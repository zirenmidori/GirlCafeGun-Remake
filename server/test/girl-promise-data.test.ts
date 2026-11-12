import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parsePromiseRequest,
  PromiseCatalog,
  type PromiseCatalogContents,
} from "../src/game-data/girl-promise-data.js";

function sourceContents(): PromiseCatalogContents {
  const read = (name: string): string =>
    readFileSync(`resources/pledge/${name}.txt`, "utf8");
  return {
    steps: read("steps"),
    tasks: read("tasks"),
    fragments: read("fragments"),
    exchange: read("exchange"),
  };
}

describe("recovered Fantasy Oath catalog", () => {
  it("loads once and preserves all sixteen real girls and exact client tables", () => {
    const catalog = PromiseCatalog.loadDefault();
    expect(PromiseCatalog.loadDefault()).toBe(catalog);
    expect(catalog.girlIds).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(catalog.size).toBe(16);
    expect(catalog.taskCount).toBe(670);
    expect(catalog.girlIds.flatMap((girl) => catalog.getSteps(girl))).toHaveLength(119);
    expect(catalog.girlIds.filter((girl) => catalog.isSimple(girl))).toEqual([13, 16]);
    const expected = {
      steps: "0e0ab8589442dceade1efc0d93b599b4f2307e9b280c823c225ebe5086aa3df6",
      tasks: "72e7a078c97c92b1ad1d4c61baaef6b5ad76c407b6daee579d225838d77473f3",
      fragments: "525e508b4862ce1e4c5b7bf0c7b4ef462e05414f5438d30e73b4e93f6692cbc3",
      exchange: "402bb5c24c693c80754008b675c64aa59cdaf2097ffedffae9a4964557cac7f5",
    };
    for (const [name, sha256] of Object.entries(expected)) {
      expect(
        createHash("sha256")
          .update(readFileSync(`resources/pledge/${name}.txt`))
          .digest("hex"),
      ).toBe(sha256);
    }
  });

  it("keeps activation, current-stage task order and release dates distinct", () => {
    const catalog = PromiseCatalog.loadDefault();
    expect(catalog.globalOpenDate).toBe("2019-11-5-10-40");
    expect(catalog.getStep(2, 1)?.tasklist).toEqual([201, 207, 217, 223]);
    expect(catalog.task(223)).toMatchObject({
      strtype: "ChapterFight",
      count: 1,
      infight: 1,
      lvpara: [100, 1, 10],
    });
    expect(catalog.task(13)?.lvpara).toEqual([2, -1]);
    expect(catalog.activationCost(2)).toEqual([9, 16, 1, 1, 10]);
    expect(catalog.activationCost(13)).toEqual([9, 16, 1, 1, 0]);
    expect(catalog.activationCost(201)).toBeNull();
    expect(catalog.releasedGirls(Date.UTC(2022, 5, 28))).not.toContain(13);
    expect(catalog.releasedGirls(Date.UTC(2022, 5, 29, 8))).toHaveLength(16);
    const references = new Set(
      catalog.girlIds.flatMap((girl) =>
        catalog.getSteps(girl).flatMap((step) => [...step.tasklist]),
      ),
    );
    expect(references.size).toBe(583);
    for (const taskId of references) expect(catalog.task(taskId)).not.toBeNull();
  });

  it("preserves normal card rewards and simplified story completion boundaries", () => {
    const catalog = PromiseCatalog.loadDefault();
    expect(catalog.getStep(1, 6)).toMatchObject({
      changecard: 1,
      cardgdpl: [1, 1, 17, 5],
      cardbreaklv: 3,
      cardlv: 70,
      cardskilllv: [4, 4, 4, 4],
      heart: 1,
    });
    expect(catalog.getStep(1, 7)?.rewards[0]).toEqual([15, 1, 1, 1, 20_000, 1]);
    expect(catalog.getStep(1, 7)?.rewards.at(-1)).toEqual([6, 28, 80, 4, 1, 9]);
    expect(catalog.maxStep(1)).toBe(7);
    expect(catalog.maxStep(2)).toBe(6);
    expect(catalog.maxStep(13)).toBe(6);
    expect(catalog.getStep(13, 6)).toMatchObject({
      simpleCartoon: "girl13/girl13_vow0601",
      cardgdpl: [],
      tasklist: [],
    });
    // 7 is a simple-story completion sentinel, never a fabricated table row.
    expect(catalog.getStep(13, 7)).toBeNull();
    expect(catalog.getSteps(201)).toEqual([]);
    expect(Object.isFrozen(catalog.getStep(1, 6)?.cardskilllv)).toBe(true);
  });

  it("uses positional fragment requirements and the four exact exchange recipes", () => {
    const catalog = PromiseCatalog.loadDefault();
    expect(catalog.fragments(1)).toHaveLength(4);
    expect(catalog.fragments(4, 6)[0]).toMatchObject({ id: 10, TaskIndexs: [4, 6] });
    expect(catalog.exchange(1)).toMatchObject({
      LimitNum: 10,
      tbSubItem: [9, 16, 1, 1, 20],
      tbMoney: [],
      tbAwardItem: [9, 32, 1, 1, 1],
    });
    expect(catalog.exchange(4)).toMatchObject({
      LimitNum: 0,
      tbSubItem: [],
      tbMoney: [63, 20],
      tbAwardItem: [9, 33, 1, 1, 1],
    });
    expect(catalog.exchanges()).toHaveLength(4);
    expect(catalog.exchange(5)).toBeNull();
  });

  it("rejects corrupted table references and duplicate stages before serving data", () => {
    const contents = sourceContents();
    expect(
      () =>
        new PromiseCatalog({
          ...contents,
          steps: contents.steps.replace("201-207-217-223", "999999"),
        }),
    ).toThrow("Unknown pledge task");
    const row = contents.steps
      .split(/\r?\n/)
      .find((line) => line.startsWith("2\t1\t"))!;
    expect(
      () => new PromiseCatalog({ ...contents, steps: `${contents.steps}\n${row}` }),
    ).toThrow("Duplicate pledge step 2:1");
  });
});

describe("Fantasy Oath client request contract", () => {
  it.each([
    [228, { girlId: 13, step: 7 }],
    [229, { Id: 4, Num: 3 }],
    [230, {}],
    [231, []],
    [232, {}],
    [233, { girlid: 2 }],
    [234, { girlid: 2, taskid: 223 }],
    [235, { girlid: 2 }],
    [239, { girlid: 1, step: 7 }],
  ])("parses supported request %s with exact field names", (command, payload) => {
    const parsed = parsePromiseRequest(command as number, payload);
    expect(parsed).toEqual({ command, ...(Array.isArray(payload) ? {} : payload) });
    expect(parsePromiseRequest(command as number, { tbParam: payload })).toEqual(
      parsed,
    );
  });

  it.each([
    [228, { girlid: 13, step: 1 }],
    [229, { id: 4, num: 1 }],
    [229, { Id: 4, Num: 0 }],
    [234, { girlid: 2, taskid: 1.2 }],
    [235, { girlid: "2" }],
    [239, { girlid: 1, step: Number.MAX_SAFE_INTEGER + 1 }],
    [233, null],
    [233, []],
    [236, {}],
    [237, {}],
    [238, {}],
  ])("rejects malformed/unsupported request %s", (command, payload) => {
    expect(parsePromiseRequest(command as number, payload)).toBeNull();
  });
});
