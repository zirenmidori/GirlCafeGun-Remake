import { once } from "node:events";
import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  ItemBoxCatalog,
  parseItemBoxOpenRequest,
} from "../src/game-data/item-box-data.js";
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

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

const boxItems = [
  "STR\tSTR\tSTR\tSTR\tSTR\tSTR\tSTR",
  "Genre\tDetail\tParticular\tLevel\tAutoUse\tItem class\tExtParam1",
  "Genre\tDetail\tParticular\tLevel\tAutoUse\tClassName\tExtParam1",
  "8\t1\t1\t1\t0\tItemBoxAuto\t7",
  "8\t5\t2\t3\t0\tItemBoxAuto\t8",
].join("\n");
const boxInfo = [
  "STR\tSTR\tINT\tSTR\tINT\tSTR",
  "ExtParam1字段",
  "boxId\tGDPLN\tbroadcast\tobtainType\tWeight\t备注",
  "7\t[9-1-1-1-5]\t0\tFix\t0\t",
  "7\t[9-1-1-2-2]\t0\tRandom\t3000\t",
  "7\t[9-1-1-3-1]\t0\tRandom\t1000\t",
  "7\t[9-1-1-4-1]\t0\tProb\t5000\t",
  "8\t[2-2-5-1-1]\t0\tSelect\t0\t",
  "8\t[2-4-25-1-1]\t0\tSelect\t0\t",
].join("\n");

function callback(packet: GamePacket): { method: string; parameters: unknown } | null {
  if (packet.command !== COMMAND.NTF_S2C_CALL) return null;
  const fields = decodeFields(packet.payload);
  return {
    method: firstString(fields, 1),
    parameters: JSON.parse(firstString(fields, 2)) as unknown,
  };
}

