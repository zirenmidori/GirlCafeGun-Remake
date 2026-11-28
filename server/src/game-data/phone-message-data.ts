import { readFileSync } from "node:fs";
import path from "node:path";

import type { PhoneLetterState, PhoneState } from "../persistence/player-repository.js";

type TranscriptLine = [
  type: 0 | 1 | 2,
  flags: number,
  choices: number[],
  branches: number[],
];

export interface PhoneLetterDefinition {
  topicId: number;
  initiator: number;
  awardPosition: number;
  affectionByChoice: readonly number[];
  transcript: readonly TranscriptLine[];
  replyPositions: readonly number[];
}

type TranscriptRecord = [number, number, number, number[], TranscriptLine[]];
let definitions: Map<number, PhoneLetterDefinition> | undefined;

function loadDefinitions(): Map<number, PhoneLetterDefinition> {
  if (definitions) return definitions;
  const data = readFileSync(
    path.resolve("resources/phonemsg/letter-transcripts.txt"),
    "utf8",
  );
  const parsed = new Map<number, PhoneLetterDefinition>();
  for (const line of data.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [topicId, initiator, awardPosition, affectionByChoice, transcript] =
      JSON.parse(line) as TranscriptRecord;
    if (
      parsed.has(topicId) ||
      transcript.length === 0 ||
      !Number.isSafeInteger(initiator)
    )
      throw new Error(`Invalid phone transcript ${topicId}`);
    parsed.set(topicId, {
      topicId,
      initiator,
      awardPosition,
      affectionByChoice,
      transcript,
      replyPositions: transcript.flatMap(([type], index) =>
        type > 0 ? [index + 1] : [],
      ),
    });
  }
  definitions = parsed;
  return parsed;
}

export function getPhoneLetterDefinition(
  topicId: number,
): PhoneLetterDefinition | null {
  return loadDefinitions().get(topicId) ?? null;
}

// The native reply ID encodes the Lua SingleInfo index and the choice on that line.
function nextReplyPosition(
  definition: PhoneLetterDefinition,
  replies: readonly number[],
): number | null {
  const transcript = definition.transcript;
  let position = 0;
  let choice = 0;
  while (position < transcript.length) {
    const [type, flags, choices, branches] = transcript[position]!;
    if (type > 0) {
      const picked = replies.find((reply) => Math.floor(reply / 10) === position + 1);
      if (picked === undefined || !choices.includes(picked % 10)) return position + 1;
      choice = picked % 10;
    }
    if (flags & 1) return null;

    let next = position + 1;
    for (; next < transcript.length; next++) {
      const [nextType, nextFlags, , nextBranches] = transcript[next]!;
      if (nextFlags & 2 && (!nextBranches.length || nextBranches[0] === choice))
        return null;
      if (nextType === 2 || nextBranches.length === 0) break;
      const branch =
        branches.length === 1 ? branches[0] : type === 2 ? choice : undefined;
      if (branch === nextBranches[0]) break;
    }
    position = next;
  }
  return null;
}

export function makePhoneReplyId(
  definition: PhoneLetterDefinition,
  selectionId: number,
  completedReplyIds: readonly number[],
): number | null {
  const position = nextReplyPosition(definition, completedReplyIds);
  if (
    position === null ||
    !definition.transcript[position - 1]![2].includes(selectionId)
  )
    return null;
  return position * 10 + selectionId;
}

export function isPhoneLetterComplete(letter: PhoneLetterState): boolean {
  const definition = getPhoneLetterDefinition(letter.topicId);
  return definition !== null && nextReplyPosition(definition, letter.replyIds) === null;
}

/** A letter that still waits for a reply from the player. */
export function isPhoneLetterOpen(letter: PhoneLetterState): boolean {
  const definition = getPhoneLetterDefinition(letter.topicId);
  return definition !== null && nextReplyPosition(definition, letter.replyIds) !== null;
}

// The client lets the player answer only the last topic of a contact (UI_Phone.lua
// CheckCanReply reads tbTopicIndex[#tbTopicIndex]), so a second letter from the same
// girl hides an open one for good. Her next letter therefore waits until the current
// one is answered and the client has shown its last line: PhoneMsgLogic:CalLastLine
// sends the award claim (nCmd 7) then, after the per-girl reply timer has stopped.
// LetterInfoNew.txt names one column 插队触发 ("queue-jump trigger"), so the official
// server held letters in a queue too [INFER: its server code is not available].
function holdsNextLetter(letter: PhoneLetterState, acceptUnclaimed: boolean): boolean {
  if (!getPhoneLetterDefinition(letter.topicId)) return false;
  return isPhoneLetterOpen(letter) || (!acceptUnclaimed && !letter.awardClaimed);
}

export interface PhoneLetterQueueOptions {
  /** At login no closing lines are playing, so an unclaimed finished letter does not hold the queue. */
  acceptUnclaimed?: boolean;
}

/**
 * Queues every newly eligible letter (in trigger order) and delivers the oldest queued
 * letter of each girl who has no letter in progress. At most one letter per girl per call.
 */
