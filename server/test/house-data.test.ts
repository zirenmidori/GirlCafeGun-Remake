import { describe, expect, it } from "vitest";
import {
  isNativeFixedHouseObjectId,
  NATIVE_FIXED_HOUSE_OBJECT_IDS,
  parseAddFurnitureRequest,
  parseAddHouseThemeRequest,
  parseDeleteHouseThemeRequest,
  parseHouseInfoRequest,
  parseOtherHouseInfoRequest,
  parseUpdateHouseRequest,
  type HouseData,
} from "../src/game-data/house-data.js";
import { COMMAND } from "../src/protocol/commands.js";
import {
  makeAddFurnitureResponse,
  makeAddHouseThemeResponse,
  makeDeleteHouseThemeResponse,
  makeHouseInfoResponse,
  makeHouseRandomResponse,
  makeOtherHouseInfoResponse,
  makeTimeResponse,
  makeUpdateHouseResponse,
} from "../src/protocol/messages.js";
import {
  decodeFields,
  encodeVarint,
  fieldBytes,
  fieldVarint,
  firstBytes,
  firstNumber,
} from "../src/protocol/protobuf.js";

const furniture = {
  templateId: 151,
  objId: 10000,
  parentId: 1,
  roomId: 1,
  pose: {
    templateId: 151,
    parentTemplateId: 1,
    place: 2,
    posX: 3,
    posY: 4,
    rotate: 90,
  },
  status: 7,
  isNew: true,
  bizcount: 8,
};
const room = {
  roomId: 1,
  girlIds: [7, 9],
  friendGirlId: 6,
  themeId: 10000,
  furnitureIds: [1, 10000],
};
const theme = {
  themeId: 10000,
  templateThemeId: 1,
  name: "My room",
  poses: [furniture.pose],
  newGenerate: false,
  roomtype: 1,
  createtime: 1_790_000_000,
};
const data: HouseData = { furniture: [furniture], rooms: [room], themes: [theme] };
function message(payload: Buffer, tag: number): Buffer {
  const value = firstBytes(decodeFields(payload), tag);
  if (value === undefined) throw new Error(`Missing test message ${tag}`);
  return value;
}

