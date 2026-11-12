import { describe, expect, it } from "vitest";

import {
  INITIAL_COFFEE_TASK_VALUES,
  makeCafeCustomerQueue,
  makeCafePetResponse,
  makeCoffeeResponse,
  makeInitialCafeData,
} from "../src/game-data/cafe-data.js";

describe("initial cafe data", () => {
  it("contains every field read by NCafeNet.RspDownloadCafeData", () => {
    expect(makeInitialCafeData(1234)).toEqual({
      basetime: 1234,
      level: 1,
      hot: 0,
      comfort: 0,
      seatlist: [],
      customerqueue: [],
      coffeelist: [],
      roomgirlslist: [[], [], []],
      weightlist: [],
      visitedList: [],
      boxstatelist: [],
      petstatelist: [],
      petlocklist: [],
      nextpetid: 2,
    });
  });

  it("includes persisted coffee inventory and returns defensive copies", () => {
    const coffees = [{ coffeetype: 3, count: 240 }];
    const data = makeInitialCafeData(1234, coffees);
    const response = makeCoffeeResponse(coffees);

    expect(data.coffeelist).toEqual(coffees);
    expect(response).toEqual({ coffeelist: coffees });
    expect(data.coffeelist).not.toBe(coffees);
    expect(response.coffeelist).not.toBe(coffees);
  });

  it("seeds the four basic coffees as learned", () => {
    expect(INITIAL_COFFEE_TASK_VALUES).toEqual({
      "1507329": 256,
      "1507330": 256,
      "1507331": 256,
      "1507332": 256,
    });
  });

  it("generates a stable initial customer queue", () => {
    expect(makeCafeCustomerQueue(1234)).toEqual({
      basetime: 1234,
      customerqueue: [
        {
          customertype: 201,
          customeridx: 1,
          starttime: 1234,
        },
      ],
    });
  });

  it("acknowledges the observed cafe pet commands", () => {
    expect(makeCafePetResponse({ sCmd: "GetCafeFoodNum" })).toEqual({
      sCmd: "GetCafeFoodNum",
    });
    expect(makeCafePetResponse({ sCmd: "UpdateFoodBoxs" })).toEqual({
      sCmd: "UpdateFoodBoxs",
      param: [],
    });
    expect(makeCafePetResponse({ sCmd: "Unknown" })).toBeNull();
  });
});
