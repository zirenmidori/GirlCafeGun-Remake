import { once } from "node:events";
import { rm, rmdir } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Server, type Socket } from "node:net";
import path from "node:path";

import { expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  makeLevelId,
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
  firstNumber,
  firstString,
  type DecodedField,
} from "../src/protocol/protobuf.js";
import { createGatewayServer } from "../src/servers/gateway-server.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

async function* readPackets(socket: Socket): AsyncGenerator<GamePacket> {
  let buffer = Buffer.alloc(0);
  for await (const chunk of socket.iterator({ destroyOnReturn: false })) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);
    while (buffer.length >= HEADER_SIZE) {
      const size = buffer.readUInt32LE(4);
      if (size < HEADER_SIZE) throw new Error(`Invalid packet length ${size}`);
      if (size > buffer.length) break;
      yield readPacket(buffer.subarray(0, size));
      buffer = buffer.subarray(size);
    }
  }
}

function nested(
  fields: readonly DecodedField[],
  fieldNumber: number,
): DecodedField[][] {
  return fields.flatMap((field) =>
    field.fieldNumber === fieldNumber && Buffer.isBuffer(field.value)
      ? [decodeFields(field.value)]
      : [],
  );
}

function phoneTopics(packets: readonly GamePacket[]) {
  const notification = packets.find(({ command }) => command === COMMAND.PHONE_MSG_NTF);
  expect(notification).toBeDefined();
  const fields = decodeFields(notification!.payload);
  return {
    letters: nested(fields, 1).flatMap((contact) =>
      nested(contact, 4).map((topic) => firstNumber(topic, 1)),
    ),
    moments: nested(fields, 2).map((topic) => firstNumber(topic, 1)),
  };
}

interface PhoneMessage {
  nCmd: number;
  nError: number;
  nMsgId?: number;
  nNpcId?: number;
  nSelectId?: number;
}

function phoneMessage(packet: GamePacket): PhoneMessage | undefined {
  if (packet.command !== COMMAND.NTF_S2C_CALL) return undefined;
  const fields = decodeFields(packet.payload);
  if (firstString(fields, 1) !== "ServerPhoneMsg") return undefined;
  return JSON.parse(firstString(fields, 2)) as PhoneMessage;
}

async function withLogin(
  port: number,
  username: string,
  test: (
    topics: ReturnType<typeof phoneTopics>,
    sendStory: (command: 12 | 13, storyPath: string) => Promise<PhoneMessage[]>,
  ) => Promise<void>,
): Promise<void> {
  const socket = createConnection({ host: "127.0.0.1", port });
  socket.setTimeout(3_000, () => socket.destroy(new Error("Gateway test timed out")));
  const packets = readPackets(socket);
  let nextSerial = 0;
  async function exchange(
    command: number,
    payload: Buffer,
    isLast: (packet: GamePacket, serial: number) => boolean,
  ): Promise<GamePacket[]> {
    const serial = ++nextSerial;
    socket.write(makePacket(command, serial, payload));
    const result: GamePacket[] = [];
    for (;;) {
      const next = await packets.next();
      if (next.done) throw new Error(`Gateway closed during request ${command}`);
      result.push(next.value);
      if (isLast(next.value, serial)) return result;
    }
  }
  try {
    await once(socket, "connect");
    await exchange(
      COMMAND.VERIFY_REQ,
      Buffer.concat([fieldBytes(1, "android"), fieldBytes(2, `${username}:test`)]),
      (packet, serial) =>
        packet.command === COMMAND.VERIFY_RSP && packet.serial === serial,
    );
    const login = await exchange(
      COMMAND.LOGIN_REQ,
      fieldBytes(1, username),
      (packet, serial) =>
        packet.command === COMMAND.LOGIN_RSP && packet.serial === serial,
    );
    await test(phoneTopics(login), async (nCmd, nMsgId) => {
      const result = await exchange(
        COMMAND.C2S_CALL_REQ,
        makeServerLuaCall("PhoneMsg", { nCmd, nMsgId }),
        (packet) => phoneMessage(packet)?.nCmd === nCmd,
      );
      return result.flatMap((packet) => {
        const message = phoneMessage(packet);
        return message ? [message] : [];
      });
    });
  } finally {
    socket.destroy();
    await packets.return(undefined);
  }
}

