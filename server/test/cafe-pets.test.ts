import { describe, expect, it, vi } from "vitest";

import type { Player } from "../src/persistence/player-repository.js";
import type { BaseAward } from "../src/game-data/chapter-config.js";
import { CafePetCatalog } from "../src/game-data/cafe-pet-catalog.js";
import {
  CafePetOperationError,
  CafePetRuntime,
  cafePetDownload,
  cafePetList,
  cafePetRikiTaskOffset,
  makeCafePetState,
  isCafePetTaskId,
  petErrorResponse,
  type CafePet,
  type CafePetRuntimeHooks,
} from "../src/game-data/cafe-pets.js";

const NOW = Date.UTC(2026, 10, 11, 12),
  SECOND = 1_000;
const catalog = CafePetCatalog.loadDefault();
const taskKey = (offset: number) => String((49 << 16) | offset);
function pet(uid: number, templateid = 101, fields: Partial<CafePet> = {}): CafePet {
  return {
    uid,
    templateid,
    exp: 0,
    hot: 100,
    name: `pet${uid}`,
    birthday: NOW / SECOND,
    meetday: NOW / SECOND,
    hobby: 101,
    iq: 100,
    nature: 1,
    gender: 1,
    lv: 1,
    ext3: 0,
    ...fields,
  };
}
function fixture() {
  // The pure runtime only consumes these three Player fields.
  const player = {
    roleId: 42,
    cafe: { coffees: [] },
    taskValues: {},
  } as unknown as Player;
  const money = new Map<number, number>([
    [2, 1_000_000],
    [3, 100_000],
    [7, 100_000],
  ]);
  const items = new Map<string, number>();
  const grants: BaseAward[][] = [];
  const beforeBuffChange = vi.fn();
  const hooks: CafePetRuntimeHooks = {
    chargeMoney(id, count) {
      if (count <= 0) return;
      if ((money.get(id) ?? 0) < count) throw new Error("insufficient_money");
      money.set(id, money.get(id)! - count);
    },
    inventory: (gdpl) => items.get(gdpl.join("-")) ?? 0,
    consumeItem(gdpl, count) {
      const key = gdpl.join("-"),
        have = items.get(key) ?? 0;
      if (have < count) throw new Error("insufficient_items");
      items.set(key, have - count);
    },
    grant(awards) {
      grants.push(structuredClone([...awards]));
    },
    beforeBuffChange,
  };
  const runtime = (at = NOW) => new CafePetRuntime(player, catalog, at, hooks);
  const call = (sCmd: string, values: Record<string, unknown> = {}, at = NOW) =>
    runtime(at).operate({ sCmd, ...values });
  const food = catalog.petFood(1)!;
  const addFood = (count = 10) => items.set(food.GDPL.join("-"), count);
  const own = (...pets: CafePet[]) => {
    const state = (player.cafe.pets ??= makeCafePetState());
    state.pets.push(...pets);
    state.nextUid = Math.max(state.nextUid, ...pets.map((p) => p.uid + 1));
  };
  const task = (offset: number) => player.taskValues[taskKey(offset)] ?? 0;
  const setTask = (offset: number, value: number) => {
    player.taskValues[taskKey(offset)] = value;
  };
  return {
    player,
    money,
    items,
    grants,
    beforeBuffChange,
    runtime,
    call,
    addFood,
    own,
    task,
    setTask,
    food,
  };
}

