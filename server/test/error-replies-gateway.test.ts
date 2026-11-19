import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createConnection, type Server, type Socket } from "node:net";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { GachaCatalog } from "../src/game-data/gacha-data.js";
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

const account = "error-replies:local-test";
const scratchPrefix = path.resolve(
  import.meta.dirname,
  "../../release/work/error-replies-tcp-",
);
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

interface ClientCall {
  method: string;
  parameters: Record<string, unknown>;
}

function clientCall(packet: GamePacket): ClientCall | null {
  if (packet.command !== COMMAND.NTF_S2C_CALL) return null;
  const fields = decodeFields(packet.payload);
  return {
    method: firstString(fields, 1),
    parameters: JSON.parse(firstString(fields, 2)) as Record<string, unknown>,
  };
}

function calls(packets: readonly GamePacket[]): ClientCall[] {
  return packets.map(clientCall).filter((call): call is ClientCall => call !== null);
}

function isCall(method: string, match: Record<string, unknown> = {}) {
  return (packet: GamePacket): boolean => {
    const call = clientCall(packet);
    return (
      call?.method === method &&
      Object.entries(match).every(([key, value]) => call.parameters[key] === value)
    );
  };
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
      () => finish(new Error(`Timed out waiting for a reply to ${command}/${serial}`)),
      3_000,
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
          finish(new Error("Invalid packet size"));
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

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups = [];
});

async function fixture({ verify = true } = {}) {
  const directory = await mkdtemp(scratchPrefix);
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
  const server = createGatewayServer({ config, logger, players });
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
      (server as Server).close((error) => (error ? reject(error) : resolve())),
    );
    await store.flush();
    await rm(directory, { recursive: true, force: true });
  });

  let serial = 0;
  const send = (
    command: number,
    payload: Buffer,
    finished: (packet: GamePacket) => boolean,
  ) => request(socket, command, ++serial, payload, finished);
  const call = (
    method: string,
    parameters: Record<string, unknown>,
    finished: (packet: GamePacket) => boolean,
  ) => send(COMMAND.C2S_CALL_REQ, makeServerLuaCall(method, parameters), finished);
  // The gateway answers in order, so anything a handler sent after its
  // error reply arrives before this probe's response.
  const probe = () => {
    const probeSerial = serial + 1;
    return send(
      COMMAND.TASK_VALUE_REQ,
      Buffer.alloc(0),
      (packet) =>
        packet.command === COMMAND.TASK_VALUE_RSP && packet.serial === probeSerial,
    );
  };

  if (verify) {
    await send(
      COMMAND.VERIFY_REQ,
      Buffer.concat([fieldBytes(1, "android"), fieldBytes(2, account)]),
      (packet) => packet.command === COMMAND.VERIFY_RSP,
    );
    await send(
      COMMAND.LOGIN_REQ,
      fieldBytes(1, "error-replies"),
      (packet) => packet.command === COMMAND.LOGIN_RSP,
    );
  }
  return {
    players,
    send,
    call,
    probe,
    nextSerial: () => serial + 1,
  };
}

function formationInfo(player: ReturnType<PlayerRepository["get"]>, id: number) {
  const formation = player!.formations.find((entry) => entry.id === id)!;
  return formation.fightCards.map((card) => ({
    MainCard: card.mainCardGuid,
    Secondarycard: card.secondaryCardGuids,
    UsedCard: card.usedCardGuid,
    WeaponId: card.weaponGuid,
    Rune: card.runeItemGuids,
  }));
}

