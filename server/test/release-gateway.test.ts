import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
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
  decodeFields,
  fieldBytes,
  fieldVarint,
  firstBytes,
  firstNumber,
  firstString,
} from "../src/protocol/protobuf.js";
import {
  HEADER_SIZE,
  makePacket,
  readPacket,
  type GamePacket,
} from "../src/protocol/packet.js";
import { createGatewayServer } from "../src/servers/gateway-server.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};
function exchange(
  socket: Socket,
  command: number,
  serial: number,
  payload: Buffer,
  done: (packet: GamePacket) => boolean,
) {
  return new Promise<GamePacket[]>((resolve, reject) => {
    let pending = Buffer.alloc(0);
    const packets: GamePacket[] = [];
    const timeout = setTimeout(() => finish(new Error("Gateway timed out")), 4000);
    function finish(error?: Error) {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", finish);
      if (error) reject(error);
      else resolve(packets);
    }
    function onData(chunk: Buffer) {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= HEADER_SIZE) {
        const size = pending.readUInt32LE(4);
        if (pending.length < size) return;
        const packet = readPacket(pending.subarray(0, size));
        pending = pending.subarray(size);
        packets.push(packet);
        if (done(packet)) {
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
const response = (command: number, serial: number) => (p: GamePacket) =>
  p.command === command && p.serial === serial;
function callback(command: number) {
  return (p: GamePacket) =>
    p.command === COMMAND.NTF_S2C_CALL &&
    JSON.parse(firstString(decodeFields(p.payload), 2)).sCmd === command;
}

it("release has one persistent identity, rejects GM calls, claims real roster gifts and updates MODs before callbacks", async () => {
  const dir = await mkdtemp(path.resolve("../release/work/gateway-tests-"));
  const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
  config.release = { singlePlayerAccount: "gcg-offline-player-v1", welcomeGift: true };
  const store = new JsonStore({
    filePath: path.join(dir, "state.json"),
    initialState: makeInitialState(),
    logger,
  });
  await store.initialize();
  const players = new PlayerRepository({
    store,
    defaults: config.playerDefaults,
    logger,
    welcomeGifts: true,
  });
  const server = createGatewayServer({ config, logger, players });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  let socket: Socket | undefined;
  try {
    for (const [i, claimedIdentity] of ["GM:anything", "different-user"].entries()) {
      socket = createConnection({ host: "127.0.0.1", port: address.port });
      await once(socket, "connect");
      const verify = await exchange(
        socket,
        COMMAND.VERIFY_REQ,
        1,
        fieldBytes(2, claimedIdentity),
        response(COMMAND.VERIFY_RSP, 1),
      );
      expect(firstNumber(decodeFields(verify.at(-1)!.payload), 1)).toBe(1);
      expect(firstNumber(decodeFields(verify.at(-1)!.payload), 9)).toBe(
        i === 0 ? 1 : 0,
      );
      await exchange(
        socket,
        COMMAND.LOGIN_REQ,
        2,
        fieldBytes(1, claimedIdentity),
        response(COMMAND.LOGIN_RSP, 2),
      );
      socket.destroy();
      socket = undefined;
    }
    expect(players.listLocalPlayers()).toHaveLength(1);
    const account = config.release.singlePlayerAccount;
    let p = players.get(account)!;
    expect(p.inventory.some((item) => item.detail === 27)).toBe(false);
    expect(
      p.mail!.messages.filter((m) => m.title === "Welcome to Girl Cafe Gun"),
    ).toHaveLength(1);
    socket = createConnection({ host: "127.0.0.1", port: address.port });
    await once(socket, "connect");
    await exchange(
      socket,
      COMMAND.VERIFY_REQ,
      1,
      fieldBytes(2, "another"),
      response(COMMAND.VERIFY_RSP, 1),
    );
    await exchange(
      socket,
      COMMAND.LOGIN_REQ,
      2,
      Buffer.alloc(0),
      response(COMMAND.LOGIN_RSP, 2),
    );
    for (const [serial, payload] of [
      [3, makeServerLuaCall("GMCommand", { command: "grant all" })],
      [4, makeServerLuaCall("LuaCall", { sCmd: 9999, tbParam: {} })],
      [5, makeServerLuaCall("LuaCall", { sCmd: 999999, tbParam: {} })],
    ] as const) {
      const before = store.snapshot();
      const rejected = await exchange(
        socket,
        COMMAND.C2S_CALL_REQ,
        serial,
        payload,
        response(COMMAND.C2S_CALL_RSP, serial),
      );
      expect(rejected.at(-1)!.returnCode).toBe(1);
      expect(store.snapshot()).toEqual(before);
    }
    const id = p.mail!.messages.find((m) => m.title === "Welcome to Girl Cafe Gun")!.id;
    const claim = await exchange(
      socket,
      COMMAND.GET_MAIL_ITEM_REQ,
      6,
      Buffer.concat([fieldVarint(1, id), fieldVarint(2, 1)]),
      response(COMMAND.GET_MAIL_ITEM_RSP, 6),
    );
    const commands = claim.map((packet) => packet.command);
    expect(commands).toContain(COMMAND.GIRL_UPDATE_NTF);
    expect(commands).toContain(COMMAND.TASK_VALUE_RSP);
    expect(commands.indexOf(COMMAND.ITEM_UPDATE_NTF)).toBeLessThan(commands.length - 1);
    expect(commands.indexOf(COMMAND.GIRL_UPDATE_NTF)).toBeLessThan(commands.length - 1);
    p = players.get(account)!;
    expect(p.girls.some((girl) => girl.girlId === 27)).toBe(true);
    const neptune = p.inventory.find((item) => item.genre === 1 && item.detail === 27)!;
    expect(neptune).toMatchObject({ enhanceLevel: 1, breakLevel: 0, count: 1 });
    await store.update((state) => {
      const player = state.players[account]!;
      player.inventory.push({
        guid: 999,
        genre: 3,
        detail: 1,
        particular: 4,
        templateLevel: 1,
        count: 1,
        createTime: 1,
        enhanceLevel: 4,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
      });
      player.money.push({ id: 16, count: 10 });
      player.money.find((money) => money.id === 2)!.count = 1_000_000;
    });
    const packets = await exchange(
      socket,
      COMMAND.C2S_CALL_REQ,
      7,
      makeServerLuaCall("LuaCall", { sCmd: 31, tbParam: { nGuid: 999 } }),
      callback(31),
    );
    expect(JSON.parse(firstString(decodeFields(packets.at(-1)!.payload), 2))).toEqual({
      sCmd: 31,
      tbParam: {},
    });
    expect(
      packets.findIndex((packet) => packet.command === COMMAND.ITEM_UPDATE_NTF),
    ).toBeLessThan(packets.length - 1);
    expect(
      packets.findIndex((packet) => packet.command === COMMAND.MONEY_UPDATE_NTF),
    ).toBeLessThan(packets.length - 1);
    const itemUpdate = packets.find(
      (packet) => packet.command === COMMAND.ITEM_UPDATE_NTF,
    )!;
    const item = decodeFields(firstBytes(decodeFields(itemUpdate.payload), 1)!);
    expect(firstNumber(item, 8)).toBe(5);
    const skill = decodeFields(firstBytes(item, 11)!);
    expect(firstNumber(skill, 3)).toBe(2);
    const beforeFailure = store.snapshot();
    const failure = await exchange(
      socket,
      COMMAND.C2S_CALL_REQ,
      8,
      makeServerLuaCall("LuaCall", { sCmd: 31, tbParam: { nGuid: 999 } }),
      callback(31),
    );
    expect(
      JSON.parse(firstString(decodeFields(failure.at(-1)!.payload), 2)).tbParam.nError,
    ).toBeGreaterThan(0);
    expect(store.snapshot()).toEqual(beforeFailure);
  } finally {
    socket?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
