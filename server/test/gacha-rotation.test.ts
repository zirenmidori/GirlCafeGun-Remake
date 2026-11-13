import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { GachaCatalog } from "../src/game-data/gacha-data.js";
import {
  activeGachaBannerIds,
  GachaRotationCatalog,
  GACHA_ROTATION_COHORTS,
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
  expect([...observed].filter((key) => key.startsWith("1:"))).toHaveLength(221);
  expect([...observed].filter((key) => key.startsWith("2:"))).toHaveLength(134);
  expect(observed.has("2:2:28:1")).toBe(true);
  expect(observed.has("2:2:10000:1")).toBe(false);
  expect(observed.has("2:2:10001:1")).toBe(true);
  expect(observed.has("1:7:17:5")).toBe(false);
  expect(cards.rarityOf([1, 202, 1, 3])).toBeNull();
  expect(rotation.cardRarityOf([1, 202, 1, 3])).toBe(3);
  expect(rotation.cardRarityOf([1, 7, 17, 5])).toBeNull();
  expect(rotation.at(epoch + 364 * day).manifest.character).toEqual(
    rotation.at(epoch).manifest.character,
  );
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
    character: [1, rotationId],
    weapon: [1, rotationId],
  });
  expect(activeGachaBannerIds(epoch, 0)).toEqual({ character: [1], weapon: [1] });
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
