import { once } from "node:events";
import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { makeBountyPassTaskId } from "../src/game-data/bounty-data.js";
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

const account = "bounty-gate";
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

function clientCall(packet: GamePacket): {
  method: string;
  parameters: Record<string, unknown>;
} | null {
  if (packet.command !== COMMAND.NTF_S2C_CALL) return null;
  const fields = decodeFields(packet.payload);
  const method = firstString(fields, 1);
  const json = firstString(fields, 2);
  if (method === undefined || json === undefined) return null;
  return { method, parameters: JSON.parse(json) as Record<string, unknown> };
}

function request(
  socket: Socket,
  command: number,
  serial: number,
  payload: Buffer,
  completed: (packet: GamePacket) => boolean,
): Promise<GamePacket[]> {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    const packets: GamePacket[] = [];
    const timeout = setTimeout(
      () => finish(new Error(`No reply for ${command}/${serial}`)),
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
      finish(new Error("Gateway closed before replying"));
    }
    function onData(chunk: Buffer): void {
      pending = Buffer.concat([pending, chunk]);
      let done = false;
      while (pending.length >= HEADER_SIZE) {
        const size = pending.readUInt32LE(4);
        if (size < HEADER_SIZE) {
          finish(new Error("Invalid packet size"));
          return;
        }
        if (pending.length < size) break;
        const packet = readPacket(pending.subarray(0, size));
        pending = pending.subarray(size);
        packets.push(packet);
        done ||= completed(packet);
      }
      if (done) finish();
    }
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    socket.write(makePacket(command, serial, payload));
  });
}

it("rejects a recovered bounty pass for a locked difficulty without granting awards", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-bounty-gateway-"));
  const filePath = path.join(directory, "state.json");
  let server: Server | undefined;
  let socket: Socket | undefined;
  try {
    const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
    const identity = config.release?.singlePlayerAccount ?? account;
    const store = new JsonStore({
      filePath,
      initialState: makeInitialState(),
      logger,
    });
    await store.initialize();
    const players = new PlayerRepository({
      store,
      defaults: config.playerDefaults,
      logger,
    });

    server = createGatewayServer({ config, logger, players });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Gateway did not bind a TCP port");
    }

    socket = createConnection({ host: "127.0.0.1", port: address.port });
    await once(socket, "connect");
    await request(
      socket,
      COMMAND.VERIFY_REQ,
      1,
      Buffer.concat([fieldBytes(1, "android"), fieldBytes(2, account)]),
      (packet) => packet.command === COMMAND.VERIFY_RSP,
    );
    await request(
      socket,
      COMMAND.LOGIN_REQ,
      2,
      fieldBytes(1, account),
      (packet) => packet.command === COMMAND.LOGIN_RSP,
    );

    // A fresh connection has no joined session, so the server recovers a run
    // before settling. Difficulty 6 exceeds the unlocked range
    // min(6, 0 + 1) for a player with no recorded pass difficulty.
    const packets = await request(
      socket,
      COMMAND.C2S_CALL_REQ,
      3,
      makeServerLuaCall("LuaCall", {
        sCmd: 252,
        tbParam: {
          sCmd: 51,
          tbParam: {
            nActivityId: 1,
            nDiff: 6,
            nFormationId: 1,
            nGold: 0,
            tbThiefDeath: [],
            tbThiefDropItem: [],
          },
        },
      }),
      (packet) => {
        const call = clientCall(packet);
        return call?.method === "LuaCall" && call.parameters.sCmd === 51;
      },
    );
    const reply = packets
      .map(clientCall)
      .find((entry) => entry?.method === "LuaCall" && entry.parameters.sCmd === 51);
    expect(reply, "Missing bounty settlement callback").toBeDefined();
    expect(reply!.parameters).toEqual({ sCmd: 51, tbParam: { nError: 1 } });

    const player = players.get(identity)!;
    expect(player.bounty?.completionCounts).toEqual({});
    expect(player.taskValues[String(makeBountyPassTaskId(1))]).toBeUndefined();
  } finally {
    socket?.destroy();
    if (server?.listening) {
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await rm(directory, { recursive: true, force: true });
  }
});
