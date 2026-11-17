import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import {
  AutoUseItemCatalog,
  MAIN_BACKGROUND_TASK_GROUP,
} from "../src/game-data/auto-use-item-data.js";
import { PromiseCatalog } from "../src/game-data/girl-promise-data.js";
import { COSTUME_PACKS } from "../src/game-data/costume-shop-data.js";
import { makeIBShopTaskId } from "../src/game-data/ib-shop-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  IBShopError,
  makeInitialState,
  PlayerRepository,
  suitTaskId,
  type InventoryEntryState,
  type PersistedState,
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

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

const defaults = {
  name: "",
  level: 1,
  exp: 0,
  fightPower: 0,
  serverZone: 8,
  firstLevelComplete: false,
};
const PACK = 1007;
const NOW = Date.UTC(2026, 10, 6, 12);
const SUIT_KEY = "283855";
const IB_KEY = String(makeIBShopTaskId(PACK));
const BACKGROUND_KEY = String((MAIN_BACKGROUND_TASK_GROUP << 16) | 2004);

async function fixture(account = "tester") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg-costume-"));
  directories.push(directory);
  const filePath = path.join(directory, "state.json");
  const store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
  await store.initialize();
  const repository = new PlayerRepository({ store, defaults, logger });
  await repository.getOrCreate(account);
  return { repository, store, filePath };
}

function setMoney(
  store: JsonStore<PersistedState>,
  free: number,
  paid: number,
): Promise<void> {
  return store.update((state) => {
    const player = state.players.tester!;
    player.money = player.money.filter(({ id }) => id !== 3 && id !== 12);
    player.money.push({ id: 3, count: free }, { id: 12, count: paid });
  });
}
function diamonds(store: JsonStore<PersistedState>): [number, number] {
  const money = store.snapshot().players.tester!.money;
  return [
    money.find(({ id }) => id === 3)?.count ?? 0,
    money.find(({ id }) => id === 12)?.count ?? 0,
  ];
}
function stack(guid: number, gdpl: readonly number[]): InventoryEntryState {
  return {
    guid,
    genre: gdpl[0]!,
    detail: gdpl[1]!,
    particular: gdpl[2]!,
    templateLevel: gdpl[3]!,
    count: 1,
    createTime: 0,
    enhanceLevel: 0,
    enhanceExp: 0,
    breakLevel: 0,
    lockOn: 0,
  };
}
function deadStacks(player: { inventory: InventoryEntryState[] }) {
  return player.inventory.filter(
    (item) => item.genre === 19 || (item.genre === 6 && item.detail === 25),
  );
}

describe("costume auto-use rules", () => {
  const catalog = AutoUseItemCatalog.loadDefault();
  it("maps costume and background items to ownership tasks", () => {
    expect(catalog.effect(19, 1, 7, 4)).toEqual({
      kind: "suit",
      girlId: 11,
      modelId: 7001,
    });
    expect(catalog.effect(19, 2, 22, 4)).toEqual({
      kind: "suit",
      girlId: 6,
      modelId: 5018,
    });
    expect(catalog.effect(13, 2, 1, 6035)).toMatchObject({ kind: "none" });
    expect(catalog.effect(6, 25, 4, 3)).toEqual({
      kind: "unlock-flag",
      taskIds: [(87 << 16) | 2004],
    });
  });

  it("matches every pack to the recorded ownership rows", async () => {
    const oracle = JSON.parse(
      await readFile("resources/test-profile-catalog.json", "utf8"),
    ) as {
      suitOwnership: { girlId: number; modelId: number; taskKey: number }[];
      backgroundOwnership: { id: number; taskKey: number }[];
    };
    expect(COSTUME_PACKS).toHaveLength(41);
    for (const pack of COSTUME_PACKS) {
      const effect = catalog.effect(...pack.suit);
      expect(effect).toEqual({
        kind: "suit",
        girlId: pack.girlId,
        modelId: pack.modelId,
      });
      const key = suitTaskId(pack.girlId, pack.modelId);
      const row = oracle.suitOwnership.find(
        (entry) => entry.girlId === pack.girlId && entry.modelId === pack.modelId,
      );
      expect(row?.taskKey, `pack ${pack.id}`).toBe(key);
      for (const [genre, detail, particular, level] of pack.contents) {
        if (genre !== 6 || detail !== 25) continue;
        const background = catalog.effect(genre, detail, particular, level);
        const taskId = (87 << 16) | (2000 + particular);
        expect(background).toEqual({ kind: "unlock-flag", taskIds: [taskId] });
        expect(
          oracle.backgroundOwnership.some((entry) => entry.taskKey === taskId),
          `pack ${pack.id} background ${particular}`,
        ).toBe(true);
      }
    }
  });
});

