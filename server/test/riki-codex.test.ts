import { once } from "node:events";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { GachaCatalog } from "../src/game-data/gacha-data.js";
import {
  pendingRikiCodexIds,
  reconcileRikiCodex,
  RikiCodexCatalog,
  rikiTaskKey,
  unlockedRikiIds,
} from "../src/game-data/riki-codex-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
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
import { mkdtemp } from "./helpers/temp.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};
const RIKI_TABLE = readFileSync(
  path.resolve(import.meta.dirname, "..", "resources", "cafe", "riki.txt"),
  "utf8",
);
/** Riki.txt rows used below. */
const STARTER_IRENE = 1047; // card 1-7-1-1
const STARTER_TOKI = 1067; // card 1-9-1-3
const PISTOL = 2001; // weapon 2-1-2-1
const CG_3005 = 3005; // a CG that a RikiItem unlocks (task only)
const NEPTUNE = 12_701; // patch_card_display.py row, card 1-27-1-1
const EVENT_STORY = 6605; // type 6, P 23, L 1, RatdisNum 3
const RIKI_COIN = 61;

type TestStore = JsonStore<ReturnType<typeof makeInitialState>>;

function item(
  guid: number,
  genre: number,
  detail: number,
  particular: number,
  templateLevel: number,
): InventoryEntryState {
  return {
    guid,
    genre,
    detail,
    particular,
    templateLevel,
    count: 1,
    createTime: 1,
    enhanceLevel: 1,
    enhanceExp: 0,
    breakLevel: 0,
    lockOn: 0,
  };
}

function rikiIds(packets: readonly GamePacket[], command: number): number[] {
  const ids: number[] = [];
  for (const packet of packets.filter((entry) => entry.command === command)) {
    if (command === COMMAND.RIKI_DATA_RSP) {
      ids.push(firstNumber(decodeFields(packet.payload), 1));
      continue;
    }
    for (const field of decodeFields(packet.payload)) {
      if (field.fieldNumber === 1 && Buffer.isBuffer(field.value))
        ids.push(firstNumber(decodeFields(field.value), 1));
    }
  }
  return ids;
}

function clientCalls(packets: readonly GamePacket[]) {
  return packets
    .filter((packet) => packet.command === COMMAND.NTF_S2C_CALL)
    .map((packet) => {
      const fields = decodeFields(packet.payload);
      return {
        method: firstString(fields, 1),
        parameters: JSON.parse(firstString(fields, 2)) as Record<string, unknown>,
      };
    });
}

/** Every packet that arrives until 300 ms pass without one (at most 5 s). */
function collect(socket: Socket, command: number, serial: number, payload: Buffer) {
  return new Promise<GamePacket[]>((resolve) => {
    let pending = Buffer.alloc(0);
    const packets: GamePacket[] = [];
    const limit = setTimeout(finish, 5_000);
    let quiet = setTimeout(finish, 1_500);
    function finish() {
      clearTimeout(limit);
      clearTimeout(quiet);
      socket.off("data", onData);
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
      clearTimeout(quiet);
      quiet = setTimeout(finish, 300);
    }
    socket.on("data", onData);
    socket.write(makePacket(command, serial, payload));
  });
}

