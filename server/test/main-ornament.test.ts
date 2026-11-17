import { once } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import { createConnection, type Server, type Socket } from "node:net";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { AutoUseItemCatalog } from "../src/game-data/auto-use-item-data.js";
import {
  changeBackground,
  changeDecorate,
  ITEMLESS_THEME_IDS,
  LUA_COMMAND_CHANGE_BACKGROUND,
  LUA_COMMAND_CHANGE_DECORATE,
  makeOrnamentTaskId,
  reconcileMainThemes,
} from "../src/game-data/main-ornament-data.js";
import {
  changeProfileLook,
  LUA_COMMAND_GET_VISITING_CARD_DATA,
  LUA_COMMAND_SET_PLAYER_LIST_SKIN,
  LUA_COMMAND_SET_VISITING_CARD,
  PROFILE_LOOK_LOCKED_ERROR,
  profileLookReply,
} from "../src/game-data/look-data.js";
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
import { mkdtemp } from "./helpers/temp.js";

const key = (offset: number): string => String(makeOrnamentTaskId(offset));

describe("main-screen theme state", () => {
  it("gives the five item-less themes once and keeps existing times", () => {
    const values: Record<string, number> = { [key(2)]: 77 };
    expect(reconcileMainThemes(values, 1_000).map((id) => id & 0xffff)).toEqual([
      1, 3, 4, 5,
    ]);
    expect(values[key(2)]).toBe(77);
    expect(values[key(1)]).toBe(1_000);
    expect(reconcileMainThemes(values, 2_000)).toEqual([]);
    expect(values[key(6)]).toBeUndefined();
  });

  it("changes theme and decoration only for an owned theme", () => {
    const values: Record<string, number> = {};
    reconcileMainThemes(values, 1_000);
    const ok = changeDecorate(values, {
      sCmd: LUA_COMMAND_CHANGE_DECORATE,
      tbParam: [
        { type: 1, id: 3 },
        { type: 2, id: 3 },
      ],
    });
    expect(ok.ok).toBe(true);
    expect(values[key(0)]).toBe(3);
    expect(values[key(1000)]).toBe(1);
    // Lua tables with integer keys may arrive as a {"1":..,"2":..} object.
    expect(
      changeDecorate(values, { 1: { type: 1, id: 1 }, 2: { type: 2, id: 0 } }).ok,
    ).toBe(true);
    expect(values[key(0)]).toBe(1);
    expect(values[key(1000)]).toBe(0);
    const locked = changeDecorate(values, [
      { type: 1, id: 7 },
      { type: 2, id: 7 },
    ]);
    expect(locked).toEqual({ ok: false, reason: "theme_not_owned:7" });
    expect(values[key(0)]).toBe(1);
    expect(values[key(1000)]).toBe(0);
  });

  it("changes background only for an owned background", () => {
    const values: Record<string, number> = {};
    expect(changeBackground(values, { id: 5 }).ok).toBe(false);
    expect(changeBackground(values, { id: 0 }).ok).toBe(true);
    values[key(2005)] = 123;
    expect(changeBackground(values, { tbParam: { id: 5 }, sCmd: 96 }).ok).toBe(true);
    expect(values[key(2000)]).toBe(5);
    expect(changeBackground(values, { id: 27 }).ok).toBe(false);
  });

  it("unlocks a received theme item through its task value", () => {
    const catalog = AutoUseItemCatalog.loadDefault();
    for (const id of [6, 7, 8, 9, 10, 11])
      expect(catalog.effect(6, 24, id, 3)).toEqual({
        kind: "unlock-time",
        taskIds: [makeOrnamentTaskId(id)],
      });
    for (const id of ITEMLESS_THEME_IDS)
      expect(catalog.effect(6, 24, id, 3)).toBeNull();
  });
});

const account = "ornament-wire:local-test";
const scratchRoot = path.resolve(import.meta.dirname, "../../tools/ornament-fix");
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

