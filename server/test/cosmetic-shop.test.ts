import { once } from "node:events";
import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import {
  COSMETIC_NEVER_EXPIRES,
  COSMETIC_SHOP,
  cosmeticShopRow,
} from "../src/game-data/cosmetic-shop-data.js";
import { AutoUseItemCatalog } from "../src/game-data/auto-use-item-data.js";
import { makeIBShopTaskId } from "../src/game-data/ib-shop-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  PlayerRepository,
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
const NOW = Date.UTC(2026, 10, 28, 12);
const CARD = COSMETIC_SHOP.find(
  (row) => row.kind === "visitingCard" && row.type === 1,
)!;
const timedFrames = COSMETIC_SHOP.filter(
  (row) => row.kind === "headFrame" && row.type === 2,
);
const FRAME_TIMED = timedFrames[0]!;
const FRAME_TIMED_2 = timedFrames[1]!;
const ownerKey = (row: { group: number; cosmeticId: number }): string =>
  String((row.group << 16) | row.cosmeticId);
const ibKey = (row: { id: number }): string => String(makeIBShopTaskId(row.id));

async function fixture(account = "tester") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg-cosmetic-"));
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

describe("cosmetic shop table", () => {
  const catalog = AutoUseItemCatalog.loadDefault();
  it("sells each cosmetic once through its own AutoUse item", () => {
    expect(COSMETIC_SHOP.length).toBeGreaterThan(100);
    expect(new Set(COSMETIC_SHOP.map(({ id }) => id)).size).toBe(COSMETIC_SHOP.length);
    for (const row of COSMETIC_SHOP) {
      expect(row.id, `row ${row.id}`).toBeGreaterThanOrEqual(3001);
      expect(catalog.effect(...row.item), `row ${row.id}`).toEqual({
        kind: "unlock-time",
        taskIds: [(row.group << 16) | row.cosmeticId],
      });
      expect(row.type === 2 ? row.limitTime > 0 : row.limitTime === 0).toBe(true);
    }
  });
});

describe("buyCosmeticPack", () => {
  it("spends Diamonds free first and stamps a permanent cosmetic with the time", async () => {
    const { repository, store } = await fixture();
    await setMoney(store, 100, 100);
    const result = await repository.buyCosmeticPack("tester", CARD.id, NOW);
    expect(diamonds(store)).toEqual([0, 80]);
    const player = store.snapshot().players.tester!;
    expect(player.taskValues[ownerKey(CARD)]).toBe(Math.floor(NOW / 1000));
    expect(player.taskValues[ibKey(CARD)]).toBe(1);
    expect(result.updatedTaskIds).toEqual(
      expect.arrayContaining([Number(ownerKey(CARD)), Number(ibKey(CARD))]),
    );
    expect(result.updatedMoney.map(({ id }) => id).sort((a, b) => a - b)).toEqual([
      3, 12,
    ]);
    expect(player.inventory.filter(({ genre }) => genre === 6)).toEqual([]);
  });

  it("stores a timed cosmetic so that value + LimitTime never passes before 2038", async () => {
    const { repository, store } = await fixture();
    await setMoney(store, 200, 0);
    await repository.buyCosmeticPack("tester", FRAME_TIMED.id, NOW);
    const value = store.snapshot().players.tester!.taskValues[ownerKey(FRAME_TIMED)]!;
    expect(value).toBe(COSMETIC_NEVER_EXPIRES - FRAME_TIMED.limitTime);
    expect(value + FRAME_TIMED.limitTime).toBeGreaterThan(Date.UTC(2035, 0, 1) / 1000);
    expect(diamonds(store)).toEqual([140, 0]);
  });

  it("refuses a second buy and an owned cosmetic without charging", async () => {
    const { repository, store } = await fixture();
    await setMoney(store, 500, 0);
    await repository.buyCosmeticPack("tester", CARD.id, NOW);
    await expect(
      repository.buyCosmeticPack("tester", CARD.id, NOW),
    ).rejects.toMatchObject({ reason: "limit_reached", clientError: 20075 });
    expect(diamonds(store)).toEqual([380, 0]);
    await store.update((state) => {
      state.players.tester!.taskValues[ownerKey(FRAME_TIMED_2)] = 5;
    });
    await expect(
      repository.buyCosmeticPack("tester", FRAME_TIMED_2.id, NOW),
    ).rejects.toMatchObject({ reason: "limit_reached" });
    expect(diamonds(store)).toEqual([380, 0]);
  });

  it("refuses without enough Diamonds and changes nothing", async () => {
    const { repository, store } = await fixture();
    await setMoney(store, 100, 19);
    const before = store.snapshot().players.tester;
    await expect(
      repository.buyCosmeticPack("tester", CARD.id, NOW),
    ).rejects.toMatchObject({ reason: "insufficient_diamonds", clientError: 20013 });
    expect(store.snapshot().players.tester).toEqual(before);
  });

  it("rejects an unknown id", async () => {
    const { repository } = await fixture();
    expect(cosmeticShopRow(9999)).toBeUndefined();
    await expect(repository.buyCosmeticPack("tester", 9999)).rejects.toMatchObject({
      reason: "unknown_item",
      clientError: 20074,
    });
  });
});

