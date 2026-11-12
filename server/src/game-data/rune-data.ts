import { readFileSync } from "node:fs";
import path from "node:path";

export const RUNE_GENRE = 3;
export const RUNE_SLOT_COUNT = 4;

export interface RuneTemplate {
  rarity: number;
  attributeType: number;
  addHp: number;
  defense: number;
  attackDamage: number;
  shield: number;
}

export interface RuneGdpl {
  genre: number;
  detail: number;
  particular: number;
  templateLevel: number;
}

/**
 * Minimal projection of the client's `Item/Rune.txt`. In this client build the
 * table is shipped as `FileRuneTemplateInfo` in `setting.u`, not as a text
 * asset. The bundled TSV keeps the fields needed by the unenhanced-module
 * path: slot/detail, rarity, faction/AttributeType and level-1 main stats.
 */
export class RuneTemplateCatalog {
  #templates = new Map<string, RuneTemplate>();

  private constructor() {}

  static loadDefault(): RuneTemplateCatalog {
    const file = path.resolve(process.cwd(), "resources/rune/runes.txt");
    return RuneTemplateCatalog.load(readFileSync(file, "utf8"));
  }

  static load(contents: string): RuneTemplateCatalog {
    const catalog = new RuneTemplateCatalog();
    for (const line of contents.split(/\r?\n/).slice(3)) {
      if (!line.trim()) continue;
      const values = line.split("\t").map(Number);
      if (values.length !== 11 || !values.every(Number.isSafeInteger)) {
        throw new Error(`Malformed rune template row: ${line}`);
      }
      const [
        genre,
        detail,
        particular,
        level,
        rarity,
        attributeType,
        addHp,
        defense,
        attackDamage,
        shield,
      ] = values;
      if (
        genre !== RUNE_GENRE ||
        detail! < 1 ||
        detail! > RUNE_SLOT_COUNT ||
        particular! < 1 ||
        level! < 1
      ) {
        throw new Error(`Malformed rune template row: ${line}`);
      }
      catalog.#templates.set([genre, detail, particular, level].join(":"), {
        rarity: rarity!,
        attributeType: attributeType!,
        addHp: addHp!,
        defense: defense!,
        attackDamage: attackDamage!,
        shield: shield!,
      });
    }
    return catalog;
  }

  get size(): number {
    return this.#templates.size;
  }

  templateOf(item: RuneGdpl): RuneTemplate | null {
    return (
      this.#templates.get(
        [item.genre, item.detail, item.particular, item.templateLevel].join(":"),
      ) ?? null
    );
  }

  acceptsSlot(item: RuneGdpl, slotIndex: number): boolean {
    return (
      Number.isSafeInteger(slotIndex) &&
      slotIndex >= 0 &&
      slotIndex < RUNE_SLOT_COUNT &&
      this.templateOf(item) !== null &&
      item.detail === slotIndex + 1
    );
  }
}

let defaultCatalog: RuneTemplateCatalog | null = null;

export function runeTemplateCatalog(): RuneTemplateCatalog {
  defaultCatalog ??= RuneTemplateCatalog.loadDefault();
  return defaultCatalog;
}
