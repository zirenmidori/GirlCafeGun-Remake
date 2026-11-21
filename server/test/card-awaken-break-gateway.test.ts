import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createConnection, type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  PlayerRepository,
  type InventoryEntryState,
} from "../src/persistence/player-repository.js";
import { COMMAND } from "../src/protocol/commands.js";
import { makeItemNotification, makeServerLuaCall } from "../src/protocol/messages.js";
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
    const timeout = setTimeout(() => {
      finish(new Error(`Timed out waiting for the response to command ${command}`));
    }, 5000);

    function finish(error?: Error): void {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", finish);
      socket.off("close", onClose);
      if (error) reject(error);
      else resolve(packets);
    }
    function onClose(): void {
      finish(new Error("Gateway closed before responding"));
    }
    function onData(chunk: Buffer): void {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= HEADER_SIZE) {
        const size = pending.readUInt32LE(4);
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
    socket.once("error", finish);
    socket.once("close", onClose);
    socket.write(makePacket(command, serial, payload));
  });
}

function itemFields(payload: Buffer, guid: number) {
  return decodeFields(payload)
    .filter((field) => field.fieldNumber === 1)
    .map((field) => decodeFields(field.value as Buffer))
    .find((fields) => firstNumber(fields, 1) === guid)!;
}

function miniSkills(fields: ReturnType<typeof decodeFields>) {
  return fields
    .filter((field) => field.fieldNumber === 11)
    .map((field) => decodeFields(field.value as Buffer))
    .map((skill) => [
      firstNumber(skill, 1),
      firstNumber(skill, 2),
      firstNumber(skill, 3),
    ]);
}

function luaReply(packet: GamePacket): unknown {
  return JSON.parse(firstString(decodeFields(packet.payload), 2));
}

function entry(
  guid: number,
  genre: number,
  detail: number,
  particular: number,
  templateLevel: number,
  count: number,
  overrides: Partial<InventoryEntryState> = {},
): InventoryEntryState {
  return {
    guid,
    genre,
    detail,
    particular,
    templateLevel,
    count,
    createTime: 1,
    enhanceLevel: genre === 1 ? 1 : 0,
    enhanceExp: 0,
    breakLevel: 0,
    lockOn: 0,
    ...overrides,
  };
}

it("awakens and breaks a card over real TCP and answers every refusal with one errorKey reply", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-card-awaken-tcp-"));
  const account = "card-wire:local-only";
  let server: Server | undefined;
  let socket: Socket | undefined;
  try {
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
    await store.update((state) => {
      const player = state.players[account]!;
      player.money = [{ id: 2, count: 200_000 }];
      player.formations = [];
      player.inventory = [
        entry(100, 1, 1, 1, 1, 1),
        entry(101, 1, 1, 1, 1, 1, { cardSkillLevels: [2, 1, 1, 1] }),
        entry(102, 1, 1, 1, 1, 1, { lockOn: 1 }),
        entry(140, 7, 2, 3, 1, 3),
      ];
      player.nextItemGuid = 1_000;
    });
    server = createGatewayServer({ config, logger, players });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
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
    await request(
      socket,
      COMMAND.LOGIN_REQ,
      ++serial,
      fieldBytes(1, "card-wire"),
      (packet) => packet.command === COMMAND.LOGIN_RSP,
    );
    const call = (command: number, tbParam: unknown) =>
      request(
        socket!,
        COMMAND.C2S_CALL_REQ,
        ++serial,
        makeServerLuaCall("LuaCall", { sCmd: command, tbParam }),
        (packet) =>
          packet.command === COMMAND.NTF_S2C_CALL &&
          (luaReply(packet) as { sCmd?: number }).sCmd === command,
      );
    const awaken = (materials: unknown[]) =>
      call(5, { guid: 100, clientlv: 1, clientSkillLv: 0, items: materials });
    const expectSingleError = (packets: GamePacket[], command: number, key: string) => {
      // The gateway acknowledges every call with C2S_CALL_RSP; nothing else may follow.
      const replies = packets.filter(({ command: c }) => c !== COMMAND.C2S_CALL_RSP);
      expect(replies).toHaveLength(1);
      expect(replies[0]!.command).toBe(COMMAND.NTF_S2C_CALL);
      expect(luaReply(replies[0]!)).toEqual({
        sCmd: command,
        tbParam: { errorKey: key },
      });
    };

    // Refusals: a locked donor, a missing donor, and the card itself.
    expectSingleError(await awaken([[2, 102, 1]]), 5, "Card.Tip02");
    expectSingleError(await awaken([[2, 999, 1]]), 5, "UI_WeaponStrong.NotEnough");
    expectSingleError(await awaken([[2, 100, 1]]), 5, "UI_WeaponStrong.NotEnough");
    expectSingleError(await awaken([[1, 25, 1]]), 5, "UI_WeaponStrong.NotEnough");
    // Break without the second item stack changes nothing.
    const beforeRefusals = store.snapshot();
    expectSingleError(await call(6, { guid: 100 }), 6, "Error.20011");
    expect(store.snapshot()).toEqual(beforeRefusals);
    await store.update((state) => {
      state.players[account]!.inventory.push(entry(141, 7, 2, 3, 2, 3));
    });

    // Awakening with a duplicate.
    const awakened = await awaken([[2, 101, 1]]);
    const itemIndex = awakened.findIndex(
      (packet) => packet.command === COMMAND.ITEM_UPDATE_NTF,
    );
    const moneyIndex = awakened.findIndex(
      (packet) => packet.command === COMMAND.MONEY_UPDATE_NTF,
    );
    expect(itemIndex).toBeGreaterThanOrEqual(0);
    expect(moneyIndex).toBeGreaterThan(itemIndex);
    expect(moneyIndex).toBeLessThan(awakened.length - 1);
    expect(luaReply(awakened.at(-1)!)).toEqual({ sCmd: 5, tbParam: {} });
    const update = awakened[itemIndex]!.payload;
    const skills = miniSkills(itemFields(update, 100));
    expect(skills).toHaveLength(3);
    expect(skills.map(([id, , type]) => [id, type])).toEqual([
      [20026, 3],
      [30262, 2],
      [38143, 2],
    ]);
    const levels = skills.map(([, level]) => level!);
    expect(levels.reduce((sum, level) => sum + level, 0)).toBe(3 + 4);
    expect(firstNumber(itemFields(update, 101), 6)).toBe(0);
    const saved = store.snapshot().players[account]!;
    expect(miniSkills(itemFields(makeItemNotification(saved), 100))).toEqual(skills);

    // Break needs the step items and gold; the client acts on ok only.
    const broken = await call(6, { guid: 100 });
    const breakItem = broken.findIndex(
      (packet) => packet.command === COMMAND.ITEM_UPDATE_NTF,
    );
    const breakMoney = broken.findIndex(
      (packet) => packet.command === COMMAND.MONEY_UPDATE_NTF,
    );
    expect(breakItem).toBeGreaterThanOrEqual(0);
    expect(breakMoney).toBeGreaterThan(breakItem);
    expect(luaReply(broken.at(-1)!)).toEqual({ sCmd: 6, tbParam: { ok: true } });
    expect(firstNumber(itemFields(broken[breakItem]!.payload, 100), 10)).toBe(1);
    expect(store.snapshot().players[account]!.inventory[0]).toMatchObject({
      guid: 100,
      breakLevel: 1,
    });
  } finally {
    if (socket) {
      const closed = once(socket, "close");
      socket.destroy();
      await closed;
    }
    if (server?.listening)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    await rm(directory, { recursive: true, force: true });
  }
});
