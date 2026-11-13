import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import {
  getMomentDefinition,
  isMomentComplete,
  reconcileMoments,
} from "../src/game-data/moments-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  MomentSelectionError,
  PlayerRepository,
} from "../src/persistence/player-repository.js";
import { makePhoneMessageNotification } from "../src/protocol/messages.js";
import { decodeFields, firstNumber } from "../src/protocol/protobuf.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};
const now = Date.parse("2026-11-09T12:00:00Z");

it("decodes shipped choices and serializes unlocked Moments alongside Private Chat", async () => {
  expect(getMomentDefinition(1)).toEqual({
    topicId: 1,
    initiator: 7,
    choiceIds: [2],
    awards: [5, 10, 10],
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-moments-"));
  try {
    const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
    const filePath = path.join(directory, "state.json");
    async function start() {
      const store = new JsonStore({
        filePath,
        initialState: makeInitialState(),
        logger,
      });
      await store.initialize();
      const players = new PlayerRepository({
        store,
        defaults: config.playerDefaults,
        logger,
      });
      return { store, players };
    }
    const { store, players } = await start();
    await players.getOrCreate("alpha", now);
    await players.getOrCreate("beta", now);

    await store.update((state) => {
      const phone = state.players.alpha!.phone;
      phone.letters.push({
        topicId: 1,
        initiator: 111,
        createTime: now / 1_000,
        replyIds: [],
      });
      const unlocked = reconcileMoments(phone, [1, 6, 999_999, 1], now);
      expect(unlocked.newPosts.map(({ topicId }) => topicId)).toEqual([1, 6]);
      expect(unlocked.newPublishableIds).toEqual([]);
      expect(unlocked.newPosts.map(isMomentComplete)).toEqual([false, true]);
      expect(reconcileMoments(phone, [1, 6], now).newPosts).toEqual([]);
    });
    const phonePacket = decodeFields(
      makePhoneMessageNotification(players.get("alpha")!),
    );
    expect(phonePacket.some(({ fieldNumber }) => fieldNumber === 1)).toBe(true);
    const posts = phonePacket.filter(({ fieldNumber }) => fieldNumber === 2);
    expect(
      posts.map(({ value }) => {
        const fields = decodeFields(value as Buffer);
        return [firstNumber(fields, 1), firstNumber(fields, 2), firstNumber(fields, 3)];
      }),
    ).toEqual([
      [1, now / 1_000, 0],
      [6, now / 1_000, 0],
    ]);

    await expect(players.updatePhoneMoments("alpha", 1, 1, now)).rejects.toBeInstanceOf(
      MomentSelectionError,
    );
    await expect(players.updatePhoneMoments("alpha", 4, 2, now)).rejects.toBeInstanceOf(
      MomentSelectionError,
    );
    const attempts = await Promise.allSettled([
      players.updatePhoneMoments("alpha", 1, 2, now),
      players.updatePhoneMoments("alpha", 1, 2, now),
    ]);
    expect(attempts.map(({ status }) => status)).toEqual(["fulfilled", "rejected"]);
    const success = attempts[0];
    if (success?.status !== "fulfilled") throw new Error("Valid Moments reply failed");
    expect(success.value.affection?.addedExperience).toBe(10);
    expect(success.value.player.phone.moments?.topics[0]?.selectionId).toBe(2);
    expect(success.value.updatedGirl).toMatchObject({ girlId: 7, exp: 10 });
    expect(players.get("beta")?.phone.moments).toBeUndefined();

    const { players: reopened } = await start();
    const alpha = reopened.get("alpha")!;
    expect(alpha.phone.moments?.topics[0]?.selectionId).toBe(2);
    expect(alpha.girls.find(({ girlId }) => girlId === 7)?.exp).toBe(10);
    await expect(
      reopened.updatePhoneMoments("alpha", 1, 2, now),
    ).rejects.toBeInstanceOf(MomentSelectionError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
