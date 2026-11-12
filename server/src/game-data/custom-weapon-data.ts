import { readFileSync } from "node:fs";
import path from "node:path";
import type { Gdpl } from "./gacha-data.js";
import { weaponTemplateCatalog } from "./weapon-skill-data.js";

export interface CustomWeaponTemplate {
  id: string;
  name: string;
  gdpl: Gdpl;
  donor: Gdpl;
  kind: "weapon";
  weaponType: number;
  rarity: number;
  expType: number;
  maxBreakLevel: number;
  maxLevel: number;
  passiveSkill1: number;
  passiveSkill2: number;
}
let cached: readonly CustomWeaponTemplate[] | undefined;
/** Explicit local extensions; never injected into any lottery pool. */
export function customWeaponTemplates(): readonly CustomWeaponTemplate[] {
  if (cached) return cached;
  const source = JSON.parse(
    readFileSync(path.resolve("resources/custom-weapons.json"), "utf8"),
  ) as { schemaVersion: number; weapons: CustomWeaponTemplate[] };
  if (source.schemaVersion !== 1 || !Array.isArray(source.weapons))
    throw new Error("Unrecognized custom weapon catalog");
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const entry of source.weapons) {
    if (
      !entry.id ||
      ids.has(entry.id) ||
      entry.kind !== "weapon" ||
      !Array.isArray(entry.gdpl) ||
      entry.gdpl.length !== 4 ||
      !entry.gdpl.every((n) => Number.isSafeInteger(n) && n > 0) ||
      entry.gdpl[0] !== 2 ||
      keys.has(entry.gdpl.join(":"))
    )
      throw new Error("Invalid custom weapon definition");
    const template = weaponTemplateCatalog().templateOf(...entry.gdpl);
    if (
      !template ||
      template.rarity !== entry.rarity ||
      template.passiveSkill1 !== entry.passiveSkill1 ||
      template.passiveSkill2 !== entry.passiveSkill2 ||
      entry.maxLevel !== 80 ||
      entry.maxBreakLevel !== 4
    )
      throw new Error("Custom weapon does not match the runtime catalog");
    ids.add(entry.id);
    keys.add(entry.gdpl.join(":"));
  }
  cached = source.weapons;
  return cached;
}
