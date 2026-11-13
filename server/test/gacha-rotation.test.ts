import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { customCardTemplates } from "../src/game-data/custom-card-data.js";
import { ROTATION_SELECTION_TASK } from "../src/game-data/recruitment-policy.js";
import { GachaCatalog } from "../src/game-data/gacha-data.js";
import {
  activeGachaBannerIds,
  GachaRotationCatalog,
  GACHA_ROTATION_COHORTS,
  RAILGUN_GACHA_POOL_ID,
  ROTATING_GACHA_POOL_ID,
} from "../src/game-data/gacha-rotation-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeGachaTaskId,
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

const cards = GachaCatalog.loadDefault();
const weapons = GachaCatalog.loadDefault(0);
const epoch = Date.UTC(2026, 10, 8, 20);
const day = 86_400_000;
const rotationId = ROTATING_GACHA_POOL_ID;
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

it("covers the exact eligible roster within 364 days even at the longest interval", async () => {
  const rotation = GachaRotationCatalog.loadDefault(cards.get(1)!, weapons.get(1)!, 14);
  const contents = await readFile("resources/gacha/rotation-roster.txt", "utf8");
  const expected = contents
    .split(/\r?\n/)
    .slice(3)
    .filter((row) => row.endsWith("\t"))
    .map((row) => row.split("\t").slice(0, 4).join(":"));
  const observed = new Set<string>();
  for (let index = 0; index < GACHA_ROTATION_COHORTS; index++) {
    const now = epoch + index * 14 * day;
    const window = rotation.at(now);
    expect(window.manifest.revision * 1000).toBe(now);
    expect(window.manifest.endsAt * 1000).toBe(now + 14 * day);
    for (const kind of ["character", "weapon"] as const) {
      const pool = window[kind]!;
      const banner = window.manifest[kind]!;
      expect(banner.id).toBe(rotationId);
      expect(banner.rows).toEqual([...pool.normalCards.values()].flat());
      expect([...pool.normalCards.keys()]).toEqual([1, 2, 3, 4]);
      for (const row of banner.rows) observed.add(row.gdpl.join(":"));
      const base = kind === "character" ? cards.get(1)! : weapons.get(1)!;
      expect(pool.costOne).toEqual(base.costOne);
      expect(pool.costTen).toEqual(base.costTen);
      expect(pool.protectNum).toBe(base.protectNum);
      expect(pool.starSeedId).toBe(base.starSeedId);
      expect(pool.hedgeSeedId).toBe(base.hedgeSeedId);
    }
  }
  expect(observed).toEqual(new Set(expected));
  expect([...observed].filter((key) => key.startsWith("1:"))).toHaveLength(222);
  expect([...observed].filter((key) => key.startsWith("2:"))).toHaveLength(134);
  expect(observed.has("2:2:28:1")).toBe(true);
  expect(observed.has("2:2:10000:1")).toBe(false);
  expect(observed.has("2:2:10001:1")).toBe(true);
  expect(observed.has("1:7:17:5")).toBe(false);
  expect(cards.rarityOf([1, 202, 1, 3])).toBe(3);
  expect(rotation.cardRarityOf([1, 202, 1, 3])).toBe(3);
  expect(rotation.cardRarityOf([1, 27, 1, 1])).toBe(4);
  expect(rotation.cardRarityOf([1, 7, 17, 5])).toBeNull();
  expect(rotation.at(epoch + 364 * day).manifest.character).toEqual(
    rotation.at(epoch).manifest.character,
  );
});

