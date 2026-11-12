import { describe, expect, it } from "vitest";

import {
  WeaponTemplateCatalog,
  weaponPassiveSkills,
} from "../src/game-data/weapon-skill-data.js";
import { makeItemUpdateNotification } from "../src/protocol/messages.js";
import { decodeFields } from "../src/protocol/protobuf.js";
import type { InventoryEntryState } from "../src/persistence/player-repository.js";

describe("weapon template catalog", () => {
  const catalog = WeaponTemplateCatalog.loadDefault();

  it("loads all rows from the bundled client table", () => {
    expect(catalog.size).toBe(141);
  });

  it("resolves the 群星道标 template with 星之所向 (40239)", () => {
    expect(catalog.templateOf(2, 1, 3, 1)).toEqual({
      rarity: 4,
      passiveSkill1: 40239,
      passiveSkill2: 0,
    });
  });

  it("rejects malformed rows", () => {
    expect(() => WeaponTemplateCatalog.load("a\nb\nc\n2\t1\t3\n")).toThrow(
      /Malformed weapon template row/,
    );
    expect(() =>
      WeaponTemplateCatalog.load("a\nb\nc\n2\t1\t3\t1\tx\t40239\t0\n"),
    ).toThrow(/Malformed weapon template row/);
  });
});

describe("weaponPassiveSkills", () => {
  const catalog = WeaponTemplateCatalog.loadDefault();

  it("maps template passive skills to skillinfo entries at break level + 1", () => {
    expect(weaponPassiveSkills(2, 1, 3, 1, 0, catalog)).toEqual([
      { skillId: 40239, skillLevel: 1, skillType: 2 },
    ]);
    expect(weaponPassiveSkills(2, 1, 3, 1, 3, catalog)).toEqual([
      { skillId: 40239, skillLevel: 4, skillType: 2 },
    ]);
  });

  it("includes both config passive skills when present", () => {
    let seen = 0;
    for (let particular = 1; particular <= 500 && seen === 0; particular += 1) {
      const template = catalog.templateOf(2, 1, particular, 1);
      if (template && template.passiveSkill1 > 0 && template.passiveSkill2 > 0) {
        seen = particular;
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(weaponPassiveSkills(2, 1, seen, 1, 0, catalog)).toHaveLength(2);
  });

  it.each([
    [2, 27, 40421],
    [4, 26, 40424],
  ])(
    "projects recovered weapon %i/%i passive skill %i",
    (detail, particular, skillId) => {
      expect(weaponPassiveSkills(2, detail, particular, 1, 4, catalog)).toEqual([
        { skillId, skillLevel: 5, skillType: 2 },
      ]);
    },
  );

  it("returns no skills for non-weapons and skill-less templates", () => {
    expect(weaponPassiveSkills(1, 1, 1, 1, 0, catalog)).toEqual([]);
    expect(weaponPassiveSkills(2, 1, 2, 2, 0, catalog)).toEqual([]);
    expect(weaponPassiveSkills(2, 999, 999, 9, 0, catalog)).toEqual([]);
  });
});

describe("makeItemUpdateNotification skillinfo", () => {
  function weapon(overrides: Partial<InventoryEntryState> = {}): InventoryEntryState {
    return {
      guid: 1,
      genre: 2,
      detail: 1,
      particular: 3,
      templateLevel: 1,
      count: 1,
      createTime: 0,
      enhanceLevel: 1,
      enhanceExp: 0,
      breakLevel: 0,
      lockOn: 0,
      ...overrides,
    };
  }

  it("serializes skillinfo as proto field 11 with MiniSkill entries", () => {
    const fields = decodeFields(makeItemUpdateNotification([weapon()]));
    const item = fields.find(({ fieldNumber }) => fieldNumber === 1);
    expect(item).toBeDefined();
    const itemFields = decodeFields(item!.value as Buffer);
    const skills = itemFields.filter(({ fieldNumber }) => fieldNumber === 11);
    expect(skills).toHaveLength(1);
    const miniSkill = decodeFields(skills[0]!.value as Buffer);
    expect(miniSkill).toEqual([
      { fieldNumber: 1, wireType: 0, value: 40239n },
      { fieldNumber: 2, wireType: 0, value: 1n },
      { fieldNumber: 3, wireType: 0, value: 2n },
    ]);
    expect(itemFields.some(({ fieldNumber }) => fieldNumber === 13)).toBe(true);
  });

  it("omits skillinfo for items without config passive skills", () => {
    const fields = decodeFields(
      makeItemUpdateNotification([weapon({ particular: 2, templateLevel: 2 })]),
    );
    const itemFields = decodeFields(
      fields.find(({ fieldNumber }) => fieldNumber === 1)!.value as Buffer,
    );
    expect(itemFields.some(({ fieldNumber }) => fieldNumber === 11)).toBe(false);
  });
});