describe("gateway error replies", () => {
  it("answers a failed RENAME_REQ with return code 11015 and keeps the old name", async () => {
    const f = await fixture();
    const before = f.players.get(account)!.name;
    const serial = f.nextSerial();
    const packets = await f.send(
      COMMAND.RENAME_REQ,
      fieldBytes(3, ""),
      (packet) => packet.command === COMMAND.RENAME_RSP,
    );
    const reply = packets.find((packet) => packet.command === COMMAND.RENAME_RSP)!;
    expect(reply.serial).toBe(serial);
    expect(reply.returnCode).toBe(11015);
    expect(f.players.get(account)!.name).toBe(before);

    const okSerial = f.nextSerial();
    const ok = await f.send(
      COMMAND.RENAME_REQ,
      fieldBytes(3, "Manager"),
      (packet) => packet.command === COMMAND.RENAME_RSP,
    );
    expect(ok.at(-1)).toMatchObject({ serial: okSerial, returnCode: 0 });
    expect(f.players.get(account)!.name).toBe("Manager");
  });

  it.each([21, 22, 23])(
    "answers a rejected formation update %i with CallClientError 20072 and no LuaCall success",
    async (sCmd) => {
      const f = await fixture();
      const id = f.players.get(account)!.formations[0]!.id;
      const before = structuredClone(f.players.get(account)!.formations);

      // A weapon that is no longer owned (for example consumed as enhance
      // material while the formation screen was open).
      const stale = await f.call(
        "LuaCall",
        { sCmd, tbParam: { Id: id, Info: [{ MainCard: 0, WeaponId: 987_654_321 }] } },
        isCall("CallClientError"),
      );
      expect(calls(stale).at(-1)).toEqual({
        method: "CallClientError",
        parameters: { err: 20072 },
      });
      // Card data the parser cannot read.
      const malformed = await f.call(
        "LuaCall",
        { sCmd, tbParam: { Id: id, Info: [5] } },
        isCall("CallClientError"),
      );
      expect(calls(malformed).at(-1)?.parameters).toEqual({ err: 20072 });
      const after = await f.probe();
      expect(
        [...stale, ...malformed, ...after].some(
          (packet) =>
            isCall("LuaCall", { sCmd })(packet) ||
            packet.command === COMMAND.FORMATION_UPDATE_NTF,
        ),
      ).toBe(false);
      expect(f.players.get(account)!.formations).toEqual(before);

      const saved = await f.call(
        "LuaCall",
        { sCmd, tbParam: { Id: id, Info: formationInfo(f.players.get(account), id) } },
        isCall("LuaCall", { sCmd }),
      );
      expect(calls(saved).at(-1)?.parameters).toEqual({ sCmd, tbParam: { ret: 0 } });
    },
  );

  it("answers a failed SetMainGirl with GirlLogic nError and keeps the main girl", async () => {
    const f = await fixture();
    const owned = f.players.get(account)!.girls[0]!.girlId;
    const taskValues = structuredClone(f.players.get(account)!.taskValues);
    const packets = await f.call(
      "GirlLogic",
      { sCmd: "SetMainGirl", nId: 999_999 },
      isCall("GirlLogic", { sCmd: "SetMainGirl" }),
    );
    expect(calls(packets).at(-1)?.parameters).toEqual({
      sCmd: "SetMainGirl",
      nId: 999_999,
      nError: 1,
    });
    expect(f.players.get(account)!.taskValues).toEqual(taskValues);

    const ok = await f.call(
      "GirlLogic",
      { sCmd: "SetMainGirl", nId: owned },
      isCall("GirlLogic", { sCmd: "SetMainGirl" }),
    );
    expect(calls(ok).at(-1)?.parameters).toEqual({ sCmd: "SetMainGirl", nId: owned });
  });

  it("answers a failed SetModelInFight with GirlLogic nError and no success flag", async () => {
    const f = await fixture();
    const owned = f.players.get(account)!.girls[0]!.girlId;
    const taskValues = structuredClone(f.players.get(account)!.taskValues);
    const packets = await f.call(
      "GirlLogic",
      { sCmd: "SetModelInFight", nId: 999_999, nUse: 1 },
      isCall("GirlLogic", { sCmd: "SetModelInFight" }),
    );
    const reply = calls(packets).at(-1)!.parameters;
    expect(reply).toEqual({ sCmd: "SetModelInFight", nId: 999_999, nError: 1 });
    expect(reply.bSuccess).toBeUndefined();
    expect(f.players.get(account)!.taskValues).toEqual(taskValues);

    const ok = await f.call(
      "GirlLogic",
      { sCmd: "SetModelInFight", nId: owned, nUse: 0 },
      isCall("GirlLogic", { sCmd: "SetModelInFight" }),
    );
    expect(calls(ok).at(-1)?.parameters).toMatchObject({ nId: owned, bSuccess: true });
  });

  it("rejects SetCardCustomUp for an unknown pool or a failed save with CallClientError 29999", async () => {
    const f = await fixture();
    const taskValues = structuredClone(f.players.get(account)!.taskValues);
    for (const nId of ["not-a-pool", 987_654]) {
      const packets = await f.call(
        "SetCardCustomUp",
        { nId, tbItems: [101, 102] },
        isCall("CallClientError"),
      );
      expect(calls(packets).at(-1)?.parameters).toEqual({ err: 29999 });
    }
    // A valid pool whose save fails also gets an answer.
    const pool = GachaCatalog.loadDefault().get(GachaCatalog.loadDefault().ids[0]!)!;
    vi.spyOn(f.players, "setGachaCustomUp").mockRejectedValueOnce(
      new Error("store write failed"),
    );
    const failed = await f.call(
      "SetCardCustomUp",
      { nId: pool.id, tbItems: [101, 102] },
      isCall("CallClientError"),
    );
    expect(calls(failed).at(-1)?.parameters).toEqual({ err: 29999 });
    const after = await f.probe();
    expect(
      [...failed, ...after].some((packet) => isCall("SetCardCustomUp")(packet)),
    ).toBe(false);
    expect(f.players.get(account)!.taskValues).toEqual(taskValues);

    const ok = await f.call(
      "SetCardCustomUp",
      { nId: pool.id, tbItems: [101, 102] },
      isCall("SetCardCustomUp"),
    );
    expect(calls(ok).at(-1)?.parameters).toEqual({ nId: pool.id });
  });

  it.each([
    [COMMAND.PVP_APPLY_CREATE_TEAM_REQ, COMMAND.PVP_APPLY_CREATE_TEAM_RSP],
    [COMMAND.PVP_APPLY_BEGIN_MATCH_REQ, COMMAND.PVP_APPLY_BEGIN_MATCH_RSP],
    [COMMAND.PVP_APPLY_TEAM_READY_REQ, COMMAND.PVP_APPLY_TEAM_READY_RSP],
    [COMMAND.PVP_APPLY_UPDATE_PLAYERINFO_REQ, COMMAND.PVP_APPLY_UPDATE_PLAYERINFO_RSP],
  ])(
    "answers PVP request %i before VERIFY with response %i and return code 1",
    async (requestCommand, responseCommand) => {
      const f = await fixture({ verify: false });
      const serial = f.nextSerial();
      const packets = await f.send(
        requestCommand,
        Buffer.alloc(0),
        (packet) => packet.command === responseCommand,
      );
      expect(packets).toHaveLength(1);
      expect(packets[0]).toMatchObject({
        command: responseCommand,
        serial,
        returnCode: 1,
      });
      expect(packets[0]!.payload).toHaveLength(0);
      // No phantom save for the pre-verify "offline" account.
      expect(f.players.get("offline")).toBeNull();
    },
  );
});
