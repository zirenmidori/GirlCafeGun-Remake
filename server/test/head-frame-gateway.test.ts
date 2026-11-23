import { once } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Server, type Socket } from "node:net";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import {
  HEAD_FRAME_TASK_GROUP,
  LUA_COMMAND_SET_HEAD_FRAME,
} from "../src/game-data/auto-use-item-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  PlayerRepository,
} from "../src/persistence/player-repository.js";
import { COMMAND } from "../src/protocol/commands.js";
import { makeServerLuaCall } from "../src/protocol/messages.js";
import {
  HEADER_SIZE,
  makePacket,
  readPacket,
  type GamePacket,
} from "../src/protocol/packet.js";
import {
  decodeFields,
  fieldBytes,
  firstNumber,
  firstString,
} from "../src/protocol/protobuf.js";
import { createGatewayServer } from "../src/servers/gateway-server.js";

const account = "head-frame-wire:local-test";
const username = "head-frame-wire";
const scratchRoot = path.resolve(import.meta.dirname, "../../tools/head-frame-test");
const ownedKey = String((HEAD_FRAME_TASK_GROUP << 16) | 21);

function callback(
  packet: GamePacket,
): { method: string; parameters: Record<string, unknown> } | null {
  if (packet.command !== COMMAND.NTF_S2C_CALL) return null;
  const fields = decodeFields(packet.payload);
  return {
    method: firstString(fields, 1),
    parameters: JSON.parse(firstString(fields, 2)) as Record<string, unknown>,
  };
}

function headFrameReply(packet: GamePacket): Record<string, unknown> | null {
  const call = callback(packet);
  if (call?.method !== "LuaCall" || call.parameters.sCmd !== LUA_COMMAND_SET_HEAD_FRAME)
    return null;
  return call.parameters.tbParam as Record<string, unknown>;
}

function isHeadFrameReply(packet: GamePacket): boolean {
  return headFrameReply(packet) !== null;
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
      socket.off("error", onError);
      socket.off("close", onClose);
      if (error) reject(error);
      else resolve(packets);
    }
    function onError(error: Error): void {
      finish(error);
    }
    function onClose(): void {
      finish(new Error("Gateway closed before responding"));
    }
    function onData(chunk: Buffer): void {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= HEADER_SIZE) {
        const size = pending.readUInt32LE(4);
        if (size < HEADER_SIZE) {
          finish(new Error("Invalid packet size"));
          return;
        }
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
    socket.once("error", onError);
    socket.once("close", onClose);
    socket.write(makePacket(command, serial, payload));
  });
}

