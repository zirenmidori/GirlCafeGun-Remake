import {
  decodeFields,
  fieldBytes,
  fieldVarint,
  firstNumber,
  firstString,
} from "./protobuf.js";
import { runeItemSkills } from "../game-data/rune-progression-data.js";

import type {
  HouseCafeSnapshot,
  HouseData,
  HouseGuestState,
  HouseMusicState,
  HouseVisitedState,
  HousePoseState,
  HouseRoomState,
  HouseThemeState,
} from "../game-data/house-data.js";
import type { AppConfig } from "../config.js";
import type { CafePet } from "../game-data/cafe-pets.js";
import { weaponPassiveSkills } from "../game-data/weapon-skill-data.js";
import { oathCardSkills } from "../game-data/oath-card-skill-data.js";
import type {
  CafeFurnitureState,
  FightCardState,
  FormationState,
  GirlState,
  InventoryEntryState,
  LevelState,
  MoneyState,
  Player,
  TaskChange,
} from "../persistence/player-repository.js";

export function parseRenameName(payload: Buffer): string {
  return firstString(decodeFields(payload), 3);
}

export function makeServerLuaCall(method: string, parameters: unknown): Buffer {
  return Buffer.concat([
    fieldBytes(1, method),
    fieldBytes(2, JSON.stringify(parameters)),
  ]);
}

// pvpproto.NotifyTeamMsg：客户端 PvpClient.NotifyTeamMsg 按 msg 弹提示
// （"no_room"/"need_ready"/"need_player"）。
export function makePvpTeamMessage(roleId: number, msg: string): Buffer {
  return Buffer.concat([fieldVarint(1, roleId), fieldBytes(2, msg)]);
}

function makeHousePose(pose: HousePoseState): Buffer {
  return Buffer.concat([
    fieldVarint(1, pose.templateId),
    fieldVarint(2, pose.parentTemplateId),
    fieldVarint(3, pose.place),
    fieldVarint(4, pose.posX),
    fieldVarint(5, pose.posY),
    fieldVarint(6, pose.rotate),
  ]);
}

function makeCafeFurniture(item: CafeFurnitureState): Buffer {
  return Buffer.concat([
    fieldVarint(1, item.templateId),
    fieldVarint(2, item.objId),
    fieldVarint(3, item.parentId),
    fieldVarint(4, item.roomId),
    // NCafeItem.UpdateInfo dereferences pose even for unplaced furniture.
    fieldBytes(5, makeHousePose(item.pose)),
    fieldVarint(6, item.status),
    fieldVarint(7, item.isNew ? 1 : 0),
    fieldVarint(8, item.bizcount),
  ]);
}
function makeHouseRoom(room: HouseRoomState): Buffer {
  return Buffer.concat([
    fieldVarint(1, room.roomId),
    ...room.girlIds.map((id) => fieldVarint(2, id)),
    fieldVarint(3, room.friendGirlId),
    fieldVarint(4, room.themeId),
    ...room.furnitureIds.map((id) => fieldVarint(5, id)),
  ]);
}
function makeHouseTheme(theme: HouseThemeState): Buffer {
  return Buffer.concat([
    fieldVarint(1, theme.themeId),
    fieldVarint(2, theme.templateThemeId),
    fieldBytes(3, theme.name),
    ...theme.poses.map((pose) => fieldBytes(4, makeHousePose(pose))),
    fieldVarint(5, theme.newGenerate ? 1 : 0),
    fieldVarint(6, theme.roomtype),
    fieldVarint(7, theme.createtime),
  ]);
}

function makeCafePet(pet: CafePet): Buffer {
  return Buffer.concat([
    fieldVarint(1, pet.uid),
    fieldVarint(2, pet.templateid),
    fieldVarint(3, pet.exp),
    fieldVarint(4, pet.hot),
    fieldBytes(5, pet.name),
    fieldVarint(6, pet.birthday),
    fieldVarint(7, pet.meetday),
    fieldVarint(8, pet.hobby),
    fieldVarint(9, pet.iq),
    fieldVarint(10, pet.nature),
    fieldVarint(11, pet.gender),
    fieldVarint(12, pet.lv),
    fieldVarint(15, pet.ext3 ?? 0),
  ]);
}