describe("buyCostumePack", () => {
  it("spends Diamonds and unlocks the costume and background", async () => {
    const { repository, store } = await fixture();
    await setMoney(store, 200, 0);
    const result = await repository.buyCostumePack("tester", PACK);
    expect(diamonds(store)).toEqual([62, 0]);
    const player = store.snapshot().players.tester!;
    expect(player.taskValues[SUIT_KEY]).toBe(1);
    expect(player.taskValues[IB_KEY]).toBe(1);
    expect(player.taskValues[BACKGROUND_KEY]).toBe(1);
    expect(deadStacks(player)).toEqual([]);
    expect(result.updatedMoney.map(({ id }) => id)).toContain(3);
    expect(result.updatedTaskIds).toEqual(
      expect.arrayContaining([
        Number(SUIT_KEY),
        Number(IB_KEY),
        Number(BACKGROUND_KEY),
      ]),
    );
    await expect(repository.buyCostumePack("tester", PACK)).rejects.toMatchObject({
      reason: "limit_reached",
      clientError: 20075,
    });
    expect(diamonds(store)).toEqual([62, 0]);
  });

  it("spends free Diamonds first, then paid ones", async () => {
    const { repository, store } = await fixture();
    await setMoney(store, 100, 100);
    await repository.buyCostumePack("tester", PACK);
    expect(diamonds(store)).toEqual([0, 62]);
  });

  it("refuses without enough Diamonds and changes nothing", async () => {
    const { repository, store } = await fixture();
    await setMoney(store, 100, 37);
    const before = store.snapshot().players.tester;
    await expect(repository.buyCostumePack("tester", PACK)).rejects.toMatchObject({
      reason: "insufficient_diamonds",
      clientError: 20013,
    });
    expect(store.snapshot().players.tester).toEqual(before);
  });

  it("refuses a costume the player already owns", async () => {
    const { repository, store } = await fixture();
    await setMoney(store, 500, 0);
    await store.update((state) => {
      state.players.tester!.taskValues[SUIT_KEY] = 2;
    });
    await expect(repository.buyCostumePack("tester", PACK)).rejects.toBeInstanceOf(
      IBShopError,
    );
    expect(diamonds(store)).toEqual([500, 0]);
    expect(store.snapshot().players.tester!.taskValues[SUIT_KEY]).toBe(2);
  });

  it("rejects an unknown pack", async () => {
    const { repository } = await fixture();
    await expect(repository.buyCostumePack("tester", 9999)).rejects.toMatchObject({
      reason: "unknown_item",
      clientError: 20074,
    });
  });
});

describe("dead costume stacks in old saves", () => {
  it("turns them into ownership on load and removes the stacks", async () => {
    const { store, filePath } = await fixture();
    await store.update((state) => {
      state.players.tester!.inventory.push(
        stack(910_001, [19, 2, 22, 4]),
        stack(910_002, [6, 25, 20, 3]),
      );
    });
    await store.flush();
    const reopened = new JsonStore({
      filePath,
      initialState: makeInitialState(),
      logger,
    });
    await reopened.initialize();
    const loaded = new PlayerRepository({ store: reopened, defaults, logger });
    const player = await loaded.getOrCreate("tester");
    expect(player.taskValues[String(suitTaskId(6, 5018))]).toBe(1);
    expect(player.taskValues[String((87 << 16) | 2020)]).toBe(1);
    expect(deadStacks(player)).toEqual([]);
    const again = await loaded.getOrCreate("tester");
    expect(again.taskValues[String(suitTaskId(6, 5018))]).toBe(1);
  });
});

describe("oath step 7 reward", () => {
  it("unlocks the costume instead of keeping a stack", async () => {
    const { repository, store } = await fixture();
    await store.update((state) => {
      const p = state.players.tester!;
      p.levels.push({ id: (6 << 16) | (12 << 8) | 1, star: 15 });
      p.nextItemGuid = 2_000_000;
      p.inventory.push(stack(900_001, [9, 16, 1, 1]));
      p.inventory[p.inventory.length - 1]!.count = 1000;
      if (!p.girls.some((g) => g.girlId === 6))
        p.girls.push({
          girlId: 6,
          level: 100,
          exp: 0,
          modelId: 1,
          moodValue: 100,
          vigor: 100,
          flag: 0,
        });
    });
    await repository.handlePromiseRequest("tester", 233, { girlid: 6 }, NOW);
    await store.update((state) => {
      const g = state.players.tester!.promise!.girls["6"]!;
      g.step = 7;
      g.rewardstep = 6;
      g.rewardlist = [0];
      g.taskdatas = PromiseCatalog.loadDefault()
        .getStep(6, 7)!
        .tasklist.map((id) => ({ id, count: 0, status: 2 }));
    });
    await repository.handlePromiseRequest("tester", 239, { girlid: 6, step: 7 }, NOW);
    const player = store.snapshot().players.tester!;
    expect(player.taskValues[String(suitTaskId(6, 5018))]).toBeGreaterThan(0);
    expect(deadStacks(player)).toEqual([]);
  });
});

