import { once } from "node:events";
import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { LUA_COMMAND_CARD_DECOMPOSE } from "../src/game-data/card-decomposition-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  CustomGirlOutfitUnavailableError,
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
  firstBytes,
  firstNumber,
  firstString,
} from "../src/protocol/protobuf.js";
import { createGatewayServer } from "../src/servers/gateway-server.js";

const account = "nocturne-test";
const suitId = 9101;
const syntheticSuitTask = (4 << 16) | (6 * 2000 + 1771);
const fightModelTask = (3 << 16) | (6 * 2000 + 9);
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

function officerCard(guid: number, overrides: Partial<InventoryEntryState> = {}) {
  return {
    guid,
    genre: 1,
    detail: 7,
    particular: 13,
    templateLevel: 4,
    count: 1,
    createTime: 1,
    enhanceLevel: 1,
    enhanceExp: 0,
    breakLevel: 0,
    lockOn: 0,
    ...overrides,
  };
}

async function fixture(cards: InventoryEntryState[] = []) {
  const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg-nocturne-"));
  const filePath = path.join(directory, "state.json");
  async function reopen() {
    const store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
    await store.initialize();
    const players = new PlayerRepository({
      store,
      defaults: config.playerDefaults,
      logger,
    });
    return { store, players };
  }
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const { store, players } = await reopen();
    await players.getOrCreate(account);
    await store.update((state) => state.players[account]!.inventory.push(...cards));
    return { store, players, config, reopen, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

it("denies tombstones, similar cards and forged suit tasks without mutating the save", async () => {
  const f = await fixture([
    officerCard(50_001, { count: 0 }),
    officerCard(50_002, { templateLevel: 3 }),
  ]);
  try {
    await f.store.update((state) => {
      state.players[account]!.taskValues[syntheticSuitTask] = 2;
    });
    const before = f.store.snapshot();
    await expect(
      f.players.changeGirlClothes(account, 7, suitId),
    ).rejects.toBeInstanceOf(CustomGirlOutfitUnavailableError);
    expect(f.store.snapshot()).toEqual(before);
  } finally {
    await f.cleanup();
  }
});

it("persists Nocturne and the fight flag while the café uses Officer Irene's stock 3D model", async () => {
  const f = await fixture([officerCard(50_001)]);
  try {
    const before = await f.players.setGirlFightModel(account, 7, true);
    const result = await f.players.changeGirlClothes(account, 7, suitId);
    expect(result.girl).toMatchObject({ girlId: 7, modelId: suitId });
    expect(result.player.inventory).toEqual(before.inventory);
    expect(result.player.taskValues).toEqual(before.taskValues);

    const cafe = await f.players.setCafeWaiterList(account, [[[7, suitId]], [], []]);
    expect(cafe.response).toEqual([[[7, 13]], [], []]);
    expect(cafe.player.cafe.roomGirlsList).toEqual([
      [{ girlId: 7, modelId: 13 }],
      [],
      [],
    ]);

    const { players } = await f.reopen();
    const reloaded = await players.getOrCreate(account);
    expect(reloaded.girls).toEqual(result.player.girls);
    const loggedIn = await players.markLogin(account);
    expect(loggedIn.girls).toEqual(result.player.girls);
    expect(loggedIn.taskValues[fightModelTask]).toBe(1);
    expect(loggedIn.taskValues[syntheticSuitTask]).toBeUndefined();
    const stock = await players.changeGirlClothes(account, 7, 1);
    expect(stock.girl.modelId).toBe(1);
    expect(stock.player.taskValues[fightModelTask]).toBe(1);
  } finally {
    await f.cleanup();
  }
});

function request(
  socket: Socket,
  command: number,
  serial: number,
  payload: Buffer,
  responseCommand: number,
): Promise<GamePacket[]> {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    const packets: GamePacket[] = [];
    const timer = setTimeout(
      () => finish(new Error("Gateway response timed out")),
      3000,
    );

    function finish(error?: Error) {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", finish);
      if (error) reject(error);
      else resolve(packets);
    }

    function onData(chunk: Buffer) {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= HEADER_SIZE) {
        const size = pending.readUInt32LE(4);
        if (size < HEADER_SIZE) {
          finish(new Error("Invalid gateway packet size"));
          return;
        }
        if (pending.length < size) return;
        const packet = readPacket(pending.subarray(0, size));
        pending = pending.subarray(size);
        packets.push(packet);
        if (packet.command === responseCommand) {
          finish();
          return;
        }
      }
    }
    socket.on("data", onData);
    socket.once("error", finish);
    socket.write(makePacket(command, serial, payload));
  });
}

function girlUpdate(packets: GamePacket[]) {
  const packet = packets.find(({ command }) => command === COMMAND.GIRL_UPDATE_NTF);
  if (!packet) return undefined;
  const girl = decodeFields(firstBytes(decodeFields(packet.payload), 1)!);
  return { girlId: firstNumber(girl, 1), modelId: firstNumber(girl, 4) };
}

