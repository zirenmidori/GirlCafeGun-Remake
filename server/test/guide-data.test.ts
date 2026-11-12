import { describe, expect, it } from "vitest";

import { makeGuideLogAcknowledgement } from "../src/game-data/guide-data.js";

describe("guide data", () => {
  it("maps the request field names to the client callback shape", () => {
    expect(
      makeGuideLogAcknowledgement({
        sCmd: 102,
        tbParam: {
          nTimming: 0,
          GuideType: "Force",
          GuideID: 102,
          StepID: 1,
        },
      }),
    ).toEqual({
      nTimming: 0,
      GuideId: 102,
      StepId: 1,
      GuideType: "Force",
    });
  });
});
