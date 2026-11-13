import { once } from "node:events";
import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Server, type Socket } from "node:net";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import {
  PromiseCatalog,
  type PromiseGirlData,
} from "../src/game-data/girl-promise-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  makeLevelId,
  PlayerRepository,
  type InventoryEntryState,
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

const account = "promise-wire:local-test";
const bareUsername = "promise-wire";
const scratchRoot = path.resolve(import.meta.dirname, "../../tools/fight-menu/fantasy");

interface LuaCallback {
  method: string;
  parameters: unknown;
}
function callback(packet: GamePacket): LuaCallback | null {
  if (packet.command !== COMMAND.NTF_S2C_CALL) return null;
  const fields = decodeFields(packet.payload);
  return {
    method: firstString(fields, 1),
    parameters: JSON.parse(firstString(fields, 2)) as unknown,
  };
}
function commandCallback(packet: GamePacket, command: number): boolean {
  const call = callback(packet);
  return (
    call?.method === "LuaCall" &&
    typeof call.parameters === "object" &&
    call.parameters !== null &&
    (call.parameters as { sCmd?: number }).sCmd === command
  );
}
function luaValue(packets: readonly GamePacket[], command: number): unknown {
  const packet = packets.find((packet) => commandCallback(packet, command));
  expect(packet, `missing Lua callback ${command}`).toBeDefined();
  return (callback(packet!)!.parameters as { tbParam: unknown }).tbParam;
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
      () => finish(new Error(`Timed out waiting for request ${command}/${serial}`)),
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
          finish(new Error(`Invalid gateway packet size ${size}`));
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

function item(
  guid: number,
  genre: number,
  detail: number,
  particular: number,
  templateLevel: number,
  count: number,
): InventoryEntryState {
  return {
    guid,
    genre,
    detail,
    particular,
    templateLevel,
    count,
    createTime: 1,
    enhanceLevel: genre === 1 ? 1 : 0,
    enhanceExp: 0,
    breakLevel: 0,
    lockOn: 0,
  };
}
function countMaterial(players: PlayerRepository, detail: number): number {
  return players
    .get(account)!
    .inventory.filter(
      (entry) =>
        entry.genre === 9 &&
        entry.detail === detail &&
        entry.particular === 1 &&
        entry.templateLevel === 1,
    )
    .reduce((sum, entry) => sum + entry.count, 0);
}
function itemSyncs(packets: readonly GamePacket[]): number[][] {
  return packets
    .filter((packet) => packet.command === COMMAND.ITEM_UPDATE_NTF)
    .flatMap((packet) =>
      decodeFields(packet.payload)
        .filter((field) => field.fieldNumber === 1)
        .map((field) => {
          const fields = decodeFields(field.value as Buffer);
          return [1, 2, 3, 4, 5, 6].map((id) => firstNumber(fields, id));
        }),
    );
}

async function fixture() {
  const directory = await mkdtemp(path.join(scratchRoot, "tcp-test-"));
  const filePath = path.join(directory, "state.json");
  const warnings: { event: string; fields: unknown }[] = [];
  const logger: Logger = {
    debug() {},
    info() {},
    warn(event, fields) {
      warnings.push({ event, fields });
    },
    error() {},
    async close() {},
  };
  const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
  let store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
  await store.initialize();
  let players = new PlayerRepository({
    store,
    defaults: { ...config.playerDefaults, firstLevelComplete: false },
    logger,
  });
  await players.getOrCreate(account);
  await store.update((state) => {
    const player = state.players[account]!;
    player.inventory.push(item(20_000, 9, 16, 1, 1, 500));
    player.inventory.push(item(20_001, 1, 1, 1, 1, 1));
    player.inventory.push({
      ...item(20_002, 1, 2, 17, 5, 1),
      enhanceLevel: 70,
      breakLevel: 3,
    });
    player.inventory.push({
      ...item(20_003, 1, 1, 17, 5, 1),
      enhanceLevel: 70,
      breakLevel: 3,
    });
    player.nextItemGuid = 30_000;
    player.girls.find((girl) => girl.girlId === 2)!.level = 100;
    player.girls.push({ ...player.girls[0]!, girlId: 1, level: 100 });
    player.money.push({ id: 63, count: 100 });
  });
  let server: Server | undefined;
  let socket: Socket | undefined;
  let serial = 0;
  async function disconnect(): Promise<void> {
    if (!socket) return;
    const closed = once(socket, "close");
    socket.destroy();
    await closed;
    socket = undefined;
  }
  async function stop(): Promise<void> {
    await disconnect();
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
    if (!address || typeof address === "string")
      throw new Error("Missing gateway TCP address");
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
      fieldBytes(1, bareUsername),
      (packet) => packet.command === COMMAND.LOGIN_RSP,
    );
  }
  async function call(
    command: number,
    tbParam: unknown = {},
    terminalCommand = command,
  ): Promise<GamePacket[]> {
    return request(
      socket!,
      COMMAND.C2S_CALL_REQ,
      ++serial,
      makeServerLuaCall("LuaCall", { sCmd: command, tbParam }),
      (packet) => commandCallback(packet, terminalCommand),
    );
  }
  async function unlock(): Promise<void> {
    await store.update((state) => {
      state.players[account]!.levels.push({ id: makeLevelId(6, 12, 1), star: 15 });
    });
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
      throw new Error("Refusing cleanup outside isolated test directory");
    await rm(resolved, { recursive: true, force: true });
  }
  try {
    await start();
  } catch (error) {
    await cleanup();
    throw error;
  }
  return {
    call,
    unlock,
    reload,
    cleanup,
    warnings,
    get store() {
      return store;
    },
    get players() {
      return players;
    },
    get socket() {
      return socket!;
    },
    nextSerial() {
      return ++serial;
    },
  };
}

