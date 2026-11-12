import { describe, expect, it } from "vitest";

import {
  makeItemNotification,
  makeItemUpdateNotification,
  makeFormationUpdateNotification,
  makeGirlUpdateNotification,
  makeHouseInfoResponse,
  makeLive2DEnableLevelNotification,
  makeLive2DHXNotification,
  makeMoneyUpdateNotification,
  makePhoneMessageNotification,
  makePlayerNotification,
  makePlayerUpdateNotification,
  makePvpTeamMessage,
  makeServerLuaCall,
  makeTaskValueSync,
  makeVerifyResponse,
  parseRenameName,
  parseTaskChanges,
} from "../src/protocol/messages.js";
import { makePacket, readPacket } from "../src/protocol/packet.js";
import { decodeFields, firstNumber, firstString } from "../src/protocol/protobuf.js";

describe("game protocol", () => {
  const rosterPlayer = {
    account: "roster-user",
    roleId: 1,
    name: "Commander",
    level: 1,
    exp: 0,
    fightPower: 0,
    serverZone: 8,
    registerTime: 1,
    lastLoginAt: null,
    live2dEnableLevel: 3,
    live2dHX: false,
    taskValues: {},
    nextItemGuid: 20_001,
    money: [
      { id: 1, count: 28 },
      { id: 2, count: 0 },
      { id: 3, count: 0 },
    ],
    inventory: [
      {
        guid: 10_001,
        genre: 1,
        detail: 7,
        particular: 1,
        templateLevel: 1,
        count: 1,
        createTime: 1,
        enhanceLevel: 1,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
      },
      {
        guid: 10_002,
        genre: 1,
        detail: 9,
        particular: 1,
        templateLevel: 3,
        count: 1,
        createTime: 1,
        enhanceLevel: 1,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 1,
      },
      {
        guid: 10_003,
        genre: 1,
        detail: 2,
        particular: 1,
        templateLevel: 1,
        count: 1,
        createTime: 1,
        enhanceLevel: 1,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
      },
    ],
    girls: [7, 9, 2].map((girlId) => ({
      girlId,
      level: 1,
      exp: 0,
      modelId: 1,
      moodValue: 100,
      vigor: 100,
      flag: 0,
    })),
    formations: [
      {
        id: 1,
        title: "初始阵容",
        fightCards: [10_001, 10_002, 10_003].map((guid) => ({
          mainCardGuid: guid,
          secondaryCardGuids: [],
          usedCardGuid: guid,
          weaponGuid: 0,
          runeItemGuids: [],
        })),
      },
    ],
    levels: [{ id: 65_793, star: 15 }],
    cafe: { coffees: [] },
    gacha: { pending: null },
    dailySignUp: {
      cycle: "1970-01",
      lastOperationalDate: null,
    },
    eightDaySignUp: {
      cumulativeDays: 0,
      lastOperationalDate: null,
    },
    phone: {
      letters: [
        {
          topicId: 10_001,
          initiator: 7,
          createTime: 1,
          replyIds: [],
        },
      ],
    },
  };

  it("encodes the 1-5 guide letter in PhoneMsgNtf", () => {
    const phoneFields = decodeFields(
      makePhoneMessageNotification({
        ...rosterPlayer,
      }),
    );
    const letter = phoneFields[0]?.value;
    expect(Buffer.isBuffer(letter)).toBe(true);
    const letterFields = decodeFields(letter as Buffer);
    expect(firstNumber(letterFields, 1)).toBe(7);
    expect(firstNumber(letterFields, 3)).toBe(1);

    const topic = letterFields.find(({ fieldNumber }) => fieldNumber === 4)?.value;
    expect(Buffer.isBuffer(topic)).toBe(true);
    expect(firstNumber(decodeFields(topic as Buffer), 1)).toBe(10_001);
    expect(
      makePhoneMessageNotification({
        ...rosterPlayer,
        phone: { letters: [] },
      }),
    ).toEqual(Buffer.alloc(0));
  });

  it("round-trips the packet header", () => {
    const payload = Buffer.from("0801", "hex");
    const packet = readPacket(makePacket(1048, 7, payload));
    expect(packet.command).toBe(1048);
    expect(packet.serial).toBe(7);
    expect(packet.payload).toEqual(payload);
  });

  it("encodes level and residual experience in PlayerDataNtf", () => {
    const fields = decodeFields(
      makePlayerUpdateNotification({ ...rosterPlayer, level: 4, exp: 4 }),
    );
    expect(
      fields
        .filter(({ fieldNumber }) => fieldNumber === 1)
        .map(({ value }) => Number(value)),
    ).toEqual([1, 2]);
    expect(
      fields
        .filter(({ fieldNumber }) => fieldNumber === 2)
        .map(({ value }) => Number(value)),
    ).toEqual([4, 4]);
  });

  it("encodes global Live2D EnableLevel and HX notifications", () => {
    expect(firstNumber(decodeFields(makeLive2DEnableLevelNotification(3)), 1)).toBe(3);
    expect(firstNumber(decodeFields(makeLive2DHXNotification(true)), 1)).toBe(1);
    expect(firstNumber(decodeFields(makeLive2DHXNotification(false)), 1)).toBe(0);
  });

  it("encodes the initial cafe, rest and dorm rooms", () => {
    expect(makeHouseInfoResponse(7).toString("hex")).toBe(
      "0807120e08072202080122020802220208061a00",
    );
  });

  it("encodes the pvp team message notification", () => {
    const payload = makePvpTeamMessage(7, "no_room");
    const fields = decodeFields(payload);
    expect(firstNumber(fields, 1)).toBe(7);
    expect(firstString(fields, 2)).toBe("no_room");
  });

  it("encodes task sync and decodes task changes", () => {
    const payload = makeTaskValueSync({ 65551: 6, 262181: 3 });
    const outer = decodeFields(payload);
    expect(outer).toHaveLength(2);
    const first = outer[0];
    expect(first).toBeDefined();
    expect(Buffer.isBuffer(first?.value)).toBe(true);
    const firstTask = decodeFields(first?.value as Buffer);
    expect(firstNumber(firstTask, 1)).toBe(65551);
    expect(firstNumber(firstTask, 2)).toBe(6);
    expect(parseTaskChanges(payload)).toEqual([
      { id: 65551, value: 6 },
      { id: 262181, value: 3 },
    ]);
  });

  it("marks a newly created role in VerifyRsp", () => {
    const payload = makeVerifyResponse(
      {
        account: "new-user",
        roleId: 1,
        name: "",
        level: 1,
        exp: 0,
        fightPower: 0,
        serverZone: 8,
        registerTime: 1,
        lastLoginAt: null,
        live2dEnableLevel: 3,
        live2dHX: false,
        taskValues: {},
        inventory: [],
        nextItemGuid: 20_001,
        money: [],
        girls: [],
        formations: [],
        levels: [],
        cafe: { coffees: [] },
        phone: { letters: [] },
        gacha: { pending: null },
        dailySignUp: { cycle: "1970-01", lastOperationalDate: null },
        eightDaySignUp: { cumulativeDays: 0, lastOperationalDate: null },
      },
      {
        id: 1,
        aid: 1,
        sid: 1,
        name: "test",
        state: 1,
        level: 1,
      },
      true,
    );
    expect(firstNumber(decodeFields(payload), 9)).toBe(1);

    const returningPayload = makeVerifyResponse(
      {
        account: "returning-user",
        roleId: 2,
        name: "",
        level: 1,
        exp: 0,
        fightPower: 0,
        serverZone: 8,
        registerTime: 1,
        lastLoginAt: "2026-07-28T00:00:00.000Z",
        live2dEnableLevel: 3,
        live2dHX: false,
        taskValues: {},
        inventory: [],
        nextItemGuid: 20_001,
        money: [],
        girls: [],
        formations: [],
        levels: [],
        cafe: { coffees: [] },
        phone: { letters: [] },
        gacha: { pending: null },
        dailySignUp: { cycle: "1970-01", lastOperationalDate: null },
        eightDaySignUp: { cumulativeDays: 0, lastOperationalDate: null },
      },
      {
        id: 1,
        aid: 1,
        sid: 1,
        name: "test",
        state: 1,
        level: 1,
      },
      false,
    );
    expect(firstNumber(decodeFields(returningPayload), 9)).toBe(0);
  });

  it("keeps password-login identities attached to saved progress across client restarts", () => {
    const savedPlayer = {
      ...rosterPlayer,
      account: "commander:local-password",
      level: 2,
      exp: 8,
      taskValues: { 65551: 6 },
    };
    const profiles = new Map([[savedPlayer.account, savedPlayer]]);
    let preferences = { account: "commander", password: "local-password" };

    for (let restart = 0; restart < 2; restart++) {
      // Verify() appends the separately saved password after each restart.
      preferences = structuredClone(preferences);
      const identity = `${preferences.account}:${preferences.password}`;
      const player = profiles.get(identity);
      expect(player).toBe(savedPlayer);
      if (!player) throw new Error("Login selected a different player profile");

      const response = decodeFields(
        makeVerifyResponse(
          player,
          { id: 1, aid: 1, sid: 1, name: "test", state: 1, level: 1 },
          false,
        ),
      );
      // GameManager.StartVerify persists a nonempty response account as username.
      const responseAccount = firstString(response, 10);
      if (responseAccount !== "") preferences.account = responseAccount;

      expect(firstNumber(response, 1)).toBe(savedPlayer.roleId);
      const notification = decodeFields(makePlayerNotification(player));
      expect(firstNumber(notification, 2)).toBe(2);
      expect(firstNumber(notification, 3)).toBe(8);
      expect(player.taskValues[65551]).toBe(6);
      expect(player.levels).toEqual(rosterPlayer.levels);
    }

    expect(preferences.account).toBe("commander");
    expect(profiles.size).toBe(1);
  });

  it("decodes the player name from RenameReq field 3", () => {
    expect(parseRenameName(Buffer.from("1a06797979797979", "hex"))).toBe("yyyyyy");
  });

  it("encodes an NtfS2CCall callback", () => {
    const payload = makeServerLuaCall("GirlLogic", {
      sCmd: "HeadTouched",
      nId: 9,
      nType: 2,
    });
    const fields = decodeFields(payload);
    expect(firstString(fields, 1)).toBe("GirlLogic");
    expect(JSON.parse(firstString(fields, 2))).toEqual({
      sCmd: "HeadTouched",
      nId: 9,
      nType: 2,
    });
  });

  it("encodes the starter girls and default formation in PlayerNtf", () => {
    const fields = decodeFields(makePlayerNotification(rosterPlayer));
    const girlList = decodeFields(
      fields.find((field) => field.fieldNumber === 10)?.value as Buffer,
    );
    const girlIds = girlList.map((field) =>
      firstNumber(decodeFields(field.value as Buffer), 1),
    );
    expect(girlIds).toEqual([7, 9, 2]);

    const formation = decodeFields(
      fields.find((field) => field.fieldNumber === 11)?.value as Buffer,
    );
    expect(firstNumber(formation, 1)).toBe(1);
    expect(formation.filter((field) => field.fieldNumber === 2)).toHaveLength(3);

    const levelList = decodeFields(
      fields.find((field) => field.fieldNumber === 12)?.value as Buffer,
    );
    const firstLevel = decodeFields(levelList[0]?.value as Buffer);
    expect(firstNumber(firstLevel, 1)).toBe(65_793);
    expect(firstNumber(firstLevel, 2)).toBe(15);

    const money = fields
      .filter((field) => field.fieldNumber === 5)
      .map((field) => decodeFields(field.value as Buffer));
    expect(
      money.map((entry) => [firstNumber(entry, 1), firstNumber(entry, 2)]),
    ).toEqual([
      [1, 28],
      [2, 0],
      [3, 0],
    ]);
  });

  it("encodes a single updated girl in GirlUpdateNtf", () => {
    const outer = decodeFields(
      makeGirlUpdateNotification({
        girlId: 9,
        level: 3,
        exp: 12,
        modelId: 2,
        moodValue: 88,
        vigor: 77,
        flag: 1,
      }),
    );
    expect(outer).toHaveLength(1);
    const girl = decodeFields(outer[0]?.value as Buffer);
    expect(firstNumber(girl, 1)).toBe(9);
    expect(firstNumber(girl, 2)).toBe(3);
    expect(firstNumber(girl, 3)).toBe(12);
    expect(firstNumber(girl, 4)).toBe(2);
    expect(firstNumber(girl, 5)).toBe(88);
    expect(firstNumber(girl, 6)).toBe(77);
    expect(firstNumber(girl, 7)).toBe(1);
  });

  it("encodes the three starter character cards in ItemNtf", () => {
    const fields = decodeFields(makeItemNotification(rosterPlayer));
    const cards = fields
      .filter((field) => field.fieldNumber === 1)
      .map((field) => decodeFields(field.value as Buffer));
    expect(cards).toHaveLength(3);
    expect(
      cards.map((card) => [
        firstNumber(card, 2),
        firstNumber(card, 3),
        firstNumber(card, 4),
        firstNumber(card, 5),
      ]),
    ).toEqual([
      [1, 7, 1, 1],
      [1, 9, 1, 3],
      [1, 2, 1, 1],
    ]);
    expect(firstNumber(fields, 2)).toBe(3);
    expect(firstNumber(cards[1]!, 13)).toBe(1);
  });

  it("encodes oath skill levels using the exact template skill IDs and native types", () => {
    const skillsOf = (
      templateLevel: number,
      levels: [number, number, number, number],
    ) => {
      const outer = decodeFields(
        makeItemUpdateNotification([
          {
            ...rosterPlayer.inventory[2]!,
            detail: 2,
            particular: 17,
            templateLevel,
            cardSkillLevels: levels,
          },
        ]),
      );
      const item = decodeFields(outer[0]!.value as Buffer);
      expect(item.some(({ fieldNumber }) => fieldNumber === 12)).toBe(false);
      return item
        .filter(({ fieldNumber }) => fieldNumber === 11)
        .map(({ value }) => {
          const skill = decodeFields(value as Buffer);
          return [firstNumber(skill, 1), firstNumber(skill, 2), firstNumber(skill, 3)];
        });
    };
    expect(skillsOf(3, [1, 2, 3, 4])).toEqual([
      [30392, 1, 3],
      [28267, 2, 2],
      [28271, 3, 2],
      [38144, 4, 2],
    ]);
    expect(skillsOf(4, [2, 2, 2, 2])).toEqual([
      [30398, 2, 3],
      [28269, 2, 2],
      [28272, 2, 2],
      [38145, 2, 2],
    ]);
    expect(skillsOf(5, [4, 4, 4, 4])).toEqual([
      [30398, 4, 3],
      [28269, 4, 2],
      [28272, 4, 2],
      [38145, 4, 2],
    ]);
  });

  it("preserves legacy card and weapon skill payloads when adding oath skills", () => {
    const card = decodeFields(
      decodeFields(
        makeItemUpdateNotification([
          {
            ...rosterPlayer.inventory[2]!,
            particular: 17,
            templateLevel: 5,
          },
        ]),
      )[0]!.value as Buffer,
    );
    expect(card.filter(({ fieldNumber }) => fieldNumber === 11)).toHaveLength(0);
    const weapon = decodeFields(
      decodeFields(
        makeItemUpdateNotification([
          {
            ...rosterPlayer.inventory[0]!,
            genre: 2,
            detail: 1,
            particular: 3,
            templateLevel: 1,
            breakLevel: 3,
            cardSkillLevels: [4, 4, 4, 4],
          },
        ]),
      )[0]!.value as Buffer,
    );
    const skills = weapon
      .filter(({ fieldNumber }) => fieldNumber === 11)
      .map(({ value }) => {
        const skill = decodeFields(value as Buffer);
        return [firstNumber(skill, 1), firstNumber(skill, 2), firstNumber(skill, 3)];
      });
    expect(skills).toEqual([[40239, 4, 2]]);
  });

  it("encodes a FormationInfoUpdateNtf", () => {
    const fields = decodeFields(
      makeFormationUpdateNotification(rosterPlayer.formations[0]!),
    );
    const formation = decodeFields(fields[0]?.value as Buffer);
    expect(firstNumber(formation, 1)).toBe(1);
    expect(formation.filter((field) => field.fieldNumber === 2)).toHaveLength(3);
  });

  it("encodes four positional rune fields including empty slots", () => {
    const formation = {
      id: 1,
      title: "modules",
      fightCards: [
        {
          mainCardGuid: 10_001,
          secondaryCardGuids: [],
          usedCardGuid: 0,
          weaponGuid: 0,
          runeItemGuids: [20_478, 0, 0, 20_483],
        },
      ],
    };
    const outer = decodeFields(makeFormationUpdateNotification(formation));
    const formationFields = decodeFields(outer[0]!.value as Buffer);
    const fightCard = decodeFields(
      formationFields.find(({ fieldNumber }) => fieldNumber === 2)!.value as Buffer,
    );
    expect(
      fightCard
        .filter(({ fieldNumber }) => fieldNumber === 5)
        .map(({ value }) => Number(value)),
    ).toEqual([20_478, 0, 0, 20_483]);
  });

  it("encodes incremental item and money notifications", () => {
    const item = {
      ...rosterPlayer.inventory[0]!,
      guid: 20_001,
      genre: 7,
      detail: 1,
      particular: 4,
      count: 2,
    };
    const itemFields = decodeFields(makeItemUpdateNotification([item]));
    const encodedItem = decodeFields(itemFields[0]?.value as Buffer);
    expect(firstNumber(encodedItem, 1)).toBe(20_001);
    expect(firstNumber(encodedItem, 6)).toBe(2);

    const moneyFields = decodeFields(makeMoneyUpdateNotification({ id: 1, count: 25 }));
    const encodedMoney = decodeFields(moneyFields[0]?.value as Buffer);
    expect(firstNumber(encodedMoney, 1)).toBe(1);
    expect(firstNumber(encodedMoney, 2)).toBe(25);
  });
});