it("covers the independent stock and custom catalogs in 182 days, excluding gameplay rewards", async () => {
  const profile = JSON.parse(
    await readFile("resources/test-profile-catalog.json", "utf8"),
  ) as { instanceTemplates: { kind: string; gdpl: number[] }[] };
  const stock = profile.instanceTemplates.filter(({ kind }) => kind === "character");
  expect(stock).toHaveLength(278);
  // Formula cards for the original roster are campaign/starter rewards; Wuxia's
  // casual starter and the two signup cards also keep their gameplay routes.
  const gameplay = new Set([
    ...Array.from({ length: 12 }, (_, i) => `1:${i + 1}:1:1`),
    "1:9:1:3",
    "1:2:4:3",
    "1:9:9:4",
  ]);
  const pledge = (await readFile("resources/pledge/steps.txt", "utf8")).split(/\r?\n/);
  const headers = pledge[2]!.split("\t");
  for (const line of pledge.slice(3)) {
    if (!line.trim()) continue;
    const row = Object.fromEntries(
      headers.map((key, index) => [key, line.split("\t")[index]]),
    );
    if (row.changecard === "1") gameplay.add(row.cardgdpl!.replaceAll("-", ":"));
  }
  expect(gameplay.size).toBe(57);
  const expected = new Set(
    [...stock, ...customCardTemplates()]
      .map(({ gdpl }) => gdpl.join(":"))
      .filter((key) => !gameplay.has(key)),
  );
  expect(expected.size).toBe(222);
  const rotation = GachaRotationCatalog.loadDefault(cards.get(1)!, weapons.get(1)!, 7);
  const observed = new Set<string>();
  for (let i = 0; i < GACHA_ROTATION_COHORTS; i++) {
    const window = rotation.at(epoch + i * 7 * day);
    for (const row of window.manifest.character!.rows) observed.add(row.gdpl.join(":"));
  }
  expect(observed).toEqual(expected);
  expect([...observed].some((key) => gameplay.has(key))).toBe(false);
  expect(rotation.at(epoch + 182 * day).manifest.character).toEqual(
    rotation.at(epoch).manifest.character,
  );
});

it("accepts catalog-declared custom rarity without permitting arbitrary character mismatches", async () => {
  const contents = await readFile("resources/gacha/rotation-roster.txt", "utf8");
  expect(
    () => new GachaRotationCatalog(contents, cards.get(1)!, weapons.get(1)!),
  ).not.toThrow();
  for (const corrupted of [
    contents.replace("1\t27\t1\t1\t4\t", "1\t27\t1\t1\t3\t"),
    contents.replace("1\t1\t1\t3\t3\t", "1\t1\t1\t3\t4\t"),
    contents + "1\t28\t1\t1\t4\t\n",
  ]) {
    expect(corrupted).not.toBe(contents);
    expect(
      () => new GachaRotationCatalog(corrupted, cards.get(1)!, weapons.get(1)!),
    ).toThrow("Invalid rotation roster row");
  }
});

it("advances exactly at the server boundary and preserves the native pity and ten-pull hedge", () => {
  const rotation = GachaRotationCatalog.loadDefault(cards.get(1)!, weapons.get(1)!);
  const first = rotation.at(epoch);
  expect(rotation.at(epoch + 7 * day - 1).manifest).toEqual(first.manifest);
  expect(rotation.at(epoch + 7 * day).manifest.revision).toBe(first.manifest.endsAt);
  expect(rotation.at(epoch + 7 * day).manifest.character).not.toEqual(
    first.manifest.character,
  );
  expect(activeGachaBannerIds(epoch)).toEqual({
    character: [1, RAILGUN_GACHA_POOL_ID, rotationId],
    weapon: [1, rotationId],
  });
  expect(activeGachaBannerIds(epoch, 0)).toEqual({
    character: [1, RAILGUN_GACHA_POOL_ID],
    weapon: [1],
  });
  expect(
    GachaRotationCatalog.loadDefault(cards.get(1)!, weapons.get(1)!, 0).at(epoch)
      .manifest,
  ).toEqual({ revision: 0, startsAt: 0, endsAt: 0, intervalDays: 0 });
  const pity = cards.rollPool(
    first.character!,
    false,
    { pity: 49, upPity: 0, total: 49 },
    new Set(),
    [],
    () => 0,
  );
  expect(pity.awards[0]?.tbGDPL[3]).toBeGreaterThanOrEqual(4);
  expect(pity.counters.pity).toBe(0);
  for (const [catalog, pool] of [
    [cards, first.character!],
    [weapons, first.weapon!],
  ] as const) {
    const result = catalog.rollPool(
      pool,
      true,
      { pity: 0, upPity: 0, total: 0 },
      new Set(),
      [],
      () => 0,
    );
    expect(result.awards).toHaveLength(10);
    const last = result.awards.at(-1)!;
    expect(pool.hedgeCards.get(3)?.some(({ id }) => id === last.nId)).toBe(true);
  }
});

function callback(packet: GamePacket): { method: string; parameters: unknown } | null {
  if (packet.command !== COMMAND.NTF_S2C_CALL) return null;
  const fields = decodeFields(packet.payload);
  return {
    method: firstString(fields, 1),
    parameters: JSON.parse(firstString(fields, 2)) as unknown,
  };
}

