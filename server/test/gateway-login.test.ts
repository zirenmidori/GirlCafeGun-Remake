import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
} from "../src/persistence/player-repository.js";
import { COMMAND } from "../src/protocol/commands.js";
import { makeServerLuaCall, parseTaskChanges } from "../src/protocol/messages.js";
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
  fieldVarint,
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

it("keeps VERIFY's saved profile when LOGIN sends the bare username on fresh connections", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-gateway-login-"));
  const filePath = path.join(directory, "state.json");
  const account = "commander";
  const identity = `${account}:local-password`;
  let server: Server | undefined;
  try {
    const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
    const store = new JsonStore({
      filePath,
      initialState: makeInitialState(),
      logger,
    });
    await store.initialize();
    const players = new PlayerRepository({
      store,
      defaults: {
        ...config.playerDefaults,
        level: 1,
        exp: 0,
        firstLevelComplete: false,
      },
      logger,
    });
    const savedPlayer = await players.getOrCreate(identity);
    expect(savedPlayer.roleId).toBe(1);
    await store.update((state) => {
      const player = state.players[identity]!;
      player.level = 2;
      player.exp = 8;
      player.taskValues[65551] = 6;
      player.lastLoginAt = "2026-11-04T00:00:00.000Z";
      player.cafe.furniture = [101, 102].map((templateId, index) => ({
        templateId,
        objId: 10000 + index,
        parentId: 0,
        roomId: 0,
        pose: {
          templateId,
          parentTemplateId: 0,
          place: 0,
          posX: 0,
          posY: 0,
          rotate: 0,
        },
        status: 0,
        isNew: false,
        bizcount: 0,
      }));
    });

    server = createGatewayServer({ config, logger, players });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Gateway did not bind a TCP port");
    }

    for (let restart = 0; restart < 2; restart++) {
      const socket = createConnection({ host: "127.0.0.1", port: address.port });
      try {
        await once(socket, "connect");
        const verified = await request(
          socket,
          COMMAND.VERIFY_REQ,
          1,
          Buffer.concat([fieldBytes(1, "android"), fieldBytes(2, identity)]),
          COMMAND.VERIFY_RSP,
        );
        const verifyFields = decodeFields(verified.at(-1)!.payload);
        expect(firstNumber(verifyFields, 1)).toBe(1);
        expect(firstNumber(verifyFields, 9)).toBe(0);
        expect(firstString(verifyFields, 10)).toBe("");

        // The client sends its saved username here, rather than VERIFY's token.
        const login = await request(
          socket,
          COMMAND.LOGIN_REQ,
          2,
          fieldBytes(1, account),
          COMMAND.LOGIN_RSP,
        );
        const playerPacket = login.find(
          ({ command }) => command === COMMAND.PLAYER_NTF,
        );
        const taskPacket = login.find(
          ({ command }) => command === COMMAND.TASK_VALUE_RSP,
        );
        expect(playerPacket).toBeDefined();
        expect(taskPacket).toBeDefined();
        const playerFields = decodeFields(playerPacket!.payload);
        expect(firstNumber(playerFields, 20)).toBe(1);
        expect(firstNumber(playerFields, 2)).toBe(2);
        expect(firstNumber(playerFields, 3)).toBe(8);
        expect(parseTaskChanges(taskPacket!.payload)).toContainEqual({
          id: 65551,
          value: 6,
        });
        const phone = await request(
          socket,
          COMMAND.C2S_CALL_REQ,
          3,
          makeServerLuaCall("PhoneMsg", { nCmd: 8 }),
          COMMAND.NTF_S2C_CALL,
          0,
        );
        const phoneFields = decodeFields(phone.at(-1)!.payload);
        expect(firstString(phoneFields, 1)).toBe("ServerPhoneMsg");
        expect(JSON.parse(firstString(phoneFields, 2))).toEqual({
          nError: 0,
          nCmd: 8,
          tbList: [],
        });
        // Native house requests may omit roleid or supply it explicitly. Both
        // must use VERIFY's persisted profile and preserve safe instance IDs.
        for (const [index, payload] of [
          Buffer.alloc(0),
          fieldVarint(1, savedPlayer.roleId),
        ].entries()) {
          const packets = await request(
            socket,
            COMMAND.GET_HOUSEINFO_REQ,
            4 + index,
            payload,
            COMMAND.GET_HOUSEINFO_RSP,
          );
          const fields = decodeFields(packets.at(-1)!.payload);
          expect(firstNumber(fields, 1)).toBe(savedPlayer.roleId);
          const house = decodeFields(firstBytes(fields, 2)!);
          expect(firstNumber(house, 1)).toBe(savedPlayer.roleId);
          const furniture = house
            .filter(({ fieldNumber }) => fieldNumber === 2)
            .map(({ value }) => decodeFields(value as Buffer));
          expect(furniture).toHaveLength(2);
          expect(furniture.map((entry) => firstNumber(entry, 2))).toEqual([
            10000, 10001,
          ]);
          expect(furniture.map((entry) => firstNumber(entry, 1))).toEqual([101, 102]);
          for (const entry of furniture) {
            expect(firstNumber(entry, 3)).toBe(0);
            expect(firstNumber(entry, 4)).toBe(0);
            expect(firstNumber(decodeFields(firstBytes(entry, 5)!), 1)).toBe(
              firstNumber(entry, 1),
            );
          }
        }
        const count = await request(
          socket,
          COMMAND.C2S_CALL_REQ,
          6,
          makeServerLuaCall("LuaCall", { sCmd: 241 }),
          COMMAND.NTF_S2C_CALL,
          0,
        );
        const countFields = decodeFields(count.at(-1)!.payload);
        expect(firstString(countFields, 1)).toBe("LuaCall");
        expect(JSON.parse(firstString(countFields, 2))).toEqual({
          sCmd: 241,
          tbParam: { nRet: 0, nNum: 2 },
        });
        expect(
          players.get(identity)?.cafe.furniture?.map(({ objId }) => objId),
        ).toEqual([10000, 10001]);
        expect(players.get(account)).toBeNull();
        expect(Object.keys(store.snapshot().players)).toEqual([identity]);
      } finally {
        const closed = once(socket, "close");
        socket.destroy();
        await closed;
      }
    }

    await store.flush();
    const persisted: unknown = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted).toMatchObject({
      nextRoleId: 2,
      players: {
        [identity]: { roleId: 1, level: 2, exp: 8, taskValues: { 65551: 6 } },
      },
    });
  } finally {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await rm(directory, { recursive: true, force: true });
  }
});
