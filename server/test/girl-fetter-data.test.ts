import { describe, expect, it } from "vitest";

import { GirlFetterCatalog } from "../src/game-data/girl-fetter-data.js";

describe("girl fetter catalog", () => {
  it("parses all 16 girls with main and sub nodes", () => {
    const catalog = GirlFetterCatalog.loadDefault();
    expect(catalog.size).toBe(16);
    const nodes = catalog.nodes(1);
    expect(nodes.length).toBeGreaterThan(20);
    expect(nodes[0]).toMatchObject({ index: 1, requiredLevel: 1, cond: null });
  });

  it("parses sub node levels and chapter conditions", () => {
    const catalog = GirlFetterCatalog.loadDefault();
    expect(catalog.node(1, 2)).toMatchObject({ index: 2, requiredLevel: 5 });
    expect(catalog.node(1, 11)).toMatchObject({
      index: 11,
      requiredLevel: 15,
      cond: { chapter: 2, index: 6, difficulty: 1 },
    });
    expect(catalog.node(5, 62)).toMatchObject({
      cond: { chapter: 7, index: 2, difficulty: 1 },
    });
  });

  it("parses node awards as GDPLN lists", () => {
    const catalog = GirlFetterCatalog.loadDefault();
    expect(catalog.node(1, 1)?.awards).toContainEqual([15, 2, 1, 1, 30]);
    expect(catalog.node(1, 2)?.awards).toEqual([
      [15, 2, 1, 1, 10],
      [15, 1, 1, 1, 3000],
    ]);
  });

  it("returns empty nodes for link girls", () => {
    const catalog = GirlFetterCatalog.loadDefault();
    expect(catalog.nodes(201)).toEqual([]);
  });
});
