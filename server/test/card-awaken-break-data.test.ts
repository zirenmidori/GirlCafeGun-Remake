import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CardBreakCatalog,
  cardMaximumLevel,
  parseCardBreakRequest,
} from "../src/game-data/card-break-data.js";
import { characterCardFeedValue } from "../src/game-data/card-decomposition-data.js";
import {
  addCardExperience,
  CARD_MAXIMUM_ENHANCE_LEVEL,
  CARD_SKILL_MATERIALS,
} from "../src/game-data/card-enhancement-data.js";
import {
  applyCardSkillPoints,
  characterCardSkills,
  cardSkillFeedPoints,
  cardSkillPointsRemaining,
} from "../src/game-data/card-skill-data.js";
import { CharacterCardCatalog } from "../src/game-data/character-card-template-data.js";
import type { InventoryEntryState } from "../src/persistence/player-repository.js";

function card(
  detail: number,
  particular: number,
  templateLevel: number,
  cardSkillLevels?: [number, number, number, number],
): InventoryEntryState {
  return {
    guid: 1,
    genre: 1,
    detail,
    particular,
    templateLevel,
    count: 1,
    createTime: 1,
    enhanceLevel: 1,
    enhanceExp: 0,
    breakLevel: 0,
    lockOn: 0,
    ...(cardSkillLevels ? { cardSkillLevels } : {}),
  };
}

describe("card resources", () => {
  it("keep the files recorded in provenance.json", () => {
    const root = path.resolve(process.cwd(), "resources/card");
    const provenance = JSON.parse(
      readFileSync(path.join(root, "provenance.json"), "utf8"),
    ) as {
      files: Record<
        string,
        { sha256: string; bytes: number; projection: { sourceRows: number } }
      >;
    };
    expect(Object.keys(provenance.files).sort()).toEqual([
      "charactercard.txt",
      "charactercardbreak.txt",
    ]);
    for (const [name, expected] of Object.entries(provenance.files)) {
      const bytes = readFileSync(path.join(root, name));
      expect(bytes.length).toBe(expected.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected.sha256);
    }
    expect(provenance.files["charactercardbreak.txt"]!.sha256).toBe(
      "c57fa738c9b93ac639dd6c9f87551c9be1e10df633195c6007a4d91a785e6c38",
    );
    expect(provenance.files["charactercard.txt"]!.projection.sourceRows).toBe(296);
  });
});

describe("character card templates", () => {
  const cards = CharacterCardCatalog.loadDefault();

  it("caches the parsed table and reads rarity, break type and skills", () => {
    expect(CharacterCardCatalog.loadDefault()).toBe(cards);
    expect(cards.get({ genre: 1, detail: 1, particular: 1, templateLevel: 1 })).toEqual(
      {
        genre: 1,
        detail: 1,
        particular: 1,
        templateLevel: 1,
        rarity: 1,
        weaponType: 1,
        breakType: 21,
        attributeType: 1,
        expType: 1,
        skillIds: [20026, 30262, 0, 38143],
      },
    );
    expect(
      cards.get({ genre: 1, detail: 999, particular: 1, templateLevel: 1 }),
    ).toBeNull();
  });
});

describe("card break table", () => {
  const breaks = CardBreakCatalog.loadDefault();

  it("reads every stage of the three-step rows", () => {
    expect(CardBreakCatalog.loadDefault()).toBe(breaks);
    expect(breaks.row(21)?.stages).toHaveLength(3);
    expect(breaks.stage(21, 1)).toEqual({
      breakLevel: 1,
      items: [
        { genre: 7, detail: 2, particular: 3, templateLevel: 1, count: 3 },
        { genre: 7, detail: 2, particular: 3, templateLevel: 2, count: 3 },
      ],
      currencyId: 2,
      currencyCount: 20_000,
      maximumLevel: 50,
    });
    expect(breaks.stage(21, 3)?.items).toHaveLength(4);
    expect(breaks.stage(21, 4)).toBeNull();
    expect(breaks.stage(21, 0)).toBeNull();
    expect(breaks.stage(999, 1)).toBeNull();
  });

  it("gives the level cap of each break step and the global cap without a row", () => {
    expect([0, 1, 2, 3].map((step) => cardMaximumLevel(21, step))).toEqual([
      40, 50, 60, 70,
    ]);
    expect(cardMaximumLevel(999, 0)).toBe(CARD_MAXIMUM_ENHANCE_LEVEL);
    expect(CARD_MAXIMUM_ENHANCE_LEVEL).toBe(70);
  });

  it("parses the client request", () => {
    expect(parseCardBreakRequest({ sCmd: 6, tbParam: { guid: 12 } })).toEqual({
      guid: 12,
    });
    expect(parseCardBreakRequest({ guid: 12 })).toEqual({ guid: 12 });
    expect(parseCardBreakRequest({ tbParam: { guid: 0 } })).toBeNull();
    expect(parseCardBreakRequest(null)).toBeNull();
  });
});

