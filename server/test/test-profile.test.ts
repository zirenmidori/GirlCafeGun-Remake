import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { Player } from "../src/persistence/player-repository.js";
import {
  makeHouseInfoResponse,
  makeItemNotification,
  makePlayerNotification,
  makeTaskValueSync,
} from "../src/protocol/messages.js";
import {
  grantTestProfile,
  loadTestProfileCatalog,
  testGirlTaskId,
} from "../src/tools/grant-test-profile.js";

const catalog = loadTestProfileCatalog();
const inventoryCount =
  catalog.instanceTemplates.length * 2 + catalog.stackableTemplates.length;
const recoveredClient = catalog.schemaVersion === 2;
const chapterText = readFileSync("resources/map/chapter.txt", "utf8");
const source: Player = {
  account: "test:local-only",
  roleId: 6,
  name: "",
  level: 2,
  exp: 5,
  fightPower: 1,
  serverZone: 8,
  registerTime: 1,
  lastLoginAt: null,
  live2dEnableLevel: 3,
  live2dHX: false,
  taskValues: { 65551: 6 },
  inventory: [
    {
      guid: 10001,
      genre: 1,
      detail: 7,
      particular: 1,
      templateLevel: 1,
      count: 1,
      createTime: 1,
      enhanceLevel: 1,
      enhanceExp: 0,
      breakLevel: 0,
      lockOn: 0,
    },
  ],
  nextItemGuid: 20001,
  money: [{ id: 2, count: 4 }],
  girls: [
    { girlId: 7, level: 1, exp: 0, modelId: 1, moodValue: 100, vigor: 100, flag: 0 },
  ],
  formations: [
    {
      id: 1,
      title: "test",
      fightCards: [
        {
          mainCardGuid: 10001,
          usedCardGuid: 10001,
          secondaryCardGuids: [],
          weaponGuid: 0,
          runeItemGuids: [0, 0, 0, 0],
        },
      ],
    },
  ],
  levels: [],
  cafe: { coffees: [] },
  phone: { letters: [] },
  gacha: { pending: null },
  dailySignUp: { cycle: "", lastOperationalDate: null },
  eightDaySignUp: { cumulativeDays: 0, lastOperationalDate: null },
};
const matches = (item: Player["inventory"][number], gdpl: number[]) =>
  [item.genre, item.detail, item.particular, item.templateLevel].join(":") ===
  gdpl.join(":");

it("grants real catalog content with combat copies, upgradeable spares, and safe currency caps", () => {
  const before = structuredClone(source);
  const p = grantTestProfile(source, catalog, chapterText, 1793870000);
  expect(source).toEqual(before);
  expect(p.formations).toEqual(source.formations);
  expect(p.inventory.find((i) => i.guid === 10001)?.enhanceLevel).toBe(70);
  expect(p.inventory).toHaveLength(inventoryCount);
  expect(new Set(p.inventory.map((i) => i.guid)).size).toBe(inventoryCount);
  for (const template of catalog.instanceTemplates) {
    const copies = p.inventory.filter((item) => matches(item, template.gdpl));
    expect(copies).toHaveLength(2);
    expect(copies[0]!.enhanceLevel).toBe(
      template.kind === "rune" ? 1 : template.maxLevel,
    );
    expect(copies[0]!.breakLevel).toBe(
      template.kind === "rune" ? 0 : template.maxBreakLevel,
    );
    expect(copies[1]!.enhanceLevel).toBe(1);
    expect(copies[1]!.breakLevel).toBe(0);
  }
  for (const template of catalog.stackableTemplates)
    expect(p.inventory.find((item) => matches(item, template.gdpl))?.count).toBe(9999);
  for (const currency of catalog.currencies)
    expect(p.money.find((m) => m.id === currency.id)?.count).toBe(
      Math.min(currency.maxValue, 100_000_000),
    );
  expect(p.money.find((m) => m.id === 1)?.count).toBe(9999);
  expect(p.money.find((m) => m.id === 13)?.count).toBe(100);
  expect(p.inventory.some((i) => i.genre === 1 && i.detail === 102)).toBe(false);
  expect(p.cafe.furniture).toHaveLength(catalog.furnitureLinks.length);
  expect(
    p.cafe.furniture?.every(
      (i) => i.roomId === 0 && i.pose.templateId === i.templateId,
    ),
  ).toBe(true);
});

it("replenishes without duplicate instances and refreshes cosmetic access", () => {
  const first = grantTestProfile(source, catalog, chapterText, 1793870000);
  first.taskValues[String((3 << 16) | 300)] = 2;
  expect(grantTestProfile(first, catalog, chapterText, 1793870000)).toEqual(first);
  const later = grantTestProfile(first, catalog, chapterText, 1793880000);
  for (const cosmetic of catalog.cosmeticOwnership) {
    expect(later.taskValues[String(cosmetic.taskKey)]).toBe(1793880000);
    later.taskValues[String(cosmetic.taskKey)] =
      first.taskValues[String(cosmetic.taskKey)]!;
  }
  expect(later).toEqual(first);
});

