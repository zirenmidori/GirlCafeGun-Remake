import { once } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import { createConnection, type Server, type Socket } from "node:net";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { CafePetCatalog } from "../src/game-data/cafe-pet-catalog.js";
import type { Logger } from "../src/logger.js";
import {
  makeInitialState,
  PlayerRepository,
  type InventoryEntryState,
} from "../src/persistence/player-repository.js";
import { JsonStore } from "../src/persistence/json-store.js";
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
} from "../src/protocol/protobuf.js";
import { createGatewayServer } from "../src/servers/gateway-server.js";

const account = "cafe-pet-wire:local-test";
const scratchRoot = path.resolve(import.meta.dirname, "../../tools/cafe-fix");
const food = [21, 1, 1, 2] as const;
const toy = [22, 1, 1, 1] as const;
const energyGift = [22, 2, 3, 1] as const;
type Values = Record<string, unknown>;

function clientCall(packet: GamePacket): { method: string; parameters: Values } | null {
  if (packet.command !== COMMAND.NTF_S2C_CALL) return null;
  const fields = decodeFields(packet.payload);
  return {
    method: firstString(fields, 1),
    parameters: JSON.parse(firstString(fields, 2)) as Values,
  };
}

function petResponse(packets: readonly GamePacket[], command: string): Values {
  const call = packets
    .map(clientCall)
    .find(
      (entry) => entry?.method === "NCafePetLogic" && entry.parameters.sCmd === command,
    );
  expect(call, `Missing NCafePetLogic/${command}`).toBeDefined();
  return call!.parameters;
}

function cafeResponse(packets: readonly GamePacket[]): Values {
  const call = packets
    .map(clientCall)
    .find((entry) => entry?.method === "LuaCall" && entry.parameters.sCmd === 112);
  expect(call, "Missing café initialization").toBeDefined();
  return call!.parameters.tbParam as Values;
}

function syncedTasks(packets: readonly GamePacket[]): Map<number, number> {
  return new Map(
    packets
      .filter((packet) => packet.command === COMMAND.TASK_VALUE_RSP)
      .flatMap((packet) => parseTaskChanges(packet.payload))
      .map(({ id, value }) => [id, value]),
  );
}

function taskId(index: number): number {
  return (49 << 16) | index;
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

async function fixture() {
  await mkdir(scratchRoot, { recursive: true });
  const directory = await mkdtemp(path.join(scratchRoot, "pet-tcp-test-"));
  const filePath = path.join(directory, "state.json");
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    async close() {},
  };
  const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
  let store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
  await store.initialize();
  let players = new PlayerRepository({
    store,
    defaults: config.playerDefaults,
    logger,
  });
  await players.getOrCreate(account);
  await store.update((state) => {
    const player = state.players[account]!;
    for (const id of [2, 3, 7]) {
      const wallet = player.money.find((entry) => entry.id === id);
      if (wallet) wallet.count = 1_000_000;
      else player.money.push({ id, count: 1_000_000 });
    }
    for (const [genre, detail, particular, templateLevel] of [food, toy, energyGift]) {
      player.inventory.push({
        guid: player.nextItemGuid++,
        genre,
        detail,
        particular,
        templateLevel,
        count: 10,
        createTime: Math.floor(Date.now() / 1_000),
        enhanceLevel: 0,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
      });
    }
  });
  let server: Server | undefined;
  let socket: Socket | undefined;
  let serial = 0;
  async function stop(): Promise<void> {
    if (socket) {
      const closed = once(socket, "close");
      socket.destroy();
      await closed;
      socket = undefined;
    }
    if (server?.listening) {
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    }
    server = undefined;
  }
  async function start(): Promise<void> {
    server = createGatewayServer({ config, logger, players });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing TCP address");
    socket = createConnection({ host: "127.0.0.1", port: address.port });
    await once(socket, "connect");
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
      fieldBytes(1, "cafe-pet-wire"),
      (packet) => packet.command === COMMAND.LOGIN_RSP,
    );
  }
  async function pet(
    command: string,
    values: Values = {},
    reply = command,
    packetSerial = ++serial,
  ) {
    return request(
      socket!,
      COMMAND.C2S_CALL_REQ,
      packetSerial,
      makeServerLuaCall("NCafePetLogic", { sCmd: command, ...values }),
      (packet) => {
        const call = clientCall(packet);
        if (reply === "CallClientTip") return call?.method === "CallClientTip";
        return call?.method === "NCafePetLogic" && call.parameters.sCmd === reply;
      },
    );
  }
  async function cafe(): Promise<GamePacket[]> {
    return request(
      socket!,
      COMMAND.C2S_CALL_REQ,
      ++serial,
      makeServerLuaCall("LuaCall", { sCmd: 112, tbParam: {} }),
      (packet) => {
        const call = clientCall(packet);
        return call?.method === "LuaCall" && call.parameters.sCmd === 112;
      },
    );
  }
  async function housePets(): Promise<Values[]> {
    const packets = await request(
      socket!,
      COMMAND.GET_HOUSEINFO_REQ,
      ++serial,
      Buffer.alloc(0),
      (packet) => packet.command === COMMAND.GET_HOUSEINFO_RSP,
    );
    const reply = packets.find(
      (packet) => packet.command === COMMAND.GET_HOUSEINFO_RSP,
    )!;
    const houseBytes = firstBytes(decodeFields(reply.payload), 2);
    expect(houseBytes, "Missing native house cache").toBeDefined();
    const house = decodeFields(houseBytes!);
    return house
      .filter((field) => field.fieldNumber === 5 && Buffer.isBuffer(field.value))
      .map((field) => {
        const pet = decodeFields(field.value as Buffer);
        return {
          uid: firstNumber(pet, 1),
          templateid: firstNumber(pet, 2),
          exp: firstNumber(pet, 3),
          hot: firstNumber(pet, 4),
          name: firstString(pet, 5),
          birthday: firstNumber(pet, 6),
          meetday: firstNumber(pet, 7),
          hobby: firstNumber(pet, 8),
          iq: firstNumber(pet, 9),
          nature: firstNumber(pet, 10),
          gender: firstNumber(pet, 11),
          lv: firstNumber(pet, 12),
          ext3: firstNumber(pet, 15),
        };
      });
  }
  async function reload(): Promise<void> {
    await stop();
    await store.flush();
    store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
    await store.initialize();
    players = new PlayerRepository({ store, defaults: config.playerDefaults, logger });
    await start();
  }
  async function cleanup(): Promise<void> {
    await stop();
    await store.flush();
    const resolved = path.resolve(directory);
    if (
      !resolved.startsWith(`${scratchRoot}${path.sep}`) ||
      !path.basename(resolved).startsWith("pet-tcp-test-")
    )
      throw new Error("Refusing cleanup outside the pet TCP fixture");
    await rm(resolved, { recursive: true, force: true });
  }
  try {
    await start();
  } catch (error) {
    await cleanup();
    throw error;
  }
  return {
    pet,
    cafe,
    housePets,
    reload,
    cleanup,
    nextSerial: () => ++serial,
    get player() {
      return players.get(account)!;
    },
    get store() {
      return store;
    },
  };
}

