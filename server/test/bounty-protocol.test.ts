import { expect, it } from "vitest";

import { parseBountyCall, type LuaCall } from "../src/servers/gateway-server.js";

it("parses direct join and sCmd=252 wrapped settlement calls", () => {
  const join: LuaCall = {
    method: "LuaCall",
    json: "",
    parameters: {
      sCmd: 50,
      tbParam: { id: 1, diff: 1, nFormationId: 1 },
    },
  };
  expect(parseBountyCall(join)).toMatchObject({
    command: 50,
    activityId: 1,
    difficulty: 1,
    formationId: 1,
  });

  const pass: LuaCall = {
    method: "LuaCall",
    json: "",
    parameters: {
      sCmd: 252,
      tbParam: {
        sCmd: 51,
        tbParam: {
          nActivityId: 1,
          nDiff: 1,
          nFormationId: 1,
          nGold: 1_580,
          tbThiefDeath: [],
          tbThiefDropItem: [],
        },
      },
    },
  };
  expect(parseBountyCall(pass)).toMatchObject({
    command: 51,
    activityId: 1,
    difficulty: 1,
    formationId: 1,
    parameters: { nGold: 1_580 },
  });
});
