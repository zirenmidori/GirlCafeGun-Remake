import { describe, expect, it } from "vitest";

import {
  RuneTemplateCatalog,
  runeTemplateCatalog,
} from "../src/game-data/rune-data.js";
import { parseFormationUpdateCall } from "../src/servers/gateway-server.js";

describe("rune template catalog", () => {
  const catalog = runeTemplateCatalog();

  it("loads all 80 templates extracted from FileRuneTemplateInfo", () => {
    expect(catalog.size).toBe(80);
  });

  it("resolves unenhanced main stats and faction", () => {
    expect(
      catalog.templateOf({
        genre: 3,
        detail: 1,
        particular: 4,
        templateLevel: 2,
      }),
    ).toEqual({
      rarity: 4,
      attributeType: 1,
      addHp: 0,
      defense: 0,
      attackDamage: 4,
      shield: 0,
    });
  });

  it("uses detail as the canonical formation slot", () => {
    const shield = {
      genre: 3,
      detail: 4,
      particular: 2,
      templateLevel: 5,
    };
    expect(catalog.acceptsSlot(shield, 3)).toBe(true);
    expect(catalog.acceptsSlot(shield, 1)).toBe(false);
  });

  it("rejects malformed tables", () => {
    expect(() => RuneTemplateCatalog.load("a\nb\nc\n3\t1\n")).toThrow(
      /Malformed rune template row/,
    );
  });
});

describe("formation rune slots", () => {
  it("preserves zero placeholders instead of compacting rune GUIDs", () => {
    const call = {
      method: "LuaCall",
      json: "",
      parameters: {
        sCmd: 22,
        tbParam: {
          Id: 1,
          Info: [
            {
              MainCard: 10_001,
              Secondarycard: [],
              UsedCard: 0,
              WeaponId: 0,
              Rune: [20_478, 0, 0, 20_483],
            },
          ],
        },
      },
    };
    expect(parseFormationUpdateCall(call, null)?.formation.fightCards[0]).toMatchObject(
      { runeItemGuids: [20_478, 0, 0, 20_483] },
    );
  });
});
