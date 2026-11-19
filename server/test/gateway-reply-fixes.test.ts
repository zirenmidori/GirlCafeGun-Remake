import { once } from "node:events";
import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { CARD_MAXIMUM_ENHANCE_LEVEL } from "../src/game-data/card-enhancement-data.js";
import {
  dailyMissionProgress,
  hasClaimedDailyMission,
  makeDailyMissionTaskId,
} from "../src/game-data/daily-mission-data.js";
import { GachaCatalog } from "../src/game-data/gacha-data.js";
import { ShopCatalog, type GoodsConfig } from "../src/game-data/shop-data.js";
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

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};
const LUA_COMMAND_CARD_LEVEL_UP_COMMON = 5;
const LUA_COMMAND_SHOP_BUY_GOODS = 13;
// Long enough for a loaded test run; the reply comes within a few milliseconds when it comes at all.
const WINDOW_MS = 2_000;

type TestStore = JsonStore<ReturnType<typeof makeInitialState>>;

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

function clientCalls(packets: readonly GamePacket[]): ClientCall[] {
  return packets.map(callback).filter((entry): entry is ClientCall => entry !== null);
}

/** Collects every packet that arrives in a short window; never stops at the first match. */
function collect(
  socket: Socket,
  command: number,
  serial: number,
  payload: Buffer,
  windowMs = WINDOW_MS,
): Promise<GamePacket[]> {
  return new Promise((resolve) => {
    let pending = Buffer.alloc(0);
    const packets: GamePacket[] = [];
    const timer = setTimeout(finish, windowMs);
    function finish() {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("close", finish);
      socket.off("error", finish);
      resolve(packets);
    }
    function onData(chunk: Buffer) {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= HEADER_SIZE) {
        const size = pending.readUInt32LE(4);
        if (size < HEADER_SIZE || pending.length < size) return;
        packets.push(readPacket(pending.subarray(0, size)));
        pending = pending.subarray(size);
      }
    }
    socket.on("data", onData);
    socket.once("close", finish);
    socket.once("error", finish);
    socket.write(makePacket(command, serial, payload));
  });
}

async function withGateway(
  account: string,
  prepare: (store: TestStore, players: PlayerRepository) => Promise<void>,
  run: (
    call: (method: string, parameters: unknown) => Promise<GamePacket[]>,
    store: TestStore,
    players: PlayerRepository,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg-reply-fixes-"));
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
  await prepare(store, players);
  const server = createGatewayServer({ config, logger, players });
  let socket: Socket | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    socket = createConnection({ host: "127.0.0.1", port: address.port });
    await once(socket, "connect");
    let serial = 1;
    const login = await collect(
      socket,
      COMMAND.LOGIN_REQ,
      serial,
      fieldBytes(1, account),
      300,
    );
    expect(login.some((packet) => packet.command === COMMAND.LOGIN_RSP)).toBe(true);
    await run(
      (method, parameters) =>
        collect(
          socket!,
          COMMAND.C2S_CALL_REQ,
          ++serial,
          makeServerLuaCall(method, parameters),
        ),
      store,
      players,
    );
  } finally {
    socket?.destroy();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await store.flush();
    await rm(directory, { recursive: true, force: true });
  }
}

it("answers a card enhance at the level cap with the Error.1 LuaCall and changes nothing", async () => {
  const account = "reply-fix-cap";
  let guid = 0;
  await withGateway(
    account,
    async (store) => {
      await store.update((state) => {
        const player = state.players[account]!;
        const card = player.inventory.find(({ genre }) => genre === 1)!;
        card.enhanceLevel = CARD_MAXIMUM_ENHANCE_LEVEL;
        guid = card.guid;
        player.inventory.push({
          guid: player.nextItemGuid++,
          genre: 7,
          detail: 1,
          particular: 4,
          templateLevel: 4,
          count: 21,
          enhanceLevel: 0,
          enhanceExp: 0,
          breakLevel: 0,
          lockOn: 0,
          createTime: 1,
        });
      });
    },
    async (call, store) => {
      const before = structuredClone(store.snapshot().players[account]!);
      const packets = await call("LuaCall", {
        sCmd: LUA_COMMAND_CARD_LEVEL_UP_COMMON,
        tbParam: {
          guid,
          clientlv: CARD_MAXIMUM_ENHANCE_LEVEL,
          clientSkillLv: 0,
          items: [[1, 24, 1]],
        },
      });
      expect(clientCalls(packets)).toEqual([
        {
          method: "LuaCall",
          parameters: {
            sCmd: LUA_COMMAND_CARD_LEVEL_UP_COMMON,
            tbParam: { errorKey: "Error.1" },
          },
        },
      ]);
      const after = store.snapshot().players[account]!;
      expect(after.inventory).toEqual(before.inventory);
      expect(after.money).toEqual(before.money);
    },
  );
}, 15_000);