describe("main-screen theme gateway", () => {
  it("repairs an old save at login and applies themes and backgrounds", async () => {
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
    // An old save: nothing in group 87.
    await store.update((state) => {
      const values = state.players[account]!.taskValues;
      for (const id of Object.keys(values))
        if (Number(id) >>> 16 === 87) delete values[id];
    });
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
      const login = await request(
        socket,
        COMMAND.LOGIN_REQ,
        ++serial,
        fieldBytes(1, "ornament-wire"),
        (packet) => packet.command === COMMAND.LOGIN_RSP,
      );
      const loginTasks = tasks(login);
      const loginState = players.get(account)!.taskValues;
      for (const id of ITEMLESS_THEME_IDS)
        expect(Number(loginState[key(id)])).toBeGreaterThan(0);
      for (const id of ITEMLESS_THEME_IDS)
        expect(loginTasks.get(makeOrnamentTaskId(id))).toBeGreaterThan(0);

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
          reply: luaReply(packets[replyAt]!)!.tbParam as Record<string, unknown>,
          tasksBeforeReply: tasks(packets.slice(0, replyAt)),
        };
      };

      const theme = await call(LUA_COMMAND_CHANGE_DECORATE, [
        { type: 1, id: 4 },
        { type: 2, id: 0 },
      ]);
      expect(theme.reply).toEqual({});
      expect(theme.tasksBeforeReply.get(makeOrnamentTaskId(0))).toBe(4);
      expect(theme.tasksBeforeReply.get(makeOrnamentTaskId(1000))).toBe(0);

      const locked = await call(LUA_COMMAND_CHANGE_DECORATE, [{ type: 1, id: 9 }]);
      expect(locked.reply).toEqual({ nError: 1 });
      expect(players.get(account)!.taskValues[key(0)]).toBe(4);

      const background = await call(LUA_COMMAND_CHANGE_BACKGROUND, { id: 0 });
      expect(background.reply).toEqual({});
      expect(background.tasksBeforeReply.get(makeOrnamentTaskId(2000))).toBe(0);
      expect((await call(LUA_COMMAND_CHANGE_BACKGROUND, { id: 12 })).reply).toEqual({
        nError: 1,
      });
      await store.update((state) => {
        state.players[account]!.taskValues[String((77 << 16) | 15)] = 1_700_000_000;
      });
      expect((await call(LUA_COMMAND_SET_PLAYER_LIST_SKIN, 15)).reply).toEqual({
        VisitingCardID: 0,
        PlayerListSkinID: 15,
        ChatBubbleID: 0,
      });
      expect((await call(LUA_COMMAND_SET_VISITING_CARD, 7)).reply).toEqual({
        nError: PROFILE_LOOK_LOCKED_ERROR,
      });
      expect((await call(LUA_COMMAND_GET_VISITING_CARD_DATA, {})).reply).toEqual({
        VisitingCardID: 0,
        PlayerListSkinID: 15,
        ChatBubbleID: 0,
      });
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

describe("profile look", () => {
  it("sets an owned card skin, list mark or chat bubble and keeps the others", () => {
    const values: Record<string, number> = { [String((77 << 16) | 15)]: 123 };
    const mark = changeProfileLook(
      undefined,
      values,
      LUA_COMMAND_SET_PLAYER_LIST_SKIN,
      {
        sCmd: LUA_COMMAND_SET_PLAYER_LIST_SKIN,
        tbParam: 15,
      },
    );
    expect(mark).toEqual({
      ok: true,
      look: { visitingCardId: 0, playerListSkinId: 15, chatBubbleId: 0 },
    });
    const locked = changeProfileLook(
      mark.ok ? mark.look : undefined,
      values,
      LUA_COMMAND_SET_VISITING_CARD,
      7,
    );
    expect(locked).toEqual({ ok: false, reason: "not_owned:76/7" });
    const off = changeProfileLook(
      mark.ok ? mark.look : undefined,
      values,
      LUA_COMMAND_SET_PLAYER_LIST_SKIN,
      0,
    );
    expect(off.ok && off.look.playerListSkinId).toBe(0);
    expect(profileLookReply(mark.ok ? mark.look : undefined)).toEqual({
      VisitingCardID: 0,
      PlayerListSkinID: 15,
      ChatBubbleID: 0,
    });
    expect(profileLookReply(undefined)).toEqual({
      VisitingCardID: 0,
      PlayerListSkinID: 0,
      ChatBubbleID: 0,
    });
  });
});
