import { readFile, rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import {
  makeDailyMissionTaskId,
  DAILY_MISSIONS,
  DAILY_MISSION_ACTIVE_AWARD_TASK_ID,
  DAILY_MISSION_ACTIVE_POINT_TASK_ID,
} from "../src/game-data/daily-mission-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  PlayerRepository,
} from "../src/persistence/player-repository.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

it("persists player and task changes atomically", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-store-"));
  const filePath = path.join(directory, "state.json");
  try {
    const store = new JsonStore({
      filePath,
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

    const player = await repository.getOrCreate("tester");
    expect(player.name).toBe("");
    expect(player.lastLoginAt).toBeNull();
    expect(player.live2dEnableLevel).toBe(3);
    expect(player.live2dHX).toBe(false);
    expect(player.taskValues).toEqual({
      "131074": 7,
      "131173": 5,
      "131174": 0,
      "198908": 1,
      "208908": 1,
      "212908": 1,
      "264145": 2,
      "274145": 2,
      "278145": 2,
      "367702": 4384,
      "460773": 1,
      "470773": 1,
      "474775": 1,
      "593825": 2,
      "593826": 2,
      "593828": 2,
      "593829": 2,
      "1507329": 256,
      "1507330": 256,
      "1507331": 256,
      "1507332": 256,
      ...Object.fromEntries(
        [
          ...DAILY_MISSIONS.map(({ id }) => id),
          DAILY_MISSION_ACTIVE_POINT_TASK_ID,
          DAILY_MISSION_ACTIVE_AWARD_TASK_ID,
        ].map((id) => [String(makeDailyMissionTaskId(id)), 0]),
      ),
    });
    expect(
      player.inventory
        .filter(({ genre }) => genre === 1)
        .map(({ genre, detail, particular, templateLevel }) => [
          genre,
          detail,
          particular,
          templateLevel,
        ]),
    ).toEqual([
      [1, 7, 1, 1],
      [1, 9, 1, 3],
      [1, 2, 1, 1],
    ]);
    expect(player.girls.map(({ girlId }) => girlId)).toEqual([7, 9, 2]);
    expect(player.formations[0]?.fightCards).toHaveLength(3);
    expect(player.levels).toEqual([]);
    expect(player.money).toEqual([
      { id: 1, count: 28 },
      { id: 2, count: 0 },
      { id: 3, count: 0 },
    ]);
    expect(player.inventory).toHaveLength(3);
    expect(player.cafe).toEqual({ coffees: [] });
    expect(player.phone).toEqual({ letters: [] });
    expect(player.bounty).toMatchObject({ completionCounts: {} });
    const loggedInPlayer = await repository.markLogin("tester");
    expect(loggedInPlayer.lastLoginAt).not.toBeNull();
    const renamedPlayer = await repository.rename("tester", "Commander");
    expect(renamedPlayer.name).toBe("Commander");
    const mainGirlPlayer = await repository.setMainGirl("tester", 9);
    expect(mainGirlPlayer.taskValues["131074"]).toBe(9);
    const clothes = await repository.changeGirlClothes("tester", 9, 1);
    expect(clothes.girl).toMatchObject({ girlId: 9, modelId: 1 });
    const fightModelPlayer = await repository.setGirlFightModel("tester", 9, true);
    expect(fightModelPlayer.taskValues["212617"]).toBe(1);
    const training = await repository.startGirlTraining(
      "tester",
      7,
      21,
      1_785_260_000_000,
    );
    expect(training).toMatchObject({
      girlId: 7,
      position: 21,
      endTime: 1_785_267_200,
      outdoorId: 72,
    });
    expect(training.player.taskValues).toMatchObject({
      "208611": 0,
      "208619": 21,
      "208620": 1_785_267_200,
      "208624": 72,
    });
    const repeatedTraining = await repository.startGirlTraining(
      "tester",
      7,
      21,
      1_785_270_000_000,
    );
    expect(repeatedTraining.endTime).toBe(1_785_267_200);
    await repository.setTaskValues("tester", [{ id: 123, value: 9 }]);
    const cafePlayer = await repository.makeCoffee("tester", 3, 240);
    expect(cafePlayer.cafe).toEqual({
      coffees: [{ coffeetype: 3, count: 240 }],
    });
    const settlement = await repository.settleLevel(
      "tester",
      1,
      1,
      1,
      3,
      3,
      [
        [15, 1, 1, 1, 1_000, 0],
        [7, 1, 4, 1, 2, 100],
        [1, 2, 1, 1, 2, 100],
      ],
      36,
    );
    expect(settlement.player.levels).toEqual([{ id: 65_793, star: 11 }]);
    expect(settlement.player).toMatchObject({ level: 4, exp: 4 });
    expect(settlement.experienceUpdate).toEqual({
      previousLevel: 1,
      previousExperience: 0,
      addedExperience: 36,
      level: 4,
      experience: 4,
      levelsGained: 3,
      vigourRecovery: 50,
    });
    expect(settlement.updatedMoney).toEqual([
      { id: 1, count: 75 },
      { id: 2, count: 1_000 },
    ]);
    expect(settlement.updatedItems).toMatchObject([
      { genre: 7, detail: 1, particular: 4, templateLevel: 1, count: 2 },
      { genre: 1, detail: 2, particular: 1, templateLevel: 1, count: 1 },
      { genre: 1, detail: 2, particular: 1, templateLevel: 1, count: 1 },
    ]);
    const awardedCards = settlement.updatedItems.filter(({ genre }) => genre === 1);
    expect(awardedCards).toHaveLength(2);
    expect(awardedCards.every(({ enhanceLevel }) => enhanceLevel === 1)).toBe(true);
    expect(new Set(awardedCards.map(({ guid }) => guid)).size).toBe(2);
    const awardedCard = settlement.updatedItems.find(({ genre }) => genre === 1);
    expect(awardedCard).toBeDefined();
    const formationPlayer = await repository.updateFormation("tester", {
      id: 2,
      title: "",
      fightCards: [
        {
          mainCardGuid: awardedCard?.guid ?? 0,
          secondaryCardGuids: [],
          usedCardGuid: 0,
          weaponGuid: 0,
          runeItemGuids: [],
        },
      ],
    });
    expect(formationPlayer.formations[1]?.fightCards[0]?.mainCardGuid).toBe(
      awardedCard?.guid,
    );
    const enhancement = await repository.enhanceCard("tester", 10_003, [
      { kind: 1, reference: 6, count: 1 },
    ]);
    expect(enhancement.card).toMatchObject({
      guid: 10_003,
      enhanceLevel: 4,
      enhanceExp: 167,
    });
    expect(enhancement.consumedItems).toMatchObject([
      { genre: 7, detail: 1, particular: 4, templateLevel: 1, count: 1 },
    ]);
    expect(enhancement.coinCost).toBe(500);
    expect(enhancement.updatedMoney).toEqual([{ id: 2, count: 500 }]);
    const completedPlayer = await repository.completeLevel("tester", 1, 1, 1, 5);
    expect(completedPlayer.levels).toEqual([{ id: 65_793, star: 23 }]);
    const letterPlayer = await repository.addPhoneLetter("tester", {
      topicId: 10_001,
      initiator: 7,
    });
    expect(letterPlayer.phone.letters[0]).toMatchObject({
      topicId: 10_001,
      initiator: 7,
      replyIds: [],
    });
    const repliedPlayer = await repository.replyToPhoneLetter("tester", 10_001, 21);
    expect(repliedPlayer.phone.letters[0]?.replyIds).toEqual([21]);
    await repository.removePhoneLetter("tester", 10_001);
    const mysteryLetterPlayer = await repository.addPhoneLetter("tester", {
      topicId: 1,
      initiator: 111,
    });
    expect(mysteryLetterPlayer.phone.letters).toMatchObject([
      { topicId: 1, initiator: 111, replyIds: [] },
    ]);

    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted.schemaVersion).toBe(1);
    expect(persisted.players.tester.name).toBe("Commander");
    expect(persisted.players.tester.live2dEnableLevel).toBe(3);
    expect(persisted.players.tester.live2dHX).toBe(false);
    expect(persisted.players.tester.taskValues["123"]).toBe(9);
    expect(persisted.players.tester.levels).toEqual([{ id: 65_793, star: 23 }]);
    expect(persisted.players.tester.money).toEqual([
      { id: 1, count: 75 },
      { id: 2, count: 500 },
      { id: 3, count: 0 },
    ]);
    expect(persisted.players.tester.cafe).toEqual({
      coffees: [{ coffeetype: 3, count: 240 }],
    });
    expect(persisted.players.tester.phone.letters).toMatchObject([
      { topicId: 1, initiator: 111, replyIds: [] },
    ]);
    expect(persisted.players.tester).not.toHaveProperty("cards");
    expect(persisted.players.tester).not.toHaveProperty("items");
    expect(
      persisted.players.tester.inventory.find(
        ({ guid }: { guid: number }) => guid === 10_003,
      ),
    ).toMatchObject({
      guid: 10_003,
      enhanceLevel: 4,
      enhanceExp: 167,
    });

    const rosterSettlement = await repository.settleLevel(
      "tester",
      1,
      2,
      1,
      3,
      0,
      [
        [1, 1, 81, 5, 1, 100],
        [1, 201, 1, 4, 1, 100],
      ],
      0,
    );
    expect(rosterSettlement.updatedGirls).toMatchObject([
      { girlId: 1, level: 1, exp: 0, modelId: 8001 },
      { girlId: 201, level: 1, exp: 0, modelId: 1 },
    ]);
    expect(rosterSettlement.player.taskValues).toMatchObject({
      // Girl 1's 8001 model uses the client's historical 1801 task offset.
      "263945": 2,
      "460377": 1,
      // Linked girls use extension groups 91 (suit) and 92 (card).
      "5963777": 2,
      "6029336": 1,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