it("pushes the task values after a shop purchase so daily mission 108 reaches the client", async () => {
  const account = "reply-fix-shop";
  const catalog = ShopCatalog.loadDefault();
  let goods: GoodsConfig | undefined;
  for (let goodsId = 1; goodsId < 200_000 && !goods; goodsId++) {
    const candidate = catalog.getGoods(goodsId);
    const tab = candidate ? catalog.getTab(candidate.shopId) : null;
    if (
      candidate &&
      tab &&
      tab.onOff === 1 &&
      tab.refreshRule !== 1 &&
      tab.begin === null &&
      tab.end === null &&
      candidate.genre !== 11 &&
      candidate.begin === null &&
      candidate.end === null &&
      candidate.needCafeLevel === 0 &&
      candidate.goodsNum === 1 &&
      candidate.sellingPrice.length === 1 &&
      candidate.sellingPrice[0]! > 0 &&
      candidate.refreshLimitNum === null &&
      candidate.shelfLifeLmt === null
    )
      goods = candidate;
  }
  expect(goods, "no plain shop goods in the catalog").toBeDefined();
  const bought = goods!;
  const taskId = makeDailyMissionTaskId(108);
  await withGateway(
    account,
    async (store) => {
      await store.update((state) => {
        const player = state.players[account]!;
        const money = player.money.find(({ id }) => id === bought.moneyType);
        if (money) money.count = 100_000_000;
        else player.money.push({ id: bought.moneyType, count: 100_000_000 });
        delete player.taskValues[String(taskId)];
      });
    },
    async (call, _store, players) => {
      const packets = await call("LuaCall", {
        sCmd: LUA_COMMAND_SHOP_BUY_GOODS,
        tbParam: { shopid: bought.shopId, goodsid: bought.goodsId, buynum: 1 },
      });
      expect(
        clientCalls(packets).filter(
          (entry) => entry.parameters.sCmd === LUA_COMMAND_SHOP_BUY_GOODS,
        ),
      ).toHaveLength(1);
      const syncs = packets.filter(
        (packet) => packet.command === COMMAND.TASK_VALUE_RSP,
      );
      expect(syncs).toHaveLength(1);
      const value = parseTaskChanges(syncs[0]!.payload).find(({ id }) => id === taskId);
      expect(value, "daily mission 108 is missing from TASK_VALUE_RSP").toBeDefined();
      expect(dailyMissionProgress(value!.value)).toBe(1);
      expect(hasClaimedDailyMission(value!.value)).toBe(false);
      expect(players.get(account)!.taskValues[String(taskId)]).toBe(value!.value);
    },
  );
}, 15_000);

it("answers GetLastGacha without enough diamonds as a Lottery error and not as GetLastGacha", async () => {
  const account = "reply-fix-gacha";
  const pools = GachaCatalog.loadDefault();
  const pool = pools.get(1)!;
  await withGateway(
    account,
    async (store, players) => {
      const roll = pools.rollPool(
        pool,
        false,
        { pity: 0, upPity: 0, total: 0 },
        new Set(),
        [],
        () => 0,
      );
      await players.savePendingGacha(account, pool.id, false, roll);
      await store.update((state) => {
        const player = state.players[account]!;
        for (const money of player.money) money.count = 0;
        player.inventory = player.inventory.filter(
          (item) =>
            ![pool.costOne, pool.costTen].some(
              (cost) =>
                cost &&
                item.genre === cost[0] &&
                item.detail === cost[1] &&
                item.particular === cost[2] &&
                item.templateLevel === cost[3],
            ),
        );
      });
    },
    async (call, store) => {
      const before = structuredClone(store.snapshot().players[account]!);
      const packets = await call("GetLastGacha", true);
      expect(clientCalls(packets)).toEqual([
        { method: "Lottery", parameters: { err: "error.gacha.cash" } },
      ]);
      const after = store.snapshot().players[account]!;
      expect(after.gacha.pending).toEqual(before.gacha.pending);
      expect(after.inventory).toEqual(before.inventory);
    },
  );
}, 15_000);

