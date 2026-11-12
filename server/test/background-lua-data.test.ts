import { describe, expect, it } from "vitest";

import {
  LUA_COMMAND_ASSIST_LIST,
  LUA_COMMAND_CLUB_INFO,
  LUA_COMMAND_FRIEND_LIST,
  LUA_COMMAND_RANDOM_EVENT,
  makeBackgroundLuaResponse,
} from "../src/game-data/background-lua-data.js";

describe("background Lua empty-state responses", () => {
  it("preserves the requested friend-list type", () => {
    expect(
      makeBackgroundLuaResponse(LUA_COMMAND_FRIEND_LIST, {
        sCmd: LUA_COMMAND_FRIEND_LIST,
        tbParam: { reqfriendtype: 3 },
      }),
    ).toEqual({
      reqfriendtype: 3,
      HYList: [],
      FXList: [],
      SQList: [],
      HMDList: [],
      BindList: [],
    });
  });

  it("returns safe empty values for optional systems", () => {
    expect(makeBackgroundLuaResponse(LUA_COMMAND_RANDOM_EVENT, {})).toEqual({});
    expect(
      makeBackgroundLuaResponse(LUA_COMMAND_ASSIST_LIST, {
        Power: 3530,
        ChapterType: [],
      }),
    ).toEqual([]);
    expect(makeBackgroundLuaResponse(LUA_COMMAND_CLUB_INFO, {})).toEqual({});
  });

  it("does not claim unrelated commands", () => {
    expect(makeBackgroundLuaResponse(999, {})).toBeUndefined();
    expect(makeBackgroundLuaResponse(230, {})).toBeUndefined();
    expect(makeBackgroundLuaResponse(231, {})).toBeUndefined();
  });
});