function request(
  socket: Socket,
  command: number,
  serial: number,
  payload: Buffer,
  end: (packet: GamePacket) => boolean,
): Promise<GamePacket[]> {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    const packets: GamePacket[] = [];
    const timer = setTimeout(() => finish(new Error("Gacha response timed out")), 5000);

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
          finish(new Error("Invalid gateway packet"));
          return;
        }
        if (pending.length < size) return;
        const packet = readPacket(pending.subarray(0, size));
        packets.push(packet);
        pending = pending.subarray(size);
        if (end(packet)) {
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

it("publishes the rotation over TCP and rejects stale card and weapon pulls before charging", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg-rotation-"));
  const account = "rotation-test";
  const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
  config.gachaRotationDays = 7;
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
    for (const [genre, detail, particular, templateLevel] of [
      cards.get(1)!.costOne!,
      weapons.get(1)!.costOne!,
    ]) {
      player.inventory.push({
        guid: player.nextItemGuid++,
        genre,
        detail,
        particular,
        templateLevel,
        count: 1,
        enhanceLevel: 0,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
        createTime: 1,
      });
    }
  });
  const server = createGatewayServer({ config, logger, players });
  let socket: Socket | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    const client = createConnection({ host: "127.0.0.1", port: address.port });
    socket = client;
    await once(client, "connect");
    let serial = 1;
    await request(
      client,
      COMMAND.LOGIN_REQ,
      serial,
      fieldBytes(1, account),
      (packet) => packet.command === COMMAND.LOGIN_RSP,
    );
    const call = (method: string, parameters: unknown, response = method) =>
      request(
        client,
        COMMAND.C2S_CALL_REQ,
        ++serial,
        makeServerLuaCall(method, parameters),
        (packet) => callback(packet)?.method === response,
      );
    const packets = await call("GetOfflineGachaRotation", {}, "OfflineGachaRotation");
    const manifest = callback(packets.at(-1)!)!.parameters as ReturnType<
      GachaRotationCatalog["at"]
    >["manifest"];
    expect(manifest.character?.id).toBe(rotationId);
    expect(manifest.weapon?.id).toBe(rotationId);
    const before = store.snapshot();
    const stale = manifest.revision - 7 * 86_400;
    const staleCard = await call("Lottery", {
      nId: rotationId,
      bTen: false,
      rotationRevision: stale,
    });
    expect(callback(staleCard.at(-1)!)?.parameters).toEqual({
      err: "error.gacha.notexists",
    });
    const staleWeapon = await call("WeaponLogicMsg", {
      nCmd: 0,
      Id: rotationId,
      isTen: false,
      rotationRevision: stale,
    });
    expect(callback(staleWeapon.at(-1)!)?.parameters).toEqual({
      nError: 20096,
      nCmd: 0,
    });
    for (const denial of [staleCard, staleWeapon]) {
      expect(denial.map(callback)).toContainEqual({
        method: "OfflineGachaRotation",
        parameters: manifest,
      });
    }
    expect(store.snapshot()).toEqual(before);

    await call("Lottery", {
      nId: rotationId,
      bTen: false,
      rotationRevision: manifest.revision,
    });
    await call("WeaponLogicMsg", {
      nCmd: 0,
      Id: rotationId,
      isTen: false,
      rotationRevision: manifest.revision,
    });
    const saved = players.get(account)!;
    const oldGuids = new Set(
      before.players[account]!.inventory.map(({ guid }) => guid),
    );
    for (const [kind, base] of [
      ["character", cards.get(1)!],
      ["weapon", weapons.get(1)!],
    ] as const) {
      const [genre, detail, particular, templateLevel] = base.costOne!;
      const ticket = saved.inventory.find(
        (item) =>
          item.genre === genre &&
          item.detail === detail &&
          item.particular === particular &&
          item.templateLevel === templateLevel,
      );
      expect(ticket?.count).toBe(0);
      const offered = new Set(manifest[kind]!.rows.map((row) => row.gdpl.join(":")));
      const reward = saved.inventory.find(
        (item) =>
          !oldGuids.has(item.guid) && item.genre === (kind === "character" ? 1 : 2),
      )!;
      expect(
        offered.has(
          [reward.genre, reward.detail, reward.particular, reward.templateLevel].join(
            ":",
          ),
        ),
      ).toBe(true);
    }
    expect(saved.taskValues[makeGachaTaskId(3001 + rotationId)]).toBe(1);
    expect(saved.taskValues[makeGachaTaskId(1001)]).toBe(1);
  } finally {
    socket?.destroy();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

it("earns both rotation selectors and redeems native command 76 over TCP exactly once per owned box", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg-selector-gateway-"));
  const account = "selection-gateway";
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
  const window = GachaRotationCatalog.loadDefault(cards.get(1)!, weapons.get(1)!).at();
  await store.update((state) => {
    const player = state.players[account]!;
    for (const kind of ["character", "weapon"] as const) {
      player.taskValues[makeGachaTaskId(ROTATION_SELECTION_TASK[kind])] = 99;
      const [genre, detail, particular, templateLevel] = window[kind]!.costOne!;
      player.inventory.push({
        guid: player.nextItemGuid++,
        genre,
        detail,
        particular,
        templateLevel,
        count: 1,
        enhanceLevel: 0,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
        createTime: 1,
      });
    }
  });
  const server = createGatewayServer({ config, logger, players });
  let socket: Socket | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    const client = createConnection({ host: "127.0.0.1", port: address.port });
    socket = client;
    await once(client, "connect");
    let serial = 1;
    await request(
      client,
      COMMAND.LOGIN_REQ,
      serial,
      fieldBytes(1, account),
      (packet) => packet.command === COMMAND.LOGIN_RSP,
    );
    const call = (method: string, parameters: unknown, response = method) =>
      request(
        client,
        COMMAND.C2S_CALL_REQ,
        ++serial,
        makeServerLuaCall(method, parameters),
        (packet) => callback(packet)?.method === response,
      );
    await call("Lottery", {
      nId: 850,
      bTen: false,
      rotationRevision: window.manifest.revision,
    });
    await call("WeaponLogicMsg", {
      nCmd: 0,
      Id: 850,
      isTen: false,
      rotationRevision: window.manifest.revision,
    });
    for (const kind of ["character", "weapon"] as const) {
      const selector = window.manifest[kind]!.selector!;
      const box = players
        .get(account)!
        .inventory.find(
          (item) =>
            [item.genre, item.detail, item.particular, item.templateLevel].join(":") ===
            selector.gdpl.slice(0, 4).join(":"),
        );
      expect(box?.count).toBe(1);
      const opened = await call("LuaCall", {
        sCmd: 76,
        tbParam: { gdpln: selector.gdpl, select: 1 },
      });
      expect(opened.map(({ command }) => command)).toContain(COMMAND.ITEM_UPDATE_NTF);
      const data = callback(opened.at(-1)!)!.parameters as {
        sCmd: number;
        tbParam: unknown;
      };
      expect(data.sCmd).toBe(76);
      expect(Array.isArray(data.tbParam)).toBe(true);
      const before = store.snapshot();
      const replay = await call("LuaCall", {
        sCmd: 76,
        tbParam: { gdpln: selector.gdpl, select: 1 },
      });
      expect(callback(replay.at(-1)!)!.parameters).toEqual({
        sCmd: 76,
        tbParam: { nError: 1 },
      });
      expect(store.snapshot()).toEqual(before);
    }
  } finally {
    socket?.destroy();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

it("commits permanent Railgun pulls over TCP with stock costs, independent pity and durable ownership", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg-railgun-"));
  const account = "railgun-test";
  const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
  const filePath = path.join(directory, "state.json");
  const store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
  await store.initialize();
  const players = new PlayerRepository({
    store,
    defaults: config.playerDefaults,
    logger,
  });
  await players.getOrCreate(account);
  const pool = cards.get(RAILGUN_GACHA_POOL_ID)!;
  await store.update((state) => {
    const player = state.players[account]!;
    for (const [ticket, count] of [
      [pool.costOne!, 3],
      [pool.costTen!, 1],
    ] as const) {
      const [genre, detail, particular, templateLevel] = ticket;
      player.inventory.push({
        guid: player.nextItemGuid++,
        genre,
        detail,
        particular,
        templateLevel,
        count,
        enhanceLevel: 0,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
        createTime: 1,
      });
    }
    for (const money of player.money) money.count = 0;
    player.taskValues[makeGachaTaskId(2 + pool.id)] = 49;
    player.taskValues[makeGachaTaskId(2001 + pool.id)] = 99;
    player.taskValues[makeGachaTaskId(3001 + pool.id)] = 99;
    player.taskValues[makeGachaTaskId(3)] = 17; // Standard pool's separate pity.
  });
  // Fix random boundaries, not the award result: the actual pool algorithm,
  // TCP handler, cost deduction, grant and durable store all execute below.
  const original = GachaCatalog.prototype.rollPool;
  let targetKuroko = false;
  const random = vi
    .spyOn(GachaCatalog.prototype, "rollPool")
    .mockImplementation(function (
      this: GachaCatalog,
      pool,
      ten,
      counters,
      owned,
      selected,
    ) {
      let calls = 0;
      return original.call(this, pool, ten, counters, owned, selected, (ceiling) =>
        targetKuroko ? (calls++ === 0 ? 8_200 : ceiling - 1) : 0,
      );
    });
  const server = createGatewayServer({ config, logger, players });
  let socket: Socket | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    const client = createConnection({ host: "127.0.0.1", port: address.port });
    socket = client;
    await once(client, "connect");
    let serial = 1;
    await request(
      client,
      COMMAND.LOGIN_REQ,
      serial,
      fieldBytes(1, account),
      (packet) => packet.command === COMMAND.LOGIN_RSP,
    );
    const pull = (ten: boolean) =>
      request(
        client,
        COMMAND.C2S_CALL_REQ,
        ++serial,
        makeServerLuaCall("Lottery", { nId: pool.id, bTen: ten }),
        (packet) => callback(packet)?.method === "Lottery",
      );
    const legendary = callback((await pull(false)).at(-1)!)!.parameters as {
      bGetCard: boolean;
      tbAwards: { tbGDPL: number[]; nUpTimes: number }[];
    };
    expect(legendary.bGetCard).toBe(true);
    expect(legendary.tbAwards[0]).toMatchObject({
      tbGDPL: [1, 201, 1, 4],
      nUpTimes: 100,
    });
    targetKuroko = true;
    const kuroko = callback((await pull(false)).at(-1)!)!
      .parameters as typeof legendary;
    expect(kuroko.tbAwards[0]!.tbGDPL).toEqual([1, 202, 1, 3]);
    targetKuroko = false;
    const ten = callback((await pull(true)).at(-1)!)!.parameters as typeof legendary;
    expect(ten.bGetCard).toBe(true);
    expect(ten.tbAwards).toHaveLength(10);
    expect(ten.tbAwards[9]!.tbGDPL[3]).toBeGreaterThanOrEqual(3);
    const saved = players.get(account)!;
    const count = (gdpl: number[]) =>
      saved.inventory
        .filter(
          (item) =>
            [item.genre, item.detail, item.particular, item.templateLevel].join(":") ===
            gdpl.slice(0, 4).join(":"),
        )
        .reduce((sum, item) => sum + item.count, 0);
    expect(count(pool.costOne!)).toBe(1);
    expect(count(pool.costTen!)).toBe(0);
    expect(count([1, 201, 1, 4])).toBe(1);
    expect(count([1, 202, 1, 3])).toBe(1);
    expect(saved.taskValues[makeGachaTaskId(2 + pool.id)]).toBe(11);
    expect(saved.taskValues[makeGachaTaskId(2001 + pool.id)]).toBe(-1);
    expect(saved.taskValues[makeGachaTaskId(3001 + pool.id)]).toBe(111);
    expect(saved.taskValues[makeGachaTaskId(3)]).toBe(17);
    const beforeRejected = store.snapshot();
    expect(callback((await pull(true)).at(-1)!)!.parameters).toEqual({
      err: "error.gacha.cash",
    });
    expect(store.snapshot()).toEqual(beforeRejected);
    await store.update((state) => {
      state.players[account]!.taskValues[makeGachaTaskId(3001 + pool.id)] = 299;
    });
    await pull(false);
    expect(
      players
        .get(account)!
        .inventory.find(
          (item) =>
            item.genre === 8 &&
            item.detail === 10 &&
            item.particular === 46 &&
            item.templateLevel === 4,
        )?.count,
    ).toBe(1);
    const nativeBox = await request(
      client,
      COMMAND.C2S_CALL_REQ,
      ++serial,
      makeServerLuaCall("LuaCall", {
        sCmd: 76,
        tbParam: { gdpln: [8, 10, 46, 4, 1], select: 2 },
      }),
      (packet) => callback(packet)?.method === "LuaCall",
    );
    expect(callback(nativeBox.at(-1)!)!.parameters).toMatchObject({
      sCmd: 76,
      tbParam: [[1, 203, 1, 4, 1, false, false, false]],
    });
    expect(
      players
        .get(account)!
        .inventory.find(
          (item) =>
            item.genre === 8 &&
            item.detail === 10 &&
            item.particular === 46 &&
            item.templateLevel === 4,
        )?.count,
    ).toBe(0);
    await store.flush();
    const reopened = new JsonStore({
      filePath,
      initialState: makeInitialState(),
      logger,
    });
    await reopened.initialize();
    expect(reopened.snapshot().players[account]).toEqual(players.get(account));
  } finally {
    random.mockRestore();
    socket?.destroy();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
