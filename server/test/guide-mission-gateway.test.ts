import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createConnection, type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import {
  makeGuideMissionTaskValue,
  makeGuideTaskId,
} from "../src/game-data/guide-mission-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
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
import { mkdtemp } from "./helpers/temp.js";

const account = "guide-wire:local-test";
const username = "guide-wire";
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

function callback(packet: GamePacket): Record<string, unknown> | null {
  if (packet.command !== COMMAND.NTF_S2C_CALL) return null;
  const fields = decodeFields(packet.payload);
  if (firstString(fields, 1) !== "GirlLogic") return null;
  return JSON.parse(firstString(fields, 2)) as Record<string, unknown>;
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
      if (error) reject(error);
      else resolve(packets);
    }
    function onData(chunk: Buffer): void {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= HEADER_SIZE) {
        const size = pending.readUInt32LE(4);
        if (pending.length < size) return;
        const packet = readPacket(pending.subarray(0, size));
        pending = pending.subarray(size);
        packets.push(packet);
        if (finished(packet)) {
          finish();
          return;
        }
      }
    }
    socket.on("data", onData);
    socket.write(makePacket(command, serial, payload));
  });
}

function syncedTasks(packets: readonly GamePacket[]): Map<number, number> {
  return new Map(
    packets
      .filter((packet) => packet.command === COMMAND.TASK_VALUE_RSP)
      .flatMap((packet) => parseTaskChanges(packet.payload))
      .map(({ id, value }) => [id, value]),
  );
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function connect(): Promise<{ socket: Socket; serial: () => number }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-guide-wire-"));
  cleanups.push(() => rm(directory, { force: true, recursive: true }));
  const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
  const store = new JsonStore({
    filePath: path.join(directory, "state.json"),
    initialState: makeInitialState(),
    logger,
  });
  await store.initialize();
  cleanups.push(() => store.flush());
  const players = new PlayerRepository({
    store,
    defaults: config.playerDefaults,
    logger,
  });
  await players.getOrCreate(account);
  await store.update((state) => {
    state.players[account]!.inventory.push({
      guid: 900_001,
      genre: 5,
      detail: 2,
      particular: 1,
      templateLevel: 1,
      count: 10,
      createTime: 0,
      enhanceLevel: 0,
      enhanceExp: 0,
      breakLevel: 0,
      lockOn: 0,
    });
  });

  const server: Server = createGatewayServer({ config, logger, players });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing bound port");
  const socket = createConnection({ host: "127.0.0.1", port: address.port });
  await once(socket, "connect");
  cleanups.push(async () => {
    const closed = once(socket, "close");
    socket.destroy();
    await closed;
  });

  let serial = 0;
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
  return { socket, serial: () => ++serial };
}

describe("guide mission gateway", () => {
  it("sends mission 40018 to the client after a gift that unlocks nothing", async () => {
    const { socket, serial } = await connect();

    const packets = await request(
      socket,
      COMMAND.C2S_CALL_REQ,
      serial(),
      makeServerLuaCall("GirlLogic", {
        sCmd: "GirlGift",
        nId: 7,
        tbItem: [5, 2, 1, 1],
        ItemNum: 1,
      }),
      (packet) => callback(packet)?.sCmd === "GirlGift",
    );

    expect(
      packets.map(callback).find((call) => call?.sCmd === "GirlGift"),
    ).toMatchObject({ nId: 7, bLove: false });
    expect(syncedTasks(packets).get(makeGuideTaskId(40_018))).toBe(
      makeGuideMissionTaskValue(1, false),
    );
  });
});
