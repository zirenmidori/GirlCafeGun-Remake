import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GUIDE_MISSIONS,
  GUIDE_PROGRESS_TASK_ID,
  GUIDE_TRAINING_TYPES_TASK_ID,
  makeGuideMissionTaskValue,
  makeGuideTaskId,
} from "../src/game-data/guide-mission-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  makeLevelId,
  PlayerRepository,
  type FormationState,
  type PersistedState,
} from "../src/persistence/player-repository.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createRepository(): Promise<{
  repository: PlayerRepository;
  store: JsonStore<PersistedState>;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-guide-mission-"));
  directories.push(directory);
  const store = new JsonStore({
    filePath: path.join(directory, "state.json"),
    initialState: makeInitialState(),
    logger,
  });
  await store.initialize();
  const repository = new PlayerRepository({
    store,
    defaults: {
      name: "",
      level: 1,
      exp: 0,
      fightPower: 0,
      serverZone: 8,
      firstLevelComplete: false,
    },
    logger,
  });
  await repository.getOrCreate("tester");
  return { repository, store };
}

describe("guide mission persistence", () => {
  it("reconciles completed levels from an existing save on login", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      const player = state.players.tester;
      if (!player) throw new Error("missing test player");
      player.levels.push(
        { id: makeLevelId(1, 1, 1), star: 15 },
        { id: makeLevelId(1, 2, 1), star: 15 },
        { id: makeLevelId(1, 3, 1), star: 15 },
        { id: makeLevelId(1, 6, 1), star: 15 },
      );
    });

    const player = await repository.markLogin("tester");

    expect(player.taskValues).toMatchObject({
      [makeGuideTaskId(40_001)]: 2,
      [makeGuideTaskId(40_002)]: 2,
      [makeGuideTaskId(40_003)]: 2,
      [makeGuideTaskId(40_004)]: 2,
    });
  });

  it("reconciles the maximum formation power from the client formula", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      const player = state.players.tester;
      if (!player) throw new Error("missing test player");
      for (const card of player.inventory.filter(({ genre }) => genre === 1)) {
        card.enhanceLevel = 50;
      }
    });

    const player = await repository.markLogin("tester");

    expect(player.fightPower).toBeGreaterThanOrEqual(3_900);
    expect(player.taskValues[String(makeGuideTaskId(40_022))]).toBe(7_800);
  });

  it("completes the chapter-two mission after claiming its full-star box", async () => {
    const { repository } = await createRepository();
    for (let index = 1; index <= 6; index += 1) {
      await repository.completeLevel("tester", 2, index, 1, 7);
    }

    await repository.claimChapterStarAward("tester", 2, 1, 1);
    await repository.claimChapterStarAward("tester", 2, 1, 2);
    const result = await repository.claimChapterStarAward("tester", 2, 1, 3);

    expect(result.player.taskValues[String(makeGuideTaskId(40_021))]).toBe(2);
  });

  it("updates from domain events and enforces sequential mission claims", async () => {
    const { repository } = await createRepository();
    await repository.completeLevel("tester", 1, 1, 1, 3);
    await repository.completeLevel("tester", 1, 2, 1, 3);

    await expect(
      repository.claimGuideMissionAward("tester", 40_002),
    ).rejects.toMatchObject({
      reason: "prerequisite_not_claimed",
    });

    const first = await repository.claimGuideMissionAward("tester", 40_001);
    expect(first.player.taskValues[String(makeGuideTaskId(40_001))]).toBe(3);
    expect(first.updatedMoney).toContainEqual({ id: 2, count: 2_000 });

    const second = await repository.claimGuideMissionAward("tester", 40_002);
    expect(second.player.taskValues[String(makeGuideTaskId(40_002))]).toBe(3);
    expect(second.player.money).toContainEqual({ id: 2, count: 4_000 });

    await expect(
      repository.claimGuideMissionAward("tester", 40_002),
    ).rejects.toMatchObject({
      reason: "already_claimed",
    });
  });

  it("claims milestone rewards from completed count exactly once", async () => {
    const { repository } = await createRepository();
    await repository.completeLevel("tester", 1, 1, 1, 3);
    await repository.completeLevel("tester", 1, 2, 1, 3);
    await repository.completeLevel("tester", 1, 3, 1, 3);

    const result = await repository.claimGuideProgressAward("tester", 1);
    expect(
      result.player.taskValues[String(makeGuideTaskId(GUIDE_PROGRESS_TASK_ID))],
    ).toBe(1 << 1);
    expect(result.updatedItems).toContainEqual(
      expect.objectContaining({
        genre: 7,
        detail: 1,
        particular: 4,
        templateLevel: 1,
        count: 5,
      }),
    );

    await expect(repository.claimGuideProgressAward("tester", 1)).rejects.toMatchObject(
      {
        reason: "already_claimed",
      },
    );
  });

  describe("missions 40014, 40018 and 40026", () => {
    const trainingKey = String(makeGuideTaskId(40_014));
    const giftKey = String(makeGuideTaskId(40_018));
    const supportKey = String(makeGuideTaskId(40_026));
    const maskKey = String(makeGuideTaskId(GUIDE_TRAINING_TYPES_TASK_ID));

    function girlStateKey(girlId: number, offset: number): string {
      return String((3 << 16) | ((girlId - 1) * 2_000 + offset));
    }

    function supportTeam(mainCardGuid: number, id = 2_001): FormationState {
      return {
        id,
        title: "",
        fightCards: [
          {
            mainCardGuid,
            secondaryCardGuids: [],
            usedCardGuid: 0,
            weaponGuid: 0,
            runeItemGuids: [],
          },
        ],
      };
    }

    async function addGenericGifts(store: JsonStore<PersistedState>): Promise<void> {
      await store.update((state) => {
        state.players.tester?.inventory.push({
          guid: 900_001,
          genre: 5,
          detail: 2,
          particular: 1,
          templateLevel: 1,
          count: 10,
          createTime: 0,
          enhanceLevel: 0,
          enhanceExp: 0,
          breakLevel: 0,
          lockOn: 0,
        });
      });
    }

    async function addFourthGirl(store: JsonStore<PersistedState>): Promise<void> {
      await store.update((state) => {
        const player = state.players.tester!;
        player.girls.push({ ...player.girls[0]!, girlId: 10 });
      });
    }

    it("counts distinct started training types for mission 40014", async () => {
      const { repository, store } = await createRepository();
      await addFourthGirl(store);
      const startedAt = Date.now() - 4_000_000;

      let player = (await repository.startGirlTraining("tester", 7, 11, startedAt))
        .player;
      expect(player.taskValues[trainingKey]).toBe(makeGuideMissionTaskValue(1, false));
      // A second training of the same type is not a new type.
      player = (await repository.startGirlTraining("tester", 9, 12, startedAt)).player;
      expect(player.taskValues[trainingKey]).toBe(makeGuideMissionTaskValue(1, false));
      await repository.startGirlTraining("tester", 2, 21, startedAt);
      player = (await repository.startGirlTraining("tester", 10, 31, startedAt)).player;
      expect(player.taskValues[trainingKey]).toBe(makeGuideMissionTaskValue(3, false));

      await repository.endGirlTraining("tester", 7);
      player = (await repository.startGirlTraining("tester", 7, 41)).player;
      expect(player.taskValues[trainingKey]).toBe(makeGuideMissionTaskValue(4, false));
      expect(player.taskValues[maskKey]).toBe(0b1111);
    });

    it("completes mission 40018 with the first gift", async () => {
      const { repository, store } = await createRepository();
      await addGenericGifts(store);

      const first = await repository.sendGirlGift("tester", 7, [5, 2, 1, 1], 1);
      expect(first.unlockedSecretIds).toEqual([]);
      expect(first.guideMissionsChanged).toBe(true);
      expect(first.player.taskValues[giftKey]).toBe(
        makeGuideMissionTaskValue(1, false),
      );

      const second = await repository.sendGirlGift("tester", 9, [5, 2, 1, 1], 1);
      expect(second.guideMissionsChanged).toBe(false);
      expect(second.player.taskValues[giftKey]).toBe(
        makeGuideMissionTaskValue(1, false),
      );
    });

    it("completes mission 40026 when a support team is saved", async () => {
      const { repository } = await createRepository();

      const ordinary = await repository.updateFormation(
        "tester",
        supportTeam(10_001, 1),
      );
      expect(ordinary.taskValues[supportKey]).toBeUndefined();

      const player = await repository.updateFormation("tester", supportTeam(10_001));
      expect(player.taskValues[supportKey]).toBe(makeGuideMissionTaskValue(1, false));
    });

    it("unlocks progress award 5 after the three missions come from their actions", async () => {
      const { repository, store } = await createRepository();
      await addGenericGifts(store);
      await addFourthGirl(store);
      await store.update((state) => {
        const player = state.players.tester!;
        for (const mission of GUIDE_MISSIONS) {
          if ([40_014, 40_018, 40_026].includes(mission.id)) continue;
          player.taskValues[String(makeGuideTaskId(mission.id))] =
            makeGuideMissionTaskValue(mission.target, false);
        }
      });
      await expect(
        repository.claimGuideProgressAward("tester", 5),
      ).rejects.toMatchObject({ reason: "not_completed" });

      const startedAt = Date.now() - 4_000_000;
      await repository.startGirlTraining("tester", 7, 11, startedAt);
      await repository.startGirlTraining("tester", 9, 21, startedAt);
      await repository.startGirlTraining("tester", 2, 31, startedAt);
      await repository.startGirlTraining("tester", 10, 41, startedAt);
      await repository.sendGirlGift("tester", 7, [5, 2, 1, 1], 1);
      await repository.updateFormation("tester", supportTeam(10_002));

      const result = await repository.claimGuideProgressAward("tester", 5);
      expect(
        (result.player.taskValues[String(makeGuideTaskId(GUIDE_PROGRESS_TASK_ID))] ??
          0) &
          (1 << 5),
      ).toBe(1 << 5);
      expect(result.updatedItems).toContainEqual(
        expect.objectContaining({
          genre: 7,
          detail: 10,
          particular: 1,
          templateLevel: 4,
        }),
      );
    });

    it("gives no credit for these missions to a new save", async () => {
      const { repository } = await createRepository();
      const player = await repository.markLogin("tester");
      expect(player.taskValues[trainingKey]).toBeUndefined();
      expect(player.taskValues[giftKey]).toBeUndefined();
      expect(player.taskValues[supportKey]).toBeUndefined();
      expect(player.taskValues[maskKey]).toBeUndefined();
    });

    it("credits an old save at login from what its state still shows", async () => {
      const { repository, store } = await createRepository();
      await store.update((state) => {
        const player = state.players.tester!;
        // Trainings that run now: girl 7 on type 2, girl 9 on type 3.
        player.taskValues[girlStateKey(7, 11)] = 21;
        player.taskValues[girlStateKey(9, 11)] = 31;
        // Favourite-gift secret 11 of girl 2: only a gift sets it.
        player.taskValues[girlStateKey(2, 100 + 11 - 1)] = 1;
        player.formations.push(supportTeam(10_003, 2_003));
      });

      const player = await repository.markLogin("tester");

      expect(player.taskValues[trainingKey]).toBe(makeGuideMissionTaskValue(2, false));
      expect(player.taskValues[maskKey]).toBe(0b110);
      expect(player.taskValues[giftKey]).toBe(makeGuideMissionTaskValue(1, false));
      expect(player.taskValues[supportKey]).toBe(makeGuideMissionTaskValue(1, false));
    });
  });
});