it("sends a wardrobe denial and publishes the replacement only when the final copy is decomposed", async () => {
  const f = await fixture([officerCard(50_001), officerCard(50_002)]);
  const server = createGatewayServer({ config: f.config, logger, players: f.players });
  let socket: Socket | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No gateway port");
    socket = createConnection({ host: "127.0.0.1", port: address.port });
    await once(socket, "connect");
    await request(
      socket,
      COMMAND.LOGIN_REQ,
      1,
      fieldBytes(1, account),
      COMMAND.LOGIN_RSP,
    );
    const connected = socket;
    let serial = 1;
    const call = (method: string, parameters: unknown) =>
      request(
        connected,
        COMMAND.C2S_CALL_REQ,
        ++serial,
        makeServerLuaCall(method, parameters),
        COMMAND.NTF_S2C_CALL,
      );

    const wrongGirl = { sCmd: "ChangeCloth", nId: 9, nSuit: suitId };
    const denied = await call("GirlLogic", wrongGirl);
    expect(girlUpdate(denied)).toBeUndefined();
    const denial = decodeFields(denied.at(-1)!.payload);
    expect(firstString(denial, 1)).toBe("GirlLogic");
    expect(JSON.parse(firstString(denial, 2))).toEqual({ ...wrongGirl, nError: 1 });

    const retired = { ...wrongGirl, nSuit: 9102 };
    const rejected = await call("GirlLogic", retired);
    expect(girlUpdate(rejected)).toBeUndefined();
    const rejection = decodeFields(rejected.at(-1)!.payload);
    expect(firstString(rejection, 1)).toBe("GirlLogic");
    expect(JSON.parse(firstString(rejection, 2))).toEqual({ ...retired, nError: 1 });

    const select = { ...wrongGirl, nId: 7 };
    const selected = await call("GirlLogic", select);
    expect(girlUpdate(selected)).toEqual({ girlId: 7, modelId: suitId });
    expect(JSON.parse(firstString(decodeFields(selected.at(-1)!.payload), 2))).toEqual(
      select,
    );

    const decompose = (guid: number) =>
      call("LuaCall", { sCmd: LUA_COMMAND_CARD_DECOMPOSE, tbParam: [guid] });
    const first = await decompose(50_001);
    expect(first.map(({ command }) => command)).toContain(COMMAND.ITEM_UPDATE_NTF);
    expect(girlUpdate(first)).toBeUndefined();
    expect(
      f.players.get(account)?.girls.find(({ girlId }) => girlId === 7)?.modelId,
    ).toBe(suitId);

    const last = await decompose(50_002);
    expect(girlUpdate(last)).toEqual({ girlId: 7, modelId: 1 });
    expect(last.at(-1)?.command).toBe(COMMAND.NTF_S2C_CALL);
    const { players } = await f.reopen();
    const restored = await players.getOrCreate(account);
    expect(restored.girls.find(({ girlId }) => girlId === 7)?.modelId).toBe(1);
    await expect(players.changeGirlClothes(account, 7, suitId)).rejects.toBeInstanceOf(
      CustomGirlOutfitUnavailableError,
    );
  } finally {
    socket?.destroy();
    if (server.listening) {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await f.cleanup();
  }
}, 10_000);

it.each(["getOrCreate", "markLogin"] as const)(
  "reconciles a retired Silver Discipline selection on %s without changing progression",
  async (entrypoint) => {
    const now = Date.UTC(2026, 10, 8, 12);
    const silverDiscipline = 9102;
    const obsoleteSuitTask = (4 << 16) | (8 * 2000 + 1772);
    const f = await fixture([officerCard(50_001)]);
    try {
      await f.players.changeGirlClothes(account, 7, suitId);
      await f.players.setGirlFightModel(account, 9, true);
      await f.players.setCafeWaiterList(account, [[[9, 1]], [], []], now);
      await f.store.update((state) => {
        const player = state.players[account]!;
        const wuxia = player.girls.find(({ girlId }) => girlId === 9)!;
        wuxia.level = 42;
        wuxia.exp = 10;
        wuxia.vigor = 63;
        player.taskValues[obsoleteSuitTask] = 2;
      });
      const expected = await f.players[entrypoint](account, now);
      await f.store.update((state) => {
        state.players[account]!.girls.find(({ girlId }) => girlId === 9)!.modelId =
          silverDiscipline;
      });
      const { store, players } = await f.reopen();
      expect(await players[entrypoint](account, now)).toEqual(expected);
      expect(store.snapshot().players[account]).toEqual(expected);

      const before = store.snapshot();
      await expect(
        players.changeGirlClothes(account, 9, silverDiscipline),
      ).rejects.toThrow("has been retired");
      await expect(
        players.setCafeWaiterList(account, [[[9, silverDiscipline]], [], []], now),
      ).rejects.toMatchObject({
        reason: "waiter_model_not_owned",
      });
      expect(store.snapshot()).toEqual(before);
    } finally {
      await f.cleanup();
    }
  },
);
