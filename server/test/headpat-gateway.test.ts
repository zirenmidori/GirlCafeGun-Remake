import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createConnection, type Server, type Socket } from "node:net";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import {
  dailyMissionProgress,
  makeDailyMissionTaskId,
} from "../src/game-data/daily-mission-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  makeLevelId,
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

const account = "headpat-wire:local-test";
const username = "headpat-wire";
const scratchRoot = path.resolve(import.meta.dirname, "../../tools/headpat-fix");
const chargeKey = String((2 << 16) | 101);
const refillKey = String((2 << 16) | 102);
const dailyKey = String(makeDailyMissionTaskId(105));

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
function headpatResponse(packets: readonly GamePacket[]): Record<string, unknown> {
  const call = packets
    .map(callback)
    .find(
      (entry) =>
        entry?.method === "GirlLogic" && entry.parameters.sCmd === "HeadTouched",
    );
  expect(call, "missing safe HeadTouched callback").toBeDefined();
  return call!.parameters;
}
function isHeadpatCallback(packet: GamePacket): boolean {
  const call = callback(packet);
  return call?.method === "GirlLogic" && call.parameters.sCmd === "HeadTouched";
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
function syncedTasks(packets: readonly GamePacket[]): Map<number, number> {
  return new Map(
    packets
      .filter((packet) => packet.command === COMMAND.TASK_VALUE_RSP)
      .flatMap((packet) => parseTaskChanges(packet.payload))
      .map(({ id, value }) => [id, value]),
  );
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
    const player = state.players[account]!;
    player.girls.push({ ...player.girls[0]!, girlId: 10, level: 100, exp: 0 });
    player.levels.push({ id: makeLevelId(6, 12, 1), star: 15 });
    player.inventory.push({
      guid: 900_000,
      genre: 9,
      detail: 16,
      particular: 1,
      templateLevel: 1,
      count: 100,
      createTime: 1,
      enhanceLevel: 0,
      enhanceExp: 0,
      breakLevel: 0,
      lockOn: 0,
    });
  });
  await players.handlePromiseRequest(account, 233, { tbParam: { girlid: 10 } });
  // Model the real old save: neither field exists. Login must repair this once.
  await store.update((state) => {
    const tasks = state.players[account]!.taskValues;
    delete tasks[chargeKey];
    delete tasks[refillKey];
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
  async function headpat(
    parameters: Record<string, unknown>,
    requestedSerial = ++serial,
  ): Promise<GamePacket[]> {
    return request(
      socket!,
      COMMAND.C2S_CALL_REQ,
      requestedSerial,
      makeServerLuaCall("GirlLogic", { sCmd: "HeadTouched", ...parameters }),
      isHeadpatCallback,
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
    headpat,
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
    nextSerial() {
      return ++serial;
    },
  };
}
function oathCount(players: PlayerRepository): number {
  return players
    .get(account)!
    .promise!.girls["10"]!.taskdatas.find((task) => task.id === 1024)!.count;
}
function dailyCount(players: PlayerRepository): number {
  return dailyMissionProgress(players.get(account)!.taskValues[dailyKey] ?? 0);
}

describe("headpat actual TCP protocol", () => {
  it("repairs legacy login charges and counts valid capped-affection gestures exactly once across packet retry and reload", async () => {
    const f = await fixture();
    try {
      expect(f.players.get(account)!.taskValues[chargeKey]).toBe(5);
      expect(f.players.get(account)!.taskValues[refillKey]).toBe(0);
      expect(syncedTasks(f.loginPackets).get(Number(chargeKey))).toBe(5);
      const originalGirl = f.players
        .get(account)!
        .girls.find((girl) => girl.girlId === 10)!;
      const serial = f.nextSerial();
      const firstPackets = await f.headpat({ nId: 10, nType: 0 }, serial);
      const first = headpatResponse(firstPackets);
      expect(first).toMatchObject({
        sCmd: "HeadTouched",
        nId: 10,
        nType: 0,
        nIsMaxlevel: true,
        nAddExp: 0,
        nOldExp: 0,
        nNewExp: 0,
        nOldLevel: 100,
        nNewLevel: 100,
      });
      expect(Object.hasOwn(first, "nError")).toBe(false);
      expect(syncedTasks(firstPackets).get(Number(chargeKey))).toBe(4);
      expect(f.players.get(account)!.taskValues[chargeKey]).toBe(4);
      expect(f.players.get(account)!.taskValues[refillKey]).toBeGreaterThan(0);
      expect(oathCount(f.players)).toBe(1);
      expect(dailyCount(f.players)).toBe(1);
      expect(f.players.get(account)!.girls.find((girl) => girl.girlId === 10)).toEqual(
        originalGirl,
      );
      const afterFirst = f.players.get(account);
      const retry = headpatResponse(await f.headpat({ nId: 10, nType: 0 }, serial));
      expect(retry).toEqual(first);
      expect(f.players.get(account)).toEqual(afterFirst);
      headpatResponse(await f.headpat({ nId: 10, nType: 1 }));
      expect(f.players.get(account)!.taskValues[chargeKey]).toBe(3);
      expect(oathCount(f.players)).toBe(2);
      expect(dailyCount(f.players)).toBe(2);
      await f.reload();
      expect(f.players.get(account)!.taskValues[chargeKey]).toBe(3);
      expect(syncedTasks(f.loginPackets).get(Number(chargeKey))).toBe(3);
      expect(oathCount(f.players)).toBe(2);
      expect(dailyCount(f.players)).toBe(2);
    } finally {
      await f.cleanup();
    }
  }, 20_000);

  it("rejects invalid and exhausted gestures without mutation while tutorial animation remains free", async () => {
    const f = await fixture();
    try {
      await f.store.update((state) => {
        const tasks = state.players[account]!.taskValues;
        tasks[chargeKey] = 0;
        tasks[refillKey] = Math.floor(Date.now() / 1_000);
      });
      const before = f.players.get(account);
      for (const parameters of [
        { nId: 10, nType: 0 },
        { nId: 999, nType: 1 },
        { nId: 10, nType: 9 },
        { nId: "10", nType: 0 },
        { nId: 10 },
      ]) {
        const result = headpatResponse(await f.headpat(parameters));
        expect(result.nError).toBeGreaterThan(0);
        expect(f.players.get(account)).toEqual(before);
      }
      const tutorial = headpatResponse(await f.headpat({ nId: 10, nType: 2 }));
      expect(tutorial).toEqual({ sCmd: "HeadTouched", nId: 10, nType: 2 });
      expect(Object.hasOwn(tutorial, "nError")).toBe(false);
      expect(f.players.get(account)).toEqual(before);
      expect(oathCount(f.players)).toBe(0);
      expect(dailyCount(f.players)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }, 20_000);

  it("synchronizes genuine affection gains and announces a newly earned oath task", async () => {
    const f = await fixture();
    try {
      const girlBefore = f.players
        .get(account)!
        .girls.find((girl) => girl.girlId === 2)!;
      const packets = await f.headpat({ nId: 2, nType: 0 });
      const result = headpatResponse(packets);
      expect(result.nAddExp).toBeGreaterThan(0);
      expect(result.nOldExp).toBe(girlBefore.exp);
      expect(result.nOldLevel).toBe(girlBefore.level);
      const girlAfter = f.players
        .get(account)!
        .girls.find((girl) => girl.girlId === 2)!;
      expect(result.nNewExp).toBe(girlAfter.exp);
      expect(result.nNewLevel).toBe(girlAfter.level);
      expect(packets.some((packet) => packet.command === COMMAND.GIRL_UPDATE_NTF)).toBe(
        true,
      );
      expect(oathCount(f.players)).toBe(0);
      expect(dailyCount(f.players)).toBe(1);
      await f.store.update((state) => {
        const task = state.players[account]!.promise!.girls["10"]!.taskdatas.find(
          (entry) => entry.id === 1024,
        )!;
        task.count = 29;
        task.status = 0;
      });
      const completed = await f.headpat({ nId: 10, nType: 1 });
      expect(oathCount(f.players)).toBe(30);
      expect(
        f.players
          .get(account)!
          .promise!.girls["10"]!.taskdatas.find((entry) => entry.id === 1024)!.status,
      ).toBe(1);
      expect(completed.map(callback).filter(Boolean)).toContainEqual({
        method: "LuaCall",
        parameters: { sCmd: 238, tbParam: { taskId: 1024 } },
      });
    } finally {
      await f.cleanup();
    }
  }, 20_000);
});
