import { once } from "node:events";
import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import {
  ACTIVITY_ACHIEVEMENT_TASK_GROUP,
  makeAchievementTaskId,
  makeAchievementTaskValue,
} from "../src/game-data/activity-achievement-data.js";
import { makeMonthCardTaskId } from "../src/game-data/ib-shop-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeGachaTaskId,
  makeInitialState,
  MONEY_DIAMOND,
  PlayerRepository,
} from "../src/persistence/player-repository.js";
import { COMMAND } from "../src/protocol/commands.js";
import {
  makeServerLuaCall,
  makeTaskValueSync,
  parseTaskChanges,
} from "../src/protocol/messages.js";
import {
  HEADER_SIZE,
  makePacket,
  readPacket,
  type GamePacket,
} from "../src/protocol/packet.js";
import {
  decodeFields,
  encodeVarint,
  fieldBytes,
  firstString,
} from "../src/protocol/protobuf.js";
import { createGatewayServer } from "../src/servers/gateway-server.js";

const account = "task-change-wire:local-test";
const username = "task-change-wire";
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

const task = (group: number, id: number): number => (group << 16) | id;

function request(
  socket: Socket,
  command: number,
  serial: number,
  payload: Buffer,
  finished: (packet: GamePacket) => boolean,
): Promise<GamePacket[]> {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    const packets: GamePacket[] = [];
    const timeout = setTimeout(
      () => finish(new Error(`Timed out waiting for ${command}/${serial}`)),
      5_000,
    );
    function finish(error?: Error): void {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", finish);
      if (error) reject(error);
      else resolve(packets);
    }
    function onData(chunk: Buffer): void {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= HEADER_SIZE) {
        const size = pending.readUInt32LE(4);
        if (size < HEADER_SIZE) return finish(new Error("Invalid packet size"));
        if (pending.length < size) return;
        const packet = readPacket(pending.subarray(0, size));
        pending = pending.subarray(size);
        packets.push(packet);
        if (finished(packet)) return finish();
      }
    }
    socket.on("data", onData);
    socket.once("error", finish);
    socket.write(makePacket(command, serial, payload));
  });
}

/**
 * TASK_CHANGE_REQ as the client sends it: repeated TaskInt {uint32 id, int32 value}.
 * A negative int32 goes on the wire as a 64-bit two's complement varint.
 */
function taskChangeRequest(changes: Record<number, number>): Buffer {
  return Buffer.concat(
    Object.entries(changes).map(([id, value]) =>
      fieldBytes(
        1,
        Buffer.concat([
          encodeVarint(1 << 3),
          encodeVarint(Number(id)),
          encodeVarint(2 << 3),
          encodeVarint(BigInt.asUintN(64, BigInt(value))),
        ]),
      ),
    ),
  );
}

const tasksOf = (
  packets: readonly GamePacket[],
  command: number,
): Map<number, number> =>
  new Map(
    packets
      .filter((packet) => packet.command === command)
      .flatMap((packet) => parseTaskChanges(packet.payload))
      .map(({ id, value }) => [id, value]),
  );

