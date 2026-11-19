import { once } from "node:events";
import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import os from "node:os";
import { createConnection, type Socket } from "node:net";
import path from "node:path";

import { describe, expect, it } from "vitest";

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
import { decodeFields, fieldBytes, firstString } from "../src/protocol/protobuf.js";
import { createGatewayServer } from "../src/servers/gateway-server.js";

const account = "unknown-level:local-test";
const bareUsername = "unknown-level";

interface LuaCallback {
  method: string;
  parameters: unknown;
}
function callback(packet: GamePacket): LuaCallback | null {
  if (packet.command !== COMMAND.NTF_S2C_CALL) return null;
  const fields = decodeFields(packet.payload);
  return {
    method: firstString(fields, 1),
    parameters: JSON.parse(firstString(fields, 2)) as unknown,
  };
}
function commandCallback(packet: GamePacket, command: number): boolean {
  const call = callback(packet);
  return (
    call?.method === "LuaCall" &&
    typeof call.parameters === "object" &&
    call.parameters !== null &&
    (call.parameters as { sCmd?: number }).sCmd === command
  );
}

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
    const timeout = setTimeout(
      () => finish(new Error(`Timed out waiting for request ${command}/${serial}`)),
      5_000,
    );
    function finish(error?: Error): void {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      if (error) reject(error);
      else resolve(packets);
    }
    function onError(error: Error): void {
      finish(error);
    }
    function onClose(): void {
      finish(new Error("Gateway closed before responding"));
    }
    function onData(chunk: Buffer): void {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= HEADER_SIZE) {
        const size = pending.readUInt32LE(4);
        if (size < HEADER_SIZE) {
          finish(new Error(`Invalid gateway packet size ${size}`));
          return;
        }
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
    socket.once("error", onError);
    socket.once("close", onClose);
    socket.write(makePacket(command, serial, payload));
  });
}

interface Fixture {
  socket: Socket;
  nextSerial(): number;
  cleanup(): Promise<void>;
}

async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-chapter-unknown-"));
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    async close() {},
  };
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
  const server = createGatewayServer({ config, logger, players });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing gateway TCP address");
  const socket = createConnection({ host: "127.0.0.1", port: address.port });
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
    fieldBytes(1, bareUsername),
    (packet) => packet.command === COMMAND.LOGIN_RSP,
  );
  async function cleanup(): Promise<void> {
    const closed = once(socket, "close");
    socket.destroy();
    await closed;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { force: true, recursive: true });
  }
  return {
    socket,
    nextSerial() {
      return ++serial;
    },
    cleanup,
  };
}

describe("chapter calls for levels missing from the catalog", () => {
  it("answers a 540 story call and a settlement with exactly one error reply", async () => {
    const f = await fixture();
    try {
      const story = await request(
        f.socket,
        COMMAND.C2S_CALL_REQ,
        f.nextSerial(),
        makeServerLuaCall("LuaCall", {
          sCmd: 540,
          tbParam: { Chapter: 999, Index: 1, Difficult: 1, nFormationId: 1 },
        }),
        (packet) => commandCallback(packet, 540),
      );
      const storyReplies = story.filter((packet) => commandCallback(packet, 540));
      expect(storyReplies).toHaveLength(1);
      expect(callback(storyReplies.at(-1)!)!.parameters).toEqual({
        sCmd: 540,
        tbParam: { tbNew: [] },
      });

      const settlement = await request(
        f.socket,
        COMMAND.C2S_CALL_REQ,
        f.nextSerial(),
        makeServerLuaCall("LuaCall", {
          sCmd: 252,
          tbParam: {
            sCmd: "ChapterMsg",
            tbParam: {
              nState: 1,
              Chapter: 999,
              Index: 1,
              Difficult: 1,
              nStar: 3,
              nFormationId: 1,
            },
          },
        }),
        (packet) => callback(packet)?.method === "ChapterMsg",
      );
      const settlementReplies = settlement.filter(
        (packet) => callback(packet)?.method === "ChapterMsg",
      );
      expect(settlementReplies).toHaveLength(1);
      expect(callback(settlementReplies.at(-1)!)!.parameters).toEqual({
        nError: 1,
        nState: 1,
      });
    } finally {
      await f.cleanup();
    }
  }, 20_000);
});
