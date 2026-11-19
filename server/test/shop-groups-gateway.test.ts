import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createConnection, type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { ShopCatalog } from "../src/game-data/shop-data.js";
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
import { mkdtemp } from "./helpers/temp.js";

const account = "shop-groups:local-test";
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function luaCall(packet: GamePacket): Record<string, unknown> | null {
  if (packet.command !== COMMAND.NTF_S2C_CALL) return null;
  const fields = decodeFields(packet.payload);
  if (firstString(fields, 1) !== "LuaCall") return null;
  return JSON.parse(firstString(fields, 2)) as Record<string, unknown>;
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
      () => finish(new Error(`Timed out waiting for ${command}/${serial}`)),
      5_000,
    );
    function finish(error?: Error): void {
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
        if (finished(packet)) {
          finish();
          return;
        }
      }
    }
    socket.on("data", onData);
    socket.write(makePacket(command, serial, payload));
  });
}

async function connect(): Promise<{
  goodsList: (shopId: number) => Promise<Record<string, number>[]>;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-shop-groups-"));
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
  const server: Server = createGatewayServer({ config, logger, players });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing bound port");
  const socket = createConnection({ host: "127.0.0.1", port: address.port });
  await once(socket, "connect");
  cleanups.push(async () => {
    const closed = once(socket, "close");
    socket.destroy();
    await closed;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await store.flush();
    await rm(directory, { recursive: true, force: true });
  });
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
    fieldBytes(1, "shop-groups"),
    (packet) => packet.command === COMMAND.LOGIN_RSP,
  );
  return {
    async goodsList(shopId) {
      const packets = await request(
        socket,
        COMMAND.C2S_CALL_REQ,
        ++serial,
        makeServerLuaCall("LuaCall", { sCmd: 11, tbParam: { shopid: shopId } }),
        (packet) => luaCall(packet)?.sCmd === 11,
      );
      const reply = packets.map(luaCall).find((call) => call?.sCmd === 11)!;
      const tbParam = reply.tbParam as { goodslist: Record<string, number>[] };
      return tbParam.goodslist;
    },
  };
}

it("sends one goods per group with pos = group for shop 20001 over the wire", async () => {
  const catalog = ShopCatalog.loadDefault();
  const client = await connect();
  const goodsList = await client.goodsList(20_001);
  expect(goodsList.map((entry) => entry.pos)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  for (const entry of goodsList) {
    expect(Number.parseInt(catalog.getGoods(entry.goodsid!)!.group, 10)).toBe(
      entry.pos,
    );
  }
});

it("sends pos 1..17 for the club shop 20006 so the client does not lock every column", async () => {
  const client = await connect();
  const goodsList = await client.goodsList(20_006);
  expect(goodsList.map((entry) => entry.pos)).toEqual(
    Array.from({ length: 17 }, (_, index) => index + 1),
  );
});