export function makeHouseInfoResponse(
  roleId: number,
  furniture: readonly CafeFurnitureState[] = [],
  rooms?: readonly HouseRoomState[],
  themes: readonly HouseThemeState[] = [],
  visited?: HouseVisitedState,
  pets: readonly CafePet[] = [],
): Buffer {
  const houseCache = Buffer.concat([
    fieldVarint(1, roleId),
    ...furniture.map((item) => fieldBytes(2, makeCafeFurniture(item))),
    ...themes.map((theme) => fieldBytes(3, makeHouseTheme(theme))),
    // Preserve the existing empty-house wire shape for profiles without layouts.
    ...(rooms === undefined
      ? [1, 2, 6].map((roomId) => fieldBytes(4, fieldVarint(1, roomId)))
      : rooms.map((room) => fieldBytes(4, makeHouseRoom(room)))),
    ...pets.map((pet) => fieldBytes(5, makeCafePet(pet))),
  ]);
  return Buffer.concat([
    fieldVarint(1, roleId),
    fieldBytes(2, houseCache),
    fieldBytes(
      3,
      visited === undefined ? Buffer.alloc(0) : makeHouseVisitedData(visited),
    ),
  ]);
}

/** gameproto.UpdateHouseRsp: merged durable objects, not raw client echoes. */
export function makeUpdateHouseResponse(roleId: number, changes: HouseData): Buffer {
  return Buffer.concat([
    fieldVarint(1, roleId),
    ...changes.rooms.map((room) => fieldBytes(2, makeHouseRoom(room))),
    ...changes.furniture.map((item) => fieldBytes(3, makeCafeFurniture(item))),
    ...changes.themes.map((theme) => fieldBytes(4, makeHouseTheme(theme))),
  ]);
}
export function makeAddFurnitureResponse(
  roleId: number,
  furniture: readonly CafeFurnitureState[],
): Buffer {
  return Buffer.concat([
    fieldVarint(1, roleId),
    ...furniture.map((item) => fieldBytes(2, makeCafeFurniture(item))),
  ]);
}
export function makeAddHouseThemeResponse(
  roleId: number,
  theme: HouseThemeState,
  furniture: readonly CafeFurnitureState[] = [],
): Buffer {
  return Buffer.concat([
    fieldVarint(1, roleId),
    fieldBytes(2, makeHouseTheme(theme)),
    ...furniture.map((item) => fieldBytes(3, makeCafeFurniture(item))),
  ]);
}
export function makeDeleteHouseThemeResponse(roleId: number, themeId: number): Buffer {
  return Buffer.concat([fieldVarint(1, roleId), fieldVarint(2, themeId)]);
}
/** gameproto.TimeRsp: servertime:uint64 (1), serverzone:int32 (2). */
export function makeTimeResponse(
  serverTimeSeconds: number,
  serverZone: number,
): Buffer {
  if (
    !Number.isSafeInteger(serverTimeSeconds) ||
    serverTimeSeconds < 0 ||
    !Number.isInteger(serverZone) ||
    serverZone < -0x8000_0000 ||
    serverZone > 0x7fff_ffff
  )
    throw new Error("Invalid server time/zone");
  return Buffer.concat([fieldVarint(1, serverTimeSeconds), fieldVarint(2, serverZone)]);
}