it("lets the first 10-pull re-roll for free, spends the permit once on save, and closes the pool after", async () => {
  // The first 10-pull (pool 666, the story permit) is an infinite
  // re-roll; only the accepted roll is granted, and the permit is spent on accept.
  const account = "reply-fix-first-ten";
  const pools = GachaCatalog.loadDefault();
  const pool = pools.get(666)!;
  expect(pool.judgeType).toBe(2);
  const permit = pool.costTen!;
  const isPermit = (item: {
    genre: number;
    detail: number;
    particular: number;
    templateLevel: number;
  }) =>
    item.genre === permit[0] &&
    item.detail === permit[1] &&
    item.particular === permit[2] &&
    item.templateLevel === permit[3];
  await withGateway(
    account,
    async (store) => {
      await store.update((state) => {
        const player = state.players[account]!;
        player.inventory.push({
          guid: player.nextItemGuid++,
          genre: permit[0],
          detail: permit[1],
          particular: permit[2],
          templateLevel: permit[3],
          count: 1,
          enhanceLevel: 0,
          enhanceExp: 0,
          breakLevel: 0,
          lockOn: 0,
          createTime: 1,
        });
      });
    },
    async (call, store) => {
      const start = structuredClone(store.snapshot().players[account]!);
      for (let roll = 0; roll < 3; roll++) {
        const reply = clientCalls(await call("Lottery", { nId: 666, bTen: true }));
        expect(reply.at(-1)!.parameters.bGetCard).toBe(false);
        const player = store.snapshot().players[account]!;
        // A roll grants nothing and spends nothing.
        expect(player.inventory).toEqual(start.inventory);
        expect(player.money).toEqual(start.money);
        expect(player.gacha.pending?.poolId).toBe(666);
      }
      const accepted = structuredClone(
        store.snapshot().players[account]!.gacha.pending!,
      );

      const saved = clientCalls(await call("GetLastGacha", true));
      expect(saved.at(-1)!.method).toBe("GetLastGacha");
      expect(saved.at(-1)!.parameters.bGetCard).toBe(true);
      expect(saved.at(-1)!.parameters.tbAwards).toEqual(accepted.awards);
      const after = store.snapshot().players[account]!;
      expect(after.gacha.pending).toBeNull();
      expect(
        after.inventory.filter(isPermit).reduce((sum, item) => sum + item.count, 0),
      ).toBe(0);
      for (const award of accepted.awards) {
        const [genre, detail, particular, templateLevel] = award.tbGDPL;
        expect(
          after.inventory.some(
            (item) =>
              item.genre === genre &&
              item.detail === detail &&
              item.particular === particular &&
              item.templateLevel === templateLevel,
          ),
        ).toBe(true);
      }

      // Without the permit the pool is closed: no new roll, nothing changes.
      const before = structuredClone(after);
      const again = clientCalls(await call("Lottery", { nId: 666, bTen: true }));
      expect(again).toEqual([
        { method: "Lottery", parameters: { err: "error.gacha.cash" } },
      ]);
      expect(store.snapshot().players[account]!).toEqual(before);
    },
  );
}, 20_000);

it("answers a free month-card claim while a card is active with DoRecharge Error 20021 and changes nothing", async () => {
  const account = "reply-fix-month-card";
  await withGateway(
    account,
    async () => {},
    async (call, store) => {
      const recharge = { sCmd: 10000, tbParam: { Type: 2, Id: 1 } };
      const first = clientCalls(await call("LuaCall", recharge));
      expect(first).toContainEqual({
        method: "BuyMonth",
        parameters: { nType: 2, bMonth: 1, nId: 1 },
      });

      const before = structuredClone(store.snapshot().players[account]!);
      const second = clientCalls(await call("LuaCall", recharge));
      // IBLogic:ResponseTradeNo shows ui.Error.<Error>; 20021 = "You can buy no more of this".
      expect(second).toEqual([
        {
          method: "LuaCall",
          parameters: { sCmd: 10000, tbParam: { Type: 2, Id: 1, Error: 20021 } },
        },
      ]);
      expect(store.snapshot().players[account]!).toEqual(before);
    },
  );
}, 15_000);