describe("campaign stages over TCP", () => {
  it("accepts all 486 combat stages in Chapters 1 through 15", async () => {
    const f = await fixture();
    try {
      let accepted = 0;
      for (let chapter = 1; chapter <= 15; chapter += 1) {
        const stageCount = chapter <= 3 ? 6 : 12;
        for (let difficulty = 1; difficulty <= 3; difficulty += 1) {
          for (let index = 1; index <= stageCount; index += 1) {
            const packets = await request(
              f.socket,
              COMMAND.C2S_CALL_REQ,
              f.nextSerial(),
              makeServerLuaCall("LuaCall", {
                sCmd: 252,
                tbParam: {
                  sCmd: "ChapterMsg",
                  tbParam: {
                    nState: 0,
                    Chapter: chapter,
                    Index: index,
                    Difficult: difficulty,
                    nFormationId: 1,
                  },
                },
              }),
              (packet) => callback(packet)?.method === "ChapterMsg",
            );
            expect(
              callback(packets.at(-1)!)!.parameters,
              `stage ${chapter}-${index}, difficulty ${difficulty}`,
            ).toMatchObject({
              nError: 0,
              nState: 0,
            });
            accepted += 1;
          }
        }
      }
      expect(accepted).toBe(486);
    } finally {
      await f.cleanup();
    }
  }, 45_000);

  it("acknowledges every Chapter 16 story and grants its first-clear reward once across reconnects", async () => {
    const f = await fixture();
    try {
      const stage = { Chapter: 16, Index: 9, Difficult: 1, nFormationId: 1 };
      const before = f.players.get(account)!;
      const first = await f.call(540, stage);
      expect(luaValue(first, 540)).toEqual({ tbNew: [[15, 2, 1, 1, 20]] });
      expect(first.some(({ command }) => command === COMMAND.MONEY_UPDATE_NTF)).toBe(
        true,
      );
      for (let index = 1; index <= 12; index += 1) {
        if (index === stage.Index) continue;
        expect(luaValue(await f.call(540, { ...stage, Index: index }), 540)).toEqual({
          tbNew: [[15, 2, 1, 1, 20]],
        });
      }
      const cleared = f.players.get(account)!;
      expect(cleared.levels.toSorted((a, b) => a.id - b.id)).toEqual(
        Array.from({ length: 12 }, (_, i) => ({
          id: makeLevelId(16, i + 1, 1),
          star: 15,
        })),
      );
      expect(cleared.money.find(({ id }) => id === 1)).toEqual(
        before.money.find(({ id }) => id === 1),
      );

      await f.reload();
      const repeat = await f.call(540, stage);
      expect(luaValue(repeat, 540)).toEqual({ tbNew: [] });
      expect(repeat.some(({ command }) => command === COMMAND.MONEY_UPDATE_NTF)).toBe(
        false,
      );
      expect(f.players.get(account)!.levels).toEqual(cleared.levels);
      expect(f.players.get(account)!.money).toEqual(cleared.money);
    } finally {
      await f.cleanup();
    }
  });
});

