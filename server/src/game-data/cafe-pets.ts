// SPDX-License-Identifier: MIT
// Protocol/state-machine reference: GCG2-Offline, SssjServer.Game CafePetFeature
// and CafePetFeature.Tour (MIT). Adapted for this server's atomic transactions;
// final-CN client contracts take precedence over the reference implementation.
import { createHash } from "node:crypto";

import type { Player } from "../persistence/player-repository.js";
import type { BaseAward } from "./chapter-config.js";
import type { CafeNotification } from "./cafe-runtime.js";
import type { CafePetCatalog } from "./cafe-pet-catalog.js";

export interface CafePet {
  uid: number;
  templateid: number;
  exp: number;
  hot: number;
  name: string;
  birthday: number;
  meetday: number;
  hobby: number;
  iq: number;
  nature: number;
  gender: number;
  lv: number;
  ext3?: number;
}
export interface CafePetBox {
  uid: number;
  unlocked: boolean;
  type: number;
  time: number;
  pet?: CafePet;
}
export interface CafePetState {
  version: 1;
  boxes: CafePetBox[];
  pets: CafePet[];
  nextUid: number;
  inCafe: number[];
  /** Fractional hourly gains, when a future food table actually supplies them. */
  foodCarry?: Record<string, { hot: number; exp: number }>;
  missionWeek?: number;
  foodMissionRemainder?: number;
  weeklyFoodMissionRemainder?: number;
  historyVersion?: 1;
}
export interface CafePetRuntimeHooks {
  chargeMoney(moneyId: number, count: number): void;
  consumeItem(gdpl: readonly number[], count: number): void;
  inventory(gdpl: readonly number[]): number;
  grant(awards: readonly BaseAward[]): void;
  /** ItemList.ExtParam1 for genre22 toys/cleaning supplies. */
  giftEffect?(gdpl: readonly number[]): number;
  itemByGuid?(guid: number): { gdpl: readonly number[]; count: number } | undefined;
  beforeBuffChange?(): void;
}
export interface CafePetRuntimeResult {
  response: Record<string, unknown> | undefined;
  notifications: CafeNotification[];
}
export class CafePetOperationError extends Error {
  constructor(
    readonly reason: string,
    readonly response?: Record<string, unknown>,
  ) {
    super(`Café pet operation rejected: ${reason}`);
    this.name = "CafePetOperationError";
  }
}

const GROUP = 49,
  MAX_FOOD_SECONDS = 120_000,
  BOX_COUNT = 3,
  FOOD_SLOT_COUNT = 20,
  GIFT_TYPE = 9999;
// Asia/Shanghai04:00, matching daily-sign-up-data.ts and the client's
// 2021-08-23 04:00 anchor for seven-day pet missions.
const PET_WEEK_EPOCH = Date.UTC(2021, 7, 22, 20) / 1_000;
const WEEK_SECONDS = 7 * 86_400;
const missionKey = (id: number): string => String((18 << 16) | id);
const weeklyMission = (id: number): boolean => id >= 5001 && id <= 5006;
const key = (offset: number): string => String((GROUP << 16) | offset);
const foodIdKey = (slot: number): number => 101 + (slot - 1) * 2;
const foodTimeKey = (slot: number): number => 102 + (slot - 1) * 2;
const formationKey = (area: number, slot: number): number =>
  550 + (area - 1) * 3 + slot;
const awardKey = (area: number): number => 850 + (area - 1) * 2 + 1;
export const cafePetRikiTaskOffset = (template: number): number =>
  1000 + Math.floor(template / 100) * 20 + (template % 10);