async function fixture() {
  await mkdir(scratchRoot, { recursive: true });
  const directory = await mkdtemp(path.join(scratchRoot, "tcp-test-"));
  const filePath = path.join(directory, "state.json");
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    async close() {},
  };
  const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
  let store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
  await store.initialize();
  let players = new PlayerRepository({
    store,
    defaults: config.playerDefaults,
    logger,
  });
  await players.getOrCreate(account);
  await store.update((state) => {
    state.players[account]!.taskValues[ownedKey] = 1_700_000_000;
  });
  let server: Server | undefined;
  let socket: Socket | undefined;
  let serial = 0;
  let loginPackets: GamePacket[] = [];
  async function stop(): Promise<void> {
    if (socket) {
      const closed = once(socket, "close");
      socket.destroy();
      await closed;
      socket = undefined;
    }
    if (server?.listening)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    server = undefined;
  }
  async function start(): Promise<void> {
    server = createGatewayServer({ config, logger, players });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing bound port");
    socket = createConnection({ host: "127.0.0.1", port: address.port });
    await once(socket, "connect");
    await request(
      socket,
      COMMAND.VERIFY_REQ,
      ++serial,
      Buffer.concat([fieldBytes(1, "android"), fieldBytes(2, account)]),
      (packet) => packet.command === COMMAND.VERIFY_RSP,
    );
    loginPackets = await request(
      socket,
      COMMAND.LOGIN_REQ,
      ++serial,
      fieldBytes(1, username),
      (packet) => packet.command === COMMAND.LOGIN_RSP,
    );
  }
  async function setHeadFrame(value: unknown): Promise<GamePacket[]> {
    return request(
      socket!,
      COMMAND.C2S_CALL_REQ,
      ++serial,
      makeServerLuaCall("LuaCall", {
        sCmd: LUA_COMMAND_SET_HEAD_FRAME,
        tbParam: value,
      }),
      isHeadFrameReply,
    );
  }
  async function reload(): Promise<void> {
    await stop();
    await store.flush();
    store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
    await store.initialize();
    players = new PlayerRepository({ store, defaults: config.playerDefaults, logger });
    await start();
  }
  async function cleanup(): Promise<void> {
    await stop();
    await store.flush();
    const resolved = path.resolve(directory);
    if (
      !resolved.startsWith(`${scratchRoot}${path.sep}`) ||
      !path.basename(resolved).startsWith("tcp-test-")
    )
      throw new Error("Refusing cleanup outside isolated test root");
    await rm(resolved, { recursive: true, force: true });
  }
  try {
    await start();
  } catch (error) {
    await cleanup();
    throw error;
  }
  return {
    setHeadFrame,
    reload,
    cleanup,
    get store() {
      return store;
    },
    get players() {
      return players;
    },
    get loginPackets() {
      return loginPackets;
    },
  };
}

function loginHeadFrame(packets: readonly GamePacket[]): number {
  const packet = packets.find((entry) => entry.command === COMMAND.PLAYER_NTF);
  expect(packet, "missing PLAYER_NTF").toBeDefined();
  return firstNumber(decodeFields(packet!.payload), 13);
}

describe("head frame LuaCall", () => {
  it("publishes the equipped frame in PLAYER_NTF", async () => {
    const test = await fixture();
    try {
      expect(loginHeadFrame(test.loginPackets)).toBe(0);
      await test.players.setHeadFrame(account, 7);
      await test.reload();
      expect(loginHeadFrame(test.loginPackets)).toBe(7);
    } finally {
      await test.cleanup();
    }
  });

  it("accepts the default frame and replies with a bare array", async () => {
    const test = await fixture();
    try {
      const packets = await test.setHeadFrame(1);
      expect(headFrameReply(packets[packets.length - 1]!)).toEqual([1]);
      expect(test.players.get(account)!.headFrame).toBe(1);
    } finally {
      await test.cleanup();
    }
  });

  it("accepts an owned frame", async () => {
    const test = await fixture();
    try {
      const packets = await test.setHeadFrame(21);
      expect(headFrameReply(packets[packets.length - 1]!)).toEqual([21]);
      expect(test.players.get(account)!.headFrame).toBe(21);
      await test.reload();
      expect(loginHeadFrame(test.loginPackets)).toBe(21);
    } finally {
      await test.cleanup();
    }
  });

  it("rejects an unowned frame without changing the save", async () => {
    const test = await fixture();
    try {
      const packets = await test.setHeadFrame(22);
      expect(headFrameReply(packets[packets.length - 1]!)).toMatchObject({ nError: 1 });
      expect(test.players.get(account)!.headFrame).toBe(0);
    } finally {
      await test.cleanup();
    }
  });

  it("rejects invalid ids and accepts wrapped ids", async () => {
    const test = await fixture();
    try {
      for (const invalid of [-1, "abc", {}, 70_000, null]) {
        const packets = await test.setHeadFrame(invalid);
        expect(headFrameReply(packets[packets.length - 1]!)).toMatchObject({
          nError: 1,
        });
      }
      const wrapped = await test.setHeadFrame([1]);
      expect(headFrameReply(wrapped[wrapped.length - 1]!)).toEqual([1]);
      const object = await test.setHeadFrame({ id: 1 });
      expect(headFrameReply(object[object.length - 1]!)).toEqual([1]);
    } finally {
      await test.cleanup();
    }
  });
});