describe("café pet wire and bowl lifecycle", () => {
  it("protects only actual server-owned task offsets from client writes", () => {
    for (const offset of [
      101,
      140,
      200,
      511,
      551,
      701,
      751,
      801,
      851,
      852,
      cafePetRikiTaskOffset(101),
      1404,
      1405,
      1411,
      1451,
    ])
      expect(isCafePetTaskId((49 << 16) | offset, catalog)).toBe(true);
    for (const offset of [
      0, 100, 141, 201, 501, 516, 566, 706, 756, 806, 861, 1406, 1440, 1500,
    ])
      expect(isCafePetTaskId((49 << 16) | offset, catalog)).toBe(false);
    expect(isCafePetTaskId((48 << 16) | 1451, catalog)).toBe(false);
    expect(isCafePetTaskId((18 << 16) | 5001, catalog)).toBe(true);
    expect(isCafePetTaskId((18 << 16) | 5269, catalog)).toBe(true);
    expect(isCafePetTaskId((18 << 16) | 5000, catalog)).toBe(false);
    expect(isCafePetTaskId(Number.NaN, catalog)).toBe(false);
  });
  it("projects an untouched account without creating persistent state", () => {
    const f = fixture(),
      before = structuredClone(f.player);
    expect(cafePetList(f.player)).toEqual([]);
    expect(cafePetDownload(f.player)).toEqual({
      boxstatelist: [],
      petstatelist: [],
      nextpetid: 1,
      petlocklist: [],
    });
    expect(f.player).toEqual(before);
  });
  it("opens one bowl once and returns exactly three positional entries", () => {
    const f = fixture();
    const first = f.call("OnFoodBoxOpen", { nBoxId: 2 });
    expect(first.response).toEqual({
      sCmd: "UpdateFoodBoxs",
      nError: 0,
      param: [{ uid: 1 }, { uid: 2, type: 0, time: 0 }, { uid: 3 }],
    });
    const money = new Map(f.money);
    expect(f.call("OnFoodBoxOpen", { nBoxId: 2 }).response).toEqual(first.response);
    expect(f.money).toEqual(money);
    expect(cafePetDownload(f.player).boxstatelist).toEqual([
      { uid: 2, type: 0, time: 0 },
    ]);
  });
  it("consumes a real can, resolves on demand and adopts only once", () => {
    const f = fixture();
    f.addFood();
    f.call("OnFoodBoxOpen", { nBoxId: 1 });
    const fed = f.call("SetFood", { nBoxId: 1, nId: 1 });
    expect(fed.response).toMatchObject({ sCmd: "SetFood", nError: 0 });
    expect(fed.response).not.toHaveProperty("Error");
    expect(f.items.get(f.food.GDPL.join("-"))).toBe(9);
    const deadline = f.player.cafe.pets!.boxes[0]!.time;
    f.call("UpdateFoodBoxs", {}, deadline * SECOND - 1);
    expect(f.player.cafe.pets!.boxes[0]!.pet).toBeUndefined();
    f.call("UpdateFoodBoxs", {}, deadline * SECOND);
    const pending = structuredClone(f.player.cafe.pets!.boxes[0]!.pet!);
    f.call("UpdateFoodBoxs", {}, (deadline + 1) * SECOND);
    expect(f.player.cafe.pets!.boxes[0]!.pet).toEqual(pending);
    expect(
      f.call("OnNewPet", { nBoxId: 1, name: " Test " }, (deadline + 2) * SECOND)
        .response,
    ).toMatchObject({
      sCmd: "AdoptPet",
      boxId: 1,
      petInfo: { uid: 1, name: "Test", lv: 1 },
    });
    expect(f.player.cafe.pets!.nextUid).toBe(2);
    expect(f.task(cafePetRikiTaskOffset(pending.templateid))).toBe(1 | (1 << 15));
    expect(() => f.call("OnNewPet", { nBoxId: 1 })).toThrow(CafePetOperationError);
    expect(f.player.cafe.pets!.pets).toHaveLength(1);
  });
  it("gives deterministic pending pets across preview, restart and delayed polling", () => {
    const f = fixture();
    f.addFood();
    f.call("OnFoodBoxOpen", { nBoxId: 1 });
    f.call("SetFood", { nBoxId: 1, nId: 1 });
    const saved = structuredClone(f.player),
      later = NOW + 9 * 3_600_000;
    f.call("UpdateFoodBoxs", {}, later);
    const first = f.player.cafe.pets!.boxes[0]!.pet!;
    const copy = structuredClone(saved);
    new CafePetRuntime(copy, catalog, later, f.runtime().hooks).operate({
      sCmd: "UpdateFoodBoxs",
    });
    expect(copy.cafe.pets!.boxes[0]!.pet).toEqual(first);
    // Resolve later must not reroll appearance or birthday in the same year.
    const other = structuredClone(saved);
    new CafePetRuntime(other, catalog, later + SECOND, f.runtime().hooks).operate({
      sCmd: "UpdateFoodBoxs",
    });
    expect(other.cafe.pets!.boxes[0]!.pet).toMatchObject({
      templateid: first.templateid,
      nature: first.nature,
      gender: first.gender,
      hobby: first.hobby,
      iq: first.iq,
      birthday: first.birthday,
    });
  });
  it("uses ten-minute speed prices and does not charge an already completed bowl", () => {
    const f = fixture();
    f.addFood();
    f.call("OnFoodBoxOpen", { nBoxId: 1 });
    f.call("SetFood", { nBoxId: 1, nId: 1 });
    f.player.cafe.pets!.boxes[0]!.time = NOW / SECOND + 600;
    const before = f.money.get(3)!;
    f.call("OnBoxFoodDone", { nBoxId: 1 });
    expect(f.money.get(3)).toBe(before - 2);
    f.call("OnBoxFoodDone", { nBoxId: 1 });
    expect(f.money.get(3)).toBe(before - 2);
  });
  it("releases pending pets, awards the bowl gift once, and never calls a nonexistent Rsp", () => {
    const f = fixture();
    f.call("OnFoodBoxOpen", { nBoxId: 1 });
    f.player.cafe.pets!.boxes[0]!.pet = pet(1);
    expect(f.call("OnGiveupPet", { boxId: 1 }).response).toMatchObject({
      sCmd: "GiveUpPet",
      boxId: 1,
    });
    expect(f.player.cafe.pets!.boxes[0]!.type).toBe(9999);
    expect(f.call("OnGetGiveupItem", { boxId: 1 }).response).toMatchObject({
      sCmd: "UpdateFoodBoxs",
    });
    expect(f.grants).toHaveLength(1);
    f.call("OnGetGiveupItem", { boxId: 1 });
    expect(f.grants).toHaveLength(1);
    expect(petErrorResponse({ sCmd: "SetFood" })).toEqual({
      sCmd: "SetFood",
      nError: 1,
      Error: 1,
    });
    expect(petErrorResponse({ sCmd: "UnLockTourArea" })).toBeUndefined();
    expect(() => f.call("NeverExistingCommand")).toThrow("unknown_command");
  });
});