const protectedTasks = new WeakMap<CafePetCatalog, ReadonlySet<number>>();
/** Exact server-owned offsets; preserve unrelated client tasks in the same group. */
export function isCafePetTaskId(id: number, catalog: CafePetCatalog): boolean {
  if (!Number.isSafeInteger(id) || id < 0) return false;
  if (id >>> 16 === 18) return catalog.petMission(id & 0xffff) !== null;
  if (id >>> 16 !== GROUP) return false;
  let offsets = protectedTasks.get(catalog);
  if (!offsets) {
    const set = new Set<number>([200, 1404, 1405]);
    for (let offset = 101; offset <= 140; offset++) set.add(offset);
    for (const area of catalog.tourAreas()) {
      for (const offset of [
        510 + area.Index,
        700 + area.Index,
        750 + area.Index,
        800 + area.Rare,
        awardKey(area.Index),
        awardKey(area.Index) + 1,
      ])
        set.add(offset);
      for (const slot of [1, 2, 3]) set.add(formationKey(area.Index, slot));
    }
    for (const template of catalog.petTemplates())
      set.add(cafePetRikiTaskOffset(template.Id));
    for (const buff of catalog.petBuffs()) set.add(1410 + buff.Id);
    for (const award of catalog.petRikiAwards()) set.add(1450 + award.Id);
    offsets = set;
    protectedTasks.set(catalog, offsets);
  }
  return offsets.has(id & 0xffff);
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const integer = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
const numbers = (value: unknown): number[] => {
  if (Array.isArray(value)) return value.map((n) => integer(n));
  return [];
};
const tuples = (value: unknown): number[][] => {
  if (Array.isArray(value))
    return value.every(Array.isArray)
      ? value.map(numbers)
      : value.length
        ? [numbers(value)]
        : [];
  return [];
};
const unit = (seed: string): number =>
  createHash("sha256").update(seed).digest().readUInt32LE() / 0x1_0000_0000;
function choose<T>(
  rows: readonly T[],
  weight: (row: T) => number,
  seed: string,
): T | undefined {
  const total = rows.reduce((sum, row) => sum + Math.max(0, weight(row)), 0);
  if (!Number.isFinite(total) || total <= 0) return undefined;
  let draw = unit(seed) * total;
  for (const row of rows) {
    draw -= Math.max(0, weight(row));
    if (draw < 0) return row;
  }
  return rows.at(-1);
}
const safeName = (value: unknown, uid: number): string =>
  (typeof value === "string" ? [...value.trim()].slice(0, 24).join("") : "") ||
  `pet${uid}`;
const wire = (
  sCmd: string,
  payload: Record<string, unknown> = {},
): Record<string, unknown> => ({ sCmd, nError: 0, ...payload });
const REPLIES: Readonly<Record<string, string>> = {
  GetCafeFoodNum: "GetCafeFoodNum",
  UpdateFoodBoxs: "UpdateFoodBoxs",
  OnFoodBoxOpen: "UpdateFoodBoxs",
  SetFood: "SetFood",
  OnBoxFoodDone: "SetFood",
  OnGetGiveupItem: "UpdateFoodBoxs",
  OnNewPet: "AdoptPet",
  OnGiveupPet: "GiveUpPet",
  DelPet: "GiveUpPetOwned",
  BuyCafeFood: "GetCafeFoodNum",
  ChangePetCafeState: "ChangePetCafeState",
  PetGift: "PetGift",
  PetRename: "PetRename",
  LockOnePet: "LockOnePet",
  UnLockTourArea: "UnLockTourArea",
  SetTourPets: "SetTourPets",
  CheckTourIsSuccess: "CheckTourIsSuccess",
  CompleteTour: "CompleteTour",
  GetPawAward: "OnRikiTaskChanged",
  GetPetMissionAward: "GetPetMissionAward",
};
/** Only error callbacks with a documented Error guard may be sent. */
export function petErrorResponse(
  parameters: unknown,
): Record<string, unknown> | undefined {
  const command = object(parameters).sCmd;
  if (
    typeof command === "string" &&
    ["SetFood", "OnBoxFoodDone", "OnNewPet"].includes(command)
  )
    return { sCmd: REPLIES[command], nError: 1, Error: 1 };
  return undefined;
}
export function makeCafePetState(): CafePetState {
  return {
    version: 1,
    boxes: Array.from({ length: BOX_COUNT }, (_, i) => ({
      uid: i + 1,
      unlocked: false,
      type: 0,
      time: 0,
    })),
    pets: [],
    nextUid: 1,
    inCafe: [],
  };
}
function boxWire(box: CafePetBox): Record<string, unknown> {
  return box.unlocked
    ? {
        uid: box.uid,
        type: box.type,
        time: box.time,
        ...(box.pet ? { pet: structuredClone(box.pet) } : {}),
      }
    : { uid: box.uid };
}
/** Read-only projections are safe during login and never initialize/write state. */
export function cafePetList(player: Player): CafePet[] {
  return structuredClone(player.cafe.pets?.pets ?? []);
}
export function cafePetDownload(player: Player): {
  boxstatelist: Record<string, unknown>[];
  petstatelist: { uid: number }[];
  nextpetid: number;
  petlocklist: number[];
} {
  const state = player.cafe.pets;
  return {
    boxstatelist: (state?.boxes ?? []).filter((box) => box.unlocked).map(boxWire),
    petstatelist: state?.inCafe.some((uid) => uid !== 0)
      ? state.inCafe.map((uid) => ({ uid }))
      : [],
    nextpetid: state?.nextUid ?? 1,
    petlocklist: (state?.pets ?? [])
      .filter((pet) => pet.ext3 === 1)
      .map((pet) => pet.uid),
  };
}

/** Pure, on-demand state machine. Call only on a repository transaction draft. */
export class CafePetRuntime {
  readonly state: CafePetState;
  readonly now: number;
  readonly notifications: CafeNotification[] = [];
  constructor(
    readonly player: Player,
    readonly catalog: CafePetCatalog,
    nowMs: number,
    readonly hooks: CafePetRuntimeHooks,
  ) {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0)
      throw new CafePetOperationError("invalid_clock");
    this.now = Math.floor(nowMs / 1_000);
    this.state = player.cafe.pets ??= makeCafePetState();
  }
  private task(offset: number): number {
    return this.player.taskValues[key(offset)] ?? 0;
  }
  private setTask(offset: number, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0x7fff_ffff)
      throw new CafePetOperationError("invalid_task_value");
    if (value !== this.task(offset)) this.player.taskValues[key(offset)] = value;
  }
  private reject(reason: string, request: unknown): never {
    throw new CafePetOperationError(reason, petErrorResponse(request));
  }
  private reply(
    command: string,
    fields: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const actual = REPLIES[command];
    if (!actual) throw new CafePetOperationError("unknown_command");
    return wire(actual, fields);
  }
  private updatePets(pets: readonly CafePet[]): void {
    if (pets.length)
      this.notifications.push({
        method: "NCafePetLogic",
        parameters: wire("UpdatePet", { tbPetInfo: structuredClone(pets) }),
      });
  }
  private owned(uid: number, request: unknown): CafePet {
    const pet = this.state.pets.find((p) => p.uid === uid);
    if (!pet) this.reject("pet_not_owned", request);
    return pet;
  }
  private box(request: Record<string, unknown>): CafePetBox {
    const id = integer(request.nBoxId) || integer(request.boxId);
    const box = this.state.boxes.find((b) => b.uid === id);
    if (!box) this.reject("invalid_box", request);
    return box;
  }
  private boxParams(): Record<string, unknown>[] {
    return this.state.boxes.map(boxWire);
  }
  petList(): CafePet[] {
    return cafePetList(this.player);
  }
  download(): ReturnType<typeof cafePetDownload> {
    this.refreshMissions();
    this.resolveBoxes();
    this.settleFood();
    return cafePetDownload(this.player);
  }
  private seed(label: string): string {
    return `cafepet:${this.player.roleId}:${label}`;
  }
  private busy(uid: number): boolean {
    return this.catalog
      .tourAreas()
      .some(
        (area) =>
          [2, 3, 4].includes(this.task(700 + area.Index)) &&
          [1, 2, 3].some((slot) => this.task(formationKey(area.Index, slot)) === uid),
      );
  }
  private areaCount(): number {
    let count = 1;
    for (let slot = 1; slot <= 100; slot++) {
      const needed = this.catalog.petAreaCost(slot);
      if (needed === null) break;
      if (needed <= this.state.nextUid - 1) count = slot;
    }
    return count;
  }
  private totalFood(): number {
    let total = 0;
    for (let slot = 1; slot <= FOOD_SLOT_COUNT; slot++)
      total += this.task(foodTimeKey(slot));
    return total;
  }
  /** Rarity-priority food consumption; no pet means the clocked pool is paused. */
  settleFood(): void {
    const last = this.task(200);
    if (this.now < last) return; // Clock rollback cannot mint time or consume food twice.
    const assigned = this.state.inCafe
      .map((uid) => this.state.pets.find((pet) => pet.uid === uid))
      .filter((pet): pet is CafePet => pet !== undefined);
    let elapsed = last > 0 ? this.now - last : 0;
    const originalElapsed = elapsed;
    const active = Array.from({ length: FOOD_SLOT_COUNT }, (_, i) => i + 1)
      .filter((slot) => this.task(foodTimeKey(slot)) > 0)
      .sort(
        (a, b) =>
          (this.catalog.buffFood(this.task(foodIdKey(b)))?.Rarity ?? 0) -
            (this.catalog.buffFood(this.task(foodIdKey(a)))?.Rarity ?? 0) || a - b,
      );
    if (assigned.length)
      for (const slot of active) {
        if (elapsed <= 0) break;
        const food = this.catalog.buffFood(this.task(foodIdKey(slot)));
        const remaining = this.task(foodTimeKey(slot));
        const consumed = Math.min(remaining, elapsed);
        elapsed -= consumed;
        this.setTask(foodTimeKey(slot), remaining - consumed);
        if (remaining === consumed) this.setTask(foodIdKey(slot), 0);
        if (food && (food.Energy > 0 || food.Love > 0)) {
          const carry = (this.state.foodCarry ??= {});
          for (const pet of assigned) {
            const value = (carry[String(pet.uid)] ??= { hot: 0, exp: 0 });
            value.hot += (consumed * food.Energy) / 3_600;
            value.exp += (consumed * food.Love) / 3_600;
            const hot = Math.floor(value.hot),
              exp = Math.floor(value.exp);
            value.hot -= hot;
            value.exp -= exp;
            pet.hot = Math.min(100, pet.hot + hot);
            this.addLove(pet, exp);
          }
          this.updatePets(assigned);
        }
      }
    // Polling with no food need not churn a timestamp/save on every request.
    if (assigned.length && active.length && (elapsed !== this.now - last || last === 0))
      this.setTask(200, Math.min(this.now, 0x7fff_ffff));
    const consumed = originalElapsed - elapsed;
    if (consumed > 0) {
      const weekStart =
        PET_WEEK_EPOCH + (this.state.missionWeek ?? this.week()) * WEEK_SECONDS;
      const weeklySeconds = Math.max(0, last + consumed - Math.max(last, weekStart));
      const total = (this.state.foodMissionRemainder ?? 0) + consumed;
      const weeklyTotal = (this.state.weeklyFoodMissionRemainder ?? 0) + weeklySeconds;
      this.state.foodMissionRemainder = total % 12;
      this.state.weeklyFoodMissionRemainder = weeklyTotal % 12;
      this.bumpMission(
        247,
        Math.floor(total / 12),
        undefined,
        Math.floor(weeklyTotal / 12),
      );
    }
  }
  private addLove(pet: CafePet, amount: number): void {
    const oldLevel = pet.lv;
    const rarity = this.catalog.petTemplate(pet.templateid)?.Rare ?? 1;
    const cap = rarity === 1 ? 30 : rarity === 2 ? 40 : 50;
    pet.exp += amount;
    while (pet.lv < cap) {
      const need = this.catalog.petLoveExp(pet.lv);
      if (need === null || need <= 0 || pet.exp < need) break;
      pet.exp -= need;
      pet.lv++;
    }
    if (pet.lv >= cap) pet.exp = Math.min(pet.exp, this.catalog.petLoveExp(cap) ?? 0);
    this.recordPet(pet);
    if (pet.lv > oldLevel) {
      this.bumpMission(245, pet.lv - oldLevel);
      for (const mission of this.catalog.petMissionsOfType(246)) {
        const threshold = mission.missionMax[1] ?? 0;
        if (oldLevel < threshold && pet.lv >= threshold)
          this.advanceMission(mission.missionId, 1);
      }
    }
  }
  private resolveBoxes(): void {
    for (const box of this.state.boxes) {
      if (
        !box.unlocked ||
        box.pet ||
        box.type <= 0 ||
        box.type === GIFT_TYPE ||
        box.time > this.now
      )
        continue;
      const food = this.catalog.petFood(box.type);
      if (!food) continue;
      const seed = this.seed(`attract:${box.uid}:${box.type}:${box.time}`);
      const rare = choose(
        tuples(food.GetPetRare),
        (row) => row[1] ?? 0,
        `${seed}:rare`,
      )?.[0];
      const all = this.catalog.petTemplates();
      const candidates = all.filter((row) => row.Rare === rare);
      const template = choose(
        candidates.length ? candidates : all,
        () => 1,
        `${seed}:template`,
      );
      if (!template) continue;
      const pick = (values: number[], label: string, fallback: number): number =>
        values[Math.floor(unit(`${seed}:${label}`) * values.length)] ?? fallback;
      const nature =
        choose(tuples(template.Nature), (row) => row[1] ?? 0, `${seed}:nature`)?.[0] ??
        1;
      const iq = numbers(template.IQ);
      const start = Math.min(...iq),
        end = Math.max(...iq);
      box.pet = {
        uid: this.state.nextUid,
        templateid: template.Id,
        exp: 0,
        hot: 0,
        name: "",
        birthday:
          Math.floor(
            Date.UTC(new Date(this.now * 1_000).getUTCFullYear(), 0, 1, 12) / 1_000,
          ) +
          Math.floor(unit(`${seed}:birthday`) * 365) * 86_400,
        meetday: this.now,
        hobby: pick(numbers(template.Hobby), "hobby", 101),
        iq: Number.isFinite(start)
          ? start + Math.floor(unit(`${seed}:iq`) * (end - start + 1))
          : 1,
        nature,
        gender: pick(numbers(template.Gender), "gender", 1),
        lv: 1,
        ext3: 0,
      };
      box.type = 0;
      box.time = 0;
    }
  }
  /** Recognized requests mutate the draft; unknown/dead commands have no callback. */
  operate(parameters: unknown): CafePetRuntimeResult {
    const request = object(parameters),
      command = request.sCmd;
    if (typeof command !== "string" || !REPLIES[command])
      throw new CafePetOperationError("unknown_command");
    try {
      this.refreshMissions();
      return {
        response: this.dispatch(command, request),
        notifications: this.notifications,
      };
    } catch (error) {
      if (error instanceof CafePetOperationError) throw error;
      if (error instanceof Error) this.reject(error.message, request);
      throw error;
    }
  }
  private dispatch(
    command: string,
    request: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    switch (command) {
      case "GetCafeFoodNum":
        this.settleFood();
        return this.reply(command);
      case "UpdateFoodBoxs":
        this.resolveBoxes();
        return this.reply(command, { param: this.boxParams() });
      case "OnFoodBoxOpen": {
        const box = this.box(request);
        if (!box.unlocked) {
          const price = this.catalog.foodBoxPrice(
            this.state.boxes.filter((b) => b.unlocked).length + 1,
          );
          if (!price) this.reject("missing_box_price", request);
          this.hooks.chargeMoney(price.Cost[0], price.Cost[1]);
          box.unlocked = true;
        }
        return this.reply(command, { param: this.boxParams() });
      }
      case "SetFood": {
        const box = this.box(request),
          food = this.catalog.petFood(integer(request.nId));
        if (!box.unlocked || box.type !== 0 || box.pet || !food)
          this.reject("box_or_food_unavailable", request);
        this.hooks.consumeItem(numbers(food.GDPL), 1);
        box.type = food.Id;
        box.time = this.now + this.attractTime();
        return this.reply(command, { param: this.boxParams() });
      }
      case "OnBoxFoodDone": {
        const box = this.box(request);
        if (box.pet) return this.reply(command, { param: this.boxParams() });
        const food = this.catalog.petFood(box.type);
        if (!box.unlocked || !food) this.reject("box_not_attracting", request);
        const price = numbers(food.PricePer),
          remaining = Math.max(0, box.time - this.now);
        const cost =
          remaining > 0 ? (Math.floor(remaining / 600) + 1) * (price[1] ?? 0) : 0;
        this.hooks.chargeMoney(price[0] ?? 0, cost);
        box.time = this.now;
        this.resolveBoxes();
        return this.reply(command, { param: this.boxParams() });
      }
      case "OnNewPet": {
        this.resolveBoxes();
        const box = this.box(request);
        if (!box.pet) this.reject("no_pending_pet", request);
        if (this.state.nextUid >= 0x7fff_ffff) this.reject("pet_id_exhausted", request);
        const pet = box.pet;
        pet.uid = this.state.nextUid++;
        pet.name = safeName(request.name, pet.uid);
        pet.meetday = this.now;
        this.state.pets.push(pet);
        delete box.pet;
        box.type = 0;
        box.time = 0;
        this.recordPet(pet, true);
        this.bumpMission(241, 1);
        const template = this.catalog.petTemplate(pet.templateid);
        if (template) {
          this.bumpMission(242, 1, template.Type);
          this.bumpMission(243, 1, template.Rare);
        }
        return this.reply(command, {
          boxId: box.uid,
          param: this.boxParams(),
          petInfo: structuredClone(pet),
        });
      }
      case "OnGiveupPet": {
        const box = this.box(request);
        if (!box.pet) this.reject("no_pending_pet", request);
        delete box.pet;
        box.type = GIFT_TYPE;
        box.time = 0;
        this.bumpMission(250, 1);
        return this.reply(command, { boxId: box.uid, param: this.boxParams() });
      }
      case "OnGetGiveupItem": {
        const box = this.box(request);
        if (box.type === GIFT_TYPE) {
          const gift = this.catalog.petGiveBack(1);
          if (gift) {
            this.hooks.grant([gift]);
            this.notifications.push({ command: 75, parameters: [gift] });
          }
          box.type = 0;
          box.time = 0;
          delete box.pet;
        }
        return this.reply(command, { param: this.boxParams() });
      }
      case "ChangePetCafeState": {
        const index = integer(request.nIndex),
          uid = integer(request.uid);
        if (index < 1 || index > this.areaCount() || uid < 0)
          this.reject("invalid_cafe_slot", request);
        if (uid) {
          this.owned(uid, request);
          if (this.busy(uid)) this.reject("pet_on_tour", request);
        }
        this.settleFood();
        while (this.state.inCafe.length < this.areaCount()) this.state.inCafe.push(0);
        const old = uid ? this.state.inCafe.indexOf(uid) : -1;
        if (old >= 0 && old !== index - 1) this.state.inCafe[old] = 0;
        this.state.inCafe[index - 1] = uid;
        if (this.totalFood() > 0)
          this.setTask(200, Math.max(this.task(200), Math.min(this.now, 0x7fff_ffff)));
        return this.reply(command, {
          nIndex: index,
          uid,
          ...(old >= 0 && old !== index - 1 ? { nCleanIndex: old + 1 } : {}),
        });
      }
      case "PetGift": {
        const uid = integer(request.uid),
          pet = this.owned(uid, request),
          item = numbers(request.tbItem);
        const count = item[4] ?? 0,
          gdpl = item.slice(0, 4);
        if (
          item.length !== 5 ||
          gdpl[0] !== 22 ||
          ![1, 2].includes(gdpl[1] ?? 0) ||
          count <= 0 ||
          count > 1_000_000
        )
          this.reject("invalid_gift", request);
        const per =
          this.hooks.giftEffect?.(gdpl) ?? this.catalog.petGift(gdpl)?.ExtParam1 ?? 0;
        if (
          !Number.isSafeInteger(per) ||
          per <= 0 ||
          !Number.isSafeInteger(per * count)
        )
          this.reject("unknown_gift", request);
        if (
          (gdpl[1] === 2 && pet.hot >= 100) ||
          (gdpl[1] === 1 &&
            pet.lv >=
              (this.catalog.petTemplate(pet.templateid)?.Rare === 1
                ? 30
                : this.catalog.petTemplate(pet.templateid)?.Rare === 2
                  ? 40
                  : 50))
        )
          this.reject("pet_at_limit", request);
        this.hooks.consumeItem(gdpl, count);
        if (gdpl[1] === 2) pet.hot = Math.min(100, pet.hot + per * count);
        else this.addLove(pet, per * count);
        this.bumpMission(gdpl[1] === 2 ? 249 : 248, count);
        this.updatePets([pet]);
        return this.reply(command, { uid, tbItem: item });
      }
      case "PetRename": {
        const pet = this.owned(integer(request.uid), request);
        pet.name = safeName(request.name, pet.uid);
        this.updatePets([pet]);
        return this.reply(command, { uid: pet.uid, name: pet.name });
      }
      case "LockOnePet": {
        const pet = this.owned(integer(request.nIndex), request);
        if (typeof request.isLock !== "boolean") this.reject("invalid_lock", request);
        pet.ext3 = request.isLock ? 1 : 0;
        this.updatePets([pet]);
        return this.reply(command, { nIndex: pet.uid, isLock: request.isLock });
      }
      case "DelPet": {
        const uid = integer(request.uid),
          pet = this.owned(uid, request);
        if (pet.ext3 === 1 || this.busy(uid))
          this.reject("pet_locked_or_busy", request);
        this.settleFood();
        const index = this.state.inCafe.indexOf(uid);
        if (index >= 0) this.state.inCafe[index] = 0;
        const gift = this.catalog.petGiveBack(pet.lv);
        if (gift) {
          this.hooks.grant([gift]);
          this.notifications.push({ command: 75, parameters: [gift] });
        }
        this.state.pets.splice(this.state.pets.indexOf(pet), 1);
        this.bumpMission(250, 1);
        return this.reply(command, {
          uid,
          ...(index >= 0 ? { nIndex: index + 1 } : {}),
        });
      }
      case "BuyCafeFood": {
        const id = integer(request.nFoodId),
          count = request.nNum === undefined ? 1 : integer(request.nNum),
          food = this.catalog.buffFood(id);
        if (!food || id < 1 || id > FOOD_SLOT_COUNT || count <= 0 || count > 1_000_000)
          this.reject("invalid_food", request);
        this.settleFood();
        const seconds = food.AddPoint * 12 * count;
        if (
          !Number.isSafeInteger(seconds) ||
          seconds > MAX_FOOD_SECONDS - this.totalFood()
        )
          this.reject("food_capacity", request);
        const cost = numbers(food.PriceGet);
        this.hooks.chargeMoney(cost[0] ?? 0, (cost[1] ?? 0) * count);
        this.setTask(foodIdKey(id), id);
        this.setTask(foodTimeKey(id), this.task(foodTimeKey(id)) + seconds);
        this.setTask(200, Math.max(this.task(200), Math.min(this.now, 0x7fff_ffff)));
        return this.reply(command);
      }
      case "UnLockTourArea":
        return this.unlockTour(request);
      case "SetTourPets":
        return this.startTour(request);
      case "CheckTourIsSuccess":
        return this.checkTour(request);
      case "CompleteTour":
        return this.completeTour(request);
      case "GetPawAward":
        return this.claimCollection(request);
      case "GetPetMissionAward":
        return this.claimMission(request);
    }
    return undefined;
  }
  private attractTime(): number {
    // Only the highest-weight earned buff of each type is active.
    const buffs = new Map<number, { weight: number; minutes: number }>();
    for (const buff of this.catalog.petBuffs()) {
      if ((this.task(1410 + buff.Id) & 1) === 0 || ![5, 6, 7].includes(buff.Type))
        continue;
      const old = buffs.get(buff.Type);
      if (!old || old.weight < buff.Weight)
        buffs.set(buff.Type, { weight: buff.Weight, minutes: buff.Param1 });
    }
    return Math.max(
      0,
      8 * 3_600 - [...buffs.values()].reduce((sum, buff) => sum + buff.minutes * 60, 0),
    );
  }
  private unlockTour(request: Record<string, unknown>): Record<string, unknown> {
    const index = integer(request.nIndex),
      area = this.catalog.tourArea(index);
    if (!area) this.reject("unknown_tour_area", request);
    if (this.task(700 + index) > 0)
      return this.reply("UnLockTourArea", { nIndex: index });
    const first = numbers(area.Unlock1),
      cost = numbers(area.Unlock3);
    if (
      (first.length >= 2 && this.task(800 + first[0]!) < first[1]!) ||
      this.state.nextUid - 1 < area.Unlock2
    )
      this.reject("tour_unlock_requirements", request);
    this.hooks.chargeMoney(cost[0] ?? 0, cost[1] ?? 0);
    this.setTask(700 + index, 1);
    this.rollTour(index);
    return this.reply("UnLockTourArea", { nIndex: index });
  }
  private rollTour(index: number): void {
    const area = this.catalog.tourArea(index)!;
    const completed = this.task(800 + area.Rare);
    const pool = this.catalog.tourMissionsOfRare(area.Rare);
    const seed = this.seed(`tour:${index}:${completed}`);
    const tour = choose(pool, (row) => row.Pro, seed);
    if (!tour) throw new CafePetOperationError("missing_tour_mission");
    this.setTask(510 + index, tour.MissionID);
    const picks = [1, 2, 3, 4].map(
      (kind) =>
        choose(
          this.catalog.tourRewardsFor(tour.Rare, kind),
          (row) => row.Pro,
          `${seed}:award:${kind}`,
        )?.AwardID ?? 0,
    );
    this.setTask(
      awardKey(index),
      ((picks[0]! & 0x7fff) << 1) | ((picks[1]! & 0x7fff) << 16),
    );
    this.setTask(
      awardKey(index) + 1,
      ((picks[2]! & 0x7fff) << 1) | ((picks[3]! & 0x7fff) << 16),
    );
  }
  private tourPets(index: number): CafePet[] {
    return [1, 2, 3]
      .map((slot) =>
        this.state.pets.find((pet) => pet.uid === this.task(formationKey(index, slot))),
      )
      .filter((pet): pet is CafePet => pet !== undefined);
  }
  private startTour(request: Record<string, unknown>): Record<string, unknown> {
    const index = integer(request.nIndex),
      area = this.catalog.tourArea(index),
      uids = numbers(request.tbPets);
    if (
      !area ||
      this.task(700 + index) !== 1 ||
      uids.length !== 3 ||
      new Set(uids).size !== 3
    )
      this.reject("invalid_tour_party", request);
    const pets = uids.map((uid) => this.owned(uid, request));
    if (pets.some((pet) => pet.hot < area.EnergyCost || this.busy(pet.uid)))
      this.reject("tour_pet_unavailable", request);
    if (!this.catalog.tourMission(this.task(510 + index)))
      this.reject("missing_tour_mission", request);
    this.settleFood();
    const cleared: number[] = [];
    pets.forEach((pet, i) => {
      this.setTask(formationKey(index, i + 1), pet.uid);
      pet.hot -= area.EnergyCost;
      this.state.inCafe.forEach((uid, slot) => {
        if (uid === pet.uid) {
          this.state.inCafe[slot] = 0;
          cleared.push(slot + 1);
        }
      });
    });
    this.setTask(700 + index, 2);
    this.setTask(750 + index, Math.min(this.now, 0x7fff_ffff));
    this.updatePets(pets);
    return this.reply("SetTourPets", {
      nIndex: index,
      ...(cleared.length ? { statelist: cleared } : {}),
    });
  }
  private checkTour(
    request: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const index = integer(request.nIndex),
      area = this.catalog.tourArea(index);
    if (!area) this.reject("unknown_tour_area", request);
    const status = this.task(700 + index);
    if (status === 3 || status === 4)
      return this.reply("CheckTourIsSuccess", { nIndex: index });
    const started = this.task(750 + index),
      tour = this.catalog.tourMission(this.task(510 + index));
    if (status !== 2 || !tour || started <= 0) this.reject("tour_not_running", request);
    if (this.now - started < area.Hour * 3_600) return undefined;
    // Final CN removed TourInfo's success odds and extra main reward. Its current
    // UI pays the four TourReward records. Do not invent the obsolete odds.
    this.setTask(700 + index, 3);
    return this.reply("CheckTourIsSuccess", { nIndex: index });
  }
  private completeTour(request: Record<string, unknown>): Record<string, unknown> {
    const index = integer(request.nIndex),
      area = this.catalog.tourArea(index),
      state = this.task(700 + index);
    if (!area || (state !== 3 && state !== 4))
      this.reject("tour_not_complete", request);
    const tour = this.catalog.tourMission(this.task(510 + index));
    if (!tour) this.reject("missing_tour_mission", request);
    const pets = this.tourPets(index),
      rewards: BaseAward[] = [];
    const add = (values: unknown, ratio = 1): void => {
      const tuple = numbers(values);
      if (tuple.length === 5 && tuple.every((n) => Number.isSafeInteger(n) && n >= 0)) {
        const count = Math.ceil(tuple[4]! * ratio);
        if (count > 0)
          rewards.push([tuple[0]!, tuple[1]!, tuple[2]!, tuple[3]!, count]);
      }
    };
    const packed = [this.task(awardKey(index)), this.task(awardKey(index) + 1)];
    const ids = [
      (packed[0]! >>> 1) & 0x7fff,
      (packed[0]! >>> 16) & 0x7fff,
      (packed[1]! >>> 1) & 0x7fff,
      (packed[1]! >>> 16) & 0x7fff,
    ];
    const conditions = tuples(tour.Condition).map(
      ([type, param, need]) =>
        pets.filter((pet) =>
          type === 2
            ? this.catalog.petTemplate(pet.templateid)?.Type === param
            : type === 3
              ? pet.nature === param
              : true,
        ).length >= (need ?? 0),
    );
    const ex = Math.ceil(
      pets.reduce(
        (sum, pet) =>
          sum +
          this.catalog.petLoveEx(pet.lv) *
            (this.catalog.petTemplate(pet.templateid)?.TourNumEx || 1),
        0,
      ),
    );
    ids.forEach((id, i) => {
      const reward = this.catalog.tourReward(id);
      if (!reward) return;
      if (i === 2 && !conditions.some(Boolean)) return;
      if (i === 3 && !(conditions[0] && conditions[1])) return;
      add(reward.Award, i === 1 ? Math.min(1, ex / Math.max(1, area.ExNum)) : 1);
    });
    this.hooks.grant(rewards);
    this.bumpMission(251, 1);
    this.bumpMission(252, 1, area.Rare);
    this.setTask(800 + area.Rare, this.task(800 + area.Rare) + 1);
    for (const slot of [1, 2, 3]) this.setTask(formationKey(index, slot), 0);
    this.setTask(750 + index, 0);
    this.setTask(700 + index, 1);
    this.rollTour(index);
    if (rewards.length)
      this.notifications.push({
        command: 75,
        parameters: rewards,
      });
    return this.reply("CompleteTour", { nIndex: index });
  }
  private claimCollection(request: Record<string, unknown>): Record<string, unknown> {
    const id = integer(request.Id),
      award = this.catalog.petRikiAward(id);
    if (!award) this.reject("unknown_collection_award", request);
    if ((this.task(1450 + id) & 1) !== 0)
      this.reject("collection_award_claimed", request);
    // Conditions count collection history, not only pets still owned.
    const qualifies = award.Condition.every(([type, param, required]) => {
      const templates = this.catalog.petTemplates();
      if (type === 1)
        return (
          templates.reduce(
            (sum, template) =>
              sum +
              ((this.task(cafePetRikiTaskOffset(template.Id)) & 0x7fff) > 0
                ? template.Paw
                : 0),
            0,
          ) >= required
        );
      if (type === 2)
        return (
          templates
            .filter((template) => template.Type === param)
            .filter(
              (template) =>
                (this.task(cafePetRikiTaskOffset(template.Id)) & 0x7fff) > 0,
            ).length >= required
        );
      if (type === 3)
        return ((this.task(cafePetRikiTaskOffset(param)) >>> 15) & 0x7fff) >= required;
      return false;
    });
    if (!qualifies) this.reject("collection_requirements", request);
    this.hooks.beforeBuffChange?.();
    this.setTask(1450 + id, this.task(1450 + id) | 1);
    for (const buff of award.BuffAward)
      this.setTask(1410 + buff, this.task(1410 + buff) | 1);
    if (award.TransAward > 0 && award.TransAward <= 31)
      this.setTask(1404, this.task(1404) | (1 << (award.TransAward - 1)));
    this.hooks.grant(award.ItemAward);
    return this.reply(
      "GetPawAward",
      award.BuffAward.length ? { Id: award.BuffAward[0] } : {},
    );
  }
  private recordPet(pet: CafePet, adopted = false): void {
    const offset = cafePetRikiTaskOffset(pet.templateid),
      old = this.task(offset);
    const count = Math.min(0x7fff, (old & 0x7fff) + (adopted ? 1 : 0));
    const highest = Math.max((old >>> 15) & 0x7fff, pet.lv);
    this.setTask(offset, count | (highest << 15));
    if (adopted)
      this.setTask(
        1405,
        this.catalog
          .petTemplates()
          .reduce(
            (total, template) =>
              total +
              ((this.task(cafePetRikiTaskOffset(template.Id)) & 0x7fff) > 0
                ? template.Paw
                : 0),
            0,
          ),
      );
  }
  private week(): number {
    return Math.floor((this.now - PET_WEEK_EPOCH) / WEEK_SECONDS);
  }
  private refreshMissions(): void {
    const week = this.week();
    if (this.state.missionWeek === undefined) this.state.missionWeek = week;
    else if (week > this.state.missionWeek) {
      for (const mission of this.catalog.petMissions())
        if (
          weeklyMission(mission.missionId) &&
          this.player.taskValues[missionKey(mission.missionId)]
        )
          this.player.taskValues[missionKey(mission.missionId)] = 0;
      this.state.missionWeek = week;
      this.state.weeklyFoodMissionRemainder = 0;
    }
    this.initializeMissionHistory();
  }
  private initializeMissionHistory(): void {
    if (this.state.historyVersion === 1) return;
    // Existing saves can provide safe lower bounds. Never invent past food,
    // gifts, or weekly activity from today's inventory or lifetime ownership.
    for (const template of this.catalog.petTemplates()) {
      const owned = this.state.pets.filter((pet) => pet.templateid === template.Id);
      const offset = cafePetRikiTaskOffset(template.Id),
        old = this.task(offset);
      const count = Math.max(old & 0x7fff, Math.min(0x7fff, owned.length));
      const level = Math.max((old >>> 15) & 0x7fff, ...owned.map((pet) => pet.lv), 0);
      if (count || level) this.setTask(offset, count | (level << 15));
    }
    this.state.nextUid = Math.max(
      this.state.nextUid,
      ...this.state.pets.map((pet) => pet.uid + 1),
    );
    this.setTask(
      1405,
      this.catalog
        .petTemplates()
        .reduce(
          (sum, template) =>
            sum +
            ((this.task(cafePetRikiTaskOffset(template.Id)) & 0x7fff) > 0
              ? template.Paw
              : 0),
          0,
        ),
    );
    for (const mission of this.catalog.petMissions()) {
      if (weeklyMission(mission.missionId)) continue;
      let observed = 0;
      const parameter = mission.missionMax[1];
      switch (mission.achieveType) {
        case 241:
          observed = this.state.nextUid - 1;
          break;
        case 242:
        case 243:
          observed = this.catalog
            .petTemplates()
            .filter(
              (template) =>
                (mission.achieveType === 242 ? template.Type : template.Rare) ===
                parameter,
            )
            .reduce(
              (sum, template) =>
                sum + (this.task(cafePetRikiTaskOffset(template.Id)) & 0x7fff),
              0,
            );
          break;
        case 245:
          observed = this.state.pets.reduce(
            (sum, pet) => sum + Math.max(0, pet.lv - 1),
            0,
          );
          break;
        case 246:
          observed = this.state.pets.filter(
            (pet) => pet.lv >= (parameter ?? Number.POSITIVE_INFINITY),
          ).length;
          break;
        case 250:
          observed = Math.max(0, this.state.nextUid - 1 - this.state.pets.length);
          break;
        case 251:
          observed = [
            ...new Set(this.catalog.tourAreas().map((area) => area.Rare)),
          ].reduce((sum, rare) => sum + this.task(800 + rare), 0);
          break;
        case 252:
          observed = this.task(800 + (parameter ?? 0));
          break;
      }
      const current =
        (this.player.taskValues[missionKey(mission.missionId)] ?? 0) >>> 1;
      this.advanceMission(mission.missionId, Math.max(0, observed - current));
    }
    this.state.historyVersion = 1;
  }
  private advanceMission(id: number, amount: number): void {
    const mission = this.catalog.petMission(id);
    if (!mission || amount <= 0) return;
    const target = mission.missionMax[(mission.assistparam[0] ?? 1) - 1] ?? 0;
    if (!Number.isSafeInteger(target) || target <= 0 || target > 0x3fff_ffff) return;
    const task = missionKey(id),
      old = this.player.taskValues[task] ?? 0;
    const progress = Math.min(target, (old >>> 1) + amount);
    const value = progress * 2 + (old & 1);
    if (old !== value) this.player.taskValues[task] = value;
  }
  private bumpMission(
    type: number,
    amount: number,
    param?: number,
    weeklyAmount = amount,
  ): void {
    for (const mission of this.catalog.petMissionsOfType(type)) {
      if ([242, 243, 252].includes(type) && mission.missionMax[1] !== param) continue;
      this.advanceMission(
        mission.missionId,
        weeklyMission(mission.missionId) ? weeklyAmount : amount,
      );
    }
  }
  private claimMission(request: Record<string, unknown>): Record<string, unknown> {
    const id = integer(request.nId),
      mission = this.catalog.petMission(id);
    if (!mission) this.reject("unknown_pet_mission", request);
    const task = missionKey(id),
      value = this.player.taskValues[task] ?? 0;
    const target = mission.missionMax[(mission.assistparam[0] ?? 1) - 1] ?? 0;
    if ((value & 1) !== 0 || value >>> 1 < target || target <= 0)
      this.reject("pet_mission_not_claimable", request);
    if (
      mission.preMissionId > 0 &&
      ((this.player.taskValues[missionKey(mission.preMissionId)] ?? 0) & 1) === 0
    )
      this.reject("pet_mission_prerequisite", request);
    this.hooks.grant(mission.awardsList);
    this.player.taskValues[task] = value | 1;
    for (const meta of this.catalog.petMissionsOfType(9)) {
      const done = meta.missionMax
        .slice(1)
        .filter(
          (dependency) =>
            ((this.player.taskValues[missionKey(dependency)] ?? 0) & 1) !== 0,
        ).length;
      const old = (this.player.taskValues[missionKey(meta.missionId)] ?? 0) >>> 1;
      this.advanceMission(meta.missionId, Math.max(0, done - old));
    }
    return this.reply("GetPetMissionAward", { nId: id });
  }
}