function makeHouseVisitedData(visited: HouseVisitedState): Buffer {
  return Buffer.concat([
    ...visited.entrustLog.map((entry) =>
      fieldBytes(
        1,
        Buffer.concat([fieldBytes(1, entry.roleName), fieldVarint(2, entry.endTime)]),
      ),
    ),
    fieldVarint(2, visited.entrustNum),
    fieldVarint(3, visited.entrustTime),
    ...visited.visitedList.map((entry) =>
      fieldBytes(
        4,
        Buffer.concat([
          fieldVarint(1, entry.roleId),
          fieldBytes(2, entry.name),
          fieldVarint(3, entry.time),
          fieldVarint(4, entry.girlId),
          fieldVarint(5, entry.modelId),
          fieldVarint(6, entry.comfortScore),
        ]),
      ),
    ),
    ...visited.taskList.map((entry) =>
      fieldBytes(
        5,
        Buffer.concat([
          fieldVarint(1, entry.roleId),
          fieldVarint(2, entry.startTime),
          fieldVarint(3, entry.missionId),
        ]),
      ),
    ),
  ]);
}
function makeHouseGuest(guest: HouseGuestState): Buffer {
  return Buffer.concat([
    fieldVarint(1, guest.position ?? 0),
    fieldVarint(2, guest.coffeetype ?? 0),
    fieldVarint(3, guest.customeridx),
    fieldVarint(4, guest.customertype),
    fieldVarint(5, guest.starttime),
  ]);
}
function makeHouseCafeSnapshot(cafe: HouseCafeSnapshot): Buffer {
  return Buffer.concat([
    fieldVarint(1, cafe.level),
    fieldVarint(2, cafe.comfort),
    fieldVarint(3, cafe.hot),
    fieldVarint(4, cafe.nextidx ?? 1),
    fieldVarint(5, cafe.basetime),
    fieldVarint(6, cafe.touchtime ?? 0),
    ...(cafe.roomgirlslist ?? [[], [], []]).map((room) =>
      fieldBytes(
        7,
        Buffer.concat([
          ...room.map((girl) => fieldVarint(1, girl.girlId)),
          ...room.map((girl) => fieldVarint(2, girl.modelId)),
        ]),
      ),
    ),
    ...(cafe.coffeelist ?? []).map((coffee) =>
      fieldBytes(
        8,
        Buffer.concat([
          fieldVarint(1, coffee.coffeetype),
          fieldVarint(2, coffee.count),
        ]),
      ),
    ),
    ...(cafe.seatlist ?? []).map((guest) => fieldBytes(9, makeHouseGuest(guest))),
    ...(cafe.customerqueue ?? []).map((guest) => fieldBytes(10, makeHouseGuest(guest))),
    fieldVarint(11, cafe.fixedtime ?? 0),
  ]);
}
/** HouseRandomListRsp carries repeated uint64 role IDs, not nested profiles. */
export function makeHouseRandomResponse(roleIds: readonly number[]): Buffer {
  if (roleIds.some((id) => !Number.isSafeInteger(id) || id <= 0))
    throw new Error("Invalid visited house role ID");
  return Buffer.concat(roleIds.map((id) => fieldVarint(1, id)));
}
/** OtherHouseInfoRsp has a distinct layout from GetHouseInfoRsp. */
export function makeOtherHouseInfoResponse(
  roleId: number,
  roleName: string,
  house: HouseData,
  cafe: HouseCafeSnapshot,
  entrustTime = 0,
  music?: HouseMusicState,
): Buffer {
  const houseCache = Buffer.concat([
    fieldVarint(1, roleId),
    ...house.furniture.map((item) => fieldBytes(2, makeCafeFurniture(item))),
    ...house.themes.map((theme) => fieldBytes(3, makeHouseTheme(theme))),
    ...house.rooms.map((room) => fieldBytes(4, makeHouseRoom(room))),
  ]);
  return Buffer.concat([
    fieldVarint(1, roleId),
    fieldBytes(2, roleName),
    fieldBytes(3, houseCache),
    fieldBytes(4, makeHouseCafeSnapshot(cafe)),
    fieldVarint(5, entrustTime),
    ...(music === undefined
      ? []
      : [
          fieldBytes(
            6,
            Buffer.concat([
              fieldVarint(1, music.id),
              fieldVarint(2, music.nG),
              fieldVarint(3, music.nD),
              fieldVarint(4, music.nP),
              fieldVarint(5, music.nL),
            ]),
          ),
        ]),
  ]);
}

export function makeVerifyResponse(
  player: Player,
  serverList: AppConfig["serverList"],
  createRole: boolean,
): Buffer {
  return Buffer.concat([
    fieldVarint(1, player.roleId),
    fieldVarint(2, serverList.id),
    fieldBytes(3, Buffer.alloc(16)),
    fieldVarint(5, serverList.aid),
    fieldVarint(6, serverList.sid),
    fieldVarint(7, 0),
    fieldVarint(8, Math.floor(Date.now() / 1000)),
    fieldVarint(9, createRole ? 1 : 0),
    // A nonempty account replaces the client's saved username. Keep it separate
    // from the opaque identity, which may already include the saved password.
    fieldBytes(10, ""),
  ]);
}

