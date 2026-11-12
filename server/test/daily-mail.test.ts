import { once } from "node:events";
import { mkdir, mkdtemp, rm, rmdir } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import type { BaseAward } from "../src/game-data/chapter-config.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  PlayerRepository,
} from "../src/persistence/player-repository.js";
import { COMMAND } from "../src/protocol/commands.js";
import {
  HEADER_SIZE,
  makePacket,
  readPacket,
  type GamePacket,
} from "../src/protocol/packet.js";
import {
  decodeFields,
  fieldBytes,
  fieldVarint,
  firstBytes,
  firstNumber,
} from "../src/protocol/protobuf.js";
import { createGatewayServer } from "../src/servers/gateway-server.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};
const beforeReset = Date.parse("2026-11-09T19:59:59Z");
const afterReset = beforeReset + 1_000;
const awards: BaseAward[] = [
  [9, 13, 1, 1, 2],
  [7, 10, 1, 4, 2],
];

function ticketCounts(player: ReturnType<PlayerRepository["get"]>): number[] {
  return awards.map(
    ([g, d, p, l]) =>
      player?.inventory.find(
        (item) =>
          item.genre === g &&
          item.detail === d &&
          item.particular === p &&
          item.templateLevel === l,
      )?.count ?? 0,
  );
}

async function fixture(directory: string) {
  const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
  const filePath = path.join(directory, "state.json");
  const store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
  await store.initialize();
  const players = new PlayerRepository({
    store,
    defaults: config.playerDefaults,
    logger,
  });
  return { config, players, filePath };
}

