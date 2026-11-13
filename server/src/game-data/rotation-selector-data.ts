import { readFileSync } from "node:fs";
import path from "node:path";
import type { Gdpl, Gdpln } from "./gacha-data.js";

export type SelectionKind = "character" | "weapon";
export interface RotationSelectorDefinition {
  version: number;
  kind: SelectionKind;
  cohort: number;
  itemGdpl: Gdpl;
  boxId: number;
  name: string;
  donorGdpl: Gdpl;
  choices: Gdpln[];
}
export class RotationSelectorError extends Error {
  constructor(readonly reason: "invalid_request" | "not_owned") {
    super("Rotation selection: " + reason);
  }
}
function positiveTuple(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((n) => Number.isSafeInteger(n) && n > 0)
  );
}

export class RotationSelectorCatalog {
  readonly definitions: readonly RotationSelectorDefinition[];
  private readonly byItem = new Map<string, RotationSelectorDefinition>();
  constructor(source: unknown) {
    const value = source as {
      schemaVersion: number;
      definitions: RotationSelectorDefinition[];
      legacyDefinitions?: RotationSelectorDefinition[];
    };
    if (
      !value ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.definitions) ||
      !value.definitions.length ||
      (value.legacyDefinitions !== undefined && !Array.isArray(value.legacyDefinitions))
    )
      throw new Error("Invalid rotation selector catalog");
    const boxes = new Set<number>();
    const cohorts = new Set<string>();
    for (const row of [...value.definitions, ...(value.legacyDefinitions ?? [])]) {
      const legacy = value.legacyDefinitions?.includes(row) === true;
      // Preserve the native collaboration's existing 300-pull reward. This
      // explicit exception does not enable arbitrary shipped boxes.
      if (
        legacy &&
        (row?.itemGdpl?.join(":") !== "8:10:46:4" ||
          row.boxId !== 81046 ||
          row.kind !== "character" ||
          row.cohort !== -1 ||
          row.version !== 1 ||
          JSON.stringify(row.choices) !== "[[1,201,1,4,1],[1,203,1,4,1]]")
      )
        throw new Error("Unknown legacy selection box");
      if (
        !row ||
        !Number.isSafeInteger(row.version) ||
        row.version < 1 ||
        !["character", "weapon"].includes(row.kind) ||
        !Number.isInteger(row.cohort) ||
        (!legacy && row.cohort < 0) ||
        row.cohort >= 26 ||
        !positiveTuple(row.itemGdpl, 4) ||
        row.itemGdpl[0] !== 8 ||
        !positiveTuple(row.donorGdpl, 4) ||
        !Number.isSafeInteger(row.boxId) ||
        row.boxId <= 0 ||
        !row.name ||
        !Array.isArray(row.choices) ||
        !row.choices.length ||
        row.choices.some(
          (choice) =>
            !positiveTuple(choice, 5) ||
            choice[4] !== 1 ||
            choice[0] !== (row.kind === "character" ? 1 : 2),
        ) ||
        new Set(row.choices.map((choice) => choice.join(":"))).size !==
          row.choices.length ||
        this.byItem.has(row.itemGdpl.join(":")) ||
        boxes.has(row.boxId) ||
        cohorts.has(`${row.version}:${row.kind}:${row.cohort}`)
      )
        throw new Error("Invalid rotation selector definition");
      this.byItem.set(row.itemGdpl.join(":"), row);
      boxes.add(row.boxId);
      cohorts.add(`${row.version}:${row.kind}:${row.cohort}`);
    }
    this.definitions = value.definitions;
  }
  forLineup(
    kind: SelectionKind,
    cohort: number,
    choices: readonly Gdpl[],
  ): RotationSelectorDefinition {
    const keys = choices.map((row) => row.join(":"));
    const definition = [...this.definitions]
      .reverse()
      .find(
        (row) =>
          row.kind === kind &&
          row.cohort === cohort &&
          row.choices.length === keys.length &&
          row.choices.every((choice, i) => choice.slice(0, 4).join(":") === keys[i]),
      );
    if (!definition)
      throw new Error("No immutable selector matches the rotation lineup");
    return definition;
  }
  request(
    gdpln: unknown,
    selection: unknown,
  ): { definition: RotationSelectorDefinition; count: number; choice: Gdpln } {
    if (
      !positiveTuple(gdpln, 5) ||
      gdpln[4]! > 10 ||
      !Number.isSafeInteger(selection) ||
      (selection as number) < 1
    )
      throw new RotationSelectorError("invalid_request");
    const definition = this.byItem.get(gdpln.slice(0, 4).join(":"));
    const choice = definition?.choices[(selection as number) - 1];
    if (!definition || !choice) throw new RotationSelectorError("invalid_request");
    return { definition, count: gdpln[4]!, choice };
  }
}
let cached: RotationSelectorCatalog | undefined;
export function rotationSelectorCatalog(): RotationSelectorCatalog {
  return (cached ??= new RotationSelectorCatalog(
    JSON.parse(
      readFileSync(path.resolve("resources/gacha/rotation-selectors.json"), "utf8"),
    ),
  ));
}
