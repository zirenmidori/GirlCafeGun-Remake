import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createConnection, type Server, type Socket } from "node:net";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { CafeCatalog } from "../src/game-data/cafe-catalog.js";
import { ShopCatalog } from "../src/game-data/shop-data.js";
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
  firstString,
  firstNumber,
  firstBytes,
  fieldVarint,
} from "../src/protocol/protobuf.js";
import { createGatewayServer } from "../src/servers/gateway-server.js";

const account = "cafe-wire:local-test";
const username = "cafe-wire";
const scratchRoot = path.resolve(import.meta.dirname, "../../tools/cafe-fix");
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
function luaValue(
  packets: readonly GamePacket[],
  command: number,
): Record<string, unknown> {
  const call = packets
    .map(callback)
    .find((entry) => entry?.method === "LuaCall" && entry.parameters.sCmd === command);
  expect(call, `missing cafe callback ${command}`).toBeDefined();
  return call!.parameters.tbParam as Record<string, unknown>;
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
    const player = state.players[account]!;
    player.cafe.level = 30;
    player.money.find((money) => money.id === 2)!.count = 10_000;
    player.cafe.furniture = [
      {
        templateId: 101,
        objId: 10_000,
        parentId: 0,
        roomId: 0,
        pose: {
          templateId: 101,
          parentTemplateId: 0,
          place: 0,
          posX: 0,
          posY: 0,
          rotate: 0,
        },
        status: 0,
        isNew: false,
        bizcount: 0,
      },
      {
        templateId: 102,
        objId: 10_001,
        parentId: 0,
        roomId: 0,
        pose: {
          templateId: 102,
          parentTemplateId: 0,
          place: 0,
          posX: 0,
          posY: 0,
          rotate: 0,
        },
        status: 0,
        isNew: false,
        bizcount: 0,
      },
    ];
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
  async function call(
    command: number,
    tbParam: unknown = {},
    requestedSerial = ++serial,
  ): Promise<GamePacket[]> {
    return request(
      socket!,
      COMMAND.C2S_CALL_REQ,
      requestedSerial,
      makeServerLuaCall("LuaCall", { sCmd: command, tbParam }),
      (packet) => {
        const c = callback(packet);
        return c?.method === "LuaCall" && c.parameters.sCmd === command;
      },
    );
  }
  async function native(
    command: number,
    payload: Buffer,
    responseCommand = command + 1,
  ): Promise<GamePacket[]> {
    return request(
      socket!,
      command,
      ++serial,
      payload,
      (packet) => packet.command === responseCommand,
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
    call,
    native,
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

describe("cafe actual TCP persistence", () => {
  it("materializes single and batch furniture purchases immediately, persists them, and recycles without duplicate coins", async () => {
    const f = await fixture();
    try {
      await f.store.update((state) => {
        state.players[account]!.money.push({ id: 7, count: 1_000_000 });
      });
      const catalog = CafeCatalog.loadDefault(),
        shops = ShopCatalog.loadDefault();
      const available = shops
        .goodsForShop(40_001)
        .filter(
          (good) =>
            good.genre === 11 &&
            good.goodsNum === 1 &&
            good.moneyType === 7 &&
            good.sellingPrice[0]! < 100_000,
        )
        .filter((good) =>
          catalog
            .furnitureItems()
            .some(
              (item) =>
                item.SellPrice > 0 &&
                item.OwnMax > 0 &&
                item.ItemInfo.join("-") ===
                  [good.genre, good.detail, good.particular, good.templateLevel].join(
                    "-",
                  ) &&
                !f.players
                  .get(account)!
                  .cafe.furniture!.some((entry) => entry.templateId === item.Id),
            ),
        );
      expect(available.length).toBeGreaterThanOrEqual(2);
      const [single, batch] = available;
      const wallet = () =>
        f.players.get(account)!.money.find((money) => money.id === 7)!.count;
      const before = wallet(),
        serial = f.nextSerial();
      const purchased = await f.call(
        13,
        { shopid: 40_001, goodsid: single!.goodsId, buynum: 1 },
        serial,
      );
      expect(luaValue(purchased, 13)).toMatchObject({
        shopid: 40_001,
        goodsid: single!.goodsId,
        buynum: 1,
      });
      expect(
        purchased.some((packet) => packet.command === COMMAND.ADD_FURNITURE_RSP),
      ).toBe(true);
      expect(wallet()).toBeLessThan(before);
      expect(f.players.get(account)!.cafe.furniture).toHaveLength(3);
      const firstNew = f.players
        .get(account)!
        .cafe.furniture!.find((item) => item.objId > 10_001)!;
      const stable = f.players.get(account);
      await f.call(13, { shopid: 40_001, goodsid: single!.goodsId, buynum: 1 }, serial);
      expect(f.players.get(account)).toEqual(stable);
      const batchPackets = await f.call(14, [
        { shopid: 40_001, goodsid: batch!.goodsId, buynum: 1 },
      ]);
      expect(
        batchPackets.some((packet) => packet.command === COMMAND.ADD_FURNITURE_RSP),
      ).toBe(true);
      expect(
        (luaValue(batchPackets, 14) as unknown as { ret: unknown }[])[0]!.ret,
      ).toBeTruthy();
      expect(f.players.get(account)!.cafe.furniture).toHaveLength(4);
      await f.reload();
      expect(f.players.get(account)!.cafe.furniture).toHaveLength(4);
      const afterBuy = wallet();
      expect(
        luaValue(await f.call(137, { objIds: [firstNew.objId] }), 137),
      ).toMatchObject({ objId: [firstNew.objId] });
      expect(wallet()).toBeGreaterThan(afterBuy);
      const afterRecycle = wallet();
      await f.call(137, { objIds: [firstNew.objId] });
      expect(wallet()).toBe(afterRecycle);
      expect(f.players.get(account)!.cafe.furniture).toHaveLength(3);
    } finally {
      await f.cleanup();
    }
  }, 20_000);

  it("seats real customers, settles coffee once, and reports offline earnings without paying twice", async () => {
    let time = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => time);
    let f: Awaited<ReturnType<typeof fixture>> | undefined;
    try {
      f = await fixture();
      const role = f.players.get(account)!.roleId;
      const update = Buffer.concat([
        fieldVarint(1, role),
        fieldBytes(
          3,
          Buffer.concat([
            fieldVarint(1, 101),
            fieldVarint(2, 10_000),
            fieldVarint(3, 2),
            fieldVarint(4, 1),
            fieldBytes(
              5,
              Buffer.concat([
                fieldVarint(1, 101),
                fieldVarint(2, 2),
                fieldVarint(4, 3),
                fieldVarint(5, 4),
              ]),
            ),
          ]),
        ),
      ]);
      const saved = await f.native(
        COMMAND.UPDATE_HOUSE_REQ,
        update,
        COMMAND.UPDATE_HOUSE_RSP,
      );
      expect(saved.at(-1)!.returnCode).toBe(0);
      await f.call(114, { seatlist: [{ position: 100_000 }] });
      expect(
        luaValue(await f.call(119, { coffeetype: 1, count: 12 }), 119).nError,
      ).toBeUndefined();
      time += 11_000;
      expect(
        (luaValue(await f.call(115), 115).customerqueue as unknown[]).length,
      ).toBeGreaterThan(0);
      const seated = luaValue(await f.call(117), 117);
      expect(seated.newguest).toMatchObject({ position: 100_000, coffeetype: 1 });
      const customer = (seated.newguest as { customeridx: number }).customeridx;
      const wallet = () =>
        f!.players.get(account)!.money.find((money) => money.id === 2)!.count;
      const before = wallet();
      expect(luaValue(await f.call(116, { customeridx: customer }), 116).error).toBe(
        -1,
      );
      expect(wallet()).toBe(before);
      time += 241_000;
      const settled = luaValue(await f.call(116, { customeridx: customer }), 116);
      expect(settled.error).toBe(0);
      const base = settled.earn_base as number[],
        extra = settled.earn_ex as number[];
      expect(base[0]).toBeGreaterThan(0);
      expect(wallet()).toBe(before + base[0]! + extra[0]!);
      const earned = wallet();
      expect(luaValue(await f.call(116, { customeridx: customer }), 116)).toEqual(
        settled,
      );
      expect(wallet()).toBe(earned);
      await f.reload();
      expect(wallet()).toBe(earned);
      const report = await f.call(112);
      expect(
        report
          .map(callback)
          .some(
            (entry) => entry?.method === "LuaCall" && entry.parameters.sCmd === 122,
          ),
      ).toBe(true);
      expect(wallet()).toBe(earned);
      const repeated = await f.call(112);
      expect(
        repeated
          .map(callback)
          .some(
            (entry) => entry?.method === "LuaCall" && entry.parameters.sCmd === 122,
          ),
      ).toBe(false);
      expect(wallet()).toBe(earned);
    } finally {
      if (f) await f.cleanup();
      clock.mockRestore();
    }
  }, 20_000);

  it("merges actual house deltas, preserves earlier furniture, and reloads the saved layout", async () => {
    const f = await fixture();
    try {
      const role = f.players.get(account)!.roleId;
      const room = (ids: number[]) =>
        Buffer.concat([fieldVarint(1, 1), ...ids.map((id) => fieldVarint(5, id))]);
      const change = (
        id: number,
        template: number,
        x: number,
        y: number,
        parent = 2,
        area = 1,
      ) =>
        Buffer.concat([
          fieldVarint(1, template),
          fieldVarint(2, id),
          fieldVarint(3, parent),
          fieldVarint(4, area),
          fieldBytes(
            5,
            Buffer.concat([
              fieldVarint(1, template),
              fieldVarint(2, parent),
              fieldVarint(4, x),
              fieldVarint(5, y),
              fieldVarint(6, 1),
            ]),
          ),
        ]);
      const save = async (
        id: number,
        template: number,
        x: number,
        y: number,
        parent = 2,
        area = 1,
      ) => {
        const packets = await f.native(
          COMMAND.UPDATE_HOUSE_REQ,
          Buffer.concat([
            fieldVarint(1, role),
            fieldBytes(2, room(area === 1 ? [id] : [])),
            fieldBytes(3, change(id, template, x, y, parent, area)),
          ]),
          COMMAND.UPDATE_HOUSE_RSP,
        );
        expect(packets.at(-1)!.returnCode).toBe(0);
      };
      await save(10_000, 101, 3, 4);
      await save(10_001, 102, 10, 11);
      let p = f.players.get(account)!;
      expect(p.cafe.furniture).toHaveLength(2);
      expect(p.cafe.furniture!.find((item) => item.objId === 10_000)).toMatchObject({
        parentId: 2,
        roomId: 1,
        pose: { posX: 3, posY: 4, parentTemplateId: 2 },
      });
      expect(p.cafe.rooms!.find((entry) => entry.roomId === 1)!.furnitureIds).toEqual([
        10_000, 10_001,
      ]);
      await f.reload();
      const packets = await f.native(
        COMMAND.GET_HOUSEINFO_REQ,
        Buffer.alloc(0),
        COMMAND.GET_HOUSEINFO_RSP,
      );
      const cacheBytes = firstBytes(decodeFields(packets.at(-1)!.payload), 2);
      expect(cacheBytes).toBeDefined();
      const cache = decodeFields(cacheBytes!);
      const placed = cache
        .filter((field) => field.fieldNumber === 2 && Buffer.isBuffer(field.value))
        .map((field) => decodeFields(field.value as Buffer));
      expect(placed).toHaveLength(2);
      const first = placed.find((fields) => firstNumber(fields, 2) === 10_000)!;
      expect(firstNumber(first, 4)).toBe(1);
      const poseBytes = firstBytes(first, 5);
      expect(poseBytes).toBeDefined();
      expect(firstNumber(decodeFields(poseBytes!), 4)).toBe(3);
      await save(10_000, 101, 0, 0, 0, 0);
      await f.reload();
      p = f.players.get(account)!;
      expect(p.cafe.furniture!.find((item) => item.objId === 10_000)!.roomId).toBe(0);
      expect(p.cafe.furniture!.find((item) => item.objId === 10_001)!.roomId).toBe(1);
      expect(p.cafe.rooms!.find((entry) => entry.roomId === 1)!.furnitureIds).toEqual([
        10_001,
      ]);
      const before = f.players.get(account);
      const rejected = await f.native(
        COMMAND.UPDATE_HOUSE_REQ,
        Buffer.concat([fieldVarint(1, role), fieldBytes(3, change(99_999, 101, 1, 1))]),
        COMMAND.UPDATE_HOUSE_RSP,
      );
      expect(rejected.at(-1)!.returnCode).toBeGreaterThan(0);
      expect(f.players.get(account)).toEqual(before);
    } finally {
      await f.cleanup();
    }
  }, 20_000);

  it("round-trips the actual numeric-pair staff wire format after restarting the server and store", async () => {
    const f = await fixture();
    try {
      const rows = [[[2, 1]], [[7, 1]], [[9, 1]]];
      expect(luaValue(await f.call(113, rows), 113)).toEqual(rows);
      expect(luaValue(await f.call(112), 112)).toMatchObject({ roomgirlslist: rows });
      expect(f.players.get(account)!.promise!.assignments).toEqual({
        "2": "work",
        "7": "rest",
        "9": "rest",
      });
      await f.reload();
      expect(luaValue(await f.call(112), 112)).toMatchObject({ roomgirlslist: rows });
    } finally {
      await f.cleanup();
    }
  }, 20_000);

  it("charges real coffee cost, persists stock, and rejects invalid production without partial mutation", async () => {
    const f = await fixture();
    try {
      const before = f.players
        .get(account)!
        .money.find((money) => money.id === 2)!.count;
      const serial = f.nextSerial();
      const made = await f.call(119, { coffeetype: 1, count: 12 }, serial);
      expect(luaValue(made, 119)).toMatchObject({
        coffeelist: [{ coffeetype: 1, count: 12 }],
      });
      expect(Object.hasOwn(luaValue(made, 119), "nError")).toBe(false);
      expect(f.players.get(account)!.money.find((money) => money.id === 2)!.count).toBe(
        before - 60,
      );
      expect(made.some((packet) => packet.command === COMMAND.MONEY_UPDATE_NTF)).toBe(
        true,
      );
      const saved = f.players.get(account);
      expect(
        luaValue(await f.call(119, { coffeetype: 1, count: 12 }, serial), 119),
      ).toEqual(luaValue(made, 119));
      expect(f.players.get(account)).toEqual(saved);
      await f.reload();
      expect(luaValue(await f.call(112), 112).coffeelist).toContainEqual({
        coffeetype: 1,
        count: 12,
      });
      const current = f.players.get(account);
      for (const invalid of [
        { coffeetype: 999, count: 1 },
        { coffeetype: 1, count: 1_000_000 },
        { coffeetype: 1, count: -1 },
      ]) {
        expect(luaValue(await f.call(119, invalid), 119).nError).toBeGreaterThan(0);
        expect(f.players.get(account)).toEqual(current);
      }
    } finally {
      await f.cleanup();
    }
  }, 20_000);

  it("responds with both server time and zone rather than dropping the clock request", async () => {
    const f = await fixture();
    try {
      const before = Math.floor(Date.now() / 1000);
      const packets = await f.native(
        COMMAND.TIME_REQ,
        Buffer.alloc(0),
        COMMAND.TIME_RSP,
      );
      const fields = decodeFields(packets.at(-1)!.payload);
      expect(firstNumber(fields, 1)).toBeGreaterThanOrEqual(before);
      expect(firstNumber(fields, 1)).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
      expect(firstNumber(fields, 2)).toBe(f.players.get(account)!.serverZone);
    } finally {
      await f.cleanup();
    }
  }, 20_000);
});