it("persists one grant per profile and day and combines offline days after restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-mail-save-"));
  try {
    const { players } = await fixture(directory);
    await players.getOrCreate("alpha", beforeReset);
    await players.getOrCreate("beta", beforeReset);
    const a = await Promise.all(
      Array.from({ length: 4 }, () =>
        players.updateMailbox("alpha", { kind: "list" }, awards, beforeReset),
      ),
    );
    for (const { player } of a) {
      expect(player.mail?.messages).toHaveLength(1);
      expect(player.mail?.messages[0]?.attachments).toEqual(awards);
      expect(ticketCounts(player)).toEqual([0, 0]);
    }
    expect(players.get("beta")?.mail).toBeUndefined();
    const id = a[0]!.player.mail!.messages[0]!.id;
    const ignored = await players.updateMailbox(
      "alpha",
      { kind: "delete", ids: [id] },
      awards,
      beforeReset,
    );
    expect(ignored.acceptedIds).toEqual([]);

    const requests = await Promise.all([
      players.updateMailbox(
        "alpha",
        { kind: "claim", ids: [id, id], autoDelete: true },
        awards,
        beforeReset,
      ),
      players.updateMailbox(
        "alpha",
        { kind: "claim", ids: [id], autoDelete: false },
        awards,
        beforeReset,
      ),
    ]);
    expect(requests.map(({ acceptedIds }) => acceptedIds)).toEqual([[id], []]);
    expect(ticketCounts(players.get("alpha"))).toEqual([2, 2]);
    expect(ticketCounts(players.get("beta"))).toEqual([0, 0]);

    const restarted = (await fixture(directory)).players;
    const retry = await restarted.updateMailbox(
      "alpha",
      { kind: "list" },
      awards,
      beforeReset,
    );
    expect(retry.player.mail?.messages).toEqual([]);
    const now = afterReset + 3 * 86_400_000;
    const next = await restarted.updateMailbox("alpha", { kind: "list" }, awards, now);
    const messages = next.player.mail!.messages;
    expect(messages.map(({ id }) => id)).toEqual([id + 2, id + 1]);
    expect(
      messages.map(({ attachments }) => attachments.map((award) => award[4])),
    ).toEqual([
      [2, 2],
      [6, 6],
    ]);
    expect(messages[1]?.content).toContain("3 missed days");
    expect(next.player.mail?.lastDailyDate).toBe("2026-11-13");
    const rollback = await restarted.updateMailbox(
      "alpha",
      { kind: "list" },
      awards,
      beforeReset,
    );
    expect(rollback.player.mail?.messages).toHaveLength(2);
    expect(ticketCounts(rollback.player)).toEqual([2, 2]);

    const fresh = await restarted.updateMailbox("beta", { kind: "list" }, awards, now);
    expect(fresh.player.mail?.messages).toHaveLength(1);
    expect(fresh.player.mail?.messages[0]?.attachments).toEqual(awards);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("keeps a failed claim retryable without publishing a partial grant", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-mail-retry-"));
  try {
    const { players, filePath } = await fixture(directory);
    await players.getOrCreate("alpha", beforeReset);
    const issued = await players.updateMailbox(
      "alpha",
      { kind: "list" },
      awards,
      beforeReset,
    );
    const id = issued.player.mail!.messages[0]!.id;
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    await mkdir(tmpPath);
    const listed = await players.updateMailbox(
      "alpha",
      { kind: "list" },
      awards,
      beforeReset,
    );
    expect(listed.player.mail?.messages[0]?.id).toBe(id);
    const action = { kind: "claim" as const, ids: [id], autoDelete: false };
    await expect(
      players.updateMailbox("alpha", action, awards, beforeReset),
    ).rejects.toThrow();
    expect(ticketCounts(players.get("alpha"))).toEqual([0, 0]);
    expect(players.get("alpha")?.mail?.messages[0]?.attachments).toEqual(awards);
    await rmdir(tmpPath);
    const retried = await players.updateMailbox("alpha", action, awards, beforeReset);
    expect(retried.acceptedIds).toEqual([id]);
    expect(ticketCounts(retried.player)).toEqual([2, 2]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function request(
  socket: Socket,
  command: number,
  serial: number,
  body: Buffer,
  endCommand: number,
  endSerial = serial,
): Promise<GamePacket[]> {
  return new Promise((resolve, reject) => {
    const seen: GamePacket[] = [];
    let pending = Buffer.alloc(0);
    function finish(error?: Error): void {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", finish);
      if (error) reject(error);
      else resolve(seen);
    }
    function onData(chunk: Buffer): void {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= HEADER_SIZE) {
        const size = pending.readUInt32LE(4);
        if (pending.length < size) return;
        const packet = readPacket(pending.subarray(0, size));
        pending = pending.subarray(size);
        seen.push(packet);
        if (packet.command === endCommand && packet.serial === endSerial) {
          finish();
          return;
        }
      }
    }
    const timeout = setTimeout(
      () => finish(new Error(`Missing gateway packet ${endCommand}`)),
      3000,
    );
    socket.on("data", onData);
    socket.on("error", finish);
    socket.write(makePacket(command, serial, body));
  });
}

function unpackMailList(packet: GamePacket) {
  const fields = decodeFields(packet.payload);
  expect(firstNumber(fields, 2)).toBe(3);
  return decodeFields(firstBytes(fields, 1)!).map((field) => {
    expect(field.fieldNumber).toBe(1);
    return decodeFields(field.value as Buffer);
  });
}

it("serves stock inbox packets and pushes the new operational day to a connected client", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-mail-gateway-"));
  const { config, players } = await fixture(directory);
  const server = createGatewayServer({
    config: { ...config, gachaRotationDays: 7 },
    logger,
    players,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No gateway address");
  const socket = createConnection(address.port, "127.0.0.1");
  const clock = vi.spyOn(Date, "now").mockReturnValue(beforeReset);
  const empty = Buffer.alloc(0);
  try {
    await once(socket, "connect");
    const beforeLogin = await request(
      socket,
      COMMAND.GET_MAIL_REQ,
      1,
      empty,
      COMMAND.GET_MAIL_RSP,
    );
    expect(beforeLogin.at(-1)?.returnCode).not.toBe(0);
    const login = await request(
      socket,
      COMMAND.LOGIN_REQ,
      2,
      fieldBytes(1, "alpha"),
      COMMAND.LOGIN_RSP,
    );
    const mailPacket = login.find(({ command }) => command === COMMAND.GET_MAIL_RSP);
    const mail = unpackMailList(mailPacket!)[0]!;
    const id = firstNumber(mail, 1);
    expect(firstNumber(mail, 2)).toBe(0);
    expect(firstNumber(mail, 4)).toBe(beforeReset / 1000);
    expect(
      mail
        .filter(({ fieldNumber }) => fieldNumber === 8)
        .map(({ value }) =>
          decodeFields(value as Buffer).map(({ value }) => Number(value)),
        ),
    ).toEqual(awards);

    const ids = fieldVarint(1, id);
    const read = await request(
      socket,
      COMMAND.SET_MAIL_READ_REQ,
      3,
      ids,
      COMMAND.SET_MAIL_READ_RSP,
    );
    expect(firstNumber(decodeFields(read.at(-1)!.payload), 2)).toBe(1);
    const claim = await request(
      socket,
      COMMAND.GET_MAIL_ITEM_REQ,
      4,
      ids,
      COMMAND.GET_MAIL_ITEM_RSP,
    );
    expect(claim.map(({ command }) => command)).toEqual([
      COMMAND.ITEM_UPDATE_NTF,
      COMMAND.GET_MAIL_ITEM_RSP,
    ]);
    expect(ticketCounts(players.get("alpha"))).toEqual([2, 2]);
    const deleted = await request(
      socket,
      COMMAND.DEL_MAIL_REQ,
      5,
      ids,
      COMMAND.DEL_MAIL_RSP,
    );
    expect(firstNumber(decodeFields(deleted.at(-1)!.payload), 1)).toBe(id);
    const sameDay = await request(
      socket,
      COMMAND.GET_MAIL_REQ,
      6,
      empty,
      COMMAND.GET_MAIL_RSP,
    );
    expect(unpackMailList(sameDay.at(-1)!)).toEqual([]);

    clock.mockReturnValue(afterReset);
    const rollover = await request(
      socket,
      COMMAND.KEEP_ALIVE_REQ,
      7,
      empty,
      COMMAND.ADD_MAIL_NTF,
      0,
    );
    const newMail = decodeFields(
      firstBytes(decodeFields(rollover.at(-1)!.payload), 1)!,
    );
    expect(firstNumber(newMail, 1)).not.toBe(id);
    expect(firstNumber(newMail, 4)).toBe(afterReset / 1000);
    const dayTwo = await request(
      socket,
      COMMAND.GET_MAIL_REQ,
      8,
      empty,
      COMMAND.GET_MAIL_RSP,
    );
    expect(unpackMailList(dayTwo.at(-1)!)).toEqual([newMail]);
    expect(ticketCounts(players.get("alpha"))).toEqual([2, 2]);
  } finally {
    clock.mockRestore();
    socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
