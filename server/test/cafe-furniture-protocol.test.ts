import { describe, expect, it } from "vitest";

import { makeInitialCafeData } from "../src/game-data/cafe-data.js";
import type { CafeFurnitureState } from "../src/persistence/player-repository.js";
import { makeHouseInfoResponse } from "../src/protocol/messages.js";
import { decodeFields, firstBytes, firstNumber } from "../src/protocol/protobuf.js";

function repeatedMessages(payload: Buffer, number: number): Buffer[] {
  return decodeFields(payload)
    .filter(({ fieldNumber }) => fieldNumber === number)
    .map(({ value }) => {
      expect(Buffer.isBuffer(value)).toBe(true);
      return value as Buffer;
    });
}

describe("optional cafe profile projection", () => {
  it("keeps the legacy house response byte-identical when furniture is absent", () => {
    const legacy = "0807120e08072202080122020802220208061a00";
    expect(makeHouseInfoResponse(7).toString("hex")).toBe(legacy);
    expect(makeHouseInfoResponse(7, []).toString("hex")).toBe(legacy);
  });

  it("encodes owned copies with all native furniture and explicit pose fields", () => {
    const furniture: CafeFurnitureState[] = [
      {
        templateId: 101,
        objId: 10001,
        parentId: 0,
        roomId: 0,
        pose: {
          templateId: 101,
          parentTemplateId: 0,
          place: 0,
          posX: 0,
          posY: 0,
          rotate: 0,
        },
        status: 0,
        isNew: false,
        bizcount: 0,
      },
      {
        templateId: 101,
        objId: 10002,
        parentId: 42,
        roomId: 6,
        pose: {
          templateId: 101,
          parentTemplateId: 202,
          place: 6,
          posX: 11,
          posY: 12,
          rotate: 3,
        },
        status: 5,
        isNew: true,
        bizcount: 7,
      },
    ];
    const before = structuredClone(furniture);
    const outer = decodeFields(makeHouseInfoResponse(7, furniture));
    const house = firstBytes(outer, 2)!;
    const copies = repeatedMessages(house, 2);
    expect(copies).toHaveLength(2);
    expect(firstNumber(decodeFields(house), 1)).toBe(7);
    expect(
      repeatedMessages(house, 4).map((room) => firstNumber(decodeFields(room), 1)),
    ).toEqual([1, 2, 6]);
    expect(firstBytes(outer, 3)).toEqual(Buffer.alloc(0));
    expect(repeatedMessages(house, 5)).toEqual([]);

    const first = decodeFields(copies[0]!);
    expect(first.map(({ fieldNumber }) => fieldNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect([1, 2, 3, 4, 6, 7, 8].map((field) => firstNumber(first, field))).toEqual([
      101, 10001, 0, 0, 0, 0, 0,
    ]);
    const firstPose = firstBytes(first, 5);
    expect(firstPose).toBeDefined();
    expect(
      decodeFields(firstPose!).map(({ fieldNumber, value }) => [fieldNumber, value]),
    ).toEqual([
      [1, 101n],
      [2, 0n],
      [3, 0n],
      [4, 0n],
      [5, 0n],
      [6, 0n],
    ]);

    const second = decodeFields(copies[1]!);
    expect([1, 2, 3, 4, 6, 7, 8].map((field) => firstNumber(second, field))).toEqual([
      101, 10002, 42, 6, 5, 1, 7,
    ]);
    expect(
      decodeFields(firstBytes(second, 5)!).map(({ fieldNumber, value }) => [
        fieldNumber,
        value,
      ]),
    ).toEqual([
      [1, 101n],
      [2, 202n],
      [3, 6n],
      [4, 11n],
      [5, 12n],
      [6, 3n],
    ]);
    expect(furniture).toEqual(before);
  });

  it("projects an optional cafe level while preserving default and coffee data", () => {
    const coffees = [{ coffeetype: 3, count: 240 }];
    const data = makeInitialCafeData(1234, coffees, 30);
    expect(data.level).toBe(30);
    expect(data.coffeelist).toEqual(coffees);
    expect(data.coffeelist).not.toBe(coffees);
    expect(makeInitialCafeData(1234, coffees).level).toBe(1);
  });
});
