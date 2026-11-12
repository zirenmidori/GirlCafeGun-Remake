import { describe, expect, it } from "vitest";
import { CafeCatalog } from "../src/game-data/cafe-catalog.js";
import {
  CafeFurnitureCommerce,
  materializeCafeFurniture,
} from "../src/game-data/cafe-furniture-commerce.js";
import type { CafeRuntimeHooks } from "../src/game-data/cafe-runtime.js";
import type {
  CafeFurnitureState,
  Player,
} from "../src/persistence/player-repository.js";

const catalog = CafeCatalog.loadDefault();
const NOW = Date.UTC(2026, 10, 6, 12);
function player(): Player {
  return {
    roleId: 6,
    level: 100,
    inventory: [],
    nextItemGuid: 20000,
    money: [
      { id: 7, count: 100000000 },
      { id: 2, count: 100000000 },
    ],
    cafe: { level: 30, coffees: [], furniture: [] },
    taskValues: {},
    girls: [],
    levels: [],
  } as unknown as Player;
}
function same(item: Player["inventory"][number], gdpl: readonly number[]): boolean {
  return (
    [item.genre, item.detail, item.particular, item.templateLevel].join("-") ===
    gdpl.slice(0, 4).join("-")
  );
}
function hooks(p: Player): CafeRuntimeHooks {
  return {
    chargeMoney(id, count) {
      const row = p.money.find((x) => x.id === id);
      if (!row || row.count < count) throw new Error("insufficient_funds");
      row.count -= count;
    },
    consumeItem(gdpl, count) {
      let left = count;
      for (const item of p.inventory.filter((i) => same(i, gdpl))) {
        const take = Math.min(left, item.count);
        item.count -= take;
        left -= take;
      }
      if (left) throw new Error("insufficient_items");
    },
    grant(awards) {
      for (const [g, d, q, l, count] of awards) {
        if (g === 15) {
          const id = d === 10 ? 7 : d === 1 ? 2 : d === 2 ? 3 : 0;
          let money = p.money.find((m) => m.id === id);
          if (!money) {
            money = { id, count: 0 };
            p.money.push(money);
          }
          money.count += count;
          continue;
        }
        let item = p.inventory.find((i) => same(i, [g, d, q, l]));
        if (!item) {
          item = {
            guid: p.nextItemGuid++,
            genre: g,
            detail: d,
            particular: q,
            templateLevel: l,
            count: 0,
            createTime: 1,
            enhanceLevel: 1,
            enhanceExp: 0,
            breakLevel: 0,
            lockOn: 0,
          };
          p.inventory.push(item);
        }
        item.count += count;
      }
    },
    updatedGirl() {},
  };
}
function stored(templateId: number, objId: number): CafeFurnitureState {
  return {
    templateId,
    objId,
    parentId: 0,
    roomId: 0,
    pose: { templateId, parentTemplateId: 0, place: 0, posX: 0, posY: 0, rotate: 0 },
    status: 0,
    isNew: true,
    bizcount: 0,
  };
}
function run(p: Player, command: number, parameters: unknown) {
  const runtime = new CafeFurnitureCommerce(p, catalog, NOW, hooks(p));
  return { result: runtime.operate(command, parameters), runtime };
}