function itemCount(
  inventory: readonly InventoryEntryState[],
  gdpl: readonly number[],
): number {
  return inventory
    .filter((entry) =>
      [entry.genre, entry.detail, entry.particular, entry.templateLevel].every(
        (value, index) => value === gdpl[index],
      ),
    )
    .reduce((sum, entry) => sum + entry.count, 0);
}

describe("café pet actual TCP contracts", () => {
  it("persists and synchronizes the expired weekly mission before rejecting its claim", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const f = await fixture();
    try {
      await f.pet("GetCafeFoodNum");
      const currentWeek = f.player.cafe.pets!.missionWeek;
      expect(currentWeek).toBeTypeOf("number");
      const weeklyTask = (18 << 16) | 5001;
      const lifetimeTask = (18 << 16) | 5201;
      const claimedWeeklyValue = 5 * 2 + 1;
      const lifetimeValue = 10 * 2 + 1;
      await f.store.update((state) => {
        const player = state.players[account]!;
        player.cafe.pets!.missionWeek = currentWeek! - 1;
        player.taskValues[String(weeklyTask)] = claimedWeeklyValue;
        player.taskValues[String(lifetimeTask)] = lifetimeValue;
      });
      const money = structuredClone(f.player.money);
      const inventory = structuredClone(f.player.inventory);
      const packets = await f.pet("GetPetMissionAward", { nId: 5001 }, "CallClientTip");
      const tipIndex = packets.findIndex(
        (packet) => clientCall(packet)?.method === "CallClientTip",
      );
      const resetIndex = packets.findIndex(
        (packet) =>
          packet.command === COMMAND.TASK_VALUE_RSP &&
          parseTaskChanges(packet.payload).some(
            (task) => task.id === weeklyTask && task.value === 0,
          ),
      );
      expect(resetIndex).toBeGreaterThanOrEqual(0);
      expect(tipIndex).toBeGreaterThan(resetIndex);
      expect(syncedTasks(packets).get(weeklyTask)).toBe(0);
      expect(f.player.taskValues[String(weeklyTask)]).toBe(0);
      expect(f.player.taskValues[String(lifetimeTask)]).toBe(lifetimeValue);
      expect(f.player.cafe.pets!.missionWeek).toBe(currentWeek);
      expect(f.player.money).toEqual(money);
      expect(f.player.inventory).toEqual(inventory);
      await f.reload();
      expect(f.player.taskValues[String(weeklyTask)]).toBe(0);
      expect(f.player.taskValues[String(lifetimeTask)]).toBe(lifetimeValue);
    } finally {
      await f.cleanup();
      clock.mockRestore();
    }
  });

  it("adopts through a food box, synchronizes owned pet fields, and preserves lock and placement after relogin", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const f = await fixture();
    try {
      expect(cafeResponse(await f.cafe())).toMatchObject({
        boxstatelist: [],
        petstatelist: [],
        petlocklist: [],
        nextpetid: 1,
      });
      const opened = petResponse(
        await f.pet("OnFoodBoxOpen", { nBoxId: 1 }, "UpdateFoodBoxs"),
        "UpdateFoodBoxs",
      );
      expect(opened.param).toEqual([
        { uid: 1, type: 0, time: 0 },
        { uid: 2 },
        { uid: 3 },
      ]);
      const beforeRejectedFeed = structuredClone({
        pets: f.player.cafe.pets,
        inventory: f.player.inventory,
        money: f.player.money,
        tasks: f.player.taskValues,
      });
      const rejected = petResponse(
        await f.pet("SetFood", { nBoxId: 1, nId: 999_999 }),
        "SetFood",
      );
      expect(rejected).toMatchObject({ Error: 1, nError: 1 });
      expect({
        pets: f.player.cafe.pets,
        inventory: f.player.inventory,
        money: f.player.money,
        tasks: f.player.taskValues,
      }).toEqual(beforeRejectedFeed);
      const before = itemCount(f.player.inventory, food);
      const serial = f.nextSerial();
      const fed = petResponse(
        await f.pet("SetFood", { nBoxId: 1, nId: 1 }, "SetFood", serial),
        "SetFood",
      );
      expect(fed).not.toHaveProperty("Error");
      const boxes = fed.param as Values[];
      expect(boxes).toHaveLength(3);
      expect(boxes[0]).toMatchObject({ uid: 1, type: 1 });
      expect(itemCount(f.player.inventory, food)).toBe(before - 1);
      await f.pet("SetFood", { nBoxId: 1, nId: 1 }, "SetFood", serial);
      expect(itemCount(f.player.inventory, food)).toBe(before - 1);

      clock.mockReturnValue((Number(boxes[0]!.time) + 1) * 1_000);
      const ready = petResponse(await f.pet("UpdateFoodBoxs"), "UpdateFoodBoxs");
      expect((ready.param as Values[])[0]).toHaveProperty("pet");
      const adoption = petResponse(
        await f.pet("OnNewPet", { nBoxId: 1, name: "TCP pet" }, "AdoptPet"),
        "AdoptPet",
      );
      const pet = adoption.petInfo as Values;
      const uid = Number(pet.uid);
      expect(uid).toBe(1);
      expect(pet).toMatchObject({ name: "TCP pet", lv: 1, exp: 0 });
      for (const key of [
        "templateid",
        "hot",
        "birthday",
        "meetday",
        "hobby",
        "iq",
        "nature",
        "gender",
      ])
        expect(pet).toHaveProperty(key);
      const assignment = petResponse(
        await f.pet("ChangePetCafeState", { nIndex: 1, uid }),
        "ChangePetCafeState",
      );
      expect(assignment).toMatchObject({ nIndex: 1, uid });
      const gifted = await f.pet("PetGift", { uid, tbItem: [...energyGift, 1] });
      expect(petResponse(gifted, "UpdatePet").tbPetInfo).toEqual(
        expect.arrayContaining([expect.objectContaining({ uid, hot: 80 })]),
      );
      const loved = await f.pet("PetGift", { uid, tbItem: [...toy, 1] });
      expect(petResponse(loved, "UpdatePet").tbPetInfo).toEqual(
        expect.arrayContaining([expect.objectContaining({ uid, lv: 2, exp: 20 })]),
      );
      const locked = await f.pet("LockOnePet", { nIndex: uid, isLock: true });
      expect(petResponse(locked, "LockOnePet")).toMatchObject({
        nIndex: uid,
        isLock: true,
      });
      expect(petResponse(locked, "UpdatePet").tbPetInfo).toEqual(
        expect.arrayContaining([expect.objectContaining({ uid, ext3: 1 })]),
      );
      await f.pet("PetRename", { uid, name: "Durable pet" });

      await f.reload();
      const initial = cafeResponse(await f.cafe());
      expect(initial).toMatchObject({ petlocklist: [uid], nextpetid: 2 });
      const placements = initial.petstatelist as Values[];
      expect(placements[0]).toEqual({ uid });
      expect(placements.slice(1).every((entry) => entry.uid === 0)).toBe(true);
      expect(await f.housePets()).toContainEqual(
        expect.objectContaining({
          ...pet,
          uid,
          templateid: pet.templateid,
          name: "Durable pet",
          hot: 80,
          lv: 2,
          exp: 20,
          ext3: 1,
        }),
      );
    } finally {
      await f.cleanup();
      clock.mockRestore();
    }
  });

  it("starts and claims a tour using the real three-pet formation and cannot award it twice", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const f = await fixture();
    try {
      let deadline = 0;
      for (let box = 1; box <= 3; box++) {
        await f.pet("OnFoodBoxOpen", { nBoxId: box }, "UpdateFoodBoxs");
        const fed = petResponse(
          await f.pet("SetFood", { nBoxId: box, nId: 1 }),
          "SetFood",
        );
        deadline = Math.max(deadline, Number((fed.param as Values[])[box - 1]!.time));
      }
      clock.mockReturnValue((deadline + 1) * 1_000);
      await f.pet("UpdateFoodBoxs");
      const uids: number[] = [];
      for (let box = 1; box <= 3; box++) {
        const adopted = petResponse(
          await f.pet("OnNewPet", { nBoxId: box, name: `Tour pet ${box}` }, "AdoptPet"),
          "AdoptPet",
        );
        const uid = Number((adopted.petInfo as Values).uid);
        uids.push(uid);
        await f.pet("PetGift", { uid, tbItem: [...energyGift, 1] });
        await f.pet("ChangePetCafeState", { nIndex: box, uid });
      }
      expect(new Set(uids).size).toBe(3);
      const unlocked = await f.pet("UnLockTourArea", { nIndex: 1 });
      const tourTasks = syncedTasks(unlocked);
      const packedFirst = tourTasks.get(taskId(851))!;
      const packedSecond = tourTasks.get(taskId(852))!;
      // Match the shipped LoadBits(value, 1, 15) and LoadBits(value, 16, 30).
      const rewardIds = [
        (packedFirst >>> 1) & 0x7fff,
        (packedFirst >>> 16) & 0x7fff,
        (packedSecond >>> 1) & 0x7fff,
        (packedSecond >>> 16) & 0x7fff,
      ];
      const catalog = CafePetCatalog.loadDefault();
      expect(rewardIds[0]).toBeGreaterThan(0);
      expect(rewardIds[1]).toBeGreaterThan(0);
      for (let index = 0; index < rewardIds.length; index++) {
        if (rewardIds[index]) {
          expect(catalog.tourReward(rewardIds[index]!)?.AwardNormal).toBe(index + 1);
        }
      }
      const departed = await f.pet("SetTourPets", { nIndex: 1, tbPets: uids });
      expect(petResponse(departed, "SetTourPets")).toMatchObject({
        nIndex: 1,
        statelist: [1, 2, 3],
      });
      const tasks = syncedTasks(departed);
      expect(tasks.get(taskId(701))).toBe(2);
      for (let index = 0; index < 3; index++)
        expect(tasks.get(taskId(551 + index))).toBe(uids[index]);
      const began = tasks.get(taskId(751))!;
      expect(began).toBeGreaterThan(0);
      clock.mockReturnValue((began + 4 * 3600 + 1) * 1_000);
      const completed = await f.pet("CheckTourIsSuccess", { nIndex: 1 });
      expect([3, 4]).toContain(syncedTasks(completed).get(taskId(701)));
      const serial = f.nextSerial();
      const claimed = await f.pet(
        "CompleteTour",
        { nIndex: 1 },
        "CompleteTour",
        serial,
      );
      expect(petResponse(claimed, "CompleteTour")).toMatchObject({ nIndex: 1 });
      const visual = claimed
        .map(clientCall)
        .find((call) => call?.method === "LuaCall" && call.parameters.sCmd === 75);
      expect(visual, "Tour reward uses the shipped ItemBox_Open command").toBeDefined();
      const tuples = visual!.parameters.tbParam as number[][];
      expect(tuples.length).toBeGreaterThan(0);
      expect(
        tuples.every(
          (tuple) => tuple.length === 5 && tuple.every(Number.isSafeInteger),
        ),
      ).toBe(true);
      expect(
        claimed.map(clientCall).some((call) => call?.method === "ShowRewardBox"),
      ).toBe(false);
      expect(syncedTasks(claimed).get(taskId(801))).toBe(1);
      expect(f.player.taskValues[String(taskId(701))]).toBe(1);
      const inventory = structuredClone(f.player.inventory);
      const money = structuredClone(f.player.money);
      await f.pet("CompleteTour", { nIndex: 1 }, "CompleteTour", serial);
      expect(f.player.inventory).toEqual(inventory);
      expect(f.player.money).toEqual(money);
      await f.reload();
      expect(f.player.taskValues[String(taskId(801))]).toBe(1);
      expect(f.player.inventory).toEqual(inventory);
    } finally {
      await f.cleanup();
      clock.mockRestore();
    }
  });
});