describe("café pet care, food clock and collection history", () => {
  it("keeps the six-slot placement array positional and clears a moved pet's old slot", () => {
    const f = fixture();
    f.own(pet(1));
    f.call("ChangePetCafeState", { nIndex: 6, uid: 1 });
    expect(cafePetDownload(f.player).petstatelist).toEqual(
      [0, 0, 0, 0, 0, 1].map((uid) => ({ uid })),
    );
    expect(f.call("ChangePetCafeState", { nIndex: 2, uid: 1 }).response).toMatchObject({
      nIndex: 2,
      uid: 1,
      nCleanIndex: 6,
    });
    expect(f.player.cafe.pets!.inCafe).toEqual([0, 1, 0, 0, 0, 0]);
    expect(() => f.call("ChangePetCafeState", { nIndex: 7, uid: 1 })).toThrow(
      "invalid_cafe_slot",
    );
    expect(() => f.call("ChangePetCafeState", { nIndex: 1, uid: 999 })).toThrow(
      "pet_not_owned",
    );
  });
  it("pauses food with no assigned pets and settles elapsed time exactly once", () => {
    const f = fixture();
    f.own(pet(1));
    f.call("BuyCafeFood", { nFoodId: 1, nNum: 1 });
    const purchased = f.task(102),
      before = structuredClone(f.player);
    f.call("GetCafeFoodNum", {}, NOW + 3_600_000);
    expect(f.player).toEqual(before);
    f.call("ChangePetCafeState", { nIndex: 1, uid: 1 }, NOW + 3_600_000);
    f.call("GetCafeFoodNum", {}, NOW + 3_600_000 + 90_000);
    expect(f.task(102)).toBe(purchased - 90);
    const settled = structuredClone(f.player);
    f.call("GetCafeFoodNum", {}, NOW + 3_600_000 + 90_000);
    f.call("GetCafeFoodNum", {}, NOW + 3_600_000 - 90_000);
    expect(f.player).toEqual(settled);
    expect(f.player.cafe.pets!.pets[0]!.hot).toBe(100);
    expect(f.player.cafe.pets!.pets[0]!.exp).toBe(0);
  });
  it("does not charge for overflow, and spends rarer food first without ticks", () => {
    const f = fixture();
    f.own(pet(1));
    f.call("ChangePetCafeState", { nIndex: 1, uid: 1 });
    f.call("BuyCafeFood", { nFoodId: 1, nNum: 1 });
    f.call("BuyCafeFood", { nFoodId: 4, nNum: 1 });
    const money = new Map(f.money),
      low = f.task(102),
      high = f.task(108);
    expect(() => f.call("BuyCafeFood", { nFoodId: 4, nNum: 4 })).toThrow(
      "food_capacity",
    );
    expect(f.money).toEqual(money);
    f.call("GetCafeFoodNum", {}, NOW + 90_000);
    expect(f.task(102)).toBe(low);
    expect(f.task(108)).toBe(high - 90);
  });
  it("uses exact gift metadata, tracks highest level, locks and persists names", () => {
    const f = fixture();
    f.own(pet(1, 101, { hot: 0 }));
    f.items.set("22-1-1-1", 100);
    f.items.set("22-2-1-1", 2);
    f.call("PetGift", { uid: 1, tbItem: [22, 2, 1, 1, 2] });
    expect(f.player.cafe.pets!.pets[0]!.hot).toBe(40);
    const gifted = f.call("PetGift", { uid: 1, tbItem: [22, 1, 1, 1, 1] });
    expect(f.player.cafe.pets!.pets[0]).toMatchObject({ lv: 2, exp: 20 });
    expect(gifted.notifications[0]).toMatchObject({
      method: "NCafePetLogic",
      parameters: { sCmd: "UpdatePet" },
    });
    expect((f.task(cafePetRikiTaskOffset(101)) >>> 15) & 0x7fff).toBe(2);
    expect(() => f.call("PetGift", { uid: 1, tbItem: [22, 3, 1, 1, 1] })).toThrow(
      "invalid_gift",
    );
    f.call("PetRename", { uid: 1, name: "  Nova  " });
    f.call("LockOnePet", { nIndex: 1, isLock: true });
    expect(cafePetDownload(f.player).petlocklist).toEqual([1]);
    expect(() => f.call("DelPet", { uid: 1 })).toThrow("pet_locked_or_busy");
    expect(cafePetList(structuredClone(f.player))[0]).toMatchObject({
      name: "Nova",
      ext3: 1,
      hot: 40,
    });
    f.call("LockOnePet", { nIndex: 1, isLock: false });
    f.call("DelPet", { uid: 1 });
    expect(f.player.cafe.pets!.pets).toEqual([]);
    expect((f.task(cafePetRikiTaskOffset(101)) >>> 15) & 0x7fff).toBe(2);
  });
  it("claims collection buffs from historical distinct discoveries exactly once", () => {
    const f = fixture();
    f.runtime();
    for (const id of [101, 102]) f.setTask(cafePetRikiTaskOffset(id), 1 | (1 << 15));
    // Paw3+5 reaches first milestone even after those pets have been released.
    expect(f.call("GetPawAward", { Id: 1 }).response).toEqual({
      sCmd: "OnRikiTaskChanged",
      nError: 0,
      Id: 1,
    });
    expect(f.task(1451)).toBe(1);
    expect(f.task(1411)).toBe(1);
    expect(f.beforeBuffChange).toHaveBeenCalledTimes(1);
    expect(() => f.call("GetPawAward", { Id: 1 })).toThrow("collection_award_claimed");
    expect(f.beforeBuffChange).toHaveBeenCalledTimes(1);
  });
  it("applies the highest earned attraction buff per type", () => {
    const f = fixture();
    f.addFood();
    f.call("OnFoodBoxOpen", { nBoxId: 1 });
    for (const buff of catalog.petBuffs().filter((b) => [5, 6, 7].includes(b.Type)))
      f.setTask(1410 + buff.Id, 1);
    f.call("SetFood", { nBoxId: 1, nId: 1 });
    const highest = new Map<
      number,
      typeof catalog.petBuffs extends () => readonly (infer T)[] ? T : never
    >();
    for (const buff of catalog.petBuffs().filter((b) => [5, 6, 7].includes(b.Type))) {
      if ((highest.get(buff.Type)?.Weight ?? -1) < buff.Weight)
        highest.set(buff.Type, buff);
    }
    expect(f.player.cafe.pets!.boxes[0]!.time - NOW / SECOND).toBe(
      8 * 3_600 - [...highest.values()].reduce((sum, row) => sum + row.Param1 * 60, 0),
    );
  });
});

