import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import {
  getPhoneLetterDefinition,
  isPhoneLetterComplete,
  makePhoneReplyId,
} from "../src/game-data/phone-message-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  makeLevelId,
  PlayerRepository,
  type PhoneLetterState,
} from "../src/persistence/player-repository.js";
import { makePhoneMessageNotification } from "../src/protocol/messages.js";
import {
  decodeFields,
  firstNumber,
  type DecodedField,
} from "../src/protocol/protobuf.js";
import { mkdtemp } from "./helpers/temp.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};
const now = Date.parse("2026-11-28T12:00:00Z");
const account = "letter-queue";

async function open() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-letter-queue-"));
  const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
  const store = new JsonStore({
    filePath: path.join(directory, "state.json"),
    initialState: makeInitialState(),
    logger,
  });
  await store.initialize();
  const players = new PlayerRepository({
    store,
    defaults: config.playerDefaults,
    logger,
  });
  await players.getOrCreate(account, now);
  return {
    players,
    store,
    close: async () => {
      await store.flush();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** Replies that walk a letter to its end, picking the first choice the transcript allows. */
function fullReplies(topicId: number): number[] {
  const definition = getPhoneLetterDefinition(topicId)!;
  const replies: number[] = [];
  for (;;) {
    const next = [1, 2, 3]
      .map((choice) => makePhoneReplyId(definition, choice, replies))
      .find((id) => id !== null);
    if (next === undefined || next === null) return replies;
    replies.push(next);
  }
}

function letter(topicId: number, replyIds: number[] = [], awardClaimed = false) {
  const state: PhoneLetterState = {
    topicId,
    initiator: getPhoneLetterDefinition(topicId)!.initiator,
    createTime: 1_795_000_000,
    replyIds,
  };
  if (awardClaimed) state.awardClaimed = true;
  return state;
}

/** Answers every reply of a delivered letter, then claims its award like the client does. */
async function finish(players: PlayerRepository, topicId: number) {
  const definition = getPhoneLetterDefinition(topicId)!;
  for (;;) {
    const current = players
      .get(account)!
      .phone.letters.find((l) => l.topicId === topicId)!;
    if (isPhoneLetterComplete(current)) break;
    const choice = [1, 2, 3].find(
      (id) => makePhoneReplyId(definition, id, current.replyIds) !== null,
    )!;
    const result = await players.choosePhoneLetterReply(account, topicId, choice);
    expect(result.replyId).not.toBeNull();
  }
  expect(await players.claimPhoneLetterAward(account, topicId)).not.toBeNull();
}

function wireTopics(players: PlayerRepository, initiator: number): number[] {
  const fields = decodeFields(makePhoneMessageNotification(players.get(account)!));
  for (const field of fields) {
    if (field.fieldNumber !== 1) continue;
    const contact = decodeFields(field.value as Buffer);
    if (firstNumber(contact, 1) !== initiator) continue;
    return contact
      .filter((entry: DecodedField) => entry.fieldNumber === 4)
      .map((entry) => firstNumber(decodeFields(entry.value as Buffer), 1)!);
  }
  return [];
}

const ofGirl = (letters: readonly PhoneLetterState[], initiator: number) =>
  letters
    .filter((entry) => entry.initiator === initiator)
    .map(({ topicId }) => topicId);

it("holds a girl's next letter while one is open and releases them in trigger order after the award claim", async () => {
  const { players, store, close } = await open();
  try {
    // Irene (7): letter 2 at stage 2-1-1; 88 at 2-3-1, 94 at 3-2-1, 92 at 3-4-1.
    const stages = [makeLevelId(2, 1, 1)];
    const clear = async (...ids: number[]) => {
      stages.push(...ids);
      await store.update((state) => {
        state.players[account]!.levels = stages.map((id) => ({ id, star: 15 }));
      });
    };
    await clear();
    await players.markLogin(account, now);
    expect(ofGirl(players.get(account)!.phone.letters, 7)).toEqual([2]);

    await clear(makeLevelId(2, 3, 1));
    let sync = await players.syncPhoneEvents(account, undefined, now);
    expect(ofGirl(sync.letters, 7)).toEqual([]);
    await clear(makeLevelId(3, 2, 1));
    await players.syncPhoneEvents(account, undefined, now);
    await clear(makeLevelId(3, 4, 1));
    await players.syncPhoneEvents(account, undefined, now);
    // Waiting letters are saved even when a sync delivers nothing.
    expect(players.get(account)!.phone.queuedLetterTopicIds).toEqual(
      expect.arrayContaining([88, 94, 92]),
    );
    const queue = players.get(account)!.phone.queuedLetterTopicIds!;
    expect(queue.filter((id) => [88, 94, 92].includes(id))).toEqual([88, 94, 92]);

    // The last reply completes letter 2, but the client still plays the closing lines.
    for (const id of fullReplies(2)) {
      const result = await players.choosePhoneLetterReply(account, 2, id % 10);
      expect(result.replyId).toBe(id);
    }
    sync = await players.syncPhoneEvents(account, undefined, now);
    expect(ofGirl(sync.letters, 7)).toEqual([]);

    const delivered: number[] = [];
    for (const topicId of [2, 88, 94]) {
      if (topicId !== 2) await finish(players, topicId);
      else expect(await players.claimPhoneLetterAward(account, 2)).not.toBeNull();
      sync = await players.syncPhoneEvents(account, undefined, now);
      delivered.push(...ofGirl(sync.letters, 7));
    }
    expect(delivered).toEqual([88, 94, 92]);
    expect(ofGirl(players.get(account)!.phone.letters, 7)).toEqual([2, 88, 94, 92]);
  } finally {
    await close();
  }
});

it("re-queues untouched letters stuck behind a newer one and lists the open letter last", async () => {
  const { players, store, close } = await open();
  try {
    await store.update((state) => {
      const player = state.players[account]!;
      player.levels = [];
      player.phone.letters = [
        // Moon (4) as on the phone on 2026-11-28: 74 and 76 never answered, 81 done.
        letter(74),
        letter(76),
        letter(81, fullReplies(81), true),
        // Grainne (8): 63 untouched, 65 half answered; the half-answered one stays.
        letter(63),
        letter(65, fullReplies(65).slice(0, 1)),
        // Cornelia (2): 7 is her only open letter, delivered before 132.
        letter(7),
        letter(132, fullReplies(132), true),
      ];
    });
    await players.markLogin(account, now);
    const phone = players.get(account)!.phone;
    expect(ofGirl(phone.letters, 4)).toEqual([74, 81]);
    expect(ofGirl(phone.letters, 8)).toEqual([65]);
    expect(phone.queuedLetterTopicIds).toEqual(expect.arrayContaining([76, 63]));

    expect(wireTopics(players, 4)).toEqual([81, 74]);
    expect(wireTopics(players, 2)).toEqual([132, 7]);

    await finish(players, 74);
    const sync = await players.syncPhoneEvents(account, undefined, now);
    expect(ofGirl(sync.letters, 4)).toEqual([76]);
    expect(wireTopics(players, 4)).toEqual([74, 81, 76]);
  } finally {
    await close();
  }
});

it("does not let an unclaimed but finished letter hold the queue at login", async () => {
  const { players, store, close } = await open();
  try {
    await store.update((state) => {
      const player = state.players[account]!;
      player.levels = [];
      player.phone.letters = [letter(74, fullReplies(74))];
      player.phone.queuedLetterTopicIds = [76];
    });
    expect(
      ofGirl((await players.syncPhoneEvents(account, undefined, now)).letters, 4),
    ).toEqual([]);
    await players.markLogin(account, now);
    expect(ofGirl(players.get(account)!.phone.letters, 4)).toEqual([74, 76]);
    expect(players.get(account)!.phone.queuedLetterTopicIds).toBeUndefined();
  } finally {
    await close();
  }
});
