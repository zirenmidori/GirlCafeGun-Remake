import { once } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Server, type Socket } from "node:net";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  girlMainStoryTaskKey,
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
import { decodeFields, fieldBytes, firstString } from "../src/protocol/protobuf.js";
import { createGatewayServer } from "../src/servers/gateway-server.js";

const account = "main-story-wire:local-test";
const username = "main-story-wire";
const girlId = 2;
const linkGirlId = 201;
const scratchRoot = path.resolve(import.meta.dirname, "../../tools/main-story-test");
const mainStoryKey = girlMainStoryTaskKey(girlId);
const linkMainStoryKey = girlMainStoryTaskKey(linkGirlId);
const linkMainStoryBitfield = 0b1011;

function luaReply(packet: GamePacket): { method: string; parameters: unknown } | null {
  if (packet.command !== COMMAND.NTF_S2C_CALL) return null;
  const fields = decodeFields(packet.payload);
  return {
    method: firstString(fields, 1),
    parameters: JSON.parse(firstString(fields, 2)) as unknown,
  };
}

function mainStoryReply(packet: GamePacket): Record<string, unknown> | null {
  const reply = luaReply(packet);
  if (reply?.method !== "LuaCall") return null;
  const parameters = reply.parameters as Record<string, unknown>;
  if (parameters.sCmd !== 256) return null;
  return parameters.tbParam as Record<string, unknown>;
}

function isMainStoryReply(packet: GamePacket): boolean {
  return mainStoryReply(packet) !== null;
}

function isErrorReply(packet: GamePacket): boolean {
  return luaReply(packet)?.method === "CallClientTip";
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
    const player = state.players[account];
    const owned = player?.girls.find((entry) => entry.girlId === girlId);
    if (owned) owned.level = 20;
    if (player) {
      const link = player.girls.find((entry) => entry.girlId === linkGirlId);
      if (!link)
        player.girls.push({
          girlId: linkGirlId,
          level: 1,
          exp: 0,
          modelId: 1,
          moodValue: 100,
          vigor: 100,
          flag: 0,
        });
      player.taskValues[linkMainStoryKey] = linkMainStoryBitfield;
    }
  });
  let server: Server | undefined;
  let socket: Socket | undefined;
  let serial = 0;
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
    await request(
      socket,
      COMMAND.LOGIN_REQ,
      ++serial,
      fieldBytes(1, username),
      (packet) => packet.command === COMMAND.LOGIN_RSP,
    );
  }
  async function setMainStory(id: number, value: number): Promise<GamePacket[]> {
    return request(
      socket!,
      COMMAND.C2S_CALL_REQ,
      ++serial,
      makeServerLuaCall("LuaCall", {
        sCmd: 256,
        tbParam: { nId: id, nValue: value },
      }),
      (packet) => isMainStoryReply(packet) || isErrorReply(packet),
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
    setMainStory,
    reload,
    cleanup,
    get players() {
      return players;
    },
  };
}

describe("girl main story LuaCall", () => {
  it("answers LuaCall 256 and publishes the cursor", async () => {
    const test = await fixture();
    try {
      const packets = await test.setMainStory(girlId, 1);
      expect(mainStoryReply(packets[packets.length - 1]!)).toMatchObject({
        nId: girlId,
        nValue: 1,
      });
      expect(packets.some((packet) => packet.command === COMMAND.TASK_VALUE_RSP)).toBe(
        true,
      );
      expect(test.players.get(account)!.taskValues[mainStoryKey]).toBe(1);
    } finally {
      await test.cleanup();
    }
  });

  it("keeps the cursor across relogin and accepts the next story", async () => {
    const test = await fixture();
    try {
      await test.setMainStory(girlId, 1);
      await test.reload();
      expect(test.players.get(account)!.taskValues[mainStoryKey]).toBe(1);
      const packets = await test.setMainStory(girlId, 2);
      expect(mainStoryReply(packets[packets.length - 1]!)).toMatchObject({
        nId: girlId,
        nValue: 2,
      });
      expect(test.players.get(account)!.taskValues[mainStoryKey]).toBe(2);
    } finally {
      await test.cleanup();
    }
  });

  it("refuses an unowned girl without changing the cursor", async () => {
    const test = await fixture();
    try {
      const packets = await test.setMainStory(27, 1);
      expect(isErrorReply(packets[packets.length - 1]!)).toBe(true);
      expect(test.players.get(account)!.taskValues[mainStoryKey] ?? 0).toBe(0);
    } finally {
      await test.cleanup();
    }
  });

  it("echoes the link girl bit field without validating a story row", async () => {
    const test = await fixture();
    try {
      const packets = await test.setMainStory(linkGirlId, 0);
      expect(isErrorReply(packets[packets.length - 1]!)).toBe(false);
      expect(mainStoryReply(packets[packets.length - 1]!)).toMatchObject({
        nId: linkGirlId,
        nValue: linkMainStoryBitfield,
      });
      expect(packets.some((packet) => packet.command === COMMAND.TASK_VALUE_RSP)).toBe(
        true,
      );
      expect(test.players.get(account)!.taskValues[linkMainStoryKey]).toBe(
        linkMainStoryBitfield,
      );
    } finally {
      await test.cleanup();
    }
  });
});