describe("card level cap", () => {
  it("stops at the cap and keeps leftover experience", () => {
    const capped = addCardExperience(39, 0, 1_000_000, 40);
    expect(capped.level).toBe(40);
    expect(capped.experience).toBeGreaterThan(0);
  });

  it("never lowers a level above the cap and adds no experience", () => {
    expect(addCardExperience(50, 7, 1_000, 40)).toEqual({ level: 50, experience: 7 });
  });
});

describe("card skills", () => {
  const template = CharacterCardCatalog.loadDefault().get({
    genre: 1,
    detail: 1,
    particular: 1,
    templateLevel: 1,
  })!;

  it("prices a duplicate at 3 points plus the levels it already raised", () => {
    expect(cardSkillFeedPoints(card(1, 1, 1), template)).toBe(3);
    expect(cardSkillFeedPoints(card(1, 1, 1, [2, 3, 1, 4]), template)).toBe(
      3 + 1 + 2 + 3,
    );
  });

  it("counts only the skills below level 4 and skips an empty skill slot", () => {
    expect(cardSkillPointsRemaining(card(1, 1, 1), template)).toBe(9);
    expect(cardSkillPointsRemaining(card(1, 1, 1, [4, 4, 1, 4]), template)).toBe(0);
    expect(cardSkillPointsRemaining(card(1, 1, 1), null)).toBe(0);
  });

  it("raises skills below level 4 with the injected generator and wastes the excess", () => {
    const target = card(1, 1, 1);
    expect(applyCardSkillPoints(target, template, 4, () => 0)).toBe(4);
    expect(target.cardSkillLevels).toEqual([4, 2, 1, 1]);
    expect(applyCardSkillPoints(target, template, 100, () => 0.99)).toBe(5);
    expect(target.cardSkillLevels).toEqual([4, 4, 1, 4]);
  });

  it("sends MiniSkill levels for every normal card (1 when never raised), never for an oath card", () => {
    expect(characterCardSkills(card(1, 1, 1))).toEqual([
      { skillId: 20026, skillLevel: 1, skillType: 3 },
      { skillId: 30262, skillLevel: 1, skillType: 2 },
      { skillId: 38143, skillLevel: 1, skillType: 2 },
    ]);
    expect(characterCardSkills(card(1, 1, 1, [4, 2, 1, 3]))).toEqual([
      { skillId: 20026, skillLevel: 4, skillType: 3 },
      { skillId: 30262, skillLevel: 2, skillType: 2 },
      { skillId: 38143, skillLevel: 3, skillType: 2 },
    ]);
    expect(characterCardSkills(card(1, 17, 3, [4, 2, 1, 3]))).toEqual([]);
  });

  it("maps the two skill items after the 24 experience materials", () => {
    expect(CARD_SKILL_MATERIALS.get(25)).toMatchObject({
      genre: 7,
      detail: 4,
      particular: 1,
      templateLevel: 3,
    });
    expect(CARD_SKILL_MATERIALS.get(26)).toMatchObject({ templateLevel: 4 });
    expect(CARD_SKILL_MATERIALS.get(24)).toBeUndefined();
  });
});

describe("card as a material", () => {
  it("gives the rarity base plus 30 percent of the experience the card spent", () => {
    expect(characterCardFeedValue(1, 2)).toEqual({
      experience: 2_000,
      coinCost: 2_000,
    });
    expect(characterCardFeedValue(3, 1)).toEqual({
      experience: Math.floor(0.3 * (133 + 187)) + 500,
      coinCost: 500,
    });
    expect(characterCardFeedValue(1, 9)).toBeNull();
  });
});
