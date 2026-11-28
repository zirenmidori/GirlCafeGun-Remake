import { once } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import { createConnection, type Server, type Socket } from "node:net";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { dailyMissionOperationalDate } from "../src/game-data/daily-mission-data.js";
import {
  LUA_COMMAND_GET_EXHIBITION_ITEM,
  LUA_COMMAND_GET_EXHIBITION_WEAPON,
  LUA_COMMAND_GET_SIGN,
  LUA_COMMAND_SET_EXHIBITION_ITEM,
  LUA_COMMAND_SET_EXHIBITION_WEAPON,
  LUA_COMMAND_SET_SIGN,
  ownedSlots,
  parseSign,
  parseSlots,
  reconcileProfilePage,
  renameDiamondCost,
  RENAME_COUNT_TASK_ID,
  SIGN_CHANGES_LEFT_TASK_ID,
  SIGN_CHANGES_PER_DAY,
} from "../src/game-data/user-page-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  FIRST_LEVEL_TASK_ID,
  makeInitialState,
  MONEY_DIAMOND,
  MONEY_PAY_DIAMOND,
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
import { mkdtemp } from "./helpers/temp.js";

const HEAD_FRAME_1 = (11 << 16) | 1;
const key = (id: number): string => String(id);

describe("profile page data", () => {
  it("prices renames from PlayerRename.txt and repeats the last row", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(renameDiamondCost)).toEqual([
      0, 0, 500, 1000, 1500, 2000, 2000,
    ]);
  });

  it("reads the signature from every Lua table shape", () => {
    expect(parseSign({ sCmd: 72, tbParam: ["hi"] })).toBe("hi");
    expect(parseSign({ 1: "hi" })).toBe("hi");
    expect(parseSign([""])).toBe("");
    expect(parseSign({ sCmd: 72 })).toBeNull();
    expect(parseSign([7])).toBeNull();
    expect(parseSign(["x".repeat(500)])).toHaveLength(100);
  });

  it("keeps three slots in place and drops unowned, wrong-genre and repeated guids", () => {
    const inventory = [
      { guid: 10, genre: 1, count: 1 },
      { guid: 11, genre: 1, count: 1 },
      { guid: 20, genre: 2, count: 1 },
      { guid: 12, genre: 1, count: 0 },
    ];
    expect(parseSlots({ sCmd: 74, tbParam: [21117, 0, 0] })).toEqual([21117, 0, 0]);
    // A Lua table with a hole keeps its positions.
    expect(parseSlots({ 2: 11 })).toEqual([0, 11, 0]);
    expect(parseSlots({ 1: 10, 3: 11 })).toEqual([10, 0, 11]);
    expect(parseSlots({ sCmd: 74 })).toBeNull();
    expect(ownedSlots([0, 11, 10], inventory, 1)).toEqual([0, 11, 10]);
    expect(ownedSlots([10, 10, 20], inventory, 1)).toEqual([10, 0, 0]);
    expect(ownedSlots([12, 99, 20], inventory, 2)).toEqual([0, 0, 20]);
    expect(ownedSlots(undefined, inventory, 1)).toEqual([0, 0, 0]);
  });

  it("repairs a named save at login and refills signature changes once a day", () => {
    const player = {
      name: "HealthS",
      registerTime: 1_794_850_151,
      taskValues: { [key(FIRST_LEVEL_TASK_ID)]: 6 } as Record<string, number>,
    };
    reconcileProfilePage(player, "", "2026-11-28");
    expect(player.taskValues[key(RENAME_COUNT_TASK_ID)]).toBe(1);
    expect(player.taskValues[key(HEAD_FRAME_1)]).toBe(1_794_850_151);
    expect(player.taskValues[key(SIGN_CHANGES_LEFT_TASK_ID)]).toBe(
      SIGN_CHANGES_PER_DAY,
    );
    player.taskValues[key(SIGN_CHANGES_LEFT_TASK_ID)] = 0;
    reconcileProfilePage(player, "", "2026-11-28");
    expect(player.taskValues[key(SIGN_CHANGES_LEFT_TASK_ID)]).toBe(0);
    reconcileProfilePage(player, "", "2026-11-29");
    expect(player.taskValues[key(SIGN_CHANGES_LEFT_TASK_ID)]).toBe(
      SIGN_CHANGES_PER_DAY,
    );

    // Still in the tutorial, or never named: the first naming stays free.
    for (const fresh of [
      { name: "HealthS", registerTime: 5, taskValues: {} as Record<string, number> },
      {
        name: "",
        registerTime: 5,
        taskValues: { [key(FIRST_LEVEL_TASK_ID)]: 6 } as Record<string, number>,
      },
    ]) {
      reconcileProfilePage(fresh, "", "2026-11-28");
      expect(fresh.taskValues[key(RENAME_COUNT_TASK_ID)]).toBeUndefined();
    }
  });
});