it("unlocks valid stages and guides while respecting client affection exceptions", () => {
  const p = grantTestProfile(source, catalog, chapterText, 1793870000);
  expect(p.level).toBe(300);
  expect(p.levels).toHaveLength(528);
  expect(p.taskValues[String((14 << 16) | (1 << 8) | 1)]! & 255).toBe(0);
  expect(p.levels.filter((l) => l.star === 15)).toHaveLength(522);
  expect(p.levels.filter((l) => l.star === 8)).toHaveLength(6);
  expect(p.levels.some((l) => l.id === ((30 << 16) | (30 << 8) | 1))).toBe(false);
  for (const guide of catalog.guides)
    expect(p.taskValues[String(guide.taskId)]).toBe(guide.completedValue);
  for (const story of catalog.cardStoryUnlocks)
    expect(p.taskValues[String(story.taskKey)]).toBe(1);
  expect(catalog.cardStoryUnlocks).toHaveLength(recoveredClient ? 228 : 214);
  expect(p.girls).toHaveLength(recoveredClient ? 20 : 16);
  expect(p.taskValues[String((3 << 16) | (12 * 2000 + 14))]).toBe(
    recoveredClient ? 12 : 9,
  );
  expect(p.taskValues[String((3 << 16) | 14)]).toBe(12);
  for (const girl of p.girls)
    expect(girl.level).toBe(
      recoveredClient
        ? girl.girlId >= 201
          ? 50
          : 100
        : [13, 16].includes(girl.girlId)
          ? 80
          : 100,
    );
  expect(p.taskValues[String((3 << 16) | (12 * 2000 + 100 + 20 - 1))]).toBe(
    recoveredClient ? 1 : undefined,
  );
});

it("keeps login inventory and furniture payloads comfortably below the packet limit", () => {
  const p = grantTestProfile(source, catalog, chapterText, 1793870000);
  for (const payload of [
    makePlayerNotification(p),
    makeItemNotification(p),
    makeTaskValueSync(p.taskValues),
    makeHouseInfoResponse(p.roleId, p.cafe.furniture),
  ]) {
    expect(payload.length).toBeGreaterThan(0);
    expect(payload.length).toBeLessThan(256 * 1024);
  }
});

it("adds an upgradeable spare when existing copies have both been upgraded", () => {
  const first = grantTestProfile(source, catalog, chapterText, 1793870000);
  const template = catalog.instanceTemplates[0]!;
  const copies = first.inventory.filter((item) => matches(item, template.gdpl));
  copies[1]!.enhanceLevel = 70;
  copies[1]!.breakLevel = 3;
  const next = grantTestProfile(first, catalog, chapterText, 1793870000);
  const nextCopies = next.inventory.filter((item) => matches(item, template.gdpl));
  expect(nextCopies).toHaveLength(3);
  expect(nextCopies[2]!.enhanceLevel).toBe(1);
  expect(nextCopies[2]!.breakLevel).toBe(0);
  expect(grantTestProfile(next, catalog, chapterText, 1793870000)).toEqual(next);
});

it("uses recovered affection caps and isolated collaboration task namespaces", () => {
  const recovered = structuredClone(catalog);
  recovered.schemaVersion = 2;
  recovered.girlAffectionCaps = Object.fromEntries(
    [...Array.from({ length: 16 }, (_, i) => i + 1), 201, 202, 203, 204].map((id) => [
      String(id),
      id >= 201 ? 50 : 100,
    ]),
  );
  recovered.girlMainStoryCounts = Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => [String(i + 1), 12]),
  );
  for (const id of [201, 202, 203, 204]) {
    recovered.instanceTemplates.push({
      gdpl: [1, id, 1, id === 201 || id === 203 ? 4 : 3],
      kind: "character",
      girlId: id,
      modelId: 1,
      maxLevel: 70,
      maxBreakLevel: 3,
    });
    recovered.suitOwnership.push({ taskKey: testGirlTaskId(4, id, 1), value: 2 });
  }
  const saved = structuredClone(source);
  saved.taskValues[String(testGirlTaskId(3, 201, 14))] = 5;
  const p = grantTestProfile(saved, recovered, chapterText, 1793870000);
  expect(p.girls).toHaveLength(20);
  for (const girl of p.girls) expect(girl.level).toBe(girl.girlId >= 201 ? 50 : 100);
  expect(p.taskValues[String(testGirlTaskId(3, 13, 14))]).toBe(12);
  expect(p.taskValues[String(testGirlTaskId(3, 13, 119))]).toBe(1);
  expect(p.taskValues[String(testGirlTaskId(3, 201, 14))]).toBe(5);
  expect(p.taskValues[String(testGirlTaskId(3, 202, 14))]).toBeUndefined();
  for (const [id, rarity] of [
    [201, 4],
    [202, 3],
    [203, 4],
    [204, 3],
  ]) {
    expect(p.taskValues[String(testGirlTaskId(7, id!, 20 + rarity!))]).toBe(2);
    expect(p.taskValues[String(testGirlTaskId(4, id!, 1))]).toBe(2);
    expect(p.taskValues[String(testGirlTaskId(3, id!, 106))]).toBe(1);
  }
  expect(testGirlTaskId(7, 201, 24)).toBe((92 << 16) | 24);
  expect(testGirlTaskId(4, 204, 1)).toBe((91 << 16) | (6000 + 1));
  expect(grantTestProfile(p, recovered, chapterText, 1793870000)).toEqual(p);
});