it("restores progression-triggered chats and Moments, then delivers each story event once across restart", async () => {
  const directory = await mkdtemp(
    path.resolve(import.meta.dirname, "../../tools/phone-fix/tcp-test-"),
  );
  const filePath = path.join(directory, "state.json");
  const existing = "phone-progress-existing";
  const fresh = "phone-progress-fresh";
  const existingAccount = `${existing}:test`;
  const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
  let server: Server | undefined;

  async function open(): Promise<{
    port: number;
    players: PlayerRepository;
    store: JsonStore<ReturnType<typeof makeInitialState>>;
  }> {
    const store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
    await store.initialize();
    const players = new PlayerRepository({
      store,
      defaults: { ...config.playerDefaults, firstLevelComplete: false },
      logger,
    });
    server = createGatewayServer({ config, logger, players });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing gateway port");
    return { port: address.port, players, store };
  }

  async function close(): Promise<void> {
    if (!server?.listening) return;
    const gateway = server;
    await new Promise<void>((resolve, reject) => {
      gateway.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  }

  const storyEvents = [
    { request: 12, path: "girl09/girl09_love03.txt", push: 3, topicId: 4 },
    { request: 13, path: "girl09/girl09_line02.txt", push: 1, topicId: 14 },
  ] as const;

  try {
    const { port, players, store } = await open();
    await players.getOrCreate(existingAccount);
    await store.update((state) => {
      const player = state.players[existingAccount]!;
      player.lastLoginAt = "2026-11-01T12:00:00.000Z";
      // CartoonFileId 351 and 511 both remap their original bit 31.
      player.taskValues[(39 << 16) | 211] = 1 << 1;
      player.taskValues[(39 << 16) | 216] = 1 << 6;
      // Letter 54 uses the historical basename alias for CartoonFileId 396.
      player.taskValues[(39 << 16) | 12] = 1 << 12;
      player.levels = [
        { id: makeLevelId(2, 1, 1), star: 15 },
        { id: makeLevelId(2, 6, 1), star: 15 },
      ];
    });

    await withLogin(port, existing, async (topics, sendStory) => {
      expect(topics.letters).toEqual(expect.arrayContaining([1, 2, 12, 54, 72]));
      expect(topics.moments).toEqual(expect.arrayContaining([1, 3, 64]));
      expect(topics.letters).not.toContain(4);
      expect(topics.moments).not.toContain(14);
      for (const event of storyEvents) {
        const response = await sendStory(event.request, event.path);
        expect(response).toContainEqual({
          nError: 0,
          nCmd: event.push,
          nNpcId: 9,
          nMsgId: event.topicId,
          nSelectId: 0,
        });
        const replay = await sendStory(event.request, event.path);
        expect(replay).toEqual([{ nError: 0, nCmd: event.request }]);
      }
    });

    await withLogin(port, fresh, async (topics) => {
      for (const id of [1, 2, 4, 12, 54, 72]) expect(topics.letters).not.toContain(id);
      for (const id of [1, 3, 14, 64]) expect(topics.moments).not.toContain(id);
    });

    await close();
    const reopened = await open();
    await withLogin(reopened.port, existing, async (topics, sendStory) => {
      for (const id of [1, 2, 4, 12, 54, 72])
        expect(topics.letters.filter((topic) => topic === id)).toHaveLength(1);
      for (const id of [1, 3, 14, 64])
        expect(topics.moments.filter((topic) => topic === id)).toHaveLength(1);
      for (const event of storyEvents) {
        expect(await sendStory(event.request, event.path)).toEqual([
          { nError: 0, nCmd: event.request },
        ]);
      }
    });
  } finally {
    await close();
    await rm(filePath, { force: true });
    await rm(`${filePath}.${process.pid}.tmp`, { force: true });
    await rmdir(directory);
  }
}, 15_000);