const account = "profile-wire:local-test";
const scratchRoot = path.resolve(import.meta.dirname, "../../tools/user-page-fix");
const silent: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

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
    const timeout = setTimeout(() => done(new Error(`Timed out on ${command}`)), 5_000);
    function done(error?: Error): void {
      clearTimeout(timeout);
      socket.off("data", onData);
      if (error) reject(error);
      else resolve(packets);
    }
    function onData(chunk: Buffer): void {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= HEADER_SIZE) {
        const size = pending.readUInt32LE(4);
        if (pending.length < size) return;
        const packet = readPacket(pending.subarray(0, size));
        pending = pending.subarray(size);
        packets.push(packet);
        if (finished(packet)) return done();
      }
    }
    socket.on("data", onData);
    socket.write(makePacket(command, serial, payload));
  });
}

function luaReply(packet: GamePacket): Record<string, unknown> | null {
  if (packet.command !== COMMAND.NTF_S2C_CALL) return null;
  const fields = decodeFields(packet.payload);
  if (firstString(fields, 1) !== "LuaCall") return null;
  return JSON.parse(firstString(fields, 2)) as Record<string, unknown>;
}

function tasks(packets: readonly GamePacket[]): Map<number, number> {
  return new Map(
    packets
      .filter((packet) => packet.command === COMMAND.TASK_VALUE_RSP)
      .flatMap((packet) => parseTaskChanges(packet.payload))
      .map(({ id, value }) => [id, value]),
  );
}