export function makePlayerNotification(player: Player): Buffer {
  const now = Math.floor(Date.now() / 1000);
  return Buffer.concat([
    fieldBytes(1, player.name),
    fieldVarint(2, player.level),
    fieldVarint(3, player.exp),
    fieldVarint(4, player.fightPower),
    ...player.money.map((money) => fieldBytes(5, makeMoneyInfo(money))),
    fieldVarint(6, player.registerTime),
    fieldVarint(7, now),
    fieldVarint(8, now),
    fieldVarint(9, player.serverZone),
    fieldBytes(10, makeGirlList(player.girls)),
    ...player.formations.map((formation) =>
      fieldBytes(11, makeFormationInfo(formation)),
    ),
    fieldBytes(12, makeLevelList(player.levels)),
    fieldVarint(20, player.roleId),
  ]);
}

/**
 * PlayerDataNtf uses two parallel repeated fields. Update types 1 and 2 are
 * player level and residual experience respectively.
 */
export function makePlayerUpdateNotification(player: Player): Buffer {
  return Buffer.concat([
    fieldVarint(1, 1),
    fieldVarint(1, 2),
    fieldVarint(2, player.level),
    fieldVarint(2, player.exp),
  ]);
}

export function makeLive2DEnableLevelNotification(level: number): Buffer {
  return fieldVarint(1, level);
}

export function makeLive2DHXNotification(active: boolean): Buffer {
  return fieldVarint(1, active ? 1 : 0);
}

/**
 * Encodes the login-time PhoneMsgNtf consumed by Game.PhoneMsgMgr.
 */
export function makePhoneMessageNotification(player: Player): Buffer {
  const byInitiator = new Map<number, typeof player.phone.letters>();
  for (const letter of player.phone?.letters ?? []) {
    const topics = byInitiator.get(letter.initiator) ?? [];
    topics.push(letter);
    byInitiator.set(letter.initiator, topics);
  }

  const moments = (player.phone?.moments?.topics ?? []).map((post) =>
    fieldBytes(
      2,
      Buffer.concat([
        fieldVarint(1, post.topicId),
        fieldVarint(2, post.createTime),
        fieldVarint(3, post.selectionId),
      ]),
    ),
  );

  return Buffer.concat([
    ...moments,
    ...[...byInitiator.entries()].map(([initiator, topics]) => {
      const latestCreateTime = Math.max(
        player.registerTime,
        ...topics.map(({ createTime }) => createTime),
      );
      const title = player.phone?.letterTitles?.[String(initiator)];
      const letter = Buffer.concat([
        fieldVarint(1, initiator),
        ...(title ? [fieldBytes(2, title)] : []),
        fieldVarint(3, latestCreateTime),
        ...topics.map((topicState) => {
          const topic = Buffer.concat([
            fieldVarint(1, topicState.topicId),
            ...topicState.replyIds.map((replyId) => fieldVarint(2, replyId)),
            ...(topicState.awardClaimed ? [fieldVarint(4, 1)] : []),
          ]);
          return fieldBytes(4, topic);
        }),
        fieldVarint(5, 0),
      ]);
      return fieldBytes(1, letter);
    }),
  ]);
}

function makeGirlInfo(girl: GirlState): Buffer {
  return Buffer.concat([
    fieldVarint(1, girl.girlId),
    fieldVarint(2, girl.level),
    fieldVarint(3, girl.exp),
    fieldVarint(4, girl.modelId),
    fieldVarint(5, girl.moodValue),
    fieldVarint(6, girl.vigor),
    fieldVarint(7, girl.flag),
  ]);
}

export function makeGirlUpdateNotification(
  girls: GirlState | readonly GirlState[],
): Buffer {
  const updates = Array.isArray(girls) ? girls : [girls];
  return Buffer.concat(updates.map((girl) => fieldBytes(1, makeGirlInfo(girl))));
}

function makeGirlList(girls: readonly GirlState[]): Buffer {
  return Buffer.concat(girls.map((girl) => fieldBytes(1, makeGirlInfo(girl))));
}

