export const LUA_COMMAND_CAFE_DATA = 112;
export const LUA_COMMAND_CAFE_SET_WAITER_LIST = 113;
export const LUA_COMMAND_CAFE_GENERATE_CUSTOMER = 115;
export const LUA_COMMAND_CAFE_MAKE_COFFEE = 119;
export const LUA_COMMAND_CAFE_ADD_GUEST_WEIGHT = 124;
export const LUA_COMMAND_CAFE_FURNITURE_COUNT = 241;

export const INITIAL_COFFEE_TASK_VALUES = Object.fromEntries(
  [1, 2, 3, 4].map((coffeeId) => [String((23 << 16) | coffeeId), 1 << 8]),
);

export interface CafeCustomer {
  customertype: number;
  customeridx: number;
  starttime: number;
}

export interface CafeCustomerQueue {
  basetime: number;
  customerqueue: CafeCustomer[];
}

export interface CafeCoffee {
  coffeetype: number;
  count: number;
}

export interface InitialCafeData {
  basetime: number;
  level: number;
  hot: number;
  comfort: number;
  seatlist: unknown[];
  customerqueue: unknown[];
  coffeelist: CafeCoffee[];
  roomgirlslist: [unknown[], unknown[], unknown[]];
  weightlist: unknown[];
  visitedList: unknown[];
  boxstatelist: unknown[];
  petstatelist: unknown[];
  petlocklist: unknown[];
  nextpetid: number;
}

/**
 * Shape consumed by NCafeNet.RspDownloadCafeData in the original Lua client.
 * Empty lists represent a newly-created cafe; the actual room/furniture layout
 * is synchronized separately by the native house protocol.
 */
export function makeInitialCafeData(
  nowSeconds: number,
  coffees: readonly CafeCoffee[] = [],
  level = 1,
): InitialCafeData {
  return {
    basetime: nowSeconds,
    level,
    hot: 0,
    comfort: 0,
    seatlist: [],
    customerqueue: [],
    coffeelist: coffees.map((coffee) => ({ ...coffee })),
    roomgirlslist: [[], [], []],
    weightlist: [],
    visitedList: [],
    boxstatelist: [],
    petstatelist: [],
    petlocklist: [],
    nextpetid: 2,
  };
}

export function makeCoffeeResponse(coffees: readonly CafeCoffee[]): {
  coffeelist: CafeCoffee[];
} {
  return { coffeelist: coffees.map((coffee) => ({ ...coffee })) };
}

export function makeCafeCustomerQueue(nowSeconds: number): CafeCustomerQueue {
  return {
    basetime: nowSeconds,
    customerqueue: [
      {
        customertype: 201,
        customeridx: 1,
        starttime: nowSeconds,
      },
    ],
  };
}

export function makeCafePetResponse(
  parameters: unknown,
): Record<string, unknown> | null {
  if (typeof parameters !== "object" || parameters === null) return null;
  const command = (parameters as Record<string, unknown>).sCmd;
  if (command === "GetCafeFoodNum") {
    return { sCmd: command };
  }
  if (command === "UpdateFoodBoxs") {
    return { sCmd: command, param: [] };
  }
  return null;
}