describe("profile page gateway", () => {
  it("answers the profile calls of the 2026-11-28 phone log and charges the second rename", async () => {
    await mkdir(scratchRoot, { recursive: true });
    const directory = await mkdtemp(path.join(scratchRoot, "tcp-test-"));
    const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
    const store = new JsonStore({
      filePath: path.join(directory, "state.json"),
      initialState: makeInitialState(),
      logger: silent,
    });
    await store.initialize();
    const players = new PlayerRepository({
      store,
      defaults: config.playerDefaults,
      logger: silent,
    });
    await players.getOrCreate(account);
    // The phone save: tutorial done, named in the newplayer1 cartoon, and
    // nothing in tasks 1/14, 1/29 and 11/1.
    await store.update((state) => {
      const player = state.players[account]!;
      player.name = "HealthS";
      player.taskValues[key(FIRST_LEVEL_TASK_ID)] = 6;
      for (const id of [RENAME_COUNT_TASK_ID, SIGN_CHANGES_LEFT_TASK_ID, HEAD_FRAME_1])
        delete player.taskValues[key(id)];
      delete player.profilePage;
      player.money = player.money.filter(
        ({ id }) => id !== MONEY_DIAMOND && id !== MONEY_PAY_DIAMOND,
      );
      player.money.push(
        { id: MONEY_DIAMOND, count: 300 },
        { id: MONEY_PAY_DIAMOND, count: 250 },
      );
      // A weapon (genre 2); the starter roster has none.
      player.inventory.push({ ...player.inventory[0]!, guid: 90_001, genre: 2 });
    });
    const inventory = players.get(account)!.inventory;
    const card = inventory.find((item) => item.genre === 1)!.guid;
    const weapon = inventory.find((item) => item.genre === 2)!.guid;

    let server: Server | undefined;
    let socket: Socket | undefined;
    try {
      server = createGatewayServer({ config, logger: silent, players });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      socket = createConnection({ host: "127.0.0.1", port: address.port });
      await once(socket, "connect");
      let serial = 0;
      await request(
        socket,
        COMMAND.VERIFY_REQ,
        ++serial,
        Buffer.concat([fieldBytes(1, "android"), fieldBytes(2, account)]),
        (packet) => packet.command === COMMAND.VERIFY_RSP,
      );
      const login = tasks(
        await request(
          socket,
          COMMAND.LOGIN_REQ,
          ++serial,
          fieldBytes(1, "profile-wire"),
          (packet) => packet.command === COMMAND.LOGIN_RSP,
        ),
      );
      expect(login.get(RENAME_COUNT_TASK_ID)).toBe(1);
      expect(login.get(SIGN_CHANGES_LEFT_TASK_ID)).toBe(SIGN_CHANGES_PER_DAY);
      expect(login.get(HEAD_FRAME_1)).toBeGreaterThan(0);
      expect(players.get(account)!.profilePage?.signDate).toBe(
        dailyMissionOperationalDate(),
      );

      const call = async (command: number, tbParam: unknown) => {
        const packets = await request(
          socket!,
          COMMAND.C2S_CALL_REQ,
          ++serial,
          makeServerLuaCall("LuaCall", { sCmd: command, tbParam }),
          (packet) => luaReply(packet)?.sCmd === command,
        );
        const replyAt = packets.findIndex(
          (packet) => luaReply(packet)?.sCmd === command,
        );
        return {
          reply: luaReply(packets[replyAt]!)!.tbParam,
          tasksBeforeReply: tasks(packets.slice(0, replyAt)),
        };
      };

      // UI_User:OnOpen sends 71, 73 and 77 with an empty table.
      expect((await call(LUA_COMMAND_GET_SIGN, [])).reply).toEqual([""]);
      expect((await call(LUA_COMMAND_GET_EXHIBITION_ITEM, [])).reply).toEqual([
        0, 0, 0,
      ]);
      expect((await call(LUA_COMMAND_GET_EXHIBITION_WEAPON, [])).reply).toEqual([
        0, 0, 0,
      ]);

      const signed = await call(LUA_COMMAND_SET_SIGN, ["Cafe manager"]);
      expect(signed.reply).toEqual(["Cafe manager"]);
      expect(signed.tasksBeforeReply.get(SIGN_CHANGES_LEFT_TASK_ID)).toBe(
        SIGN_CHANGES_PER_DAY - 1,
      );
      expect((await call(LUA_COMMAND_GET_SIGN, [])).reply).toEqual(["Cafe manager"]);

      // The log line: tbParam [21117,0,0]; here the card is the fixture's own.
      expect((await call(LUA_COMMAND_SET_EXHIBITION_ITEM, [0, card, 0])).reply).toEqual(
        [0, card, 0],
      );
      expect((await call(LUA_COMMAND_GET_EXHIBITION_ITEM, [])).reply).toEqual([
        0,
        card,
        0,
      ]);
      expect(
        (await call(LUA_COMMAND_SET_EXHIBITION_ITEM, [card, card, 999_999])).reply,
      ).toEqual([card, 0, 0]);
      expect(
        (await call(LUA_COMMAND_SET_EXHIBITION_WEAPON, [weapon, card, 0])).reply,
      ).toEqual([weapon, 0, 0]);
      expect((await call(LUA_COMMAND_GET_EXHIBITION_WEAPON, [])).reply).toEqual([
        weapon,
        0,
        0,
      ]);

      // Rename 2 costs 500 Diamonds: 300 free, then 200 paid.
      const rename = async (name: string) => {
        const packets = await request(
          socket!,
          COMMAND.RENAME_REQ,
          ++serial,
          fieldBytes(3, name),
          (packet) => packet.command === COMMAND.RENAME_RSP,
        );
        return {
          code: packets.at(-1)!.returnCode,
          tasksBeforeReply: tasks(packets.slice(0, -1)),
        };
      };
      const paid = await rename("Manager");
      expect(paid.code).toBe(0);
      expect(paid.tasksBeforeReply.get(RENAME_COUNT_TASK_ID)).toBe(2);
      const after = players.get(account)!;
      expect(after.name).toBe("Manager");
      expect(after.money.find(({ id }) => id === MONEY_DIAMOND)?.count).toBe(0);
      expect(after.money.find(({ id }) => id === MONEY_PAY_DIAMOND)?.count).toBe(50);

      // Rename 3 costs 1000: refused, nothing changes.
      expect((await rename("Boss")).code).toBe(11015);
      expect(players.get(account)!.name).toBe("Manager");
      expect(players.get(account)!.taskValues[key(RENAME_COUNT_TASK_ID)]).toBe(2);
    } finally {
      if (socket) {
        const closed = once(socket, "close");
        socket.destroy();
        await closed;
      }
      if (server?.listening)
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      await store.flush();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