function makeFightCard(card: FightCardState): Buffer {
  const runeSlots = Array.from({ length: 4 }, (_, index) =>
    Number.isSafeInteger(card.runeItemGuids[index]) && card.runeItemGuids[index]! > 0
      ? card.runeItemGuids[index]!
      : 0,
  );
  return Buffer.concat([
    fieldVarint(1, card.mainCardGuid),
    ...card.secondaryCardGuids.map((guid) => fieldVarint(2, guid)),
    fieldVarint(3, card.usedCardGuid),
    fieldVarint(4, card.weaponGuid),
    ...runeSlots.map((guid) => fieldVarint(5, guid)),
  ]);
}

function makeFormationInfo(formation: FormationState): Buffer {
  return Buffer.concat([
    fieldVarint(1, formation.id),
    ...formation.fightCards.map((card) => fieldBytes(2, makeFightCard(card))),
    fieldBytes(3, formation.title),
  ]);
}

function makeLevel(level: LevelState): Buffer {
  return Buffer.concat([fieldVarint(1, level.id), fieldVarint(2, level.star)]);
}

function makeLevelList(levels: readonly LevelState[]): Buffer {
  return Buffer.concat(levels.map((level) => fieldBytes(1, makeLevel(level))));
}

export function makeFormationUpdateNotification(formation: FormationState): Buffer {
  return fieldBytes(1, makeFormationInfo(formation));
}

function makeMiniSkill(skillId: number, skillLevel: number, skillType: number): Buffer {
  return Buffer.concat([
    fieldVarint(1, skillId),
    fieldVarint(2, skillLevel),
    fieldVarint(3, skillType),
  ]);
}

function makeItemInfo(item: InventoryEntryState): Buffer {
  return Buffer.concat([
    fieldVarint(1, item.guid),
    fieldVarint(2, item.genre),
    fieldVarint(3, item.detail),
    fieldVarint(4, item.particular),
    fieldVarint(5, item.templateLevel),
    fieldVarint(6, item.count),
    fieldVarint(7, item.createTime),
    fieldVarint(8, item.enhanceLevel),
    fieldVarint(9, item.enhanceExp),
    fieldVarint(10, item.breakLevel),
    ...weaponPassiveSkills(
      item.genre,
      item.detail,
      item.particular,
      item.templateLevel,
      item.breakLevel,
    ).map((skill) =>
      fieldBytes(11, makeMiniSkill(skill.skillId, skill.skillLevel, skill.skillType)),
    ),
    ...oathCardSkills(item).map((skill) =>
      fieldBytes(11, makeMiniSkill(skill.skillId, skill.skillLevel, skill.skillType)),
    ),
    ...runeItemSkills(item).map((skill) =>
      fieldBytes(11, makeMiniSkill(skill.skillId, skill.skillLevel, skill.skillType)),
    ),
    fieldVarint(13, item.lockOn),
  ]);
}

export function makeItemNotification(player: Player): Buffer {
  return Buffer.concat([
    ...player.inventory.map((item) => fieldBytes(1, makeItemInfo(item))),
    fieldVarint(2, player.inventory.length),
  ]);
}

export function makeItemUpdateNotification(
  items: readonly InventoryEntryState[],
): Buffer {
  return Buffer.concat(items.map((item) => fieldBytes(1, makeItemInfo(item))));
}

function makeMoneyInfo(money: MoneyState): Buffer {
  return Buffer.concat([fieldVarint(1, money.id), fieldVarint(2, money.count)]);
}

export function makeMoneyUpdateNotification(money: MoneyState): Buffer {
  return fieldBytes(1, makeMoneyInfo(money));
}

export function makeTaskValueSync(
  taskValues: Readonly<Record<string, number>> = {},
): Buffer {
  return Buffer.concat(
    Object.entries(taskValues)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([id, value]) => {
        const task = Buffer.concat([fieldVarint(1, Number(id)), fieldVarint(2, value)]);
        return fieldBytes(1, task);
      }),
  );
}

export function parseTaskChanges(payload: Buffer): TaskChange[] {
  const changes: TaskChange[] = [];
  for (const field of decodeFields(payload)) {
    if (
      field.fieldNumber === 1 &&
      field.wireType === 2 &&
      Buffer.isBuffer(field.value)
    ) {
      const taskFields = decodeFields(field.value);
      const change = {
        id: firstNumber(taskFields, 1),
        value: firstNumber(taskFields, 2),
      };
      if (change.id > 0) changes.push(change);
    }
  }
  return changes;
}
