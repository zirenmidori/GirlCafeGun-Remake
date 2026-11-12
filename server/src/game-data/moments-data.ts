import { readFileSync } from "node:fs";

export interface MomentTopicState {
  topicId: number;
  createTime: number;
  selectionId: number;
}

export interface MomentsState {
  topics: MomentTopicState[];
  publishableIds: number[];
}

interface MomentsPhoneState {
  moments?: MomentsState;
}

export interface MomentDefinition {
  topicId: number;
  initiator: number;
  choiceIds: readonly number[];
  awards: readonly number[];
}

export interface MomentUnlocks {
  newPosts: MomentTopicState[];
  newPublishableIds: number[];
}

let topics: ReadonlyMap<number, MomentDefinition> | undefined;

export function getMomentDefinition(topicId: number): MomentDefinition | undefined {
  if (!topics) {
    const body = readFileSync(
      new URL("../../resources/phonemsg/moments-topics.txt", import.meta.url),
      "utf8",
    );
    const rows = new Map<number, MomentDefinition>();
    for (const line of body.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const [id, npc, choices = "", awards = ""] = line.split("\t");
      const topicId = Number(id);
      const initiator = Number(npc);
      if (
        !Number.isSafeInteger(topicId) ||
        topicId < 1 ||
        rows.has(topicId) ||
        !Number.isSafeInteger(initiator) ||
        initiator < 0
      ) {
        throw new Error(`Invalid Moments catalog row: ${line}`);
      }
      rows.set(topicId, {
        topicId,
        initiator,
        choiceIds: choices.split(",").filter(Boolean).map(Number),
        awards: awards.split(",").filter(Boolean).map(Number),
      });
    }
    topics = rows;
  }
  return topics.get(topicId);
}

export function isMomentComplete(topic: MomentTopicState): boolean {
  const definition = getMomentDefinition(topic.topicId);
  return !!definition && (definition.choiceIds.length === 0 || topic.selectionId > 0);
}

export function reconcileMoments(
  phone: MomentsPhoneState,
  eligibleTopicIds: readonly number[],
  now = Date.now(),
): MomentUnlocks {
  const result: MomentUnlocks = { newPosts: [], newPublishableIds: [] };
  for (const topicId of eligibleTopicIds) {
    const definition = getMomentDefinition(topicId);
    if (!definition) continue;
    const moments = (phone.moments ??= { topics: [], publishableIds: [] });
    if (moments.topics.some((post) => post.topicId === topicId)) continue;

    if (definition.initiator === 0) {
      if (!moments.publishableIds.includes(topicId)) {
        moments.publishableIds.push(topicId);
        result.newPublishableIds.push(topicId);
      }
    } else {
      const post = { topicId, createTime: Math.floor(now / 1_000), selectionId: 0 };
      moments.topics.push(post);
      result.newPosts.push(post);
    }
  }
  return result;
}

export function applyMomentSelection(
  phone: MomentsPhoneState,
  topicId: number,
  selectionId: number,
  now: number,
): MomentDefinition | null {
  const definition = getMomentDefinition(topicId);
  const moments = phone.moments;
  if (!definition || !moments) return null;
  const post = moments.topics.find((candidate) => candidate.topicId === topicId);
  if (post) {
    if (post.selectionId !== 0 || !definition.choiceIds.includes(selectionId))
      return null;
    post.selectionId = selectionId;
    return definition;
  }
  if (definition.initiator !== 0 || selectionId !== 0) return null;
  const publishableIndex = moments.publishableIds.indexOf(topicId);
  if (publishableIndex === -1) return null;
  moments.publishableIds.splice(publishableIndex, 1);
  moments.topics.push({ topicId, createTime: Math.floor(now / 1_000), selectionId: 0 });
  return definition;
}