describe("Fantasy Oath actual TCP protocol", () => {
  it("gates the feature, activates once, synchronizes inventory and preserves progress across reload", async () => {
    const f = await fixture();
    try {
      // Global release availability is independent of the per-profile chapter gate.
      expect(luaValue(await f.call(230), 230)).toEqual({ PromiseIsOpen: true });
      const locked = await f.call(233, { girlid: 2 }, 231);
      expect(luaValue(locked, 233)).toBeNull();
      expect(countMaterial(f.players, 16)).toBe(500);
      expect(luaValue(await f.call(231), 231)).toEqual([]);
      expect(luaValue(await f.call(232), 232)).toEqual({
        OpenGirlList: Array.from({ length: 16 }, (_, index) => index + 1),
      });
      await f.unlock();
      expect(luaValue(await f.call(230), 230)).toEqual({ PromiseIsOpen: true });
      const activation = await f.call(233, { girlid: 2 });
      const girl = luaValue(activation, 233) as PromiseGirlData;
      expect(girl).toMatchObject({
        girlid: 2,
        step: 1,
        rewardstep: 0,
        rewardlist: [0],
      });
      expect(girl.cardguid).toBe(20_002);
      expect(girl.taskdatas.map(({ id }) => id)).toEqual([201, 207, 217, 223]);
      expect(countMaterial(f.players, 16)).toBe(490);
      const sync = itemSyncs(activation);
      expect(sync).toContainEqual([20_000, 9, 16, 1, 1, 490]);
      expect(
        f.players.get(account)!.inventory.find(({ guid }) => guid === girl.cardguid),
      ).toMatchObject({ templateLevel: 5, enhanceLevel: 70, breakLevel: 3 });
      const inventoryCount = f.players.get(account)!.inventory.length;
      const duplicate = luaValue(
        await f.call(233, { girlid: 2 }),
        233,
      ) as PromiseGirlData;
      expect(duplicate.cardguid).toBe(girl.cardguid);
      expect(countMaterial(f.players, 16)).toBe(490);
      expect(f.players.get(account)!.inventory).toHaveLength(inventoryCount);
      expect(luaValue(await f.call(234, { girlid: 2, taskid: 223 }), 234)).toEqual({
        Err: 1,
      });
      const completed = luaValue(await f.call(234, { girlid: 2, taskid: 217 }), 234);
      expect(completed).toMatchObject({ id: 217, status: 2 });
      expect(completed).not.toHaveProperty("Err");
      await f.reload();
      const restored = luaValue(await f.call(231), 231) as PromiseGirlData[];
      expect(restored).toHaveLength(1);
      expect(restored[0]).toMatchObject({
        girlid: 2,
        cardguid: girl.cardguid,
        step: 1,
      });
      expect(restored[0]!.taskdatas.find(({ id }) => id === 217)?.status).toBe(2);
      expect(countMaterial(f.players, 16)).toBe(490);
      expect(f.players.get(bareUsername)).toBeNull();
    } finally {
      await f.cleanup();
    }
  }, 20_000);

  it("keeps malformed callbacks client-safe, applies exchange limits and returns stage rewards exactly once", async () => {
    const f = await fixture();
    try {
      await f.unlock();
      for (const command of [233, 235]) {
        const packets = await f.call(command, { girlid: "2" }, 231);
        expect(luaValue(packets, command)).toBeNull();
        expect(luaValue(packets, 231)).toEqual([]);
        expect(packets.map(callback).filter(Boolean)).toContainEqual({
          method: "CallClientTip",
          parameters: ["Error.1"],
        });
      }
      expect(luaValue(await f.call(234, { girlid: 2, taskid: -1 }), 234)).toEqual({
        Err: 1,
      });
      expect(luaValue(await f.call(229, { Id: 1, Num: 0 }), 229)).toEqual({ Error: 1 });
      expect(luaValue(await f.call(239, { girlid: 2, step: 0 }), 239)).toEqual({
        girlid: 2,
        step: 0,
        ncompletedtasknum: 0,
        errid: 1,
        tbaward: [],
      });
      expect(luaValue(await f.call(229, { Id: 1, Num: 11 }), 229)).toEqual({
        Error: 1,
      });
      expect(countMaterial(f.players, 16)).toBe(500);
      const exchanged = luaValue(await f.call(229, { Id: 1, Num: 2 }), 229);
      expect(exchanged).toEqual({ Error: 0, tbAwardItem: [[9, 32, 1, 1, 2]] });
      expect(countMaterial(f.players, 16)).toBe(460);
      expect(luaValue(await f.call(229, { Id: 1, Num: 9 }), 229)).toEqual({ Error: 1 });
      expect(countMaterial(f.players, 16)).toBe(460);
      const girl = luaValue(await f.call(233, { girlid: 1 }), 233) as PromiseGirlData;
      const catalog = PromiseCatalog.loadDefault();
      // Seed a completed final stage in this isolated test save; the real route
      // must then validate thresholds and commit the award exactly once.
      await f.store.update((state) => {
        const progress = state.players[account]!.promise!.girls["1"]!;
        progress.step = 7;
        progress.rewardlist = [0];
        progress.taskdatas = catalog
          .getStep(1, 7)!
          .tasklist.map((id) => ({ id, count: catalog.task(id)!.count, status: 2 }));
      });
      const rewardPackets = await f.call(239, { girlid: 1, step: 7 });
      const reward = luaValue(rewardPackets, 239);
      expect(reward).toMatchObject({
        girlid: 1,
        step: 7,
        ncompletedtasknum: 9,
        errid: 0,
      });
      expect((reward as { tbaward: number[][] }).tbaward).toEqual(
        catalog.getStep(1, 7)!.rewards.map((row) => row.slice(0, 5)),
      );
      expect(
        rewardPackets.some((packet) => packet.command === COMMAND.ITEM_UPDATE_NTF),
      ).toBe(true);
      expect(f.players.get(account)!.promise!.girls["1"]!.cardguid).toBe(girl.cardguid);
      const inventory = structuredClone(f.players.get(account)!.inventory);
      const money = structuredClone(f.players.get(account)!.money);
      const duplicate = luaValue(await f.call(239, { girlid: 1, step: 7 }), 239) as {
        tbaward: unknown[];
      };
      expect(duplicate.tbaward).toEqual([]);
      expect(f.players.get(account)!.inventory).toEqual(inventory);
      expect(f.players.get(account)!.money).toEqual(money);
      await request(
        f.socket,
        COMMAND.C2S_CALL_REQ,
        f.nextSerial(),
        makeServerLuaCall("LuaCall", { sCmd: 237, tbParam: {} }),
        (packet) => packet.command === COMMAND.C2S_CALL_RSP,
      );
      const afterUnknown = await f.call(231);
      expect(afterUnknown.some((packet) => commandCallback(packet, 237))).toBe(false);
      expect(f.warnings).toContainEqual(
        expect.objectContaining({
          event: "lua.unhandled",
          fields: expect.objectContaining({ command: 237 }),
        }),
      );
    } finally {
      await f.cleanup();
    }
  }, 20_000);

  it("counts an Oath trial once per real run using the entry roster snapshot", async () => {
    const f = await fixture();
    try {
      await f.unlock();
      await f.store.update((state) => {
        const player = state.players[account]!;
        player.inventory.push(item(20_004, 1, 6, 1, 1, 1));
        player.girls.push({ ...player.girls[0]!, girlId: 6, level: 100 });
        player.formations[0]!.fightCards = [20_002, 20_004].map((guid) => ({
          mainCardGuid: guid,
          usedCardGuid: guid,
          secondaryCardGuids: [],
          weaponGuid: 0,
          runeItemGuids: [],
        }));
      });
      await f.call(233, { girlid: 2 });
      await f.call(233, { girlid: 6 });
      const catalog = PromiseCatalog.loadDefault();
      expect(catalog.task(223)?.lvpara).toEqual([100, 1, 10]);
      // Task223 needs one trial; actual stage7 task640 needs80 wins and can
      // distinguish a replay from a new run with an identical result payload.
      await f.store.update((state) => {
        const girl = state.players[account]!.promise!.girls["6"]!;
        girl.step = 7;
        girl.taskdatas = catalog
          .getStep(6, 7)!
          .tasklist.map((id) => ({ id, count: 0, status: 0 }));
      });
      await f.call(231); // Refresh the gateway's profile before entering combat.
      const [Chapter, Index, Difficult] = catalog.task(223)!.lvpara!;
      const formation = structuredClone(f.players.get(account)!.formations[0]!);
      const enter = {
        nState: 0,
        Chapter,
        Index,
        Difficult,
        nFormationId: formation.id,
      };
      const win = {
        nState: 1,
        Chapter,
        Index,
        Difficult,
        nStar: 7,
        nFormationId: formation.id,
        nUseTime: 30,
      };
      async function chapter(parameters: Record<string, unknown>): Promise<unknown> {
        const packets = await request(
          f.socket,
          COMMAND.C2S_CALL_REQ,
          f.nextSerial(),
          makeServerLuaCall("LuaCall", {
            sCmd: 252,
            tbParam: { sCmd: "ChapterMsg", tbParam: parameters },
          }),
          (packet) => callback(packet)?.method === "ChapterMsg",
        );
        return callback(packets.at(-1)!)!.parameters;
      }
      function progress(girlid: number, taskid: number) {
        return f.players
          .get(account)!
          .promise!.girls[String(girlid)]!.taskdatas.find(({ id }) => id === taskid)!;
      }
      expect(await chapter(enter)).toMatchObject({ nError: 0, nState: 0 });
      // The saved formation changes during combat, but the entered cards are
      // still owned. Settlement must use the server's captured entry roster.
      await f.store.update((state) => {
        state.players[account]!.formations[0]!.fightCards = [
          formation.fightCards[0]!,
        ].map((card) => ({ ...card, mainCardGuid: 10_001, usedCardGuid: 10_001 }));
      });
      expect(await chapter(win)).toMatchObject({ nError: 0, nState: 1 });
      expect(progress(2, 223)).toMatchObject({ count: 1, status: 1 });
      expect(progress(6, 640)).toMatchObject({ count: 1, status: 0 });
      const settledInventory = structuredClone(f.players.get(account)!.inventory);
      const settledMoney = structuredClone(f.players.get(account)!.money);
      expect(await chapter(win)).toMatchObject({ nError: 0, nState: 1 });
      expect(progress(2, 223).count).toBe(1);
      expect(progress(6, 640).count).toBe(1);
      expect(f.players.get(account)!.inventory).toEqual(settledInventory);
      expect(f.players.get(account)!.money).toEqual(settledMoney);
      await f.store.update((state) => {
        state.players[account]!.formations[0] = formation;
      });
      await f.call(231);
      expect(await chapter(enter)).toMatchObject({ nError: 0, nState: 0 });
      // The new entry creates a new authoritative run despite byte-identical
      // settlement JSON, so a stale payload cache must not suppress this win.
      expect(await chapter(win)).toMatchObject({ nError: 0, nState: 1 });
      expect(progress(6, 640).count).toBe(2);
      expect(f.players.get(account)!.promise!.seenFightRuns).toHaveLength(2);
    } finally {
      await f.cleanup();
    }
  }, 20_000);

  it("persists the exact three café assignment rows and rolls back duplicate or malformed rows", async () => {
    const f = await fixture();
    try {
      await f.store.update((state) => {
        state.players[account]!.cafe.level = 30;
      });
      const rows = [[[2, 1]], [[7, 1]], [[9, 1]]];
      const storedRows = [
        [{ girlId: 2, modelId: 1 }],
        [{ girlId: 7, modelId: 1 }],
        [{ girlId: 9, modelId: 1 }],
      ];
      expect(luaValue(await f.call(113, rows), 113)).toEqual(rows);
      expect(luaValue(await f.call(112), 112)).toMatchObject({ roomgirlslist: rows });
      expect(f.players.get(account)!.promise!.assignments).toEqual({
        "2": "work",
        "7": "rest",
        "9": "rest",
      });
      const savedCafe = structuredClone(f.players.get(account)!.cafe);
      const savedAssignments = structuredClone(
        f.players.get(account)!.promise!.assignments,
      );
      for (const invalid of [
        [[[2, 1]], [[2, 1]], []],
        [rows[0], rows[1]],
      ]) {
        const packets = await request(
          f.socket,
          COMMAND.C2S_CALL_REQ,
          f.nextSerial(),
          makeServerLuaCall("LuaCall", { sCmd: 113, tbParam: invalid }),
          (packet) => callback(packet)?.method === "CallClientTip",
        );
        expect(luaValue(packets, 113)).toEqual(rows);
        expect(packets.map(callback).filter(Boolean)).toContainEqual({
          method: "CallClientTip",
          parameters: ["Error.1"],
        });
        expect(f.players.get(account)!.cafe).toEqual(savedCafe);
        expect(f.players.get(account)!.promise!.assignments).toEqual(savedAssignments);
      }
      await f.reload();
      expect(luaValue(await f.call(112), 112)).toMatchObject({ roomgirlslist: rows });
      expect(f.players.get(account)!.cafe.roomGirlsList).toEqual(storedRows);
      expect(f.players.get(account)!.promise!.assignments).toEqual(savedAssignments);
    } finally {
      await f.cleanup();
    }
  }, 20_000);
});