describe("TASK_CHANGE_REQ on the wire", () => {
  let directory: string;
  let server: Server | undefined;
  let socket: Socket | undefined;
  let players: PlayerRepository;
  let serial = 0;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-task-change-"));
    const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
    const store = new JsonStore({
      filePath: path.join(directory, "state.json"),
      initialState: makeInitialState(),
      logger,
    });
    await store.initialize();
    players = new PlayerRepository({ store, defaults: config.playerDefaults, logger });
    await players.getOrCreate(account);
    await players.completeLevel(account, 1, 6, 1, 0b111);

    server = createGatewayServer({ config, logger, players });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing bound port");
    socket = createConnection({ host: "127.0.0.1", port: address.port });
    await once(socket, "connect");
    serial = 0;
    await request(
      socket,
      COMMAND.VERIFY_REQ,
      ++serial,
      Buffer.concat([fieldBytes(1, "android"), fieldBytes(2, account)]),
      (packet) => packet.command === COMMAND.VERIFY_RSP,
    );
    await request(
      socket,
      COMMAND.LOGIN_REQ,
      ++serial,
      fieldBytes(1, username),
      (packet) => packet.command === COMMAND.LOGIN_RSP,
    );
  });

  afterEach(async () => {
    if (socket) {
      const closed = once(socket, "close");
      socket.destroy();
      await closed;
    }
    if (server?.listening) {
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await rm(directory, { recursive: true, force: true });
  });

  const change = (changes: Record<number, number>): Promise<GamePacket[]> =>
    request(
      socket!,
      COMMAND.TASK_CHANGE_REQ,
      ++serial,
      taskChangeRequest(changes),
      (packet) => packet.command === COMMAND.TASK_CHANGE_RSP,
    );
  const stored = (id: number): number | undefined =>
    players.get(account)!.taskValues[String(id)];

  it("stores client-owned writes and confirms them without a resync", async () => {
    const writes = {
      [task(1, 15)]: 6, // PlayerLogic tutorial step
      [task(1, 1_002)]: 1, // NormalActivityConfig.NewFlagBase + 2
      [task(3, 8)]: 2, // girl 1 LastHappyMode
      [task(3, 2_000 + 15)]: 4, // girl 2 SubStoryId
      [task(9, 3)]: 1, // ActivitiesLogic.nTaskKeyConfirm
      [task(10, 2_000)]: 2, // EvaluateGuide
      [task(20, 2)]: 1, // UI_NormalActivity red dot on activity 2
      [task(44, 100)]: 1, // UI_PromiseMain
      [task(301, 45)]: 1, // DiyCommon.TaskEnterRoom
    };
    const packets = await change(writes);

    for (const [id, value] of Object.entries(writes)) {
      expect(stored(Number(id)), `task ${id}`).toBe(value);
    }
    expect(Object.fromEntries(tasksOf(packets, COMMAND.TASK_CHANGE_RSP))).toEqual(
      Object.fromEntries(Object.entries(writes).map(([id, v]) => [Number(id), v])),
    );
    expect(packets.some((packet) => packet.command === COMMAND.TASK_VALUE_RSP)).toBe(
      false,
    );
  });

  it("keeps a negative client value (CoffeeCommon.lua:332 writes 31/30 = -1)", async () => {
    const id = task(31, 30);
    const packets = await change({ [id]: -1 });

    expect(stored(id)).toBe(-1);
    expect(tasksOf(packets, COMMAND.TASK_CHANGE_RSP).get(id)).toBe(-1);
    const sync = await request(
      socket!,
      COMMAND.TASK_VALUE_REQ,
      ++serial,
      Buffer.alloc(0),
      (packet) => packet.command === COMMAND.TASK_VALUE_RSP,
    );
    expect(tasksOf(sync, COMMAND.TASK_VALUE_RSP).get(id)).toBe(-1);
  });

  it("refuses to clear an achievement claim mark and sends the mark back", async () => {
    const id = makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, 4);
    const claimed = makeAchievementTaskValue(1, true);
    await players.setTaskValues(account, [{ id, value: claimed }]);
    const diamondsBefore =
      players.get(account)!.money.find((money) => money.id === MONEY_DIAMOND)?.count ??
      0;

    const packets = await change({ [id]: makeAchievementTaskValue(1, false) });

    expect(stored(id)).toBe(claimed);
    const commands = packets.map((packet) => packet.command);
    expect(commands.indexOf(COMMAND.TASK_VALUE_RSP)).toBeGreaterThanOrEqual(0);
    expect(commands.indexOf(COMMAND.TASK_VALUE_RSP)).toBeLessThan(
      commands.indexOf(COMMAND.TASK_CHANGE_RSP),
    );
    expect(tasksOf(packets, COMMAND.TASK_VALUE_RSP).get(id)).toBe(claimed);
    expect(tasksOf(packets, COMMAND.TASK_CHANGE_RSP).get(id)).toBe(claimed);

    // The claim does not pay a second time.
    const claim = await request(
      socket!,
      COMMAND.C2S_CALL_REQ,
      ++serial,
      makeServerLuaCall("NormalActivityGetAward", { nActivityId: 2, nId: 4, nType: 1 }),
      (packet) =>
        packet.command === COMMAND.NTF_S2C_CALL &&
        firstString(decodeFields(packet.payload), 1) === "MissionMgrMsg",
    );
    expect(
      JSON.parse(firstString(decodeFields(claim.at(-1)!.payload), 2)) as unknown,
    ).toEqual({ nError: 1, nMission: 0 });
    expect(
      players.get(account)!.money.find((money) => money.id === MONEY_DIAMOND)?.count ??
        0,
    ).toBe(diamondsBefore);
  });

  it("refuses to reset a gacha pity counter and sends the counter back", async () => {
    const id = makeGachaTaskId(2 + 1);
    await players.setTaskValues(account, [{ id, value: 37 }]);

    const packets = await change({ [id]: 0 });

    expect(stored(id)).toBe(37);
    expect(tasksOf(packets, COMMAND.TASK_VALUE_RSP).get(id)).toBe(37);
    expect(tasksOf(packets, COMMAND.TASK_CHANGE_RSP).get(id)).toBe(37);
  });

  it("refuses a month-card end time and sends back an explicit 0", async () => {
    const id = makeMonthCardTaskId();
    expect(stored(id)).toBeUndefined();

    const packets = await change({ [id]: 2_000_000_000 });

    expect(stored(id)).toBeUndefined();
    expect(tasksOf(packets, COMMAND.TASK_VALUE_RSP).get(id)).toBe(0);
    expect(tasksOf(packets, COMMAND.TASK_CHANGE_RSP).get(id)).toBe(0);
  });

  it("applies the client-owned part of a mixed request", async () => {
    const own = task(31, 1);
    const pity = makeGachaTaskId(2 + 1);
    await players.setTaskValues(account, [{ id: pity, value: 12 }]);

    const packets = await change({ [own]: 2026, [pity]: 0 });

    expect(stored(own)).toBe(2026);
    expect(stored(pity)).toBe(12);
    expect(Object.fromEntries(tasksOf(packets, COMMAND.TASK_CHANGE_RSP))).toEqual({
      [own]: 2026,
      [pity]: 12,
    });
    // The resync is a full TASK_VALUE_RSP, so it also holds the accepted write.
    const sync = tasksOf(packets, COMMAND.TASK_VALUE_RSP);
    expect(sync.get(pity)).toBe(12);
    expect(sync.get(own)).toBe(2026);
  });
});

// The server encodes -1 as a 64-bit varint; the int32 field must decode it as -1 again.
it("decodes a negative int32 task value", () => {
  expect(parseTaskChanges(makeTaskValueSync({ [task(31, 30)]: -1 }))).toEqual([
    { id: task(31, 30), value: -1 },
  ]);
});
