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
    if (parsed.has(topicId) || transcript.length === 0 || !Number.isSafeInteger(initiator))
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

export function getPhoneLetterDefinition(topicId: number): PhoneLetterDefinition | null {
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
      if ((nextFlags & 2) && (!nextBranches.length || nextBranches[0] === choice))
        return null;
      if (nextType === 2 || nextBranches.length === 0) break;
      const branch = branches.length === 1 ? branches[0] : type === 2 ? choice : undefined;
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
  if (position === null || !definition.transcript[position - 1]![2].includes(selectionId))
    return null;
  return position * 10 + selectionId;
}

export function isPhoneLetterComplete(letter: PhoneLetterState): boolean {
  const definition = getPhoneLetterDefinition(letter.topicId);
  return definition !== null && nextReplyPosition(definition, letter.replyIds) === null;
}

export function phoneLetterAffection(
  definition: PhoneLetterDefinition,
  replies: readonly number[],
): number {
  const chosen = replies.find((id) => Math.floor(id / 10) === definition.awardPosition);
  return definition.affectionByChoice[(chosen ?? 0) % 10 - 1] ?? 0;
}

export function reconcilePhoneLetters(
  phone: PhoneState,
  eligibleIds: readonly number[],
  now: number,
): PhoneLetterState[] {
  const present = new Set([...phone.letters.map((letter) => letter.topicId), ...(phone.deletedLetterTopicIds ?? [])]);
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
  return added;
}
