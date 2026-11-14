import { once } from "node:events";
import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import {
  ACTIVITY_ACHIEVEMENT_TASK_GROUP,
  makeAchievementTaskId,
  makeAchievementTaskValue,
} from "../src/game-data/activity-achievement-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  MONEY_DIAMOND,
  PlayerRepository,
} from "../src/persistence/player-repository.js";
import { COMMAND } from "../src/protocol/commands.js";
import { makeServerLuaCall, parseTaskChanges } from "../src/protocol/messages.js";
import {
  HEADER_SIZE,
  makePacket,
  readPacket,
  type GamePacket,
} from "../src/protocol/packet.js";
import { decodeFields, fieldBytes, firstString } from "../src/protocol/protobuf.js";
import { createGatewayServer } from "../src/servers/gateway-server.js";

const account = "activity-wire:local-test";
const username = "activity-wire";
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

interface ClientCall {
  method: string;
  parameters: Record<string, unknown>;
}

function callback(packet: GamePacket): ClientCall | null {
  if (packet.command !== COMMAND.NTF_S2C_CALL) return null;
  const fields = decodeFields(packet.payload);
  return {
    method: firstString(fields, 1),
    parameters: JSON.parse(firstString(fields, 2)) as Record<string, unknown>,
  };
}

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

it("answers event page and achievement panel claims on the wire", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-activity-wire-"));
  let server: Server | undefined;
  let socket: Socket | undefined;
  try {
    const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
    const store = new JsonStore({
      filePath: path.join(directory, "state.json"),
      initialState: makeInitialState(),
      logger,
    });
    await store.initialize();
    const players = new PlayerRepository({
      store,
      defaults: config.playerDefaults,
      logger,
    });
    await players.getOrCreate(account);
    await players.completeLevel(account, 1, 6, 1, 0b111);
    const diamondsBefore =
      players.get(account)!.money.find(({ id }) => id === MONEY_DIAMOND)?.count ?? 0;

    server = createGatewayServer({ config, logger, players });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing bound port");
    socket = createConnection({ host: "127.0.0.1", port: address.port });
    await once(socket, "connect");
    let serial = 0;
    await request(
      socket,
      COMMAND.VERIFY_REQ,
      ++serial,
      Buffer.concat([fieldBytes(1, "android"), fieldBytes(2, account)]),
      (packet) => packet.command === COMMAND.VERIFY_RSP,
    );
    const loginPackets = await request(
      socket,
      COMMAND.LOGIN_REQ,
      ++serial,
      fieldBytes(1, username),
      (packet) => packet.command === COMMAND.LOGIN_RSP,
    );
    const taskId = makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, 4);
    const tasksOf = (packets: readonly GamePacket[]): Map<number, number> =>
      new Map(
        packets
          .filter((packet) => packet.command === COMMAND.TASK_VALUE_RSP)
          .flatMap((packet) => parseTaskChanges(packet.payload))
          .map(({ id, value }) => [id, value]),
      );
    // Login tells the client that achievement 4 can be claimed.
    expect(tasksOf(loginPackets).get(taskId)).toBe(makeAchievementTaskValue(1, false));

    const claim = (method: string, parameters: Record<string, unknown>) =>
      request(
        socket!,
        COMMAND.C2S_CALL_REQ,
        ++serial,
        makeServerLuaCall(method, parameters),
        (packet) => callback(packet)?.method === "MissionMgrMsg",
      );

    // UI_NormalActivity:GetAchieveAward on activity 2.
    const first = await claim("NormalActivityGetAward", {
      nActivityId: 2,
      nId: 4,
      nType: 1,
    });
    expect(callback(first.at(-1)!)).toEqual({
      method: "MissionMgrMsg",
      parameters: { nError: 0, nMission: 0 },
    });
    // The task values reach the client before the callback that redraws the page.
    const commands = first.map(({ command }) => command);
    expect(commands.indexOf(COMMAND.TASK_VALUE_RSP)).toBeGreaterThanOrEqual(0);
    expect(commands.indexOf(COMMAND.TASK_VALUE_RSP)).toBeLessThan(
      commands.indexOf(COMMAND.NTF_S2C_CALL),
    );
    expect(tasksOf(first).get(taskId)).toBe(makeAchievementTaskValue(1, true));
    expect(
      commands.filter((command) => command === COMMAND.MONEY_UPDATE_NTF),
    ).toHaveLength(2);
    expect(
      players.get(account)!.money.find(({ id }) => id === MONEY_DIAMOND)?.count,
    ).toBe(diamondsBefore + 20);

    const second = await claim("NormalActivityGetAward", {
      nActivityId: 2,
      nId: 4,
      nType: 1,
    });
    expect(callback(second.at(-1)!)?.parameters).toEqual({ nError: 1, nMission: 0 });
    expect(
      players.get(account)!.money.find(({ id }) => id === MONEY_DIAMOND)?.count,
    ).toBe(diamondsBefore + 20);

    // UI_Achievement: MissionManager:SendToServer('AchievementGetAward', nId).
    const panel = await claim("AchievementGetAward", { nId: 2, nType: 0 });
    expect(callback(panel.at(-1)!)?.parameters).toEqual({ nError: 1, nMission: 0 });
  } finally {
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
  }
}, 20_000);
