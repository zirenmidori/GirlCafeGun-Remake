import { createHash } from "node:crypto";

import type { BaseAward } from "./chapter-config.js";
import type { CafeCatalog } from "./cafe-catalog.js";
import { cafePetDownload } from "./cafe-pets.js";
import type { Player } from "../persistence/player-repository.js";

export interface CafeRuntimeHooks {
  chargeMoney(moneyId: number, count: number): void;
  consumeItem(gdpl: readonly number[], count: number): void;
  grant(awards: readonly BaseAward[]): void;
  updatedGirl(girlId: number): void;
  isTraining?(girlId: number): boolean;
  coffeeSold?(coffeeId: number, count: number): void;
}
export type CafeNotification =
  | { command: number; parameters: unknown; method?: undefined }
  | { method: string; parameters: unknown; command?: undefined };
export interface CafeSeatState {
  position: number;
  customeridx?: number;
  customertype?: number;
  coffeetype?: number;
  starttime?: number;
  draintime?: number;
}
export interface CafeQueueEntry {
  customertype: number;
  customeridx: number;
  starttime: number;
}
export interface CafeSaleReceipt {
  error: 0;
  customeridx: number;
  earn_base: [number, number, number];
  earn_ex: [number, number, number];
  hot: number;
}
export interface CafeBusinessReport {
  earnings: { gold: number; coffeecoin: number; hot: number };
  earnings_ex: { gold: number; coffeecoin: number; hot: number };
  outlist: Record<string, number>;
}
export interface CafeBusinessState {
  version: 1;
  hot: number;
  lastGeneratedAt: number;
  nextCustomerIndex: number;
  queue: CafeQueueEntry[];
  seats: CafeSeatState[];
  weightDay: number;
  weights: { Id: number; Weight: number }[];
  receipts: Record<string, CafeSaleReceipt>;
  daily: { day: number; gold: number; coffeecoin: number; hot: number };
  fraction: [number, number, number];
  moodAt: Record<string, number>;
  moodCarry: Record<string, number>;
  report: CafeBusinessReport;
  music: number;
  clickedAt: Record<string, number>;
}
export class CafeOperationError extends Error {
  constructor(
    readonly reason: string,
    readonly command: number,
    readonly response: unknown = { nError: 1 },
  ) {
    super(`Café operation ${command} rejected: ${reason}`);
    this.name = "CafeOperationError";
  }
}
export interface CafeRuntimeResult {
  response: unknown;
  notifications: CafeNotification[];
}
const emptyReport = (): CafeBusinessReport => ({
  earnings: { gold: 0, coffeecoin: 0, hot: 0 },
  earnings_ex: { gold: 0, coffeecoin: 0, hot: 0 },
  outlist: {},
});
const dayAt = (time: number): number => Math.floor((time - 4 * 3_600) / 86_400);
const taskKey = (offset: number): string => String((23 << 16) | offset);
const unit = (seed: string): number =>
  createHash("sha256").update(seed).digest().readUInt32LE(0) / 0x1_0000_0000;
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function params(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function cafeRoomGirls(player: Player): [number[][], number[][], number[][]] {
  return [0, 1, 2].map((index) =>
    (player.cafe.roomGirlsList?.[index] ?? []).map((girl) => [
      girl.girlId,
      girl.modelId,
    ]),
  ) as [number[][], number[][], number[][]];
}
export function cafeComfort(player: Player, catalog: CafeCatalog): number {
  const level = catalog.level(player.cafe.level ?? 1)!;
  return (player.cafe.furniture ?? [])
    .filter((item) => item.roomId === 1 || (item.roomId === 2 && level.OpenRest > 0))
    .reduce(
      (total, item) => total + (catalog.furniture(item.templateId)?.AddScore ?? 0),
      0,
    );
}
export function validCafeSeat(
  player: Player,
  position: number,
  catalog: CafeCatalog,
): boolean {
  if (!positive(position)) return false;
  const objectId = Math.floor(position / 10),
    index = position % 10;
  return (player.cafe.furniture ?? []).some((item) => {
    const config = catalog.furniture(item.templateId);
    const points = (config?.raw.Points ?? "")
      .split("|")
      .filter((point) => point.startsWith("biz_"));
    return (
      item.objId === objectId &&
      item.roomId === 1 &&
      config?.Type === 100 &&
      index >= 0 &&
      index < points.length
    );
  });
}
export function makeCafeBusinessState(now: number): CafeBusinessState {
  return {
    version: 1,
    hot: 0,
    lastGeneratedAt: now,
    nextCustomerIndex: 1,
    queue: [],
    seats: [],
    weightDay: -1,
    weights: [],
    receipts: {},
    daily: { day: dayAt(now), gold: 0, coffeecoin: 0, hot: 0 },
    fraction: [0, 0, 0],
    moodAt: {},
    moodCarry: {},
    report: emptyReport(),
    music: 0,
    clickedAt: {},
  };
}

/**
 * Server-authoritative, event-driven reconstruction from the recovered café
 * tables and client contracts. Daily weight seeds and offline scheduling were
 * absent from the shipped client; deterministic seeds make local replay safe.
 */
export class CafeRuntime {
  readonly business: CafeBusinessState;
  readonly notifications: CafeNotification[] = [];
  readonly now: number;
  constructor(
    readonly player: Player,
    readonly catalog: CafeCatalog,
    nowMs: number,
    readonly hooks: CafeRuntimeHooks,
  ) {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0)
      throw new CafeOperationError("invalid_clock", 112);
    this.now = Math.floor(nowMs / 1_000);
    player.cafe.level ??= 1;
    this.business = player.cafe.business ??= makeCafeBusinessState(this.now);
    this.business.moodCarry ??= {};
    this.business.seats = this.business.seats.filter((seat) =>
      validCafeSeat(player, seat.position, catalog),
    );
    this.refreshUnlocks();
    this.refreshWeights();
  }
  get level() {
    return this.catalog.level(this.player.cafe.level ?? 1) ?? this.catalog.level(1)!;
  }
  learned(id: number): boolean {
    return ((this.player.taskValues[taskKey(id)] ?? 0) & 256) !== 0;
  }
  stock() {
    return this.player.cafe.coffees
      .filter((coffee) => coffee.count > 0)
      .map((coffee) => ({ ...coffee }));
  }
  refreshUnlocks(): void {
    for (const coffee of this.catalog.coffees()) {
      let value = this.player.taskValues[taskKey(coffee.Id)] ?? 0;
      if (coffee.Cond1.length === 3) {
        const [chapter, index, difficulty] = coffee.Cond1;
        if (
          this.player.levels.some(
            (level) =>
              level.id === ((chapter! << 16) | (index! << 8) | difficulty!) &&
              level.star > 0,
          )
        )
          value |= 1;
      }
      if (
        coffee.Cond2.length >= 2 &&
        this.player.girls.some(
          (girl) => girl.girlId === coffee.Cond2[0] && girl.level >= coffee.Cond2[1]!,
        )
      )
        value |= 2;
      if (coffee.Cond3 > 0 && this.player.level >= coffee.Cond3) value |= 4;
      if (value !== 0 || this.player.taskValues[taskKey(coffee.Id)] !== undefined)
        this.player.taskValues[taskKey(coffee.Id)] = value;
    }
  }
  refreshWeights(): void {
    const today = dayAt(this.now);
    if (
      this.business.weightDay === today &&
      this.business.weights.every(
        (row) =>
          !this.catalog.customer(row.Id)?.NeedCoffee ||
          this.learned(this.catalog.customer(row.Id)!.NeedCoffee),
      )
    )
      return;
    const eligible = this.catalog
      .customers()
      .filter(
        (guest) =>
          guest.NeedLv <= this.level.Level &&
          (guest.NeedCoffee <= 0 || this.learned(guest.NeedCoffee)),
      );
    const selected = eligible.sort(
      (a, b) =>
        unit(`${this.player.roleId}:${today}:${a.Id}`) -
        unit(`${this.player.roleId}:${today}:${b.Id}`),
    );
    const countByType = new Map<number, number>();
    const weights: { Id: number; Weight: number }[] = [];
    for (const guest of selected) {
      const used = countByType.get(guest.Type) ?? 0;
      const limit =
        guest.Type === 1
          ? this.level.Type1Num
          : guest.Type === 2
            ? this.level.Type2Num
            : this.level.OtherTypeNum;
      if (used >= limit || weights.length >= this.level.MaxGuestTypes) continue;
      countByType.set(guest.Type, used + 1);
      weights.push({
        Id: guest.Id,
        Weight:
          guest.Weight > 0
            ? guest.Weight
            : guest.WeightMin +
              Math.floor(
                unit(`weight:${this.player.roleId}:${today}:${guest.Id}`) *
                  (guest.WeightMax - guest.WeightMin + 1),
              ),
      });
    }
    this.business.weightDay = today;
    this.business.weights = weights.sort((a, b) => a.Id - b.Id);
  }
  extraWeights(): { addguesttype: number; addguestvalue: number }[] {
    const weights = new Map<number, number>();
    for (const item of this.player.cafe.furniture ?? []) {
      if (item.roomId !== 1) continue;
      const config = this.catalog.furniture(item.templateId);
      if (config && config.AddCustomerType > 0 && config.AddCustomerValue > 0)
        weights.set(
          config.AddCustomerType,
          (weights.get(config.AddCustomerType) ?? 0) + config.AddCustomerValue,
        );
    }
    return [...weights].map(([addguesttype, addguestvalue]) => ({
      addguesttype,
      addguestvalue,
    }));
  }
  generate(at: number): void {
    this.business.queue = this.business.queue.filter(
      (guest) =>
        at <=
        guest.starttime + (this.catalog.customer(guest.customertype)?.WaitTime2 ?? 50),
    );
    if (
      this.business.queue.length >= this.level.MaxQSize ||
      !this.business.weights.length
    )
      return;
    const earliest = this.business.lastGeneratedAt + Math.max(1, this.level.Customer);
    if (at < earliest) return;
    const index = this.business.nextCustomerIndex++;
    const extra = this.extraWeights();
    const rows = this.business.weights.map((row) => ({
      ...row,
      Weight:
        row.Weight +
        (extra.find((entry) => entry.addguesttype === row.Id)?.addguestvalue ?? 0),
    }));
    const total = rows.reduce((sum, row) => sum + row.Weight, 0);
    let value =
      unit(`customer:${this.player.roleId}:${index}:${this.business.weightDay}`) *
      total;
    let id = rows.at(-1)!.Id;
    for (const row of rows) {
      value -= row.Weight;
      if (value < 0) {
        id = row.Id;
        break;
      }
    }
    this.business.queue.push({
      customertype: id,
      customeridx: index,
      starttime: Math.max(earliest, at),
    });
    this.business.lastGeneratedAt = at;
  }
  seatGuest(at: number): CafeSeatState | null {
    const seat = this.business.seats.find((seat) => !seat.customeridx);
    const guest = this.business.queue[0];
    if (!seat || !guest || !this.stock().length || guest.starttime > at) return null;
    const customer = this.catalog.customer(guest.customertype)!;
    const stock = this.stock();
    const coffee =
      stock.find(
        (entry) =>
          this.catalog.coffee(entry.coffeetype)![customer.Prefer] >=
          customer.Preferfactor,
      ) ?? stock[0]!;
    this.player.cafe.coffees.find(
      (entry) => entry.coffeetype === coffee.coffeetype,
    )!.count -= 1;
    if (!this.business.seats.some((entry) => entry.customeridx)) {
      for (const assignment of this.player.cafe.roomGirlsList?.[0] ?? []) {
        const key = String(assignment.girlId);
        this.business.moodAt[key] = at - (this.business.moodCarry[key] ?? 0);
        this.business.moodCarry[key] = 0;
        this.player.taskValues[String((41 << 16) | (10_000 + assignment.girlId))] =
          this.business.moodAt[key]!;
      }
    }
    Object.assign(seat, {
      customeridx: guest.customeridx,
      customertype: guest.customertype,
      coffeetype: coffee.coffeetype,
      starttime: at,
      draintime: 0,
    });
    this.business.queue.shift();
    return seat;
  }
  staffBonus(kind: string, guestId: number): number {
    let bonus = 0;
    for (const assignment of this.player.cafe.roomGirlsList?.[0] ?? []) {
      const girl = this.player.girls.find((girl) => girl.girlId === assignment.girlId);
      const config = this.catalog.staff(assignment.girlId);
      if (!girl || girl.vigor <= 0 || !config) continue;
      if (config.AttriType === kind) bonus += config.AttriNum;
      if (config.GuestId.includes(guestId) && config.AttriGuestType === kind)
        bonus += config.AttriPlus;
    }
    return bonus;
  }
  settle(customeridx: number, at: number): CafeSaleReceipt {
    const previous = this.business.receipts[String(customeridx)];
    if (previous) return previous;
    const seat = this.business.seats.find((seat) => seat.customeridx === customeridx);
    if (!seat || !seat.coffeetype || !seat.customertype || seat.starttime === undefined)
      throw new CafeOperationError("customer_not_seated", 116, { error: 1 });
    const coffee = this.catalog.coffee(seat.coffeetype)!;
    if (
      at <
      seat.starttime +
        (seat.draintime && seat.draintime > 0 ? seat.draintime : coffee.Time)
    )
      throw new CafeOperationError("customer_still_drinking", 116, {
        error: -1,
        adjustguest: { ...seat },
      });
    const guest = this.catalog.customer(seat.customertype)!;
    const good = coffee[guest.Prefer] >= guest.Preferfactor;
    const comfort = this.catalog.comfort(cafeComfort(this.player, this.catalog));
    const rates = [
      comfort.AddEarn_Coin + this.staffBonus("AddCoin", guest.Id),
      comfort.AddEarn_Coffee + this.staffBonus("AddCoffeeCoin", guest.Id),
      this.staffBonus("AddHot", guest.Id),
    ];
    // UI_CoffeeList493–507 predicts coffee coins/popularity only for guests
    // whose preferred property reaches the configured good-review threshold.
    const raw = [
      coffee.AwardA || coffee.Price,
      good ? coffee.AwardB : 0,
      good ? coffee.AwardC : 0,
    ];
    const base = raw.map((value, index) => {
      const precise =
        value * (1 + rates[index]! / 100) + this.business.fraction[index]!;
      const result = Math.floor(precise);
      this.business.fraction[index] = precise - result;
      return result;
    }) as [number, number, number];
    const chances = [
      coffee.RateA + (good ? guest.Rate1 : 0),
      coffee.RateB + (good ? guest.Rate2 : 0),
      coffee.RateC + (good ? guest.Rate3 : 0),
    ];
    const extra = base.map((value, index) =>
      unit(`tip:${this.player.roleId}:${customeridx}:${index}`) * 100 < chances[index]!
        ? value
        : 0,
    ) as [number, number, number];
    const day = dayAt(at);
    if (this.business.daily.day !== day)
      this.business.daily = { day, gold: 0, coffeecoin: 0, hot: 0 };
    const wallet = this.player.money.find((money) => money.id === 7)?.count ?? 0;
    const limits = [
      Math.max(0, this.level.DailyLmtGold - this.business.daily.gold),
      Math.max(
        0,
        Math.min(
          this.level.DailyLmtCoffeeCoin - this.business.daily.coffeecoin,
          this.level.CoffeeCoinMax - wallet,
        ),
      ),
      Math.max(0, this.level.TotalHot - this.business.hot),
    ];
    for (let index = 0; index < 3; index++) {
      base[index] = Math.min(base[index]!, limits[index]!);
      extra[index] = Math.min(extra[index]!, limits[index]! - base[index]!);
    }
    const total = base.map((value, index) => value + extra[index]!) as [
      number,
      number,
      number,
    ];
    this.hooks.grant([
      [15, 1, 1, 1, total[0]],
      [15, 10, 1, 1, total[1]],
    ]);
    this.business.hot += total[2];
    this.business.daily.gold += total[0];
    this.business.daily.coffeecoin += total[1];
    this.business.daily.hot += total[2];
    for (let index = 0; index < 3; index++) {
      const key = taskKey(guest.Id * 10 + index),
        prior = this.player.taskValues[key] ?? 0;
      this.player.taskValues[key] =
        ((prior % 1_000 === day % 1_000 ? Math.floor(prior / 1_000) : 0) +
          total[index]!) *
          1_000 +
        (day % 1_000);
    }
    const report = this.business.report;
    for (const [index, name] of ["gold", "coffeecoin", "hot"].entries()) {
      report.earnings[name as keyof typeof report.earnings] += base[index]!;
      report.earnings_ex[name as keyof typeof report.earnings_ex] += extra[index]!;
    }
    report.outlist[String(coffee.Id)] = (report.outlist[String(coffee.Id)] ?? 0) + 1;
    this.hooks.coffeeSold?.(coffee.Id, 1);
    const receipt: CafeSaleReceipt = {
      error: 0,
      customeridx,
      earn_base: base,
      earn_ex: extra,
      hot: this.business.hot,
    };
    this.business.receipts[String(customeridx)] = receipt;
    const ids = Object.keys(this.business.receipts);
    if (ids.length > 512)
      for (const id of ids.slice(0, ids.length - 512))
        delete this.business.receipts[id];
    this.reconcileMood(at);
    delete seat.customeridx;
    delete seat.customertype;
    delete seat.coffeetype;
    delete seat.starttime;
    delete seat.draintime;
    if (!this.business.seats.some((entry) => entry.customeridx)) {
      for (const assignment of this.player.cafe.roomGirlsList?.[0] ?? []) {
        const key = String(assignment.girlId);
        this.business.moodCarry[key] = Math.max(
          0,
          at - (this.business.moodAt[key] ?? at),
        );
        this.business.moodAt[key] = at;
      }
    }
    return receipt;
  }
  reconcileMood(at: number): void {
    const work = this.player.cafe.roomGirlsList?.[0] ?? [];
    const rest = [
      ...(this.player.cafe.roomGirlsList?.[1] ?? []),
      ...(this.player.cafe.roomGirlsList?.[2] ?? []),
    ];
    const comfort = this.catalog.comfort(cafeComfort(this.player, this.catalog));
    for (const girl of this.player.girls) {
      const mode = work.some((row) => row.girlId === girl.girlId)
        ? "work"
        : rest.some((row) => row.girlId === girl.girlId)
          ? "rest"
          : "none";
      const key = String(girl.girlId),
        before = this.business.moodAt[key];
      if (before === undefined) {
        this.business.moodAt[key] = at;
        if (mode !== "none")
          this.player.taskValues[
            String((41 << 16) | (mode === "work" ? 10_000 + girl.girlId : girl.girlId))
          ] = at;
        continue;
      }
      if (mode === "none" || this.hooks.isTraining?.(girl.girlId)) continue;
      const rate =
        mode === "work"
          ? this.level.ReduceVigor
          : this.level.AddVigor + comfort.AddVigor;
      if (
        rate <= 0 ||
        at <= before ||
        (mode === "work" && !this.business.seats.some((seat) => seat.customeridx))
      )
        continue;
      if (
        (mode === "rest" && girl.vigor >= 100) ||
        (mode === "work" && girl.vigor <= 0)
      )
        continue;
      const change = Math.floor(((at - before) * rate) / 3_600);
      if (change <= 0) continue;
      const next = Math.max(
        0,
        Math.min(100, girl.vigor + (mode === "work" ? -change : change)),
      );
      this.business.moodAt[key] = before + Math.floor((change * 3_600) / rate);
      this.player.taskValues[
        String((41 << 16) | (mode === "work" ? 10_000 + girl.girlId : girl.girlId))
      ] = this.business.moodAt[key]!;
      if (next !== girl.vigor) {
        girl.vigor = next;
        this.hooks.updatedGirl(girl.girlId);
      }
    }
  }
  reconcileOffline(): void {
    // Advance only real stock and known uploaded dining positions; never invent
    // seats, customers, or earnings when no usable furniture/coffee exists.
    let at = Math.min(this.now, this.business.lastGeneratedAt);
    let safety = 0;
    while (
      this.business.seats.length &&
      (this.stock().length || this.business.seats.some((seat) => seat.customeridx)) &&
      safety++ < 100_000
    ) {
      const ends = this.business.seats
        .filter((seat) => seat.customeridx && seat.coffeetype)
        .map(
          (seat) =>
            seat.starttime! +
            (seat.draintime && seat.draintime > 0
              ? seat.draintime
              : this.catalog.coffee(seat.coffeetype!)!.Time),
        );
      const canSeat =
        this.business.seats.some((seat) => !seat.customeridx) &&
        this.stock().length > 0;
      const nextArrival = canSeat
        ? (this.business.queue[0]?.starttime ??
          this.business.lastGeneratedAt + Math.max(1, this.level.Customer))
        : Number.POSITIVE_INFINITY;
      const next = Math.min(...ends, nextArrival);
      if (!Number.isFinite(next) || next > this.now) break;
      at = Math.max(at, next);
      this.reconcileMood(at);
      for (const seat of this.business.seats.filter(
        (seat) =>
          seat.customeridx &&
          seat.coffeetype &&
          seat.starttime! +
            (seat.draintime && seat.draintime > 0
              ? seat.draintime
              : this.catalog.coffee(seat.coffeetype!)!.Time) <=
            at,
      ))
        this.settle(seat.customeridx!, at);
      if (canSeat) {
        this.generate(at);
        this.seatGuest(at);
      }
    }
    this.reconcileMood(this.now);
  }
  download(): unknown {
    return {
      basetime: this.now,
      level: this.player.cafe.level ?? 1,
      hot: this.business.hot,
      comfort: cafeComfort(this.player, this.catalog),
      seatlist: structuredClone(this.business.seats),
      customerqueue: structuredClone(this.business.queue),
      coffeelist: this.stock(),
      roomgirlslist: cafeRoomGirls(this.player),
      weightlist: structuredClone(this.business.weights),
      visitedList: [],
      ...cafePetDownload(this.player),
    };
  }
  clearReport(): void {
    if (Object.keys(this.business.report.outlist).length) {
      this.notifications.push({
        command: 122,
        parameters: structuredClone(this.business.report),
      });
      this.business.report = emptyReport();
    }
  }
  operate(command: number, parameters: unknown): CafeRuntimeResult {
    const request = params(parameters);
    let response: unknown = {};
    switch (command) {
      case 111: {
        const next = this.catalog.level(this.level.Level + 1);
        if (
          !next ||
          this.player.level < next.NeedLevel ||
          this.business.hot < next.NeedHot
        )
          throw new CafeOperationError("level_requirements", command);
        this.hooks.chargeMoney(2, next.NeedGold);
        this.business.hot -= next.NeedHot;
        this.player.cafe.level = next.Level;
        this.hooks.grant(next.LevelAwards);
        this.business.weightDay = -1;
        this.refreshWeights();
        response = {
          level: next.Level,
          hot: this.business.hot,
          comfort: cafeComfort(this.player, this.catalog),
        };
        break;
      }
      case 112:
        this.clearReport();
        response = this.download();
        break;
      case 114: {
        if (!Array.isArray(request.seatlist))
          throw new CafeOperationError("invalid_seat_list", command);
        const ids = new Set<number>();
        const next: CafeSeatState[] = [];
        for (const value of request.seatlist) {
          const seat = params(value),
            position = seat.position;
          if (
            !positive(position) ||
            ids.has(position) ||
            !validCafeSeat(this.player, position, this.catalog)
          )
            throw new CafeOperationError("invalid_seat", command);
          ids.add(position);
          next.push(
            this.business.seats.find((row) => row.position === position) ?? {
              position,
            },
          );
        }
        if (next.length > this.level.SlotEat)
          throw new CafeOperationError("seat_capacity", command);
        // The client uploads its physical seat positions, never trusted sale IDs/times.
        if (!this.business.seats.length && next.length)
          this.business.lastGeneratedAt = this.now;
        this.business.seats = next;
        break;
      }
      case 115:
        this.generate(this.now);
        response = {
          basetime: this.now,
          customerqueue: structuredClone(this.business.queue),
        };
        break;
      case 116:
        if (!positive(request.customeridx))
          throw new CafeOperationError("invalid_customer", command, { error: 1 });
        response = this.settle(request.customeridx, this.now);
        break;
      case 117: {
        this.generate(this.now);
        const guest = this.seatGuest(this.now);
        response = {
          ...(guest ? { newguest: { ...guest } } : {}),
          seatlist: structuredClone(this.business.seats),
          customerqueue: structuredClone(this.business.queue),
          coffeelist: this.stock(),
        };
        break;
      }
      case 118: {
        if (!positive(request.coffeetype) || !this.catalog.coffee(request.coffeetype))
          throw new CafeOperationError("invalid_coffee", command);
        this.player.cafe.coffees = this.player.cafe.coffees.filter(
          (row) => row.coffeetype !== request.coffeetype,
        );
        response = { coffeelist: this.stock() };
        break;
      }
      case 119: {
        if (
          !this.stock().length &&
          !this.business.seats.some((seat) => seat.customeridx)
        )
          this.business.lastGeneratedAt = this.now;
        const batches = Array.isArray(parameters) ? parameters : [request];
        const seen = new Set<number>();
        for (const value of batches) {
          const row = params(value);
          if (
            !positive(row.coffeetype) ||
            !positive(row.count) ||
            seen.has(row.coffeetype)
          )
            throw new CafeOperationError("invalid_coffee_batch", command);
          seen.add(row.coffeetype);
          const config = this.catalog.coffee(row.coffeetype);
          if (!config || !this.learned(config.Id))
            throw new CafeOperationError("coffee_not_learned", command);
          const existing = this.player.cafe.coffees.find(
            (coffee) => coffee.coffeetype === config.Id,
          );
          if ((existing?.count ?? 0) + row.count > this.level.MaxCoffee)
            throw new CafeOperationError("coffee_capacity", command);
          if (
            (!existing || existing.count <= 0) &&
            this.stock().length >= this.level.SlotCoffee
          )
            throw new CafeOperationError("coffee_slot_capacity", command);
          this.hooks.chargeMoney(2, config.Cost * row.count);
          if (existing) existing.count += row.count;
          else
            this.player.cafe.coffees.push({ coffeetype: config.Id, count: row.count });
          this.player.taskValues[taskKey(config.Id)] =
            (this.player.taskValues[taskKey(config.Id)] ?? 0) | 65_536;
        }
        response = { coffeelist: this.stock() };
        break;
      }
      case 120: {
        if (!positive(request.Id))
          throw new CafeOperationError("invalid_coffee", command);
        const coffee = this.catalog.coffee(request.Id);
        if (!coffee) throw new CafeOperationError("invalid_coffee", command);
        if (this.learned(coffee.Id)) break;
        const value = this.player.taskValues[taskKey(coffee.Id)] ?? 0;
        if (
          (coffee.Cond1.length && !(value & 1)) ||
          (coffee.Cond2.length && !(value & 2)) ||
          (coffee.Cond3 && !(value & 4)) ||
          this.player.level < coffee.Level ||
          (coffee.PrevCoffee && !this.learned(coffee.PrevCoffee))
        )
          throw new CafeOperationError("coffee_learning_requirements", command);
        const used = this.player.taskValues[taskKey(1002)] ?? 0;
        if (
          used + coffee.LearnCostPoint >
          this.catalog.playerCoffeePoints(this.player.level)
        )
          throw new CafeOperationError("coffee_skill_points", command);
        this.hooks.chargeMoney(2, coffee.LearnCostCash);
        if (coffee.UnlockCostItem.length === 5)
          this.hooks.consumeItem(coffee.UnlockCostItem, coffee.UnlockCostItem[4]!);
        this.player.taskValues[taskKey(coffee.Id)] = value | 256;
        this.player.taskValues[taskKey(1002)] = used + coffee.LearnCostPoint;
        this.business.weightDay = -1;
        this.refreshWeights();
        break;
      }
      case 121: {
        const count = this.player.taskValues[taskKey(1003)] ?? 0;
        this.hooks.chargeMoney(3, this.catalog.resetCost(count + 1));
        for (const coffee of this.catalog.coffees())
          this.player.taskValues[taskKey(coffee.Id)] =
            (this.player.taskValues[taskKey(coffee.Id)] ?? 0) & ~256;
        for (const id of [1, 2, 3, 4])
          this.player.taskValues[taskKey(id)] =
            (this.player.taskValues[taskKey(id)] ?? 0) | 256;
        this.player.taskValues[taskKey(1002)] = 0;
        this.player.taskValues[taskKey(1003)] = count + 1;
        this.business.weightDay = -1;
        this.refreshWeights();
        break;
      }
      case 240:
        if (
          !Array.isArray(request.girlid) ||
          new Set(request.girlid).size !== request.girlid.length ||
          request.girlid.some(
            (id) =>
              !positive(id) || !this.player.girls.some((girl) => girl.girlId === id),
          )
        )
          throw new CafeOperationError("invalid_vigor_girls", command);
        break;
      case 123:
        break; // Client clock is advisory; authoritative server time is never replaced.
      case 124:
        response = this.extraWeights();
        break;
      case 125:
        this.clearReport();
        break;
      case 135: {
        const config = this.catalog.level(10_001);
        if (
          this.level.Level < this.catalog.maxLevel ||
          !config ||
          this.business.hot < config.NeedHot
        )
          throw new CafeOperationError("popularity_reward_requirements", command);
        this.business.hot -= config.NeedHot;
        this.hooks.grant(config.LevelAwards);
        response = { hot: this.business.hot };
        break;
      }
      case 138: {
        if (
          !Array.isArray(parameters) ||
          parameters.length !== 5 ||
          parameters.some(
            (value) => !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff,
          )
        )
          throw new CafeOperationError("invalid_music", command);
        const [id, nG, nD, nP, nL] = parameters as [
          number,
          number,
          number,
          number,
          number,
        ];
        if (parameters.some((value) => value !== 0)) {
          const entry = this.catalog
            .musicEntries()
            .find(
              (entry) =>
                entry.Extension1 === id &&
                entry.G === nG &&
                entry.D === nD &&
                entry.P === nP &&
                entry.L === nL,
            );
          if (
            !entry ||
            (entry.IsIgnoreLock <= 0 &&
              this.player.taskValues[String((53 << 16) | entry.Id)] !== 1)
          )
            throw new CafeOperationError("music_not_owned", command);
        }
        this.player.cafe.music = { id, nG, nD, nP, nL };
        this.business.music = id;
        response = {};
        break;
      }
      default:
        throw new CafeOperationError("unsupported_cafe_command", command);
    }
    return { response, notifications: this.notifications };
  }
}