describe("DoRecharge cosmetic over the gateway", () => {
  it("sells a permanent and a timed cosmetic and refuses the rest", async () => {
    const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
    const directory = await mkdtemp(path.join(os.tmpdir(), "gcg-cosmetic-tcp-"));
    directories.push(directory);
    const account = "cosmetic-wire:local-test";
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
      player.money = player.money.filter(({ id }) => id !== 3 && id !== 12);
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
    const taskValues = (packets: GamePacket[]) =>
      new Map(
        packets
          .filter((packet) => packet.command === COMMAND.TASK_VALUE_RSP)
          .flatMap((packet) => parseTaskChanges(packet.payload))
          .map(({ id, value }) => [id, value]),
      );
    const lastTaskIndex = (packets: GamePacket[]) =>
      packets.map((packet) => packet.command).lastIndexOf(COMMAND.TASK_VALUE_RSP);
    const free = () =>
      store.snapshot().players[account]!.money.find(({ id }) => id === 3)?.count;
    try {
      await exchange(
        COMMAND.VERIFY_REQ,
        Buffer.concat([fieldBytes(1, "android"), fieldBytes(2, account)]),
        (packet) => packet.command === COMMAND.VERIFY_RSP,
      );
      await exchange(
        COMMAND.LOGIN_REQ,
        fieldBytes(1, "cosmetic-wire"),
        (packet) => packet.command === COMMAND.LOGIN_RSP,
      );

      const started = Math.floor(Date.now() / 1000);
      const card = await recharge(CARD.id);
      expect(rechargeReply(card.at(-1)!)!.tbParam).toEqual({
        Type: 1,
        Id: CARD.id,
        Error: 0,
        tbItem: [[...CARD.item, 1]],
      });
      expect(card.some((packet) => packet.command === COMMAND.MONEY_UPDATE_NTF)).toBe(
        true,
      );
      // the task sync comes before the callback, which is the last packet
      expect(lastTaskIndex(card)).toBeGreaterThanOrEqual(0);
      expect(lastTaskIndex(card)).toBeLessThan(card.length - 1);
      const cardTasks = taskValues(card);
      expect(cardTasks.get(Number(ibKey(CARD)))).toBe(1);
      expect(cardTasks.get(Number(ownerKey(CARD)))).toBeGreaterThanOrEqual(started);

      const frame = await recharge(FRAME_TIMED.id);
      expect(rechargeReply(frame.at(-1)!)!.tbParam).toEqual({
        Type: 1,
        Id: FRAME_TIMED.id,
        Error: 0,
        tbItem: [[...FRAME_TIMED.item, 1]],
      });
      expect(lastTaskIndex(frame)).toBeLessThan(frame.length - 1);
      expect(taskValues(frame).get(Number(ownerKey(FRAME_TIMED)))).toBe(
        COSMETIC_NEVER_EXPIRES - FRAME_TIMED.limitTime,
      );
      expect(free()).toBe(200 - CARD.cost - FRAME_TIMED.cost);

      const again = await recharge(CARD.id);
      expect(rechargeReply(again.at(-1)!)!.tbParam).toMatchObject({
        Id: CARD.id,
        Error: 20075,
      });
      const poor = await recharge(FRAME_TIMED_2.id);
      expect(rechargeReply(poor.at(-1)!)!.tbParam).toMatchObject({
        Id: FRAME_TIMED_2.id,
        Error: 20013,
      });
      expect(
        store.snapshot().players[account]!.taskValues[ownerKey(FRAME_TIMED_2)],
      ).toBeUndefined();
      expect(free()).toBe(200 - CARD.cost - FRAME_TIMED.cost);
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
