import { expect, it } from "vitest";
import type { CafeFurnitureState } from "../src/persistence/player-repository.js";
import {
  FIRST_CAFE_FURNITURE_OBJECT_ID,
  nextCafeFurnitureObjectId,
  repairStoredCafeFurnitureIds,
} from "../src/game-data/cafe-furniture-data.js";
import { makeHouseInfoResponse } from "../src/protocol/messages.js";
import { decodeFields, firstNumber } from "../src/protocol/protobuf.js";

function stored(objId: number, templateId = objId + 100): CafeFurnitureState {
  return {
    objId,
    templateId,
    parentId: 0,
    roomId: 0,
    status: 0,
    isNew: false,
    bizcount: 0,
    pose: { templateId, parentTemplateId: 0, place: 0, posX: 0, posY: 0, rotate: 0 },
  };
}

it("keeps owned storage items from overwriting the client's fixed scene dictionary", () => {
  const source = Array.from({ length: 740 }, (_, i) => stored(i + 1));
  const snapshot = structuredClone(source);
  const fixed = new Map(
    [1, 2, 72, 85].map((id) => [id, { templateId: id, roomId: 1 }]),
  );
  const oldScene = new Map(fixed);
  for (const item of source) oldScene.set(item.objId, item);
  expect(oldScene.get(2)?.roomId).toBe(0);
  const result = repairStoredCafeFurnitureIds(source);
  const newScene = new Map(fixed);
  for (const item of result.furniture) newScene.set(item.objId, item);
  for (const [id, item] of fixed) expect(newScene.get(id)).toEqual(item);
  expect(source).toEqual(snapshot);
  expect(result.changed).toBe(740);
  expect(result.furniture).toHaveLength(740);
  expect(new Set(result.furniture.map((i) => i.objId)).size).toBe(740);
  expect(result.furniture[0]!.objId).toBe(10000);
  expect(result.furniture.at(-1)!.objId).toBe(10739);
  for (let i = 0; i < source.length; i++)
    expect({ ...result.furniture[i], objId: source[i]!.objId }).toEqual(source[i]);
  expect(repairStoredCafeFurnitureIds(result.furniture)).toEqual({
    furniture: result.furniture,
    changed: 0,
  });
  expect(nextCafeFurnitureObjectId(result.furniture)).toBe(10740);
  const outer = decodeFields(makeHouseInfoResponse(6, result.furniture));
  const house = decodeFields(outer.find((f) => f.fieldNumber === 2)!.value as Buffer);
  const encoded = house
    .filter((f) => f.fieldNumber === 2)
    .map((f) => decodeFields(f.value as Buffer));
  expect(encoded).toHaveLength(740);
  expect(
    encoded.every((f) => firstNumber(f, 2) >= FIRST_CAFE_FURNITURE_OBJECT_ID),
  ).toBe(true);
});

it("preserves existing safe IDs and refuses ambiguous layout or invalid IDs", () => {
  expect(nextCafeFurnitureObjectId([])).toBe(10000);
  const safe = stored(21000);
  expect(repairStoredCafeFurnitureIds([safe])).toEqual({
    furniture: [safe],
    changed: 0,
  });
  expect(
    repairStoredCafeFurnitureIds([stored(1), safe]).furniture.map((i) => i.objId),
  ).toEqual([21001, 21000]);
  expect(() => repairStoredCafeFurnitureIds([{ ...stored(2), roomId: 1 }])).toThrow(
    /storage-only/,
  );
  expect(() =>
    repairStoredCafeFurnitureIds([stored(1), { ...stored(20000), parentId: 1 }]),
  ).toThrow(/references/);
  expect(() => repairStoredCafeFurnitureIds([stored(1), stored(1)])).toThrow(
    /duplicate/,
  );
  expect(() => nextCafeFurnitureObjectId([stored(0)])).toThrow(/Invalid/);
  expect(() => nextCafeFurnitureObjectId([stored(0xffff_ffff)])).toThrow(/exhausted/);
});
