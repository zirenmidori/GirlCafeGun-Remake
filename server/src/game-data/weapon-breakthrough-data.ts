import { readFileSync } from "node:fs";
import path from "node:path";
import type { InventoryEntryState } from "../persistence/player-repository.js";
import {
  parseWeaponEnhancementRequest,
  type WeaponEnhancementRequest,
} from "./weapon-enhancement-data.js";

export interface WeaponBreakthroughStage {
  rarity: number;
  breakLevel: number;
  materialCount: number;
  currencyId: number;
  currencyCount: number;
  maximumLevel: number;
}

/** Exact Item/WeaponBreak.txt stages, cached once rather than parsed per operation. */
export class WeaponBreakthroughCatalog {
  readonly #stages = new Map<string, WeaponBreakthroughStage>();
  private constructor() {}
  static load(text: string): WeaponBreakthroughCatalog {
    const result = new WeaponBreakthroughCatalog();
    for (const line of text.split(/\r?\n/).slice(3)) {
      if (!line.trim()) continue;
      const values = line.split("\t");
      const rarity = Number(values[0]);
      if (![1, 2, 3, 4].includes(rarity))
        throw new Error("Invalid weapon break rarity");
      for (let level = 1; level <= 4; level++) {
        const columns = values.slice(2 + (level - 1) * 4, 6 + (level - 1) * 4);
        if (columns.every((value) => !value?.trim())) continue;
        const [materialCount, currencyId, currencyCount, maximumLevel] =
          columns.map(Number);
        if (
          columns.length !== 4 ||
          ![materialCount, currencyId, currencyCount, maximumLevel].every(
            (n) => Number.isSafeInteger(n) && n! > 0,
          )
        )
          throw new Error("Invalid weapon break stage");
        const key = `${rarity}:${level}`;
        if (result.#stages.has(key)) throw new Error("Duplicate weapon break stage");
        result.#stages.set(key, {
          rarity,
          breakLevel: level,
          materialCount: materialCount!,
          currencyId: currencyId!,
          currencyCount: currencyCount!,
          maximumLevel: maximumLevel!,
        });
      }
    }
    return result;
  }
  static loadDefault(): WeaponBreakthroughCatalog {
    return (defaultCatalog ??= WeaponBreakthroughCatalog.load(
      readFileSync(path.resolve("resources/weapon/breakthrough.txt"), "utf8"),
    ));
  }
  stage(rarity: number, breakLevel: number): WeaponBreakthroughStage | null {
    return this.#stages.get(`${rarity}:${breakLevel}`) ?? null;
  }
}
let defaultCatalog: WeaponBreakthroughCatalog | null = null;

export function parseWeaponBreakthroughRequest(
  parameters: unknown,
): WeaponEnhancementRequest | null {
  const request = parseWeaponEnhancementRequest(parameters);
  if (
    !request ||
    request.materials.length === 0 ||
    request.materials.reduce((sum, item) => sum + item.count, 0) > 4
  )
    return null;
  return request;
}

/** UI_Updatebox + WeaponCommon.CheckSame / CheckCostWeapon. */
export function isWeaponBreakthroughMaterial(
  target: InventoryEntryState,
  donor: InventoryEntryState,
  rarity: number,
): boolean {
  if (donor.genre !== 2) return false;
  return (
    (target.genre === donor.genre &&
      target.detail === donor.detail &&
      target.particular === donor.particular &&
      target.templateLevel === donor.templateLevel) ||
    (donor.detail === 2 &&
      donor.particular === (rarity > 3 ? 10000 : 10001) &&
      donor.templateLevel === 1)
  );
}

export class WeaponBreakthroughError extends Error {
  constructor(
    readonly reason: string,
    readonly guid = 0,
  ) {
    super(`Weapon breakthrough rejected: ${reason}`);
    this.name = "WeaponBreakthroughError";
  }
}