describe("core café furniture commerce", () => {
  it("uses exact café wallet prices and projects batch purchases into new native GUIDs", () => {
    const p = player(),
      before = p.money[0]!.count;
    const { result, runtime } = run(p, 14, [
      { shopid: 40001, goodsid: 101, buynum: 1 },
      { shopid: 40001, goodsid: 102, buynum: 2 },
    ]);
    expect(p.money[0]!.count).toBe(before - 420 - 475 * 2);
    expect(result?.response).toEqual([
      { ret: true, shopid: 40001, goodsid: 101, buynum: 1 },
      { ret: true, shopid: 40001, goodsid: 102, buynum: 2 },
    ]);
    expect(runtime.updatedFurniture.map((i) => [i.templateId, i.objId])).toEqual([
      [101, 10000],
      [102, 10001],
      [102, 10002],
    ]);
    expect(p.inventory.every((i) => i.count === 0)).toBe(true);
    expect(p.shops?.["40001"]?.counters["102"]?.total).toBe(2);
    const reloaded = JSON.parse(JSON.stringify(p)) as Player;
    run(reloaded, 14, [{ shopid: 40001, goodsid: 101, buynum: 1 }]);
    expect(reloaded.cafe.furniture?.at(-1)?.objId).toBe(10003);
    expect(reloaded.shops?.["40001"]?.counters["101"]?.total).toBe(2);
  });
  it("requires owned acquisition items for1050 and does not mint on a replay", () => {
    const p = player(),
      services = hooks(p),
      gdpl = catalog.furniture(101)!.ItemInfo;
    services.grant([[gdpl[0]!, gdpl[1]!, gdpl[2]!, gdpl[3]!, 1]]);
    expect(materializeCafeFurniture(p, [101], catalog, services)).toEqual([
      stored(101, 10000),
    ]);
    expect(p.inventory[0]?.count).toBe(0);
    const before = structuredClone(p);
    expect(() => materializeCafeFurniture(p, [101], catalog, services)).toThrow(
      "furniture_item_not_owned",
    );
    expect(p).toEqual(before);
    expect(() => materializeCafeFurniture(p, [72], catalog, services)).toThrow(
      "furniture_not_acquirable",
    );
  });
  it("validates an entire mixed/invalid batch before charging, and leaves other shops alone", () => {
    const p = player(),
      before = structuredClone(p);
    expect(run(p, 14, [{ shopid: 20001, goodsid: 1, buynum: 1 }]).result).toBeNull();
    expect(() =>
      run(p, 14, [
        { shopid: 40001, goodsid: 101, buynum: 1 },
        { shopid: 20001, goodsid: 1, buynum: 1 },
      ]),
    ).toThrow();
    expect(() => run(p, 14, [{ shopid: 40001, goodsid: 101, buynum: 100 }])).toThrow();
    expect(() => run(p, 14, [{ shopid: 40001, goodsid: 999999, buynum: 1 }])).toThrow();
    expect(() => run(p, 14, [])).toThrow();
    expect(p).toEqual(before);
  });
  it("enforces inventory and per-template ownership capacity without disturbing54fixed objects", () => {
    const p = player();
    p.cafe.furniture = Array.from({ length: 99 }, (_, i) => stored(101, 10000 + i));
    expect(() => run(p, 14, [{ shopid: 40001, goodsid: 101, buynum: 1 }])).toThrow(
      "furniture_own_limit",
    );
    const q = player();
    q.cafe.furniture = Array.from({ length: 2000 }, (_, i) => stored(101, 10000 + i));
    expect(() => run(q, 14, [{ shopid: 40001, goodsid: 102, buynum: 1 }])).toThrow(
      "furniture_capacity",
    );
    const r = player();
    r.cafe.furniture = [stored(72, 72)];
    run(r, 14, [{ shopid: 40001, goodsid: 101, buynum: 1 }]);
    expect(r.cafe.furniture).toEqual([stored(72, 72), stored(101, 10000)]);
  });
  it("does not consume an acquisition item when the native GUID space is exhausted", () => {
    const p = player(),
      services = hooks(p),
      gdpl = catalog.furniture(101)!.ItemInfo;
    services.grant([[gdpl[0]!, gdpl[1]!, gdpl[2]!, gdpl[3]!, 1]]);
    p.cafe.furniture = [stored(102, 0xffffffff)];
    const before = structuredClone(p);
    expect(() => materializeCafeFurniture(p, [101], catalog, services)).toThrow();
    expect(p).toEqual(before);
  });
  it("buys only missing predefined-theme pieces and preserves theme ownership across reload/retry", () => {
    const p = player(),
      template = catalog.theme(3)!;
    p.cafe.furniture = [stored(102, 10000), stored(505, 10001)];
    expect(run(p, 127, { themeID: 3 }).result?.response).toBe("false");
    const runtime = new CafeFurnitureCommerce(p, catalog, NOW, hooks(p));
    const buy = runtime.buyPredefinedTheme(3);
    expect(buy.theme.templateThemeId).toBe(3);
    expect(buy.theme.poses).toHaveLength(template.poses.length);
    expect(buy.furniture).toHaveLength(template.poses.length - 2);
    expect(p.cafe.furniture?.filter((i) => i.templateId === 102)).toHaveLength(
      template.poses.filter((i) => i.templateId === 102).length,
    );
    const reloaded = JSON.parse(JSON.stringify(p)) as Player,
      before = structuredClone(reloaded);
    expect(run(reloaded, 127, { themeID: 3 }).result?.response).toBe("true");
    expect(run(reloaded, 126, { themeid: 3, furidlist: [] }).result?.response).toBe(
      "buy_theme_succeed",
    );
    expect(reloaded).toEqual(before);
  });
  it("rejects a predefined theme with unavailable missing content rather than charging or inventing it", () => {
    const p = player(),
      before = structuredClone(p);
    expect(() =>
      new CafeFurnitureCommerce(p, catalog, NOW, hooks(p)).buyPredefinedTheme(3),
    ).toThrow("theme_furniture_not_for_sale");
    expect(p).toEqual(before);
  });
  it("uses already-owned theme acquisition tokens before charging for missing copies", () => {
    const p = player(),
      theme = catalog.theme(3)!,
      counts = new Map<number, number>();
    for (const pose of theme.poses)
      counts.set(pose.templateId, (counts.get(pose.templateId) ?? 0) + 1);
    for (const [id, count] of counts) {
      const g = catalog.furniture(id)!.ItemInfo;
      hooks(p).grant([[g[0]!, g[1]!, g[2]!, g[3]!, count]]);
    }
    const wallet = structuredClone(p.money),
      runtime = new CafeFurnitureCommerce(p, catalog, NOW, hooks(p));
    runtime.buyPredefinedTheme(3);
    expect(p.money).toEqual(wallet);
    expect(p.cafe.furniture).toHaveLength(theme.poses.length);
    expect(p.inventory.every((i) => i.count === 0)).toBe(true);
  });
  it("recycles only unused owned objects once, with the exact coffee-coin return", () => {
    const p = player();
    p.cafe.furniture = [stored(101, 10000), stored(102, 10001)];
    const before = p.money[0]!.count;
    expect(run(p, 137, { objIds: [10000] }).result?.response).toEqual({
      objId: [10000],
      comfort: 0,
    });
    expect(p.money[0]!.count).toBe(before + 210);
    expect(p.cafe.furniture?.map((i) => i.objId)).toEqual([10001]);
    const after = structuredClone(p);
    expect(() => run(p, 137, { objIds: [10000] })).toThrow();
    expect(p).toEqual(after);
    p.cafe.furniture![0]!.roomId = 1;
    p.cafe.furniture![0]!.parentId = 2;
    expect(() => run(p, 137, { objIds: [10001] })).toThrow("furniture_not_recyclable");
    expect(() => run(p, 137, { objIds: [10001, 10001] })).toThrow(
      "invalid_recycle_list",
    );
  });
  it("preserves atomic-draft semantics when funds are insufficient", () => {
    const original = player();
    original.money[0]!.count = 0;
    const draft = structuredClone(original);
    expect(() => run(draft, 14, [{ shopid: 40001, goodsid: 101, buynum: 1 }])).toThrow(
      "insufficient_funds",
    );
    expect(draft).toEqual(original);
  });
});