async function withGateway(
  account: string,
  prepare: (store: TestStore) => Promise<void>,
  run: (session: {
    login: GamePacket[];
    call: (method: string, parameters: unknown) => Promise<GamePacket[]>;
    relogin: () => Promise<GamePacket[]>;
    store: TestStore;
  }) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg-riki-codex-"));
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
  await prepare(store);
  const server = createGatewayServer({ config, logger, players });
  const sockets: Socket[] = [];
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    let serial = 1;
    let socket: Socket;
    const open = async () => {
      socket = createConnection({ host: "127.0.0.1", port: address.port });
      sockets.push(socket);
      await once(socket, "connect");
      return collect(socket, COMMAND.LOGIN_REQ, ++serial, fieldBytes(1, account));
    };
    const login = await open();
    await run({
      login,
      call: (method, parameters) =>
        collect(
          socket,
          COMMAND.C2S_CALL_REQ,
          ++serial,
          makeServerLuaCall(method, parameters),
        ),
      relogin: async () => {
        socket.destroy();
        return open();
      },
      store,
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await store.flush();
    await rm(directory, { recursive: true, force: true });
  }
}

it("maps held cards, weapons and the custom Neptune card to their codex rows", () => {
  const catalog = new RikiCodexCatalog(RIKI_TABLE);
  expect(
    catalog.heldIds([
      item(1, 1, 7, 1, 1),
      item(2, 1, 9, 1, 3),
      item(3, 2, 1, 2, 1),
      item(4, 1, 27, 1, 1),
      { ...item(5, 1, 2, 1, 1), count: 0 },
    ]),
  ).toEqual([STARTER_IRENE, STARTER_TOKI, PISTOL, NEPTUNE]);
  expect(catalog.row(EVENT_STORY)).toMatchObject({
    type: 6,
    eventStory: true,
    storyCost: 3,
  });
  // The comic rows have no item: no GDPL, so nothing in the bag unlocks them.
  expect(catalog.row(9001)).toMatchObject({ type: 9, gdpl: null });
});

it("keeps an entry unlocked after its item leaves the bag", () => {
  const catalog = new RikiCodexCatalog(RIKI_TABLE);
  const player = {
    inventory: [item(1, 2, 1, 2, 1)],
    taskValues: {} as Record<string, number>,
  };
  expect(pendingRikiCodexIds(player, catalog)).toEqual([PISTOL]);
  expect(reconcileRikiCodex(player, catalog)).toEqual([PISTOL]);
  expect(player.taskValues[rikiTaskKey(PISTOL)]).toBe(1);
  expect(reconcileRikiCodex(player, catalog)).toEqual([]);
  player.inventory = [];
  expect(unlockedRikiIds(player, catalog)).toEqual([PISTOL]);
});

it("sends the codex list after the login reply: held items and task 53 entries, also after the item is gone", async () => {
  const account = "riki-login";
  await withGateway(
    account,
    async (store) => {
      await store.update((state) => {
        const player = state.players[account]!;
        player.inventory.push(item(player.nextItemGuid++, 2, 1, 2, 1));
        player.taskValues[rikiTaskKey(CG_3005)] = 1;
      });
    },
    async ({ login, relogin, store }) => {
      const loginReply = login.findIndex(
        (packet) => packet.command === COMMAND.LOGIN_RSP,
      );
      const list = login.findIndex(
        (packet) => packet.command === COMMAND.RIKI_LIST_RSP,
      );
      expect(loginReply).toBeGreaterThanOrEqual(0);
      expect(list).toBeGreaterThan(loginReply);
      const ids = rikiIds(login, COMMAND.RIKI_LIST_RSP);
      expect(ids).toEqual(
        expect.arrayContaining([STARTER_IRENE, STARTER_TOKI, PISTOL, CG_3005]),
      );
      expect(new Set(ids).size).toBe(ids.length);
      // The login recorded the weapon's entry, so it survives the weapon.
      expect(store.snapshot().players[account]!.taskValues[rikiTaskKey(PISTOL)]).toBe(
        1,
      );
      await store.update((state) => {
        const player = state.players[account]!;
        player.inventory = player.inventory.filter((entry) => entry.genre !== 2);
      });
      expect(rikiIds(await relogin(), COMMAND.RIKI_LIST_RSP)).toContain(PISTOL);
    },
  );
}, 20_000);

it("pushes RikiData for the cards of a gacha pull without a new login", async () => {
  const account = "riki-gacha";
  const [genre, detail, particular, level] =
    GachaCatalog.loadDefault().get(666)!.costTen!;
  await withGateway(
    account,
    async (store) => {
      await store.update((state) => {
        const player = state.players[account]!;
        player.inventory.push(
          item(player.nextItemGuid++, genre, detail, particular, level),
        );
      });
    },
    async ({ login, call, store }) => {
      const before = new Set(rikiIds(login, COMMAND.RIKI_LIST_RSP));
      await call("Lottery", { nId: 666, bTen: true });
      const packets = await call("GetLastGacha", true);
      const saved = clientCalls(packets).find(
        (entry) => entry.method === "GetLastGacha",
      );
      expect(saved?.parameters.bGetCard).toBe(true);
      const pushed = rikiIds(packets, COMMAND.RIKI_DATA_RSP);
      const catalog = RikiCodexCatalog.loadDefault();
      const player = store.snapshot().players[account]!;
      const expected = catalog
        .heldIds(player.inventory)
        .filter((id) => !before.has(id));
      expect(expected.length).toBeGreaterThan(0);
      expect([...pushed].sort((a, b) => a - b)).toEqual(expected);
      for (const id of expected) expect(player.taskValues[rikiTaskKey(id)]).toBe(1);
    },
  );
}, 20_000);

it("BuyRikiStory charges RatdisNum Riki coins once, pushes the id first and answers RspBuyRikiStory", async () => {
  const account = "riki-story";
  await withGateway(
    account,
    async (store) => {
      await store.update((state) => {
        state.players[account]!.money.push({ id: RIKI_COIN, count: 5 });
      });
    },
    async ({ call, store }) => {
      const coins = () =>
        store.snapshot().players[account]!.money.find(({ id }) => id === RIKI_COIN)!
          .count;
      const bought = await call("BuyRikiStory", { Id: EVENT_STORY, Name: "story" });
      const data = bought.findIndex(
        (packet) => packet.command === COMMAND.RIKI_DATA_RSP,
      );
      const reply = bought.findIndex(
        (packet) => packet.command === COMMAND.NTF_S2C_CALL,
      );
      expect(rikiIds(bought, COMMAND.RIKI_DATA_RSP)).toEqual([EVENT_STORY]);
      expect(data).toBeLessThan(reply);
      expect(clientCalls(bought)).toEqual([
        { method: "RspBuyRikiStory", parameters: { Id: EVENT_STORY } },
      ]);
      expect(bought.some((packet) => packet.command === COMMAND.MONEY_UPDATE_NTF)).toBe(
        true,
      );
      expect(coins()).toBe(2);
      expect(
        store.snapshot().players[account]!.taskValues[rikiTaskKey(EVENT_STORY)],
      ).toBe(1);

      // Bought already: the same answer, no second charge.
      const again = await call("BuyRikiStory", { Id: EVENT_STORY, Name: "story" });
      expect(clientCalls(again)).toEqual([
        { method: "RspBuyRikiStory", parameters: { Id: EVENT_STORY } },
      ]);
      expect(coins()).toBe(2);

      // Too few coins for the next story, and a card row is not for sale: nothing changes.
      const before = structuredClone(store.snapshot().players[account]!);
      expect(clientCalls(await call("BuyRikiStory", { Id: EVENT_STORY + 1 }))).toEqual(
        [],
      );
      expect(clientCalls(await call("BuyRikiStory", { Id: STARTER_IRENE }))).toEqual(
        [],
      );
      const after = store.snapshot().players[account]!;
      expect(after.money).toEqual(before.money);
      expect(after.taskValues[rikiTaskKey(EVENT_STORY + 1)]).toBeUndefined();
      expect(after.taskValues[rikiTaskKey(STARTER_IRENE)]).toBe(
        before.taskValues[rikiTaskKey(STARTER_IRENE)],
      );
    },
  );
}, 20_000);