describe("DoRecharge costume pack over the gateway", () => {
  it("answers Id 1007 with the contents and Id 9999 with 20074", async () => {
    const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
    const directory = await mkdtemp(path.join(os.tmpdir(), "gcg-costume-tcp-"));
    directories.push(directory);
    const account = "costume-wire:local-test";
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
    await store.update((state) => {
      const player = state.players[account]!;
      player.money = player.money.filter(({ id }) => id !== 3);
      player.money.push({ id: 3, count: 200 });
    });
    const server: Server = createGatewayServer({ config, logger, players });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const socket: Socket = createConnection({ host: "127.0.0.1", port: address.port });
    await once(socket, "connect");
    let serial = 0;
    const exchange = (
      command: number,
      payload: Buffer,
      done: (packet: GamePacket) => boolean,
    ): Promise<GamePacket[]> =>
      new Promise((resolve, reject) => {
        let pending = Buffer.alloc(0);
        const packets: GamePacket[] = [];
        const timer = setTimeout(() => reject(new Error("timeout")), 5_000);
        const onData = (chunk: Buffer): void => {
          pending = Buffer.concat([pending, chunk]);
          while (pending.length >= HEADER_SIZE) {
            const size = pending.readUInt32LE(4);
            if (pending.length < size) return;
            const packet = readPacket(pending.subarray(0, size));
            pending = pending.subarray(size);
            packets.push(packet);
            if (done(packet)) {
              clearTimeout(timer);
              socket.off("data", onData);
              resolve(packets);
              return;
            }
          }
        };
        socket.on("data", onData);
        socket.write(makePacket(command, ++serial, payload));
      });
    const rechargeReply = (packet: GamePacket) => {
      if (packet.command !== COMMAND.NTF_S2C_CALL) return null;
      const parameters = JSON.parse(firstString(decodeFields(packet.payload), 2)) as {
        sCmd?: number;
        tbParam?: Record<string, unknown>;
      };
      return parameters.sCmd === 10000 ? parameters : null;
    };
    const recharge = (id: number) =>
      exchange(
        COMMAND.C2S_CALL_REQ,
        makeServerLuaCall("LuaCall", { sCmd: 10000, tbParam: { Type: 1, Id: id } }),
        (packet) => rechargeReply(packet) !== null,
      );
    try {
      await exchange(
        COMMAND.VERIFY_REQ,
        Buffer.concat([fieldBytes(1, "android"), fieldBytes(2, account)]),
        (packet) => packet.command === COMMAND.VERIFY_RSP,
      );
      await exchange(
        COMMAND.LOGIN_REQ,
        fieldBytes(1, "costume-wire"),
        (packet) => packet.command === COMMAND.LOGIN_RSP,
      );
      const bought = await recharge(PACK);
      const reply = rechargeReply(bought.at(-1)!)!;
      const pack = COSTUME_PACKS.find(({ id }) => id === PACK)!;
      expect(reply.tbParam).toEqual({
        Type: 1,
        Id: PACK,
        Error: 0,
        tbItem: pack.contents,
      });
      expect(bought.some((packet) => packet.command === COMMAND.MONEY_UPDATE_NTF)).toBe(
        true,
      );
      const tasks = new Map(
        bought
          .filter((packet) => packet.command === COMMAND.TASK_VALUE_RSP)
          .flatMap((packet) => parseTaskChanges(packet.payload))
          .map(({ id, value }) => [id, value]),
      );
      expect(tasks.get(Number(SUIT_KEY))).toBe(1);
      expect(tasks.get(Number(IB_KEY))).toBe(1);

      const unknown = await recharge(9999);
      expect(rechargeReply(unknown.at(-1)!)!.tbParam).toMatchObject({
        Id: 9999,
        Error: 20074,
      });
    } finally {
      socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await store.flush();
    }
  }, 20_000);
});
