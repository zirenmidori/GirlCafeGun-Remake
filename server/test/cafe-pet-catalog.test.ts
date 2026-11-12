import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CafeCatalog } from "../src/game-data/cafe-catalog.js";
import { CafePetCatalog } from "../src/game-data/cafe-pet-catalog.js";

describe("final CN café pet catalog", () => {
  const cafe = CafeCatalog.loadDefault();
  const pets = CafePetCatalog.fromCafeCatalog(cafe);

  it("caches immutable indexes over the same café catalog", () => {
    expect(CafePetCatalog.fromCafeCatalog(cafe)).toBe(pets);
    expect(CafePetCatalog.loadDefault()).toBe(pets);
    expect(pets.petTemplates()).toHaveLength(21);
    expect(pets.tourAreas()).toHaveLength(5);
    expect(pets.tourMissions()).toHaveLength(20);
    expect(pets.tourRewards()).toHaveLength(49);
    expect(pets.petRikiAwards()).toHaveLength(27);
    expect(pets.petBuffs()).toHaveLength(27);
    expect(pets.petMissions()).toHaveLength(75);
    expect(Object.isFrozen(pets.petTemplates())).toBe(true);
    expect(Object.isFrozen(pets.petTemplate(101))).toBe(true);
    expect(Object.isFrozen(pets.petTemplate(101)!.Nature[0])).toBe(true);
    expect(pets.petTemplatesOfRare(3)).toBe(pets.petTemplatesOfRare(3));
    expect(pets.tourRewardsFor(1, 1)).toBe(pets.tourRewardsFor(1, 1));
  });

  it("preserves can pricing, attraction weights and the exact food item lookup", () => {
    expect(pets.petFood(1)).toMatchObject({
      GDPL: [21, 1, 1, 2],
      PriceGet: [2, 5000],
      PricePer: [3, 1],
      GetPetRare: [
        [1, 90],
        [2, 10],
      ],
    });
    expect(pets.petFoodByItem([21, 1, 1, 2])).toBe(pets.petFood(1));
    expect(pets.petFoodByItem([21, 1, 1, 3])).toBeNull();
    expect(pets.foodBoxCount).toBe(3);
    expect(pets.foodBoxPrice(1)!.Cost).toEqual([3, 0]);
    expect(pets.foodBoxPrice(0)).toBeNull();
    expect(pets.foodBoxPrice(4)).toBeNull();
    expect(pets.buffFood(1)).toMatchObject({
      AddPoint: 200,
      Energy: 0,
      Love: 0,
      Rarity: 1,
    });
  });

  it("retains generation weights, level-cap zeroes and decimal tour multipliers", () => {
    expect(pets.petTemplate(101)).toMatchObject({
      Type: 1,
      Rare: 1,
      Paw: 3,
      Gender: [1, 2],
      Nature: [
        [1, 20],
        [2, 20],
        [3, 20],
        [4, 80],
      ],
      IQ: [1, 200],
      Hobby: [101, 102, 103, 104, 105],
    });
    expect(pets.petTemplates().some((row) => row.TourNumEx === 1.3)).toBe(true);
    expect(pets.petLoveExp(1)).toBe(10);
    expect(pets.petLoveExp(50)).toBe(0);
    expect(pets.petLoveEx(1)).toBe(1);
    expect(pets.maxPetAreaCount).toBe(6);
    expect(Array.from({ length: 6 }, (_, i) => pets.petAreaCost(i + 1))).toEqual([
      0, 0, 0, 0, 0, 0,
    ]);
    expect(pets.petGiveBack(0)).toBeNull();
    expect(pets.petGiveBack(1)).toEqual([22, 1, 1, 1, 1]);
    expect(pets.petGiveBack(49)).toEqual([22, 1, 1, 1, 53]);
    expect(pets.petGiveBack(50)).toEqual([22, 1, 1, 1, 55]);
  });

  it("uses the current twenty mission variants and area-based times", () => {
    expect(pets.tourArea(1)).toMatchObject({ Hour: 4, EnergyCost: 20, ExNum: 100 });
    expect(pets.tourArea(5)).toMatchObject({
      Hour: 8,
      EnergyCost: 80,
      ExNum: 300,
      Unlock1: [2, 5],
      Unlock2: 50,
      Unlock3: [2, 50000],
    });
    expect(pets.tourMission(2)).toEqual({
      MissionID: 2,
      Rare: 2,
      Index: 1,
      Condition: [[2, 1, 3]],
      Pro: 10,
    });
    expect(pets.tourMissionsOfRare(2)).toHaveLength(7);
    expect(pets.tourReward(1)).toMatchObject({
      AwardID: 1,
      Rare: 1,
      AwardNormal: 1,
      Award: [15, 1, 1, 1, 20000],
      Pro: 20,
    });
    expect(
      pets.tourRewardsFor(1, 1).every((row) => row.Rare === 1 && row.AwardNormal === 1),
    ).toBe(true);
    expect(pets.tourReward(32768)).toBeNull();
  });

  it("retains typed achievement conditions and buff priority without changing units", () => {
    expect(pets.petRikiAward(7)).toEqual({
      Id: 7,
      Condition: [
        [3, 102, 40],
        [3, 103, 50],
      ],
      ItemAward: [],
      BuffAward: [7],
      TransAward: 0,
    });
    expect(pets.petBuff(22)).toMatchObject({ Type: 7, BuffType: 7, Param1: 20 });
    expect(pets.petBuff(1)!.LevelType).toEqual([-1, -2]);
  });

  it("verifies all six gift effects against the decoded final CN ItemList source", () => {
    const root = path.resolve(process.cwd(), "resources/cafe");
    const provenance = JSON.parse(
      readFileSync(path.join(root, "provenance.json"), "utf8"),
    );
    const expected = provenance.files["npet/petgifts.txt"];
    const source = readFileSync(path.resolve(process.cwd(), "..", expected.source));
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      expected.projection.sourceSha256,
    );
    const original = (
      JSON.parse(source.toString("utf8")).list as Record<string, unknown>[]
    ).filter((row) => row.Genre === 22 && (row.Detail === 1 || row.Detail === 2));
    expect(original).toHaveLength(6);
    const projected = cafe.table("npet/petgifts");
    expect(projected).toHaveLength(6);
    for (const row of original) {
      const gdpl = ["Genre", "Detail", "Particular", "Level"].map((key) =>
        Number(row[key]),
      );
      expect(pets.petGift(gdpl)).toEqual({
        GDPL: gdpl,
        Detail: row.Detail,
        ExtParam1: Number(row.ExtParam1),
      });
      const copy = projected.find((r) =>
        gdpl.every(
          (n, i) => n === Number(r[["Genre", "Detail", "Particular", "Level"][i]!]),
        ),
      );
      expect(copy).toBeDefined();
      for (const [key, value] of Object.entries(row))
        expect(copy![key]).toBe(
          typeof value === "boolean" ? String(Number(value)) : String(value),
        );
    }
    expect(pets.petGift([22, 1, 1, 1])!.ExtParam1).toBe(30);
    expect(pets.petGift([22, 2, 3, 1])!.ExtParam1).toBe(80);
    expect(pets.petGift([22, 3, 1, 1])).toBeNull();
  });

  it("preserves the exact pet mission source rows, prerequisite chains and compound rewards", () => {
    const root = path.resolve(process.cwd(), "resources/cafe");
    const provenance = JSON.parse(
      readFileSync(path.join(root, "provenance.json"), "utf8"),
    );
    const expected = provenance.files["npet/achievementother.txt"];
    const source = readFileSync(path.resolve(process.cwd(), "..", expected.source));
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      expected.projection.sourceSha256,
    );
    const lines = source.toString("utf8").split(/(?<=\n)/);
    const ids = new Set<number>(expected.projection.filter.values);
    const selected = lines
      .slice(3)
      .filter((line) => ids.has(Number(line.split("\t")[0])));
    expect(selected).toHaveLength(75);
    expect(readFileSync(path.join(root, "npet/achievementother.txt"), "utf8")).toBe(
      [...lines.slice(0, 3), ...selected].join(""),
    );
    expect(pets.petMission(5001)).toMatchObject({
      missionId: 5001,
      achieveType: 241,
      missionMax: [5],
      assistparam: [1],
      awardsList: [[15, 2, 1, 1, 50]],
    });
    expect(pets.petMission(5006)!.missionMax).toEqual([
      5, 5001, 5002, 5003, 5004, 5005,
    ]);
    expect(pets.petMission(5204)).toMatchObject({
      preMissionId: 5203,
      missionMax: [500],
      awardsList: [
        [15, 2, 1, 1, 50],
        [15, 1, 1, 1, 5000],
      ],
    });
    for (const row of pets.petMissions()) {
      if (row.preMissionId) expect(pets.petMission(row.preMissionId)).not.toBeNull();
      expect(row.assistparam).toEqual([1]);
      expect(Object.isFrozen(row.awardsList)).toBe(true);
    }
    expect(pets.petMissionsOfType(252)).toHaveLength(12);
    expect(pets.petMission(5270)).toBeNull();
  });
});