describe("native house protocol", () => {
  it("uses the shipped save, purchase, delete and time commands", () => {
    expect([
      COMMAND.ADD_FURNITURE_REQ,
      COMMAND.ADD_FURNITURE_RSP,
      COMMAND.ADD_HOUSE_THEME_REQ,
      COMMAND.ADD_HOUSE_THEME_RSP,
      COMMAND.DELETE_HOUSE_THEME_REQ,
      COMMAND.DELETE_HOUSE_THEME_RSP,
      COMMAND.UPDATE_HOUSE_REQ,
      COMMAND.UPDATE_HOUSE_RSP,
      COMMAND.TIME_REQ,
      COMMAND.TIME_RSP,
    ]).toEqual([1050, 1051, 1052, 1053, 1054, 1055, 1056, 1057, 1105, 1106]);
  });
  it("keeps empty house defaults and parses an empty own-house query", () => {
    expect(makeHouseInfoResponse(7).toString("hex")).toBe(
      "0807120e08072202080122020802220208061a00",
    );
    expect(parseHouseInfoRequest(Buffer.alloc(0))).toEqual({ roleId: 0 });
    expect(parseHouseInfoRequest(fieldVarint(1, 9))).toEqual({ roleId: 9 });
  });
  it("round-trips every furniture, pose, room and theme field at native tags", () => {
    const payload = makeUpdateHouseResponse(7, data);
    expect(parseUpdateHouseRequest(payload)).toEqual({ roleId: 7, ...data });
    const cache = message(
      makeHouseInfoResponse(7, data.furniture, data.rooms, data.themes),
      2,
    );
    expect(message(cache, 2)).toEqual(message(payload, 3));
    expect(message(cache, 3)).toEqual(message(payload, 4));
    expect(message(cache, 4)).toEqual(message(payload, 2));
    expect(message(message(payload, 3), 5).length).toBeGreaterThan(0);
  });
  it("preserves omitted business fields and explicit zero removal fields", () => {
    // ReqSaveArea sets all layout scalars, but does not set status, bizcount or place.
    const pose = Buffer.concat([
      fieldVarint(1, 151),
      fieldVarint(2, 0),
      fieldVarint(4, 0),
      fieldVarint(5, 0),
      fieldVarint(6, 0),
    ]);
    const item = Buffer.concat([
      fieldVarint(1, 151),
      fieldVarint(2, 10000),
      fieldVarint(3, 0),
      fieldVarint(4, 0),
      fieldBytes(5, pose),
      fieldVarint(7, 0),
    ]);
    const parsed = parseUpdateHouseRequest(fieldBytes(3, item));
    expect(parsed.furniture).toEqual([
      {
        templateId: 151,
        objId: 10000,
        parentId: 0,
        roomId: 0,
        isNew: false,
        pose: { templateId: 151, parentTemplateId: 0, posX: 0, posY: 0, rotate: 0 },
      },
    ]);
    expect(parsed.furniture[0]).not.toHaveProperty("status");
    expect(parsed.furniture[0]).not.toHaveProperty("bizcount");
    expect(parsed.furniture[0]?.pose).not.toHaveProperty("place");
    expect(parsed.rooms).toEqual([]);
  });
  it("does not expand a room's changed-members list into a complete layout", () => {
    const packet = Buffer.concat([
      fieldVarint(1, 7),
      fieldBytes(
        2,
        Buffer.concat([fieldVarint(1, 1), fieldVarint(4, 0), fieldVarint(5, 10000)]),
      ),
    ]);
    expect(parseUpdateHouseRequest(packet).rooms).toEqual([
      { roomId: 1, themeId: 0, furnitureIds: [10000] },
    ]);
  });
  it("retains the exact 54 native fixed IDs separately from owned object IDs", () => {
    expect(NATIVE_FIXED_HOUSE_OBJECT_IDS).toHaveLength(54);
    expect(isNativeFixedHouseObjectId(72)).toBe(true);
    expect(isNativeFixedHouseObjectId(10000)).toBe(false);
    expect(isNativeFixedHouseObjectId(20)).toBe(false);
    const packet = makeUpdateHouseResponse(7, {
      rooms: [],
      themes: [],
      furniture: [{ ...furniture, templateId: 72, objId: 72 }],
    });
    expect(parseUpdateHouseRequest(packet).furniture[0]?.objId).toBe(72);
  });
  it("handles native purchases and theme creation/deletion without inventing IDs", () => {
    const packed = Buffer.concat([encodeVarint(151), encodeVarint(152)]);
    expect(
      parseAddFurnitureRequest(
        Buffer.concat([fieldVarint(1, 7), fieldBytes(2, packed)]),
      ),
    ).toEqual({ roleId: 7, templateIds: [151, 152] });
    const createTheme = Buffer.concat([
      fieldBytes(3, "New room"),
      fieldVarint(5, 1),
      fieldVarint(6, 1),
    ]);
    expect(
      parseAddHouseThemeRequest(
        Buffer.concat([
          fieldVarint(1, 7),
          fieldBytes(2, createTheme),
          fieldVarint(3, 151),
        ]),
      ),
    ).toEqual({
      roleId: 7,
      theme: { name: "New room", newGenerate: true, roomtype: 1 },
      templateIds: [151],
    });
    const response = makeAddFurnitureResponse(7, [furniture]);
    expect(firstNumber(decodeFields(response), 1)).toBe(7);
    expect(message(response, 2)).toEqual(message(makeUpdateHouseResponse(7, data), 3));
    expect(message(makeAddHouseThemeResponse(7, theme, [furniture]), 2)).toEqual(
      message(makeUpdateHouseResponse(7, data), 4),
    );
    expect(
      parseDeleteHouseThemeRequest(makeDeleteHouseThemeResponse(7, 10000)),
    ).toEqual({ roleId: 7, themeId: 10000 });
  });
  it("rejects malformed, ambiguous and out-of-range updates before persistence", () => {
    const valid = message(makeUpdateHouseResponse(7, data), 3);
    expect(() =>
      parseUpdateHouseRequest(
        Buffer.concat([fieldBytes(3, valid), fieldBytes(3, valid)]),
      ),
    ).toThrow("Duplicate");
    expect(() =>
      parseUpdateHouseRequest(
        fieldBytes(3, Buffer.concat([valid, fieldVarint(2, 10001)])),
      ),
    ).toThrow("Invalid");
    expect(() =>
      parseUpdateHouseRequest(
        fieldBytes(
          3,
          Buffer.concat([fieldVarint(1, 151), fieldVarint(2, 0x1_0000_0000)]),
        ),
      ),
    ).toThrow("range");
    expect(() =>
      parseUpdateHouseRequest(
        fieldBytes(
          3,
          Buffer.concat([
            fieldVarint(1, 151),
            fieldVarint(2, 10000),
            fieldVarint(7, 2),
          ]),
        ),
      ),
    ).toThrow("range");
    expect(() => parseUpdateHouseRequest(fieldBytes(3, Buffer.alloc(0)))).toThrow(
      "identity",
    );
    expect(() => parseHouseInfoRequest(fieldVarint(1, 9007199254740992n))).toThrow(
      "range",
    );
    expect(() =>
      parseAddHouseThemeRequest(fieldBytes(2, fieldBytes(3, Buffer.from([0xff])))),
    ).toThrow();
    expect(() => parseUpdateHouseRequest(Buffer.from([0x1a, 0x02, 0x08]))).toThrow(
      "Truncated",
    );
    expect(parseUpdateHouseRequest(fieldVarint(99, 3))).toEqual({
      roleId: 0,
      rooms: [],
      furniture: [],
      themes: [],
    });
  });
  it("encodes periodic time as uint64 seconds and signed int32 zone", () => {
    const time = decodeFields(makeTimeResponse(1_790_000_001, 8));
    expect(firstNumber(time, 1)).toBe(1_790_000_001);
    expect(firstNumber(time, 2)).toBe(8);
    const negative = decodeFields(makeTimeResponse(1, -5)).find(
      (f) => f.fieldNumber === 2,
    )?.value;
    expect(typeof negative).toBe("bigint");
    expect(BigInt.asIntN(32, negative as bigint)).toBe(-5n);
    expect(() => makeTimeResponse(-1, 8)).toThrow();
  });
  it("encodes random café targets as repeated uint64 IDs and rejects absent visit identity", () => {
    expect(makeHouseRandomResponse([7, 9]).toString("hex")).toBe("08070809");
    expect(makeHouseRandomResponse([])).toEqual(Buffer.alloc(0));
    expect(parseOtherHouseInfoRequest(fieldVarint(1, 9))).toEqual({ roleId: 9 });
    expect(() => parseOtherHouseInfoRequest(Buffer.alloc(0))).toThrow();
    expect(() => makeHouseRandomResponse([0])).toThrow();
  });
  it("embeds the target house, café snapshot and optional music at the native other-house tags", () => {
    const payload = makeOtherHouseInfoResponse(
      9,
      "Other",
      data,
      {
        level: 30,
        comfort: 60,
        hot: 100,
        basetime: 1790000000,
        nextidx: 10,
        touchtime: 1790000001,
        roomgirlslist: [[{ girlId: 7, modelId: 2 }], [], []],
        coffeelist: [{ coffeetype: 3, count: 4 }],
        seatlist: [
          {
            position: 100000,
            coffeetype: 3,
            customeridx: 2,
            customertype: 201,
            starttime: 1790000002,
          },
        ],
        customerqueue: [{ customeridx: 4, customertype: 202, starttime: 1790000003 }],
        fixedtime: 5,
      },
      12,
      { id: 3, nG: 1, nD: 2, nP: 3, nL: 4 },
    );
    expect(firstNumber(decodeFields(payload), 1)).toBe(9);
    const cache = message(payload, 3);
    expect(firstNumber(decodeFields(cache), 1)).toBe(9);
    expect(message(cache, 2)).toEqual(message(makeUpdateHouseResponse(9, data), 3));
    const cafe = decodeFields(message(payload, 4));
    expect([1, 2, 3, 4, 5, 6, 11].map((tag) => firstNumber(cafe, tag))).toEqual([
      30, 60, 100, 10, 1790000000, 1790000001, 5,
    ]);
    expect(cafe.filter((f) => f.fieldNumber === 7)).toHaveLength(3);
    const girl = decodeFields(message(message(payload, 4), 7));
    expect([firstNumber(girl, 1), firstNumber(girl, 2)]).toEqual([7, 2]);
    const guest = decodeFields(message(message(payload, 4), 9));
    expect([1, 2, 3, 4, 5].map((tag) => firstNumber(guest, tag))).toEqual([
      100000, 3, 2, 201, 1790000002,
    ]);
    expect(firstNumber(decodeFields(payload), 5)).toBe(12);
    expect(
      [1, 2, 3, 4, 5].map((tag) => firstNumber(decodeFields(message(payload, 6)), tag)),
    ).toEqual([3, 1, 2, 3, 4]);
    expect(
      decodeFields(
        makeOtherHouseInfoResponse(9, "Other", data, {
          level: 1,
          comfort: 0,
          hot: 0,
          basetime: 1,
        }),
      ).some((f) => f.fieldNumber === 6),
    ).toBe(false);
  });
  it("encodes own-house visitor history separately from layout ownership", () => {
    const payload = makeHouseInfoResponse(7, [], [], [], {
      entrustLog: [{ roleName: "Visitor", endTime: 1790000000 }],
      entrustNum: 1,
      entrustTime: 2,
      visitedList: [
        {
          roleId: 9,
          name: "Visitor",
          time: 1790000001,
          girlId: 7,
          modelId: 2,
          comfortScore: 60,
        },
      ],
      taskList: [{ roleId: 9, startTime: 1790000002, missionId: 3 }],
    });
    const visited = message(payload, 3),
      seen = decodeFields(message(visited, 4));
    expect([1, 3, 4, 5, 6].map((tag) => firstNumber(seen, tag))).toEqual([
      9, 1790000001, 7, 2, 60,
    ]);
    expect(firstNumber(decodeFields(message(visited, 1)), 2)).toBe(1790000000);
    expect(
      [1, 2, 3].map((tag) => firstNumber(decodeFields(message(visited, 5)), tag)),
    ).toEqual([9, 1790000002, 3]);
  });
});
