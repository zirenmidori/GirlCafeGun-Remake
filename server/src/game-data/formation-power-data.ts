import { GachaCatalog, type Gdpl } from "./gacha-data.js";
import { weaponRarityOf } from "./weapon-skill-data.js";
import { runeTemplateCatalog } from "./rune-data.js";
import { cardRarityOf } from "./custom-card-data.js";

export interface FormationPowerItem {
  guid: number;
  genre: number;
  detail: number;
  particular: number;
  templateLevel: number;
  enhanceLevel: number;
  breakLevel: number;
}

export interface FormationPowerPlayer {
  inventory: readonly FormationPowerItem[];
  formations: readonly {
    fightCards: readonly {
      mainCardGuid: number;
      secondaryCardGuids: readonly number[];
      weaponGuid: number;
      runeItemGuids: readonly number[];
    }[];
  }[];
}

const RARITY_WEIGHT = [0, 0.9, 1, 1.08, 1.1664] as const;
const RUNE_RARITY_WEIGHT = [0, 0.85, 1, 1.25, 1.56] as const;
const CARD_RARITY_BASE = 395.7;
const WEAPON_RARITY_BASE = 395.7;
const DEPUTY_RARITY_BASE = 395.7;
const RUNE_RARITY_BASE = -0.0857;

let cardCatalog: GachaCatalog | null = null;
let weaponCatalog: GachaCatalog | null = null;

function catalogs(): {
  cards: GachaCatalog;
  weapons: GachaCatalog;
} {
  cardCatalog ??= GachaCatalog.loadDefault();
  weaponCatalog ??= GachaCatalog.loadDefault(0);
  return { cards: cardCatalog, weapons: weaponCatalog };
}

function gdpl(item: FormationPowerItem): Gdpl {
  return [item.genre, item.detail, item.particular, item.templateLevel];
}

function normalizedRarity(item: FormationPowerItem): number {
  const { cards, weapons } = catalogs();
  const configured =
    item.genre === 1
      ? cardRarityOf(gdpl(item), (value) => cards.rarityOf(value))
      : item.genre === 2
        ? weaponRarityOf(gdpl(item), (value) => weapons.rarityOf(value))
        : item.genre === 3
          ? runeTemplateCatalog().templateOf(item)?.rarity
          : null;
  // The client has four combat-power rarity coefficients. Some late gacha
  // tables label four-star cards as rarity 5, so they use the fourth weight.
  return Math.max(1, Math.min(4, configured ?? Math.max(1, item.templateLevel)));
}

function polynomial(level: number, rarityBase: number): number {
  return rarityBase + 10.192 * level - 0.0168 * level ** 2 + 0.0005 * level ** 3;
}

function cardPower(item: FormationPowerItem, role: "main" | "deputy"): number {
  const rarity = normalizedRarity(item);
  const base = role === "main" ? CARD_RARITY_BASE : DEPUTY_RARITY_BASE;
  const roleWeight = role === "main" ? 1.875 : 0.675;
  return (
    (polynomial(item.enhanceLevel, base) + item.breakLevel * 20) *
    roleWeight *
    RARITY_WEIGHT[rarity]!
  );
}

function weaponPower(item: FormationPowerItem): number {
  const rarity = normalizedRarity(item);
  return (
    (polynomial(item.enhanceLevel, WEAPON_RARITY_BASE) + item.breakLevel * 8) *
    0.675 *
    RARITY_WEIGHT[rarity]!
  );
}

function runePower(item: FormationPowerItem): number {
  const rarity = normalizedRarity(item);
  return (
    (RUNE_RARITY_BASE + 10.411 * item.enhanceLevel) *
      0.47 *
      RUNE_RARITY_WEIGHT[rarity]! +
    item.breakLevel * 28.63
  );
}

function rounded(value: number): number {
  return Math.floor(value + 0.5);
}

/**
 * Mirrors the client FormationCommon.ComputePowerValue formula for every
 * combat component represented by the offline save. Weapon calibration parts,
 * card refits and sync bonuses are not persisted yet, so this is deliberately
 * a conservative value when those systems are added later.
 */
export function maximumFormationPower(player: FormationPowerPlayer): number {
  const inventory = new Map(player.inventory.map((item) => [item.guid, item]));
  let maximum = 0;

  for (const formation of player.formations) {
    let total = 0;
    for (const fightCard of formation.fightCards) {
      const main = inventory.get(fightCard.mainCardGuid);
      if (!main || main.genre !== 1) continue;

      let groupPower = cardPower(main, "main");
      const weapon = inventory.get(fightCard.weaponGuid);
      if (weapon?.genre === 2) {
        groupPower += weaponPower(weapon);
      }
      for (const guid of fightCard.secondaryCardGuids.slice(0, 3)) {
        const deputy = inventory.get(guid);
        if (deputy?.genre === 1) groupPower += cardPower(deputy, "deputy");
      }
      for (const guid of fightCard.runeItemGuids.slice(0, 4)) {
        const rune = inventory.get(guid);
        if (rune) groupPower += runePower(rune);
      }
      total += rounded(groupPower);
    }
    maximum = Math.max(maximum, total);
  }

  return maximum;
}