function request(
  socket: Socket,
  command: number,
  serial: number,
  payload: Buffer,
  end: (packet: GamePacket) => boolean,
): Promise<GamePacket[]> {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    const packets: GamePacket[] = [];
    const timer = setTimeout(
      () => finish(new Error("Item box response timed out")),
      5000,
    );

    function finish(error?: Error) {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", finish);
      if (error) reject(error);
      else resolve(packets);
    }

    function onData(chunk: Buffer) {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= HEADER_SIZE) {
        const size = pending.readUInt32LE(4);
        if (size < HEADER_SIZE) {
          finish(new Error("Invalid gateway packet"));
          return;
        }
        if (pending.length < size) return;
        const packet = readPacket(pending.subarray(0, size));
        packets.push(packet);
        pending = pending.subarray(size);
        if (end(packet)) {
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

async function openGateway(
  account: string,
  boxes: readonly (readonly [number, number, number, number, number])[],
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg-item-box-"));
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
    for (const [genre, detail, particular, templateLevel, count] of boxes) {
      player.inventory.push({
        guid: player.nextItemGuid++,
        genre,
        detail,
        particular,
        templateLevel,
        count,
        enhanceLevel: 0,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
        createTime: 1,
      });
    }
  });
  const server = createGatewayServer({ config, logger, players });
  let socket: Socket | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    socket = createConnection({ host: "127.0.0.1", port: address.port });
    await once(socket, "connect");
    let serial = 1;
    await request(
      socket,
      COMMAND.LOGIN_REQ,
      serial,
      Buffer.concat([fieldBytes(1, account)]),
      (packet) => packet.command === COMMAND.LOGIN_RSP,
    );
    const call = (sCmd: number, tbParam: unknown, response = "LuaCall") =>
      request(
        socket!,
        COMMAND.C2S_CALL_REQ,
        ++serial,
        makeServerLuaCall("LuaCall", { sCmd, tbParam }),
        (packet) => callback(packet)?.method === response,
      );
    return {
      store,
      players,
      cleanup: async () => {
        socket?.destroy();
        if (server.listening)
          await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
      },
      call,
    };
  } catch (error) {
    socket?.destroy();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

it("parses manual box requests and rolls Fix, Random, Prob and Select groups", () => {
  const catalog = new ItemBoxCatalog(boxItems, boxInfo);
  expect(catalog.boxId([8, 1, 1, 1])).toBe(7);
  expect(parseItemBoxOpenRequest([8, 1, 1, 1, 2], 0)).toEqual({
    gdpl: [8, 1, 1, 1],
    times: 2,
    select: 0,
  });
  expect(parseItemBoxOpenRequest([8, 1, 1, 1, 0], undefined)).toEqual({
    gdpl: [8, 1, 1, 1],
    times: 1,
    select: 0,
  });
  expect(parseItemBoxOpenRequest([8, 1, 1, 1, 1.5], 0)).toBeNull();
  expect(catalog.roll(7, 2, 0, () => 0)).toEqual([
    [9, 1, 1, 1, 10],
    [9, 1, 1, 2, 4],
    [9, 1, 1, 4, 2],
  ]);
  expect(catalog.roll(7, 1, 0, () => 0.999)).toContainEqual([9, 1, 1, 3, 1]);
  expect(catalog.roll(8, 1, 2, () => 0.5)).toEqual([[2, 4, 25, 1, 1]]);
});

it("opens bag boxes over LuaCall 75 and 76, consumes one stack and grants stock rewards", async () => {
  const account = "item-box-gateway";
  const { call, players, store, cleanup } = await openGateway(account, [
    [8, 1, 1, 1, 3],
    [8, 5, 2, 3, 2],
  ]);
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  try {
    const opened = await call(76, { gdpln: [8, 1, 1, 1, 2], select: 0 });
    expect(opened.map(({ command }) => command)).toContain(COMMAND.ITEM_UPDATE_NTF);
    const data = callback(opened.at(-1)!)!.parameters as {
      sCmd: number;
      tbParam: unknown;
    };
    expect(data).toEqual({
      sCmd: 76,
      tbParam: [[7, 1, 1, 1, 6]],
    });
    expect(
      players
        .get(account)!
        .inventory.find(
          (item) =>
            [item.genre, item.detail, item.particular, item.templateLevel].join(":") ===
            "8:1:1:1",
        )?.count,
    ).toBe(1);

    const selected = await call(75, { gdpln: [8, 5, 2, 3, 1], select: 2 });
    expect(callback(selected.at(-1)!)!.parameters).toEqual({
      sCmd: 75,
      tbParam: [[2, 2, 5, 1, 1]],
    });

    await call(76, { gdpln: [8, 1, 1, 1, 1], select: 0 });
    const before = store.snapshot();
    const replay = await call(76, { gdpln: [8, 1, 1, 1, 1], select: 0 });
    expect(callback(replay.at(-1)!)!.parameters).toEqual({
      sCmd: 76,
      tbParam: [],
    });
    expect(store.snapshot()).toEqual(before);
  } finally {
    random.mockRestore();
    await cleanup();
  }
}, 15_000);

it("sends task values and girl updates when a box award writes them", async () => {
  const account = "item-box-sync";
  // Box 30001 (8-15-1-4) holds head frames, owned through task 11/id; box 901
  // (8-9-1-3) holds character cards. Both use the shipped tables.
  const { call, players, cleanup } = await openGateway(account, [
    [8, 15, 1, 4, 1],
    [8, 9, 1, 3, 1],
  ]);
  const headFrameTasks = () =>
    Object.keys(players.get(account)!.taskValues).filter(
      (key) => Number(key) >>> 16 === 11,
    ).length;
  try {
    const before = headFrameTasks();
    const frame = await call(75, { gdpln: [8, 15, 1, 4, 1], select: 1 });
    expect(headFrameTasks()).toBe(before + 1);
    expect(frame.map(({ command }) => command)).toContain(COMMAND.TASK_VALUE_RSP);

    const card = await call(75, { gdpln: [8, 9, 1, 3, 1], select: 4 });
    expect(callback(card.at(-1)!)!.parameters).toEqual({
      sCmd: 75,
      tbParam: [[1, 12, 4, 3, 1]],
    });
    const commands = card.map(({ command }) => command);
    expect(commands).toContain(COMMAND.GIRL_UPDATE_NTF);
    expect(commands).toContain(COMMAND.TASK_VALUE_RSP);
  } finally {
    await cleanup();
  }
}, 15_000);