describe("final-CN pet tours", () => {
  it("accepts exact departure energy and uses lifetime adoptions for area unlocks", () => {
    const f = fixture();
    f.own(pet(1, 101, { hot: 20 }), pet(2, 201, { hot: 20 }), pet(3, 301, { hot: 20 }));
    f.call("UnLockTourArea", { nIndex: 1 });
    f.call("SetTourPets", { nIndex: 1, tbPets: [1, 2, 3] });
    expect(f.player.cafe.pets!.pets.map((p) => p.hot)).toEqual([0, 0, 0]);
    f.player.cafe.pets!.nextUid = 11;
    f.setTask(801, 2);
    const gold = f.money.get(2)!;
    f.call("UnLockTourArea", { nIndex: 3 });
    expect(f.task(703)).toBe(1);
    expect(f.money.get(2)).toBe(gold - 20_000);
    f.call("UnLockTourArea", { nIndex: 3 });
    expect(f.money.get(2)).toBe(gold - 20_000);
  });
  it("rolls current MissionIDs, spends each pet's energy once and cannot claim early or twice", () => {
    const f = fixture();
    f.own(pet(1), pet(2, 201), pet(3, 301));
    f.call("UnLockTourArea", { nIndex: 1 });
    expect(catalog.tourMission(f.task(511))).toMatchObject({ MissionID: 1, Rare: 1 });
    // Lib.lua LoadBits is zero-based; tour slices start at1 and16, while
    // collection slices start at0 and15. Verify against the client decoder.
    const clientBits = (value: number, begin: number, end: number) =>
      Math.floor((value % 2 ** (end + 1)) / 2 ** begin);
    for (const [offset, kind] of [
      [851, 1],
      [852, 3],
    ] as const) {
      expect(f.task(offset) & 1).toBe(0);
      const low = clientBits(f.task(offset), 1, 15),
        high = clientBits(f.task(offset), 16, 30);
      if (catalog.tourRewardsFor(1, kind).length)
        expect(catalog.tourReward(low)!.AwardNormal).toBe(kind);
      else expect(low).toBe(0);
      if (catalog.tourRewardsFor(1, kind + 1).length)
        expect(catalog.tourReward(high)!.AwardNormal).toBe(kind + 1);
      else expect(high).toBe(0);
    }
    f.call("SetTourPets", { nIndex: 1, tbPets: [1, 2, 3] });
    expect(f.player.cafe.pets!.pets.map((p) => p.hot)).toEqual([80, 80, 80]);
    expect(() => f.call("SetTourPets", { nIndex: 1, tbPets: [1, 2, 3] })).toThrow(
      "invalid_tour_party",
    );
    expect(
      f.call("CheckTourIsSuccess", { nIndex: 1 }, NOW + 3_600_000).response,
    ).toBeUndefined();
    expect(() => f.call("CompleteTour", { nIndex: 1 })).toThrow("tour_not_complete");
    const at = NOW + catalog.tourArea(1)!.Hour * 3_600_000;
    f.call("CheckTourIsSuccess", { nIndex: 1 }, at);
    expect(f.task(701)).toBe(3);
    expect(() => f.call("DelPet", { uid: 1 }, at)).toThrow("pet_locked_or_busy");
    f.call("CompleteTour", { nIndex: 1 }, at);
    expect(f.task(801)).toBe(1);
    expect(f.task(701)).toBe(1);
    expect(f.task(751)).toBe(0);
    expect([f.task(551), f.task(552), f.task(553)]).toEqual([0, 0, 0]);
    expect(f.grants).toHaveLength(1);
    expect(() => f.call("CompleteTour", { nIndex: 1 }, at)).toThrow(
      "tour_not_complete",
    );
    expect(f.grants).toHaveLength(1);
  });
  it("checks party ownership, duplicates, energy and concurrent tour use", () => {
    const f = fixture();
    f.own(pet(1), pet(2), pet(3), pet(4, 101, { hot: 19 }));
    f.call("UnLockTourArea", { nIndex: 1 });
    f.call("UnLockTourArea", { nIndex: 2 });
    expect(() => f.call("SetTourPets", { nIndex: 1, tbPets: [1, 1, 3] })).toThrow(
      "invalid_tour_party",
    );
    expect(() => f.call("SetTourPets", { nIndex: 1, tbPets: [1, 2, 999] })).toThrow(
      "pet_not_owned",
    );
    expect(() => f.call("SetTourPets", { nIndex: 1, tbPets: [1, 2, 4] })).toThrow(
      "tour_pet_unavailable",
    );
    f.call("SetTourPets", { nIndex: 1, tbPets: [1, 2, 3] });
    expect(() => f.call("SetTourPets", { nIndex: 2, tbPets: [1, 2, 3] })).toThrow(
      "tour_pet_unavailable",
    );
    expect(() => f.call("ChangePetCafeState", { nIndex: 1, uid: 1 })).toThrow(
      "pet_on_tour",
    );
  });
  it("treats species/nature conditions as bonus rewards, not departure gates", () => {
    const f = fixture();
    f.own(pet(1), pet(2, 201), pet(3, 301));
    f.runtime();
    f.setTask(703, 1);
    f.setTask(513, 2); // rare2 mission asks for3 dogs; mixed party is allowed.
    f.call("SetTourPets", { nIndex: 3, tbPets: [1, 2, 3] });
    expect(f.task(703)).toBe(2);
  });
  it("scales index loot and awards OR/AND condition bonuses exactly like the CN UI", () => {
    const f = fixture();
    f.own(
      pet(1, 101, { lv: 10 }),
      pet(2, 102, { lv: 10 }),
      pet(3, 201, { lv: 10, nature: 2 }),
    );
    f.runtime();
    f.setTask(705, 3);
    f.setTask(515, 9); // two dogs AND two nature1: both true.
    [1, 2, 3].forEach((uid, i) => f.setTask(563 + i, uid));
    const ids = [1, 2, 3, 4].map((kind) => catalog.tourRewardsFor(3, kind)[0]!.AwardID);
    f.setTask(859, (ids[0]! << 1) | (ids[1]! << 16));
    f.setTask(860, (ids[2]! << 1) | (ids[3]! << 16));
    const ex = Math.ceil(
      f.player.cafe.pets!.pets.reduce(
        (sum, p) =>
          sum +
          catalog.petLoveEx(p.lv) * (catalog.petTemplate(p.templateid)!.TourNumEx || 1),
        0,
      ),
    );
    f.call("CompleteTour", { nIndex: 5 });
    const expected = ids.map((id, i) => {
      const row = [...catalog.tourReward(id)!.Award] as BaseAward;
      if (i === 1)
        row[4] = Math.ceil(row[4] * Math.min(1, ex / catalog.tourArea(5)!.ExNum));
      return row;
    });
    expect(f.grants[0]).toEqual(expected);
    expect(f.grants[0]).toHaveLength(4); // No obsolete TourInfo main reward.
  });
});

