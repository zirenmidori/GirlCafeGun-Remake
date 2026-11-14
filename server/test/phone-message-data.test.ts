import { expect, it } from "vitest";

import {
  getPhoneLetterDefinition,
  makePhoneReplyId,
} from "../src/game-data/phone-message-data.js";

it("maps the guide reply to the protobuf reply id", () => {
  const definition = getPhoneLetterDefinition(10_001);
  expect(definition).toMatchObject({ initiator: 7, replyPositions: [2] });
  expect(makePhoneReplyId(definition!, 1, [])).toBe(21);
  expect(makePhoneReplyId(definition!, 1, [21])).toBeNull();
  expect(getPhoneLetterDefinition(1)).toMatchObject({
    initiator: 111,
    replyPositions: [],
  });
});

it("follows the authored legacy and new branches with exact packed positions", () => {
  const legacy = getPhoneLetterDefinition(8)!;
  expect(makePhoneReplyId(legacy, 1, [])).toBe(21);
  expect(makePhoneReplyId(legacy, 3, [21])).toBeNull();
  expect(makePhoneReplyId(legacy, 2, [21])).toBe(42);
  expect(makePhoneReplyId(legacy, 1, [21, 41])).toBeNull();
  expect(makePhoneReplyId(legacy, 1, [21, 42])).toBe(71);

  const newer = getPhoneLetterDefinition(56)!;
  expect(makePhoneReplyId(newer, 2, [21])).toBe(52);
  expect(makePhoneReplyId(newer, 1, [21, 52])).toBe(131);
  expect(makePhoneReplyId(newer, 1, [21, 52, 131])).toBe(151);
  expect(makePhoneReplyId(newer, 1, [21, 52, 131, 151])).toBeNull();
});
