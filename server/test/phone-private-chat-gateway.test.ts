import { once } from "node:events";
import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
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
  firstNumber,
  firstString,
} from "../src/protocol/protobuf.js";
import { createGatewayServer } from "../src/servers/gateway-server.js";

function phoneReply(packet: GamePacket): Record<string, unknown> | null {
  if (packet.command !== COMMAND.NTF_S2C_CALL) return null;
  const fields = decodeFields(packet.payload);
  if (firstString(fields, 1) !== "ServerPhoneMsg") return null;
  return JSON.parse(firstString(fields, 2)) as Record<string, unknown>;
}

function request(
  socket: Socket,
  command: number,
  serial: number,
  payload: Buffer,
  received: (packet: GamePacket) => boolean,
): Promise<GamePacket[]> {
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    const packets: GamePacket[] = [];
    const timeout = setTimeout(
      () => finish(new Error(`No response to ${command}/${serial}`)),
      4000,
    );
    function finish(error?: Error) {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", finish);
      if (error) reject(error);
      else resolve(packets);
    }
    function onData(chunk: Buffer) {
      bytes = Buffer.concat([bytes, chunk]);
      while (bytes.length >= HEADER_SIZE) {
        const size = bytes.readUInt32LE(4);
        if (size < HEADER_SIZE || size > 16 * 1024 * 1024) {
          finish(new Error("Invalid TCP packet length"));
          return;
        }
        if (bytes.length < size) return;
        const packet = readPacket(bytes.subarray(0, size));
        bytes = bytes.subarray(size);
        packets.push(packet);
        if (received(packet)) {
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

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

it("persists story chat, packed replies, title and one affection claim over TCP", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-private-chat-"));
  const filePath = path.join(directory, "state.json");
  const account = "private-chat-test";
  const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
  const story = "girl09/girl09_love03.txt";
  const topicId = 4;
  let runtime: Awaited<ReturnType<typeof boot>> | undefined;
  let socket: Socket | undefined;

  async function boot() {
    const store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
    await store.initialize();
    const players = new PlayerRepository({
      store,
      defaults: config.playerDefaults,
      logger,
    });
    const server = createGatewayServer({ config, logger, players });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return { store, players, server };
  }

  async function stop() {
    socket?.destroy();
    socket = undefined;
    if (!runtime) return;
    const { server, store } = runtime;
    runtime = undefined;
    await store.flush();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async function connect() {
    const address = runtime!.server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing gateway port");
    const client = createConnection({ host: "127.0.0.1", port: address.port });
    socket = client;
    await once(client, "connect");
    await request(
      client,
      COMMAND.VERIFY_REQ,
      1,
      Buffer.concat([fieldBytes(1, "selftest"), fieldBytes(2, account)]),
      (packet) => packet.command === COMMAND.VERIFY_RSP && packet.serial === 1,
    );
    const login = await request(
      client,
      COMMAND.LOGIN_REQ,
      2,
      fieldBytes(1, account),
      (packet) => packet.command === COMMAND.LOGIN_RSP && packet.serial === 2,
    );
    return login.find((packet) => packet.command === COMMAND.PHONE_MSG_NTF)!;
  }

  function wireTopic(snapshot: GamePacket) {
    for (const entry of decodeFields(snapshot.payload).filter(
      (field) => field.fieldNumber === 1,
    )) {
      const group = decodeFields(entry.value as Buffer);
      if (firstNumber(group, 1) !== 9) continue;
      const topic = group
        .filter((field) => field.fieldNumber === 4)
        .map((field) => decodeFields(field.value as Buffer))
        .find((fields) => firstNumber(fields, 1) === topicId);
      if (topic) return { title: firstString(group, 2), topic };
    }
    return null;
  }

  let serial = 2;
  const call = (
    nCmd: number,
    parameters: Record<string, unknown>,
    callbackCommand = nCmd,
  ) =>
    request(
      socket!,
      COMMAND.C2S_CALL_REQ,
      ++serial,
      makeServerLuaCall("PhoneMsg", { nCmd, ...parameters }),
      (packet) => phoneReply(packet)?.nCmd === callbackCommand,
    );

  try {
    runtime = await boot();
    expect(wireTopic(await connect())).toBeNull();
    const started = await call(12, { nMsgId: story });
    expect(started.map(phoneReply)).toContainEqual({
      nError: 0,
      nCmd: 3,
      nNpcId: 9,
      nMsgId: topicId,
      nSelectId: 0,
    });
    const repeatedStory = await call(12, { nMsgId: story });
    expect(repeatedStory.map(phoneReply)).not.toContainEqual(
      expect.objectContaining({ nCmd: 3, nMsgId: topicId }),
    );

    const invalid = await call(3, { nMsgId: topicId, nSelectId: 2 });
    expect(phoneReply(invalid.at(-1)!)).toEqual({ nError: 20040, nCmd: 3 });
    const reply = await call(3, { nMsgId: topicId, nSelectId: 1 });
    expect(phoneReply(reply.at(-1)!)).toEqual({
      nError: 0,
      nCmd: 3,
      nNpcId: 9,
      nMsgId: topicId,
      nSelectId: 21,
    });
    const award = await call(7, { nMsgId: topicId });
    expect(phoneReply(award.at(-1)!)).toMatchObject({
      nError: 0,
      nCmd: 7,
      nNpcId: 9,
      nMsgId: topicId,
      tbExp: [6, 0, 6, 1, 1],
    });
    const repeatAward = await call(7, { nMsgId: topicId });
    expect(phoneReply(repeatAward.at(-1)!)).toEqual({
      nError: 0,
      nCmd: 7,
      nNpcId: 9,
      nMsgId: topicId,
    });
    expect(
      runtime.players.get(account)?.girls.find(({ girlId }) => girlId === 9)?.exp,
    ).toBe(6);
    const title = await call(4, { nNpcId: 9, strTitle: "Wuxia" });
    expect(phoneReply(title.at(-1)!)).toMatchObject({
      nError: 0,
      nCmd: 4,
      strTitle: "Wuxia",
    });

    await stop();
    runtime = await boot();
    const persisted = wireTopic(await connect())!;
    expect(persisted.title).toBe("Wuxia");
    expect(firstNumber(persisted.topic, 2)).toBe(21);
    expect(firstNumber(persisted.topic, 4)).toBe(1);

    await call(10, { nMsgId: topicId });
    await call(12, { nMsgId: story });
    expect(
      runtime.players
        .get(account)
        ?.phone.letters.some((letter) => letter.topicId === topicId),
    ).toBe(false);
    expect(
      runtime.players.get(account)?.phone.completedDeletedLetterTopicIds,
    ).toContain(topicId);

    const guide = await call(11, { nMsgId: 1 }, 3);
    expect(phoneReply(guide.at(-1)!)).toEqual({
      nError: 0,
      nCmd: 3,
      nNpcId: 111,
      nMsgId: 1,
      nSelectId: 0,
    });
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