describe("pet missions use the current75 achievement rows", () => {
  const progress = (player: Player, id: number) =>
    (player.taskValues[String((18 << 16) | id)] ?? 0) >>> 1;
  it("initializes safe lifetime snapshots once without inventing weekly activity or old gifts", () => {
    const f = fixture();
    f.own(pet(1, 101, { lv: 10 }), pet(2, 201, { lv: 20 }));
    f.player.cafe.pets!.nextUid = 4; // One previously released pet.
    f.call("GetCafeFoodNum");
    expect(progress(f.player, 5201)).toBe(3);
    expect(progress(f.player, 5232)).toBe(28);
    expect(progress(f.player, 5001)).toBe(0);
    expect(progress(f.player, 5002)).toBe(0);
    expect(progress(f.player, 5003)).toBe(0);
    expect(progress(f.player, 5004)).toBe(0);
    expect(f.task(cafePetRikiTaskOffset(101))).toBe(1 | (10 << 15));
    const initialized = structuredClone(f.player);
    f.call("GetCafeFoodNum");
    expect(f.player).toEqual(initialized);
  });
  it("unlocks a language-only collection reward without opening a nonexistent buff modal", () => {
    const f = fixture();
    f.runtime();
    for (const id of [101, 102]) f.setTask(cafePetRikiTaskOffset(id), 1 | (1 << 15));
    const original = catalog.petRikiAward(1)!;
    const override = vi
      .spyOn(catalog, "petRikiAward")
      .mockReturnValue({ ...original, BuffAward: [], TransAward: 2 });
    try {
      expect(f.call("GetPawAward", { Id: 1 }).response).toEqual({
        sCmd: "OnRikiTaskChanged",
        nError: 0,
      });
      expect(f.task(1404)).toBe(2);
      expect(f.task(1451)).toBe(1);
    } finally {
      override.mockRestore();
    }
  });
  it("records real care actions and claims exact rewards only once", () => {
    const f = fixture();
    f.own(pet(1, 101, { hot: 0 }));
    f.items.set("22-1-1-1", 2);
    f.items.set("22-2-1-1", 2);
    f.call("PetGift", { uid: 1, tbItem: [22, 1, 1, 1, 1] });
    f.call("PetGift", { uid: 1, tbItem: [22, 2, 1, 1, 1] });
    expect(progress(f.player, 5003)).toBe(1);
    expect(progress(f.player, 5002)).toBe(1);
    expect(progress(f.player, 5232)).toBe(1); // Total pet levels gained.
    expect(f.call("GetPetMissionAward", { nId: 5003 }).response).toEqual({
      sCmd: "GetPetMissionAward",
      nError: 0,
      nId: 5003,
    });
    expect(f.grants.at(-1)).toEqual(catalog.petMission(5003)!.awardsList);
    const claimed = structuredClone(f.player),
      count = f.grants.length;
    expect(() => f.call("GetPetMissionAward", { nId: 5003 })).toThrow(
      "pet_mission_not_claimable",
    );
    expect(f.grants).toHaveLength(count);
    expect(f.player).toEqual(claimed);
    expect(() => f.call("GetPetMissionAward", { nId: 99999 })).toThrow(
      "unknown_pet_mission",
    );
  });
  it("counts adoption species/rarity and rejects claiming a later chain before its predecessor", () => {
    const f = fixture();
    f.call("OnFoodBoxOpen", { nBoxId: 1 });
    for (const id of [101, 102, 103, 104, 105]) {
      f.player.cafe.pets!.boxes[0]!.pet = pet(1, id, { hot: 0 });
      f.call("OnNewPet", { nBoxId: 1, name: "Nova" });
    }
    expect(progress(f.player, 5001)).toBe(5);
    expect(progress(f.player, 5201)).toBe(5);
    for (const mission of catalog
      .petMissionsOfType(242)
      .filter((row) => row.missionMax[1] === 1))
      expect(progress(f.player, mission.missionId)).toBe(
        Math.min(5, mission.missionMax[0]!),
      );
    f.player.taskValues[String((18 << 16) | 5202)] = 100;
    expect(() => f.call("GetPetMissionAward", { nId: 5202 })).toThrow(
      "pet_mission_prerequisite",
    );
    f.call("GetPetMissionAward", { nId: 5001 });
    expect(progress(f.player, 5006)).toBe(1);
  });
  it("unlocks the weekly meta reward only after allfive rewards are claimed", () => {
    const f = fixture();
    f.call("GetCafeFoodNum");
    for (let id = 5001; id <= 5005; id++) {
      const row = catalog.petMission(id)!;
      f.player.taskValues[String((18 << 16) | id)] = row.missionMax[0]! * 2;
    }
    expect(() => f.call("GetPetMissionAward", { nId: 5006 })).toThrow(
      "pet_mission_not_claimable",
    );
    for (let id = 5001; id <= 5005; id++) f.call("GetPetMissionAward", { nId: id });
    expect(progress(f.player, 5006)).toBe(5);
    f.call("GetPetMissionAward", { nId: 5006 });
    expect(f.grants.at(-1)).toEqual(catalog.petMission(5006)!.awardsList);
  });
  it("resets only weekly missions once at Monday04CST, retaining lifetime claims and rollback safety", () => {
    const f = fixture();
    f.call("GetCafeFoodNum");
    f.player.taskValues[String((18 << 16) | 5003)] = 3;
    f.player.taskValues[String((18 << 16) | 5201)] = 21;
    const epoch = Date.UTC(2021, 7, 22, 20),
      weekMs = 7 * 86_400_000;
    const next = epoch + (Math.floor((NOW - epoch) / weekMs) + 1) * weekMs;
    f.call("GetCafeFoodNum", {}, next);
    expect(progress(f.player, 5003)).toBe(0);
    expect(f.player.taskValues[String((18 << 16) | 5201)]).toBe(21);
    const reset = structuredClone(f.player);
    f.call("GetCafeFoodNum", {}, next + SECOND);
    f.call("GetCafeFoodNum", {}, NOW);
    expect(f.player).toEqual(reset);
    expect(() => f.call("GetPetMissionAward", { nId: 5201 }, next)).toThrow(
      "pet_mission_not_claimable",
    );
  });
  it("counts consumed foodpoints rather than cans, including an offlineweek boundary", () => {
    const f = fixture();
    f.own(pet(1));
    const epoch = Date.UTC(2021, 7, 22, 20),
      weekMs = 7 * 86_400_000;
    const next = epoch + (Math.floor((NOW - epoch) / weekMs) + 1) * weekMs;
    f.call("ChangePetCafeState", { nIndex: 1, uid: 1 }, next - 24_000);
    f.call("BuyCafeFood", { nFoodId: 1, nNum: 1 }, next - 24_000);
    expect(progress(f.player, 5004)).toBe(0);
    f.call("GetCafeFoodNum", {}, next + 12_000);
    expect(progress(f.player, 5004)).toBe(1);
    expect(progress(f.player, 5235)).toBe(3);
    f.call("GetCafeFoodNum", {}, next + 18_000);
    expect(progress(f.player, 5004)).toBe(1);
    f.call("GetCafeFoodNum", {}, next + 24_000);
    expect(progress(f.player, 5004)).toBe(2);
    expect(progress(f.player, 5235)).toBe(4);
  });
  it("rejects malformed fractional or string gift counts without spending or progress", () => {
    const f = fixture();
    f.own(pet(1, 101, { hot: 0 }));
    f.call("GetCafeFoodNum");
    f.items.set("22-1-1-1", 3);
    const player = structuredClone(f.player),
      items = new Map(f.items);
    for (const tbItem of [[22, 1, 1, 1, 0.5], "[22,1,1,1,0.5]", [22, 1, 1, 1, -1]])
      expect(() => f.call("PetGift", { uid: 1, tbItem })).toThrow("invalid_gift");
    expect(f.player).toEqual(player);
    expect(f.items).toEqual(items);
  });
});
