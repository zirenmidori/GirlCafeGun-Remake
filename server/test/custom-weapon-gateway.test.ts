import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createConnection, type Server, type Socket } from "node:net";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { WeaponTemplateCatalog } from "../src/game-data/weapon-skill-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  PlayerRepository,
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
  firstBytes,
  firstNumber,
  firstString,
} from "../src/protocol/protobuf.js";
import { createGatewayServer } from "../src/servers/gateway-server.js";
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
  responseCommand: number,
  responseSerial = serial,
): Promise<GamePacket[]> {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    const packets: GamePacket[] = [];
    const timeout = setTimeout(() => {
      finish(new Error(`Timed out waiting for command ${responseCommand}`));
    }, 5000);

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
        if (packet.command === responseCommand && packet.serial === responseSerial) {
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

function itemFields(payload: Buffer, guid: number) {
  return decodeFields(payload)
    .filter((field) => field.fieldNumber === 1)
    .map((field) => decodeFields(field.value as Buffer))
    .find((fields) => firstNumber(fields, 1) === guid)!;
}

function expectAstralPassive(
  fields: ReturnType<typeof decodeFields>,
  breakLevel: number,
) {
  expect(firstNumber(fields, 4)).toBe(28);
  expect(firstNumber(fields, 10)).toBe(breakLevel);
  const passive = decodeFields(firstBytes(fields, 11)!);
  expect(firstNumber(passive, 1)).toBe(40992);
  expect(firstNumber(passive, 2)).toBe(breakLevel + 1);
  expect(firstNumber(passive, 3)).toBe(2);
}

it("breaks a new non-gacha weapon over real TCP, sends authoritative item/money state before success and rejects replay atomically", async () => {
  const fixture = await readFile(
    new URL(
      "../../tools/custom-weapon/prismatic-attack/server/weapons.txt",
      import.meta.url,
    ),
    "utf8",
  );
  const directory = await mkdtemp(path.resolve("../tools/custom-weapon/tcp-test-"));
  const loadCatalog = vi
    .spyOn(WeaponTemplateCatalog, "loadDefault")
    .mockImplementationOnce(() => WeaponTemplateCatalog.load(fixture));
  const account = "astral-wire:local-only";
  let server: Server | undefined;
  let socket: Socket | undefined;
  try {
    const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
    const filePath = path.join(directory, "state.json");
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
    await players.getOrCreate(account);
    await store.update((state) => {
      const p = state.players[account]!;
      p.money = [{ id: 2, count: 100000 }];
      p.formations = [];
      p.inventory = [100, 101].map((guid) => ({
        guid,
        genre: 2,
        detail: 2,
        particular: 28,
        templateLevel: 1,
        count: 1,
        createTime: 1,
        enhanceLevel: 40,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
      }));
      p.nextItemGuid = 102;
    });
    server = createGatewayServer({ config, logger, players });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    socket = createConnection({ host: "127.0.0.1", port: address.port });
    await once(socket, "connect");
    await request(
      socket,
      COMMAND.VERIFY_REQ,
      1,
      Buffer.concat([fieldBytes(1, "android"), fieldBytes(2, account)]),
      COMMAND.VERIFY_RSP,
    );
    const login = await request(
      socket,
      COMMAND.LOGIN_REQ,
      2,
      fieldBytes(1, "astral-wire"),
      COMMAND.LOGIN_RSP,
    );
    const inventory = login.find(({ command }) => command === COMMAND.ITEM_NTF)!;
    expectAstralPassive(itemFields(inventory.payload, 100), 0);
    expect(loadCatalog).toHaveBeenCalledTimes(1);
    const parameters = { nCmd: 3, nGuid: 100, tbGuid: [[101, 1]] };
    const packets = await request(
      socket,
      COMMAND.C2S_CALL_REQ,
      3,
      makeServerLuaCall("WeaponLogicMsg", parameters),
      COMMAND.NTF_S2C_CALL,
      0,
    );
    const callback = packets.at(-1)!;
    const response = decodeFields(callback.payload);
    expect(firstString(response, 1)).toBe("WeaponLogicMsg");
    expect(JSON.parse(firstString(response, 2))).toEqual({ nError: 0, nCmd: 3 });
    const itemIndex = packets.findIndex(
      (packet) => packet.command === COMMAND.ITEM_UPDATE_NTF,
    );
    const moneyIndex = packets.findIndex(
      (packet) => packet.command === COMMAND.MONEY_UPDATE_NTF,
    );
    expect(itemIndex).toBeGreaterThanOrEqual(0);
    expect(moneyIndex).toBeGreaterThan(itemIndex);
    expect(moneyIndex).toBeLessThan(packets.length - 1);
    const update = packets[itemIndex]!.payload;
    expectAstralPassive(itemFields(update, 100), 1);
    expect(firstNumber(itemFields(update, 101), 6)).toBe(0);

    const reloaded = new JsonStore({
      filePath,
      initialState: makeInitialState(),
      logger,
    });
    await reloaded.initialize();
    const saved = reloaded.snapshot().players[account]!;
    expect(saved.inventory.find(({ guid }) => guid === 100)).toMatchObject({
      genre: 2,
      detail: 2,
      particular: 28,
      templateLevel: 1,
      breakLevel: 1,
    });
    expectAstralPassive(itemFields(makeItemNotification(saved), 100), 1);
    const money = decodeFields(
      firstBytes(decodeFields(packets[moneyIndex]!.payload), 1)!,
    );
    expect(firstNumber(money, 1)).toBe(2);
    expect(firstNumber(money, 2)).toBe(50000);
    const before = store.snapshot();
    for (const [serial, params] of [
      [4, parameters],
      [5, { nCmd: 3, nGuid: 100, tbGuid: null }],
    ] as const) {
      const denied = await request(
        socket,
        COMMAND.C2S_CALL_REQ,
        serial,
        makeServerLuaCall("WeaponLogicMsg", params),
        COMMAND.NTF_S2C_CALL,
        0,
      );
      expect(JSON.parse(firstString(decodeFields(denied.at(-1)!.payload), 2))).toEqual({
        nError: 1,
        nCmd: 3,
      });
      expect(
        denied.some(
          (packet) =>
            packet.command === COMMAND.ITEM_UPDATE_NTF ||
            packet.command === COMMAND.MONEY_UPDATE_NTF,
        ),
      ).toBe(false);
      expect(store.snapshot()).toEqual(before);
    }
  } finally {
    loadCatalog.mockRestore();
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
