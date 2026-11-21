import { readFileSync } from "node:fs";
import path from "node:path";

export interface CharacterCardTemplate {
  genre: number;
  detail: number;
  particular: number;
  templateLevel: number;
  rarity: number;
  weaponType: number;
  breakType: number;
  attributeType: number;
  expType: number;
  /** TacticalSkill, PassiveSkill1, PassiveSkill2, ResistanceSkill; 0 = no skill. */
  skillIds: readonly [number, number, number, number];
}

export interface CharacterCardReference {
  genre: number;
  detail: number;
  particular: number;
  templateLevel: number;
}

const COLUMNS = [
  "Genre",
  "Detail",
  "Particular",
  "Level",
  "Rarity",
  "WeaponType",
  "BreakType",
  "AttributeType",
  "ExpType",
  "TacticalSkill",
  "PassiveSkill1",
  "PassiveSkill2",
  "ResistanceSkill",
] as const;

function templateKey(
  genre: number,
  detail: number,
  particular: number,
  templateLevel: number,
): string {
  return `${genre}:${detail}:${particular}:${templateLevel}`;
}

/** The CharacterCard rows of setting.u that card enhancement and break need. */
export class CharacterCardCatalog {
  readonly #templates = new Map<string, CharacterCardTemplate>();
  private constructor() {}

  static load(text: string): CharacterCardCatalog {
    const result = new CharacterCardCatalog();
    const lines = text.split(/\r?\n/);
    const header = (lines[0] ?? "").split("\t");
    if (COLUMNS.some((name, index) => header[index] !== name))
      throw new Error("Invalid character card table header");
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const values = line.split("\t").map(Number);
      if (
        values.length !== COLUMNS.length ||
        values.some((value) => !Number.isSafeInteger(value) || value < 0)
      )
        throw new Error("Invalid character card row");
      const [
        genre,
        detail,
        particular,
        templateLevel,
        rarity,
        weaponType,
        breakType,
        attributeType,
        expType,
        tactical,
        passive1,
        passive2,
        resistance,
      ] = values as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const key = templateKey(genre, detail, particular, templateLevel);
      if (result.#templates.has(key)) throw new Error("Duplicate character card row");
      result.#templates.set(key, {
        genre,
        detail,
        particular,
        templateLevel,
        rarity,
        weaponType,
        breakType,
        attributeType,
        expType,
        skillIds: [tactical, passive1, passive2, resistance],
      });
    }
    return result;
  }

  static loadDefault(): CharacterCardCatalog {
    return (defaultCatalog ??= CharacterCardCatalog.load(
      readFileSync(path.resolve("resources/card/charactercard.txt"), "utf8"),
    ));
  }

  get(card: CharacterCardReference): CharacterCardTemplate | null {
    return (
      this.#templates.get(
        templateKey(card.genre, card.detail, card.particular, card.templateLevel),
      ) ?? null
    );
  }
}
let defaultCatalog: CharacterCardCatalog | null = null;