export function reconcilePhoneLetterQueue(
  phone: PhoneState,
  eligibleIds: readonly number[],
  now: number,
  { acceptUnclaimed = false }: PhoneLetterQueueOptions = {},
): { added: PhoneLetterState[]; queued: number[] } {
  const present = new Set([
    ...phone.letters.map((letter) => letter.topicId),
    ...(phone.deletedLetterTopicIds ?? []),
  ]);
  const queue: number[] = [];
  for (const topicId of phone.queuedLetterTopicIds ?? []) {
    if (present.has(topicId) || !getPhoneLetterDefinition(topicId)) continue;
    queue.push(topicId);
    present.add(topicId);
  }
  const queued: number[] = [];
  for (const topicId of eligibleIds) {
    if (present.has(topicId) || !getPhoneLetterDefinition(topicId)) continue;
    queue.push(topicId);
    queued.push(topicId);
    present.add(topicId);
  }

  const busy = new Set(
    phone.letters
      .filter((letter) => holdsNextLetter(letter, acceptUnclaimed))
      .map(({ initiator }) => initiator),
  );
  const added: PhoneLetterState[] = [];
  for (const topicId of queue) {
    const definition = getPhoneLetterDefinition(topicId)!;
    if (busy.has(definition.initiator)) continue;
    const letter: PhoneLetterState = {
      topicId,
      initiator: definition.initiator,
      createTime: Math.floor(now / 1000),
      replyIds: [],
    };
    phone.letters.push(letter);
    added.push(letter);
    busy.add(definition.initiator);
  }

  const delivered = new Set(added.map(({ topicId }) => topicId));
  const waiting = queue.filter((topicId) => !delivered.has(topicId));
  if (waiting.length) phone.queuedLetterTopicIds = waiting;
  else delete phone.queuedLetterTopicIds;
  return { added, queued };
}

/**
 * Saves made before the queue can hold several open letters of one girl, and only the
 * last one can be answered. Keeps one open letter per girl (a partly answered one if
 * any, else the oldest) and puts the untouched others back at the front of the queue.
 */
export function queueSurplusOpenLetters(phone: PhoneState): number[] {
  const openByGirl = new Map<number, PhoneLetterState[]>();
  for (const letter of phone.letters) {
    if (!isPhoneLetterOpen(letter)) continue;
    const open = openByGirl.get(letter.initiator) ?? [];
    open.push(letter);
    openByGirl.set(letter.initiator, open);
  }
  const surplus = new Set<PhoneLetterState>();
  for (const open of openByGirl.values()) {
    if (open.length < 2) continue;
    const keep = open.find(({ replyIds }) => replyIds.length > 0) ?? open[0];
    for (const letter of open)
      if (letter !== keep && letter.replyIds.length === 0) surplus.add(letter);
  }
  if (!surplus.size) return [];
  const requeued = phone.letters
    .filter((letter) => surplus.has(letter))
    .map(({ topicId }) => topicId);
  phone.letters = phone.letters.filter((letter) => !surplus.has(letter));
  phone.queuedLetterTopicIds = [
    ...requeued,
    ...(phone.queuedLetterTopicIds ?? []).filter((id) => !requeued.includes(id)),
  ];
  return requeued;
}

/** Topic order of one contact in PHONE_MSG_NTF: delivery order, the open letter last. */
export function orderPhoneLetterTopics(
  topics: readonly PhoneLetterState[],
): PhoneLetterState[] {
  return [...topics].sort(
    (a, b) => Number(isPhoneLetterOpen(a)) - Number(isPhoneLetterOpen(b)),
  );
}

export function phoneLetterAffection(
  definition: PhoneLetterDefinition,
  replies: readonly number[],
): number {
  const chosen = replies.find((id) => Math.floor(id / 10) === definition.awardPosition);
  return definition.affectionByChoice[((chosen ?? 0) % 10) - 1] ?? 0;
}

export function reconcilePhoneLetters(
  phone: PhoneState,
  eligibleIds: readonly number[],
  now: number,
): PhoneLetterState[] {
  const present = new Set([
    ...phone.letters.map((letter) => letter.topicId),
    ...(phone.deletedLetterTopicIds ?? []),
  ]);
  const added: PhoneLetterState[] = [];
  for (const topicId of eligibleIds) {
    const definition = getPhoneLetterDefinition(topicId);
    if (present.has(topicId) || !definition) continue;
    const letter: PhoneLetterState = {
      topicId,
      initiator: definition.initiator,
      createTime: Math.floor(now / 1000),
      replyIds: [],
    };
    phone.letters.push(letter);
    added.push(letter);
    present.add(topicId);
  }
  // A letter delivered directly (the guide letters) leaves the queue.
  if (added.length && phone.queuedLetterTopicIds) {
    const delivered = new Set(added.map(({ topicId }) => topicId));
    phone.queuedLetterTopicIds = phone.queuedLetterTopicIds.filter(
      (topicId) => !delivered.has(topicId),
    );
    if (!phone.queuedLetterTopicIds.length) delete phone.queuedLetterTopicIds;
  }
  return added;
}
