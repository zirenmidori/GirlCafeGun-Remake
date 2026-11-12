import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";

import type { AppConfig } from "../config.js";
import { makeBackgroundLuaResponse } from "../game-data/background-lua-data.js";
import { dailySignUpOperationalDate } from "../game-data/daily-sign-up-data.js";
import { getMomentDefinition } from "../game-data/moments-data.js";
import { dailyPullMailAwards, type MailAction } from "../game-data/mail-data.js";
import {
  bountyKeyItem,
  bountyOperationalDate,
  effectiveBountyEnergyCost,
  getBountyLevel,
  isBountyOpen,
  LUA_COMMAND_BOUNTY_FAIL,
  LUA_COMMAND_BOUNTY_JOIN,
  LUA_COMMAND_BOUNTY_PASS,
  makeBountyDailyTaskId,
  makeBountyPassTaskId,
  rollBountyRun,
  thiefAwards,
  type BountyRun,
} from "../game-data/bounty-data.js";
import {
  LUA_COMMAND_CARD_LEVEL_UP_COMMON,
  parseCardEnhancementRequest,
} from "../game-data/card-enhancement-data.js";
import {
  LUA_COMMAND_CARD_DECOMPOSE,
  parseCardDecompositionRequest,
} from "../game-data/card-decomposition-data.js";
import {
  parseWeaponBreakthroughRequest,
  WeaponBreakthroughError,
} from "../game-data/weapon-breakthrough-data.js";
import { parseWeaponEnhancementRequest } from "../game-data/weapon-enhancement-data.js";
import { RUNE_SLOT_COUNT } from "../game-data/rune-data.js";
import { RuneOperationError } from "../game-data/rune-progression-data.js";
import { cardRarityOf } from "../game-data/custom-card-data.js";
import {
  parseWeaponDecompositionRequest,
  WEAPON_LOGIC_COMMAND_DECOMPOSE,
} from "../game-data/weapon-decomposition-data.js";
import {
  ChapterCatalog,
  effectiveEnergyCost,
  rollChapterAwards,
} from "../game-data/chapter-config.js";
import { LUA_COMMAND_CAFE_FURNITURE_COUNT } from "../game-data/cafe-data.js";
import { cafePetList, CafePetOperationError } from "../game-data/cafe-pets.js";
import type { CafeNotification } from "../game-data/cafe-runtime.js";
import {
  LUA_COMMAND_WRITE_GUIDE_LOG,
  makeGuideLogAcknowledgement,
} from "../game-data/guide-data.js";
import { EIGHT_DAY_SIGN_UP_ACTIVITY_ID } from "../game-data/eight-day-sign-up-data.js";
import {
  GachaCatalog,
  type GachaRollResult,
  type Gdpl,
} from "../game-data/gacha-data.js";
import {
  activeGachaBannerIds,
  GachaRotationCatalog,
  ROTATING_GACHA_POOL_ID,
} from "../game-data/gacha-rotation-data.js";
import {
  LUA_COMMAND_SHOP_BUY_GOODS,
  LUA_COMMAND_SHOP_GOODS_LIST,
  LUA_COMMAND_SHOP_REFRESH_GOODS_LIST,
  makeShopGoodsListTbParam,
  ShopCatalog,
} from "../game-data/shop-data.js";
import {
  FREE_GIFT_PACK_AWARD,
  FREE_GIFT_PACK_ID,
  IB_SHOP_ERROR_UNKNOWN_ITEM,
  LUA_COMMAND_DO_RECHARGE,
  LUA_COMMAND_PAY_RESULT_SUCCESS,
  MONTH_CARD_ITEM_ID,
} from "../game-data/ib-shop-data.js";
import { getPhoneLetterDefinition } from "../game-data/phone-message-data.js";
import { PvpSessionManager, type PvpSession } from "../game-data/pvp-session.js";
import { buildPvpEquipSolution } from "../game-data/pvp-solution.js";
import { cafeRoomGirls } from "../game-data/cafe-runtime.js";
import {
  parseHouseInfoRequest,
  parseUpdateHouseRequest,
  parseAddFurnitureRequest,
  parseAddHouseThemeRequest,
  parseDeleteHouseThemeRequest,
  isNativeFixedHouseObjectId,
} from "../game-data/house-data.js";
import type { Logger } from "../logger.js";
import {
  BountySettlementError,
  CafeOperationError,
  InsufficientGoldError,
  InsufficientVigourError,
  InsufficientGachaCurrencyError,
  EightDaySignUpError,
  GuideMissionError,
  GirlGiftError,
  HeadpatError,
  MomentSelectionError,
  PromiseOperationError,
  type PromiseOperationResult,
  type CafeOperationResult,
  type PromiseFightEvent,
  GirlLevelAwardError,
  GirlTrainingError,
  GirlViewStoryError,
  IBShopError,
  ShopError,
  ChapterStarAwardError,
  CharacterCardDecompositionError,
  DailyMissionError,
  isCharacterCard,
  makeGachaTaskId,
  CustomGirlOutfitUnavailableError,
  makeLevelId,
  MONEY_VIGOUR,
  type FormationState,
  type GirlState,
  type Player,
  type PlayerRepository,
  WeaponDecompositionError,
} from "../persistence/player-repository.js";
import { COMMAND, commandName } from "../protocol/commands.js";
import {
  makePlayerNotification,
  makeItemNotification,
  makeItemUpdateNotification,
  makeFormationUpdateNotification,
  makeGirlUpdateNotification,
  makeHouseInfoResponse,
  makeUpdateHouseResponse,
  makeAddFurnitureResponse,
  makeAddHouseThemeResponse,
  makeDeleteHouseThemeResponse,
  makeTimeResponse,
  makeLive2DEnableLevelNotification,
  makeLive2DHXNotification,
  makeMoneyUpdateNotification,
  makePhoneMessageNotification,
  makeServerLuaCall,
  makeTaskValueSync,
  makeVerifyResponse,
  makePlayerUpdateNotification,
  parseRenameName,
  parseTaskChanges,
} from "../protocol/messages.js";
import { HEADER_SIZE, makePacket, readPacket } from "../protocol/packet.js";
import {
  makeAddMailNotification,
  makeMailListResponse,
  makeMailMutationResponse,
  parseMailAction,
} from "../protocol/mail-messages.js";
import { decodeFields, firstNumber, firstString } from "../protocol/protobuf.js";
import {
  decodePvpBeginMatchRequest,
  decodePvpCreateTeamRequest,
  decodePvpEmoji,
  decodePvpKicking,
  decodePvpRoomPublic,
  decodePvpTeamReadyRequest,
  makePvpBeginMatchResponse,
  makePvpCheckRoomResponse,
  makePvpCreateTeamResponse,
  makePvpEndMatchResponse,
  makePvpExitTeamResponse,
  makePvpKickingResponse,
  makePvpNotifyConnectToPvp,
  makePvpNotifyEmoji,
  makePvpNotifyRoomPublicAttr,
  makePvpNotifyTeamData,
  makePvpNotifyTeamReadyData,
  makePvpPingMgrResponse,
  makePvpPlayerBaseInfo,
  makePvpPlayerInfo,
  makePvpPlayerList,
  makePvpTeam,
  makePvpTeamDataResponse,
  makePvpTeamReadyResponse,
  makePvpUpdatePlayerInfoResponse,
  makePvpZanResponse,
} from "../protocol/pvp-messages.js";

interface GatewayServerOptions {
  config: AppConfig;
  logger: Logger;
  players: PlayerRepository;
  pvpSessions?: PvpSessionManager;
}

const SETTLEMENT_CACHE_TTL_MS = 120_000;
const MAIL_RESPONSES = new Map<number, number>([
  [COMMAND.GET_MAIL_REQ, COMMAND.GET_MAIL_RSP],
  [COMMAND.GET_MAIL_ITEM_REQ, COMMAND.GET_MAIL_ITEM_RSP],
  [COMMAND.SET_MAIL_READ_REQ, COMMAND.SET_MAIL_READ_RSP],
  [COMMAND.DEL_MAIL_REQ, COMMAND.DEL_MAIL_RSP],
]);

interface ConnectionContext {
  account: string;
  verifiedAccount: string | null;
  player: Player | null;
  isNewPlayer: boolean;
  headpatResponses: Map<string, { response: unknown; expiresAt: number }>;
  cafeResponses: Map<string, { response: unknown; expiresAt: number }>;
  petResponses: Map<
    string,
    { response: unknown; notifications: CafeNotification[]; expiresAt: number }
  >;
  houseResponses: Map<string, { response: Buffer; expiresAt: number }>;
  settlementResponses: Map<
    string,
    { response: Record<string, unknown>; expiresAt: number }
  >;
  activeChapter: {
    chapter: number;
    index: number;
    difficulty: number;
    promiseFight: PromiseFightEvent | null;
  } | null;
  activeBounty: {
    promiseFight: PromiseFightEvent | null;
    run: BountyRun;
    formationId: number;
    keyItem: [number, number, number, number, number] | null;
  } | null;
  lastBountySettlement: {
    key: string;
    response: Record<string, unknown>;
  } | null;
}

interface HexPreview {
  hex: string;
  truncated: boolean;
}

/** Snapshot the owned combat roster before a run, so later team changes and
 * duplicate settlement retries cannot manufacture oath progress. */
function promiseFightRoster(player: Player, formationId: number): number[] | null {
  const formation = player.formations.find((entry) => entry.id === formationId);
  if (!formation) return null;
  const owned = new Set(
    player.inventory.filter(isCharacterCard).map((card) => card.guid),
  );
  const guids = formation.fightCards
    .map((card) => card.mainCardGuid)
    .filter((guid) => guid > 0);
  if (guids.length === 0 || guids.some((guid) => !owned.has(guid))) return null;
  return [...new Set(guids)];
}

function peerName(socket: Socket): string {
  return `${socket.remoteAddress}:${socket.remotePort}`;
}

function hexPreview(buffer: Buffer, maxBytes: number): HexPreview {
  const preview = buffer.subarray(0, maxBytes);
  return {
    hex: preview.toString("hex"),
    truncated: preview.length < buffer.length,
  };
}

export interface LuaCall {
  method: string;
  json: string;
  parameters: unknown;
}

function parseLuaCall(payload: Buffer): LuaCall | null {
  try {
    const fields = decodeFields(payload);
    const json = firstString(fields, 2);
    return {
      method: firstString(fields, 1),
      json,
      parameters: JSON.parse(json) as unknown,
    };
  } catch {
    return null;
  }
}

function isHeadTouchedCall(call: LuaCall | null): call is LuaCall & {
  parameters: { sCmd: "HeadTouched"; nId?: unknown; nType?: unknown };
} {
  if (
    call?.method !== "GirlLogic" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return false;
  }
  const parameters = call.parameters as Record<string, unknown>;
  return parameters.sCmd === "HeadTouched";
}

type GirlAppearanceCall =
  | { command: "SetMainGirl"; girlId: number }
  | { command: "ChangeCloth"; girlId: number; modelId: number }
  | { command: "SetModelInFight"; girlId: number; enabled: boolean };

interface GirlTrainingCall {
  girlId: number;
  position: number;
}

interface GirlGiftCall {
  girlId: number;
  item: Gdpl;
  count: number;
}

interface GirlLevelAwardCall {
  girlId: number;
  level: number;
}

interface DoRechargeCall {
  shopType: number;
  id: number;
}

function parseDoRechargeCall(call: LuaCall | null): DoRechargeCall | null {
  if (
    call?.method !== "LuaCall" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return null;
  }
  const parameters = call.parameters as Record<string, unknown>;
  if (parameters.sCmd !== LUA_COMMAND_DO_RECHARGE) return null;
  if (typeof parameters.tbParam !== "object" || parameters.tbParam === null) {
    return null;
  }
  const tbParam = parameters.tbParam as Record<string, unknown>;
  const shopType = Number(tbParam.Type);
  const id = Number(tbParam.Id);
  if (!Number.isSafeInteger(shopType) || !Number.isSafeInteger(id) || id <= 0) {
    return null;
  }
  return { shopType, id };
}

function parseGirlGiftCall(call: LuaCall | null): GirlGiftCall | null {
  if (
    call?.method !== "GirlLogic" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return null;
  }

  const parameters = call.parameters as Record<string, unknown>;
  if (parameters.sCmd !== "GirlGift") return null;
  const girlId = Number(parameters.nId);
  const rawItem = parameters.tbItem;
  if (!Array.isArray(rawItem) || rawItem.length !== 4) return null;
  const item = rawItem.map(Number);
  if (
    !item.every((value) => Number.isSafeInteger(value) && value > 0) ||
    !Number.isSafeInteger(girlId) ||
    girlId <= 0
  ) {
    return null;
  }
  const count = parameters.ItemNum === undefined ? 1 : Number(parameters.ItemNum);
  if (!Number.isSafeInteger(count) || count <= 0) return null;
  return { girlId, item: item as unknown as Gdpl, count };
}

function parseGirlLevelAwardCall(call: LuaCall | null): GirlLevelAwardCall | null {
  if (
    call?.method !== "GirlLogic" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return null;
  }

  const parameters = call.parameters as Record<string, unknown>;
  if (parameters.sCmd !== "LevelAward") return null;
  const girlId = Number(parameters.nId);
  const level = Number(parameters.nLevel);
  return Number.isSafeInteger(girlId) &&
    girlId > 0 &&
    Number.isSafeInteger(level) &&
    level > 0
    ? { girlId, level }
    : null;
}

function parseGirlEndTrainCall(call: LuaCall | null): { girlId: number } | null {
  if (
    call?.method !== "GirlLogic" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return null;
  }

  const parameters = call.parameters as Record<string, unknown>;
  if (parameters.sCmd !== "EndTrain") return null;
  const girlId = Number(parameters.nId);
  return Number.isSafeInteger(girlId) && girlId > 0 ? { girlId } : null;
}

interface GirlViewStoryCall {
  girlId: number;
  storyType: number;
  storyIndex: number;
}

function parseGirlViewStoryCall(call: LuaCall | null): GirlViewStoryCall | null {
  if (
    call?.method !== "GirlLogic" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return null;
  }

  const parameters = call.parameters as Record<string, unknown>;
  if (parameters.sCmd !== "ViewStory") return null;
  const girlId = Number(parameters.nId);
  const storyType = Number(parameters.nType);
  const storyIndex = Number(parameters.nStoryId);
  if (
    !Number.isSafeInteger(girlId) ||
    girlId <= 0 ||
    !Number.isSafeInteger(storyType) ||
    !Number.isSafeInteger(storyIndex) ||
    storyIndex <= 0
  ) {
    return null;
  }
  return { girlId, storyType, storyIndex };
}

function parseGirlTrainingCall(call: LuaCall | null): GirlTrainingCall | null {
  if (
    call?.method !== "GirlLogic" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return null;
  }

  const parameters = call.parameters as Record<string, unknown>;
  if (parameters.sCmd !== "StartTrain") return null;
  const girlId = Number(parameters.nId);
  const position = Number(parameters.nPos);
  return Number.isSafeInteger(girlId) &&
    girlId > 0 &&
    Number.isSafeInteger(position) &&
    position > 0
    ? { girlId, position }
    : null;
}

function parseGirlAppearanceCall(call: LuaCall | null): GirlAppearanceCall | null {
  if (
    call?.method !== "GirlLogic" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return null;
  }

  const parameters = call.parameters as Record<string, unknown>;
  const girlId = Number(parameters.nId);
  if (!Number.isSafeInteger(girlId) || girlId <= 0) return null;

  if (parameters.sCmd === "SetMainGirl") {
    return { command: "SetMainGirl", girlId };
  }
  if (parameters.sCmd === "ChangeCloth") {
    const modelId = Number(parameters.nSuit);
    return Number.isSafeInteger(modelId) && modelId > 0
      ? { command: "ChangeCloth", girlId, modelId }
      : null;
  }
  if (parameters.sCmd === "SetModelInFight") {
    const use = Number(parameters.nUse);
    return use === 0 || use === 1
      ? { command: "SetModelInFight", girlId, enabled: use === 1 }
      : null;
  }
  return null;
}

interface FormationUpdateCall {
  command: number;
  formation: FormationState;
}

export function parseFormationUpdateCall(
  call: LuaCall | null,
  currentPlayer: Player | null,
): FormationUpdateCall | null {
  if (
    call?.method !== "LuaCall" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return null;
  }
  const parameters = call.parameters as Record<string, unknown>;
  if (![21, 22, 23].includes(parameters.sCmd as number)) return null;
  if (typeof parameters.tbParam !== "object" || parameters.tbParam === null) {
    return null;
  }
  const update = parameters.tbParam as Record<string, unknown>;
  if (!Number.isSafeInteger(update.Id) || !Array.isArray(update.Info)) return null;

  const fightCards = update.Info.map((value) => {
    if (typeof value !== "object" || value === null) {
      throw new Error("Invalid formation card data");
    }
    const card = value as Record<string, unknown>;
    const numbers = (candidate: unknown): number[] =>
      Array.isArray(candidate)
        ? candidate.filter(
            (item): item is number => Number.isSafeInteger(item) && item > 0,
          )
        : [];
    return {
      mainCardGuid: Number(card.MainCard) || 0,
      secondaryCardGuids: numbers(card.Secondarycard),
      usedCardGuid: Number(card.UsedCard) || 0,
      weaponGuid: Number(card.WeaponId) || 0,
      runeItemGuids: Array.from({ length: RUNE_SLOT_COUNT }, (_, index) => {
        if (!Array.isArray(card.Rune)) return 0;
        const guid = card.Rune[index];
        return Number.isSafeInteger(guid) && Number(guid) > 0 ? Number(guid) : 0;
      }),
    };
  });
  const id = Number(update.Id);
  return {
    command: Number(parameters.sCmd),
    formation: {
      id,
      title:
        currentPlayer?.formations.find((formation) => formation.id === id)?.title ?? "",
      fightCards,
    },
  };
}

interface ChapterCall {
  state: number;
  parameters: Record<string, unknown>;
}

function parseChapterCall(call: LuaCall | null): ChapterCall | null {
  if (!call || typeof call.parameters !== "object" || call.parameters === null) {
    return null;
  }

  let parameters = call.parameters as Record<string, unknown>;
  if (call.method === "LuaCall") {
    if (parameters.sCmd !== 252) return null;
    if (typeof parameters.tbParam !== "object" || parameters.tbParam === null) {
      return null;
    }
    const wrappedCall = parameters.tbParam as Record<string, unknown>;
    if (
      wrappedCall.sCmd !== "ChapterMsg" ||
      typeof wrappedCall.tbParam !== "object" ||
      wrappedCall.tbParam === null
    ) {
      return null;
    }
    parameters = wrappedCall.tbParam as Record<string, unknown>;
  } else if (call.method !== "ChapterMsg") {
    return null;
  }

  const state = Number(parameters.nState);
  return Number.isSafeInteger(state) ? { state, parameters } : null;
}

function parseNumericLuaCommand(call: LuaCall | null): number | null {
  if (
    call?.method !== "LuaCall" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return null;
  }
  const command = Number((call.parameters as Record<string, unknown>).sCmd);
  return Number.isSafeInteger(command) ? command : null;
}

type BountyCall =
  | {
      command: typeof LUA_COMMAND_BOUNTY_JOIN;
      activityId: number;
      difficulty: number;
      formationId: number;
      keyType: number;
      parameters: Record<string, unknown>;
    }
  | {
      command: typeof LUA_COMMAND_BOUNTY_PASS | typeof LUA_COMMAND_BOUNTY_FAIL;
      activityId: number;
      difficulty: number;
      formationId: number;
      keyType: number;
      parameters: Record<string, unknown>;
    };

export function parseBountyCall(call: LuaCall | null): BountyCall | null {
  if (
    call?.method !== "LuaCall" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return null;
  }
  let wrapper = call.parameters as Record<string, unknown>;
  if (
    Number(wrapper.sCmd) === 252 &&
    typeof wrapper.tbParam === "object" &&
    wrapper.tbParam !== null
  ) {
    wrapper = wrapper.tbParam as Record<string, unknown>;
  }
  const command = Number(wrapper.sCmd);
  if (
    command !== LUA_COMMAND_BOUNTY_JOIN &&
    command !== LUA_COMMAND_BOUNTY_PASS &&
    command !== LUA_COMMAND_BOUNTY_FAIL
  ) {
    return null;
  }
  if (typeof wrapper.tbParam !== "object" || wrapper.tbParam === null) return null;
  const parameters = wrapper.tbParam as Record<string, unknown>;
  const activityId = Number(
    command === LUA_COMMAND_BOUNTY_JOIN ? parameters.id : parameters.nActivityId,
  );
  const difficulty = Number(
    command === LUA_COMMAND_BOUNTY_JOIN ? parameters.diff : parameters.nDiff,
  );
  const formationId = Number(parameters.nFormationId);
  const keyType = Number(parameters.key) || 0;
  if (
    !Number.isSafeInteger(activityId) ||
    !Number.isSafeInteger(difficulty) ||
    !Number.isSafeInteger(formationId)
  ) {
    return null;
  }
  return {
    command,
    activityId,
    difficulty,
    formationId,
    keyType,
    parameters,
  };
}

function hasInventoryAward(
  player: Player,
  award: readonly [number, number, number, number, number],
): boolean {
  const [genre, detail, particular, templateLevel, count] = award;
  return player.inventory.some(
    (item) =>
      item.genre === genre &&
      item.detail === detail &&
      item.particular === particular &&
      item.templateLevel === templateLevel &&
      item.count >= count,
  );
}

function pickedThiefAwards(
  run: BountyRun,
  parameters: Record<string, unknown>,
): ReturnType<typeof thiefAwards> {
  const deaths = Array.isArray(parameters.tbThiefDeath) ? parameters.tbThiefDeath : [];
  const killedMonsters = new Set(
    deaths.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const value = entry as Record<string, unknown>;
      return value.bDeath ? [Number(value.monId)] : [];
    }),
  );
  if (!run.thiefDrops.some(({ monId }) => killedMonsters.has(monId))) return [];

  const maximum = new Map(
    thiefAwards(run.thiefDrops).map((award) => [award.slice(0, 4).join(":"), award]),
  );
  const picked = Array.isArray(parameters.tbThiefDropItem)
    ? parameters.tbThiefDropItem
    : [];
  return picked.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length < 5) return [];
    const values = entry.slice(0, 5).map(Number);
    if (!values.every(Number.isSafeInteger)) return [];
    const expected = maximum.get(values.slice(0, 4).join(":"));
    if (!expected) return [];
    const count = Math.max(0, Math.min(values[4]!, expected[4]));
    return count > 0
      ? [[values[0]!, values[1]!, values[2]!, values[3]!, count, 10] as const]
      : [];
  });
}

function parseItemLockCall(
  call: LuaCall | null,
): { guid: number; lockOn: number } | null {
  if (
    call?.method !== "LockItem" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return null;
  }
  const parameters = call.parameters as Record<string, unknown>;
  const guid = Number(parameters.nGuid);
  const lockOn = Number(parameters.nLockOn);
  return Number.isSafeInteger(guid) && guid > 0 && (lockOn === 0 || lockOn === 1)
    ? { guid, lockOn }
    : null;
}

export function createGatewayServer({
  config,
  logger,
  players,
  pvpSessions: sharedPvpSessions,
}: GatewayServerOptions): Server {
  const chapterCatalog = ChapterCatalog.loadDefault();
  const gachaCatalog = GachaCatalog.loadDefault();
  const weaponGachaCatalog = GachaCatalog.loadDefault(0);
  const gachaRotation = GachaRotationCatalog.loadDefault(
    gachaCatalog.get(1)!,
    weaponGachaCatalog.get(1)!,
    config.gachaRotationDays,
  );
  const shopCatalog = ShopCatalog.loadDefault();
  const pvpSessions =
    sharedPvpSessions ??
    new PvpSessionManager({
      robotCount: config.pvp.robotCount,
      roomCloseSeconds: config.pvp.roomCloseSeconds,
    });

  function encodePvpTeamRaw(session: PvpSession): Buffer {
    const team = session.team;
    return makePvpTeam({
      teamId: team.teamId,
      leaderId: team.leaderId,
      mapId: team.mapId,
      playersRaw: team.players.map((player) =>
        makePvpPlayerBaseInfo({
          name: player.name,
          level: player.level,
          solutionRaw: player.solutionRaw,
          roleId: player.roleId,
          ready: player.ready,
          isInFormation: player.isInFormation,
        }),
      ),
      isPublic: team.isPublic,
      closeTime: team.closeTime,
      activityId: team.activityId,
      mgrId: team.mgrId,
    });
  }
  logger.info("game_data.chapter.loaded", { levels: chapterCatalog.size });
  logger.info("game_data.gacha.loaded", { pools: gachaCatalog.size });
  logger.info("game_data.weapon_gacha.loaded", { pools: weaponGachaCatalog.size });
  logger.info("game_data.shop.loaded", { goods: shopCatalog.size });
  return createServer((socket) => {
    const peer = peerName(socket);
    const context: ConnectionContext = {
      account: "offline",
      verifiedAccount: null,
      player: null,
      isNewPlayer: false,
      headpatResponses: new Map(),
      cafeResponses: new Map(),
      petResponses: new Map(),
      houseResponses: new Map(),
      settlementResponses: new Map(),
      activeChapter: null,
      activeBounty: null,
      lastBountySettlement: null,
    };
    let pending = Buffer.alloc(0);
    let receiveQueue: Promise<void> = Promise.resolve();
    let loggedIn = false;
    let mailDate: string | null = null;
    let mailResetTimer: ReturnType<typeof setTimeout> | undefined;
    logger.info("gateway.connected", { peer });

    function send(
      command: number,
      serial: number,
      payload: Buffer = Buffer.alloc(0),
      returnCode = 0,
    ): void {
      const packet = makePacket(command, serial, payload, returnCode);
      socket.write(packet);
      const preview = hexPreview(packet, config.logging.maxPayloadHexBytes);
      logger.debug("gateway.send", {
        peer,
        command,
        commandName: commandName(command),
        serial,
        returnCode,
        packetBytes: packet.length,
        payloadBytes: payload.length,
        packetHex: preview.hex,
        packetHexTruncated: preview.truncated,
      });
    }

    function updateMailbox(action: MailAction, now: number) {
      const bannerIds = activeGachaBannerIds(now, config.gachaRotationDays);
      const awards = dailyPullMailAwards(
        bannerIds,
        gachaCatalog.get(1)?.costTen,
        weaponGachaCatalog.get(1)?.costTen,
      );
      return players.updateMailbox(context.account, action, awards, now);
    }

    async function refreshDailyMail(now = Date.now()): Promise<void> {
      const date = dailySignUpOperationalDate(now);
      if (!loggedIn || (mailDate && date <= mailDate)) return;
      const result = await updateMailbox({ kind: "list" }, now);
      context.player = result.player;
      if (socket.destroyed) return;
      const messages = result.player.mail?.messages ?? [];
      if (!mailDate) {
        send(COMMAND.GET_MAIL_RSP, 0, makeMailListResponse(messages));
      } else {
        for (const mail of messages
          .filter(({ operationalDate }) => operationalDate === date)
          .reverse()) {
          send(COMMAND.ADD_MAIL_NTF, 0, makeAddMailNotification(mail));
        }
      }
      mailDate = date;
    }

    function scheduleDailyMailRefresh(now = Date.now()): void {
      clearTimeout(mailResetTimer);
      if (!loggedIn || socket.destroyed) return;
      const reset = Date.parse(`${dailySignUpOperationalDate(now)}T20:00:00.000Z`);
      mailResetTimer = setTimeout(() => {
        receiveQueue = receiveQueue
          .then(async () => {
            if (!socket.destroyed) await refreshDailyMail();
          })
          .catch((error: unknown) => {
            logger.error("mail.rollover_failed", { peer, message: String(error) });
          })
          .finally(() => scheduleDailyMailRefresh());
      }, reset - now);
      mailResetTimer.unref();
    }

    async function syncPhoneEvents(storyPath?: string): Promise<void> {
      if (!loggedIn || !context.player) return;
      const result = await players.syncPhoneEvents(context.account, storyPath);
      context.player = result.player;
      const emit = (nCmd: number, nNpcId: number, nMsgId: number) =>
        send(
          COMMAND.NTF_S2C_CALL,
          0,
          makeServerLuaCall("ServerPhoneMsg", {
            nError: 0,
            nCmd,
            nNpcId,
            nMsgId,
            nSelectId: 0,
          }),
        );
      for (const { initiator, topicId } of result.letters) emit(3, initiator, topicId);
      for (const { topicId } of result.moments.newPosts) {
        const definition = getMomentDefinition(topicId);
        if (definition) emit(1, definition.initiator, topicId);
      }
      for (const topicId of result.moments.newPublishableIds) emit(9, 0, topicId);
    }

    function sendGirlUpdates(girls: readonly GirlState[]): void {
      if (girls.length === 0) return;
      send(COMMAND.GIRL_UPDATE_NTF, 0, makeGirlUpdateNotification(girls));
    }

    function sendPromiseUpdates(
      result: PromiseOperationResult,
      syncTaskValues = false,
    ): void {
      context.player = result.player;
      if (result.updatedItems.length > 0) {
        send(
          COMMAND.ITEM_UPDATE_NTF,
          0,
          makeItemUpdateNotification(result.updatedItems),
        );
      }
      for (const money of result.updatedMoney) {
        send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
      }
      sendGirlUpdates(result.updatedGirls);
      if (syncTaskValues)
        send(COMMAND.TASK_VALUE_RSP, 0, makeTaskValueSync(result.player.taskValues));
      for (const taskId of result.completedTaskIds) {
        send(
          COMMAND.NTF_S2C_CALL,
          0,
          makeServerLuaCall("LuaCall", {
            sCmd: 238,
            tbParam: { taskId },
          }),
        );
      }
    }

    function sendCafeUpdates(result: CafeOperationResult): void {
      sendPromiseUpdates(result, result.taskValuesChanged);
      if (result.updatedFurniture.length) {
        send(
          COMMAND.ADD_FURNITURE_RSP,
          0,
          makeAddFurnitureResponse(result.player.roleId, result.updatedFurniture),
        );
      }
      for (const theme of result.updatedThemes) {
        send(
          COMMAND.ADD_HOUSE_THEME_RSP,
          0,
          makeAddHouseThemeResponse(result.player.roleId, theme),
        );
      }
    }

    function sendCafeNotifications(notifications: readonly CafeNotification[]): void {
      for (const notification of notifications) {
        send(
          COMMAND.NTF_S2C_CALL,
          0,
          notification.method
            ? makeServerLuaCall(notification.method, notification.parameters)
            : makeServerLuaCall("LuaCall", {
                sCmd: notification.command,
                tbParam: notification.parameters,
              }),
        );
      }
    }

    function sendPvpFightConnect(session: PvpSession, roleId: number): void {
      const room = pvpSessions.createRoom(roleId);
      if (!room) return;
      const playerListRaw = makePvpPlayerList(
        session.team.players.map((player, index) =>
          makePvpPlayerInfo({
            index,
            name: player.name,
            camp: 1,
            solutionRaw: player.solutionRaw,
            roleId: player.roleId,
            code: 0,
            serverId: config.serverList.id,
            level: player.level,
          }),
        ),
      );
      logger.info("pvp.fight.notify_connect", {
        peer,
        account: context.account,
        roomId: room.roomId,
        mapId: room.mapId,
        players: session.team.players.length,
        fight: `${config.gateway.advertisedHost}:${config.pvp.fightPort}`,
      });
      send(
        COMMAND.PVP_NOTIFY_CONNECT_TO_PVP,
        0,
        makePvpNotifyConnectToPvp({
          seed: room.seed,
          ip: config.gateway.advertisedHost,
          port: config.pvp.fightPort,
          mapId: room.mapId,
          code: 0,
          myIdx: 0,
          reconnect: false,
          roleId,
          playerListRaw,
          roomId: room.roomId,
        }),
      );
      // 结算奖励占位：战斗由客户端本地模拟，服务器无法获知战果，开战即
      // 预置一份固定奖励（LuaCall 221 → PvpClient:SetRewardInfo），
      // UI_PVPSuccess 开战结束后读取 PvpClient.Reward 展示。
      setTimeout(() => {
        if (socket.destroyed) return;
        send(
          COMMAND.NTF_S2C_CALL,
          0,
          makeServerLuaCall("LuaCall", {
            sCmd: 221,
            tbParam: {
              MasterExp: 100,
              CardExp: 100,
              totalEnemyCount: 0,
              tbNew: [],
              tbDaily: [],
              tbOld: [],
            },
          }),
        );
      }, 3000);
    }

    async function handlePacket(packetBuffer: Buffer): Promise<void> {
      const packet = readPacket(packetBuffer);
      const preview = hexPreview(packet.payload, config.logging.maxPayloadHexBytes);
      logger.debug("gateway.receive", {
        peer,
        command: packet.command,
        commandName: commandName(packet.command),
        serial: packet.serial,
        returnCode: packet.returnCode,
        packetBytes: packet.size,
        payloadBytes: packet.payload.length,
        payloadHex: preview.hex,
        payloadHexTruncated: preview.truncated,
      });

      if (packet.command === COMMAND.VERIFY_REQ) {
        loggedIn = false;
        mailDate = null;
        clearTimeout(mailResetTimer);
        context.verifiedAccount = null;
        const fields = decodeFields(packet.payload);
        const platform = firstString(fields, 1);
        context.account =
          config.release?.singlePlayerAccount ?? firstString(fields, 2, "offline");
        context.player = await players.getOrCreate(context.account);
        context.account = context.player.account;
        context.verifiedAccount = context.player.account;
        context.isNewPlayer = context.player.lastLoginAt === null;
        logger.info("session.verified", {
          peer,
          account: context.account,
          platform,
          roleId: context.player.roleId,
          isNewPlayer: context.isNewPlayer,
        });
        send(
          COMMAND.VERIFY_RSP,
          packet.serial,
          makeVerifyResponse(context.player, config.serverList, context.isNewPlayer),
        );
        return;
      }

      if (packet.command === COMMAND.LOGIN_REQ) {
        const fields = decodeFields(packet.payload);
        // LOGIN can contain only the saved username, while VERIFY's identity
        // includes its password. Keep this socket attached to its verified save.
        context.account =
          config.release?.singlePlayerAccount ??
          context.verifiedAccount ??
          firstString(fields, 1, context.account);
        context.player = await players.getOrCreate(context.account);
        context.isNewPlayer = context.player.lastLoginAt === null;
        context.player = await players.markLogin(context.account);
        logger.info("session.login", {
          peer,
          account: context.account,
          roleId: context.player.roleId,
          channel: firstString(fields, 10),
          isNewPlayer: context.isNewPlayer,
          clientUserState: firstNumber(fields, 9),
        });

        send(COMMAND.TASK_VALUE_RSP, 0, makeTaskValueSync(context.player.taskValues));
        await new Promise((resolve) => setTimeout(resolve, 20));
        send(
          COMMAND.LIVE2D_ENABLE_LEVEL_NTF,
          0,
          makeLive2DEnableLevelNotification(context.player.live2dEnableLevel),
        );
        send(
          COMMAND.LIVE2D_HX_STATE_NTF,
          0,
          makeLive2DHXNotification(context.player.live2dHX),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        send(COMMAND.PLAYER_NTF, 0, makePlayerNotification(context.player));
        await new Promise((resolve) => setTimeout(resolve, 20));
        send(COMMAND.ITEM_NTF, 0, makeItemNotification(context.player));
        await new Promise((resolve) => setTimeout(resolve, 20));
        send(COMMAND.PHONE_MSG_NTF, 0, makePhoneMessageNotification(context.player));
        await new Promise((resolve) => setTimeout(resolve, 40));
        loggedIn = true;
        mailDate = null;
        try {
          await refreshDailyMail();
        } catch (error) {
          logger.warn("mail.login_sync_failed", { peer, message: String(error) });
        }
        send(COMMAND.LOGIN_RSP, packet.serial);
        scheduleDailyMailRefresh();
        return;
      }

      if (packet.command === COMMAND.TIME_REQ) {
        send(
          COMMAND.TIME_RSP,
          packet.serial,
          makeTimeResponse(
            Math.floor(Date.now() / 1_000),
            context.player?.serverZone ?? config.playerDefaults.serverZone,
          ),
        );
        await refreshDailyMail();
        return;
      }

      if (packet.command === COMMAND.KEEP_ALIVE_REQ) {
        send(COMMAND.KEEP_ALIVE_RSP, packet.serial);
        await refreshDailyMail();
        return;
      }

      const mailResponse = MAIL_RESPONSES.get(packet.command);
      if (mailResponse !== undefined) {
        if (!loggedIn) {
          send(mailResponse, packet.serial, Buffer.alloc(0), 1);
          return;
        }
        try {
          const now = Date.now();
          const action = parseMailAction(packet.command, packet.payload);
          if (action.kind !== "list") await refreshDailyMail(now);
          const result = await updateMailbox(action, now);
          context.player = result.player;
          if (action.kind === "list") {
            mailDate = dailySignUpOperationalDate(now);
            send(
              mailResponse,
              packet.serial,
              makeMailListResponse(result.player.mail?.messages ?? []),
            );
          } else {
            if (result.updatedItems.length) {
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification(result.updatedItems),
              );
            }
            for (const money of result.updatedMoney) {
              send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
            }
            sendGirlUpdates(result.updatedGirls);
            if (result.taskValuesChanged)
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(result.player.taskValues),
              );
            send(
              mailResponse,
              packet.serial,
              makeMailMutationResponse(action, result.acceptedIds),
            );
            if (
              action.kind === "claim" &&
              result.acceptedIds.length < new Set(action.ids).size
            ) {
              send(
                COMMAND.GET_MAIL_RSP,
                0,
                makeMailListResponse(result.player.mail?.messages ?? []),
              );
            }
          }
        } catch (error) {
          logger.warn("mail.request_failed", {
            peer,
            command: packet.command,
            message: String(error),
          });
          send(mailResponse, packet.serial, Buffer.alloc(0), 1);
        }
        return;
      }

      if (packet.command === COMMAND.RENAME_REQ) {
        const name = parseRenameName(packet.payload);
        context.player = await players.rename(context.account, name);
        send(COMMAND.RENAME_RSP, packet.serial);
        return;
      }

      if (packet.command === COMMAND.TASK_VALUE_REQ) {
        const player = context.player ?? (await players.getOrCreate(context.account));
        send(
          COMMAND.TASK_VALUE_RSP,
          packet.serial,
          makeTaskValueSync(player.taskValues),
        );
        return;
      }

      if (packet.command === COMMAND.TASK_CHANGE_REQ) {
        const changes = parseTaskChanges(packet.payload);
        context.player = await players.setTaskValues(context.account, changes);
        send(COMMAND.TASK_CHANGE_RSP, packet.serial, packet.payload);
        return;
      }

      if (packet.command === COMMAND.GET_HOUSEINFO_REQ) {
        try {
          const own = players.get(context.account);
          if (!own) throw new Error("Unauthenticated house request");
          const { roleId } = parseHouseInfoRequest(packet.payload);
          const player =
            roleId === 0 || roleId === own.roleId ? own : players.getByRoleId(roleId);
          if (!player) throw new Error("House does not exist");
          if (player.roleId === own.roleId) context.player = player;
          send(
            COMMAND.GET_HOUSEINFO_RSP,
            packet.serial,
            makeHouseInfoResponse(
              player.roleId,
              player.cafe.furniture ?? [],
              player.cafe.rooms,
              player.cafe.themes,
              undefined,
              cafePetList(player),
            ),
          );
          logger.info("house.info.response", {
            account: context.account,
            roleId: player.roleId,
            furnitureCount: player.cafe.furniture?.length ?? 0,
          });
        } catch (error) {
          send(COMMAND.GET_HOUSEINFO_RSP, packet.serial, Buffer.alloc(0), 1);
          logger.warn("house.info.rejected", {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }

      if (
        packet.command === COMMAND.ADD_FURNITURE_REQ ||
        packet.command === COMMAND.ADD_HOUSE_THEME_REQ ||
        packet.command === COMMAND.DELETE_HOUSE_THEME_REQ
      ) {
        const responseCommand = packet.command + 1;
        const key =
          packet.serial > 0
            ? `${packet.command}:${packet.serial}:${createHash("sha256").update(packet.payload).digest("hex")}`
            : null;
        const now = Date.now();
        for (const [id, cached] of context.houseResponses)
          if (cached.expiresAt <= now) context.houseResponses.delete(id);
        const cached = key ? context.houseResponses.get(key) : undefined;
        if (cached) {
          send(responseCommand, packet.serial, cached.response);
          return;
        }
        try {
          const own = players.get(context.account);
          if (!own) throw new Error("Unauthenticated house mutation");
          let response: Buffer;
          if (packet.command === COMMAND.ADD_FURNITURE_REQ) {
            const request = parseAddFurnitureRequest(packet.payload);
            if (request.roleId !== 0 && request.roleId !== own.roleId)
              throw new Error("Foreign house mutation");
            const result = await players.materializeCafeFurniture(
              context.account,
              request.templateIds,
            );
            sendPromiseUpdates(result, result.taskValuesChanged);
            response = makeAddFurnitureResponse(own.roleId, result.updatedFurniture);
          } else if (packet.command === COMMAND.ADD_HOUSE_THEME_REQ) {
            const request = parseAddHouseThemeRequest(packet.payload);
            if (request.roleId !== 0 && request.roleId !== own.roleId)
              throw new Error("Foreign house mutation");
            const templateId = request.theme.templateThemeId;
            if (!templateId) throw new Error("Missing predefined theme identity");
            const result = await players.buyPredefinedCafeTheme(
              context.account,
              templateId,
              request.templateIds.length ? request.templateIds : undefined,
            );
            sendPromiseUpdates(result, result.taskValuesChanged);
            response = makeAddHouseThemeResponse(
              own.roleId,
              result.theme,
              result.updatedFurniture,
            );
          } else {
            const request = parseDeleteHouseThemeRequest(packet.payload);
            if (request.roleId !== 0 && request.roleId !== own.roleId)
              throw new Error("Foreign house mutation");
            const result = await players.deleteHouseTheme(
              context.account,
              request.themeId,
            );
            sendPromiseUpdates(result);
            response = makeDeleteHouseThemeResponse(own.roleId, request.themeId);
          }
          send(responseCommand, packet.serial, response);
          if (key) {
            context.houseResponses.set(key, {
              response,
              expiresAt: now + SETTLEMENT_CACHE_TTL_MS,
            });
            if (context.houseResponses.size > 64)
              context.houseResponses.delete(
                context.houseResponses.keys().next().value!,
              );
          }
        } catch (error) {
          send(responseCommand, packet.serial, Buffer.alloc(0), 1);
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("CallClientTip", ["Error.1"]),
          );
          logger.warn("house.commerce.rejected", {
            account: context.account,
            command: packet.command,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }

      if (packet.command === COMMAND.UPDATE_HOUSE_REQ) {
        const key =
          packet.serial > 0
            ? `${packet.command}:${packet.serial}:${createHash("sha256").update(packet.payload).digest("hex")}`
            : null;
        const now = Date.now();
        for (const [id, cached] of context.houseResponses)
          if (cached.expiresAt <= now) context.houseResponses.delete(id);
        const cached = key ? context.houseResponses.get(key) : undefined;
        if (cached) {
          send(COMMAND.UPDATE_HOUSE_RSP, packet.serial, cached.response);
          return;
        }
        try {
          const changes = parseUpdateHouseRequest(packet.payload);
          const result = await players.persistHouseChanges(context.account, changes);
          sendPromiseUpdates(result, true);
          const response = makeUpdateHouseResponse(result.player.roleId, {
            rooms: result.updatedRooms,
            furniture: result.updatedFurniture,
            themes: result.updatedThemes,
          });
          send(COMMAND.UPDATE_HOUSE_RSP, packet.serial, response);
          if (key) {
            context.houseResponses.set(key, {
              response,
              expiresAt: now + SETTLEMENT_CACHE_TTL_MS,
            });
            if (context.houseResponses.size > 64)
              context.houseResponses.delete(
                context.houseResponses.keys().next().value!,
              );
          }
          logger.info("house.layout.saved", {
            account: context.account,
            furnitureChanges: changes.furniture.length,
            roomChanges: changes.rooms.length,
            themeChanges: changes.themes.length,
          });
        } catch (error) {
          send(COMMAND.UPDATE_HOUSE_RSP, packet.serial, Buffer.alloc(0), 1);
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("CallClientTip", ["Error.1"]),
          );
          logger.warn("house.layout.rejected", {
            account: context.account,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }

      if (packet.command === COMMAND.HOUSE_RANDOM_REQ) {
        send(COMMAND.HOUSE_RANDOM_RSP, packet.serial);
        logger.info("house.random.response", {
          peer,
          account: context.account,
          roleCount: 0,
        });
        return;
      }

      if (packet.command === COMMAND.C2S_CALL_REQ) {
        const call = parseLuaCall(packet.payload);
        const luaCommand = parseNumericLuaCommand(call);
        if (
          config.release &&
          (!loggedIn ||
            luaCommand === 9999 ||
            luaCommand === 999999 ||
            /^(?:gm|debug|test|console|eval|execute|grant|admin)/i.test(
              call?.method ?? "",
            ))
        ) {
          send(COMMAND.C2S_CALL_RSP, packet.serial, Buffer.alloc(0), 1);
          logger.warn("release.call_rejected", {
            method: call?.method,
            command: luaCommand,
          });
          return;
        }
        const girlTrainingCall = parseGirlTrainingCall(call);
        const girlAppearanceCall = parseGirlAppearanceCall(call);
        const girlGiftCall = parseGirlGiftCall(call);
        const doRechargeCall = parseDoRechargeCall(call);
        const girlLevelAwardCall = parseGirlLevelAwardCall(call);
        const girlEndTrainCall = parseGirlEndTrainCall(call);
        const girlViewStoryCall = parseGirlViewStoryCall(call);
        logger.info("lua.call", {
          peer,
          account: context.account,
          ...(call ? { method: call.method, json: call.json } : {}),
        });
        send(COMMAND.C2S_CALL_RSP, packet.serial);
        if (call?.method === "LockItem") {
          const request = parseItemLockCall(call);
          if (!request) {
            logger.warn("item.lock.invalid_request", {
              peer,
              account: context.account,
              parameters: call.parameters,
            });
            return;
          }
          try {
            const result = await players.setItemLock(
              context.account,
              request.guid,
              request.lockOn,
            );
            context.player = result.player;
            send(COMMAND.ITEM_UPDATE_NTF, 0, makeItemUpdateNotification([result.item]));
            logger.info("item.lock.updated", {
              peer,
              account: context.account,
              ...request,
            });
          } catch (error) {
            logger.warn("item.lock.rejected", {
              peer,
              account: context.account,
              ...request,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }
        if (call?.method === "SignUpMsg") {
          const parameters =
            call.parameters && typeof call.parameters === "object"
              ? (call.parameters as Record<string, unknown>)
              : {};
          const signUpType = Number(parameters.nType);
          if (signUpType !== 1) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("NormalActivityMsg", {
                nType: 3,
                nSubType: signUpType,
                bSuccess: false,
                tbAward: [],
                isRefreshSign: false,
              }),
            );
            logger.warn("daily_sign_up.unsupported_type", {
              peer,
              account: context.account,
              signUpType,
            });
            return;
          }

          const result = await players.signUpDaily(context.account);
          context.player = result.player;
          send(COMMAND.TASK_VALUE_RSP, 0, makeTaskValueSync(result.player.taskValues));
          if (result.updatedItems.length > 0) {
            send(
              COMMAND.ITEM_UPDATE_NTF,
              0,
              makeItemUpdateNotification(result.updatedItems),
            );
          }
          sendGirlUpdates(result.updatedGirls);
          for (const money of result.updatedMoney) {
            send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
          }
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("NormalActivityMsg", {
              nType: 3,
              nSubType: 1,
              bSuccess: true,
              tbAward: result.awards,
              isRefreshSign: result.fresh,
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "NormalActivityMsg",
            feature: "daily_sign_up",
            fresh: result.fresh,
            cumulativeCount: result.cumulativeCount,
            awards: result.awards,
          });
          return;
        }
        if (call?.method === "NormalActivityGetAward") {
          const parameters =
            call.parameters && typeof call.parameters === "object"
              ? (call.parameters as Record<string, unknown>)
              : {};
          const activityId = Number(parameters.nActivityId);
          const achievementId = Number(parameters.nId);
          if (activityId === EIGHT_DAY_SIGN_UP_ACTIVITY_ID) {
            try {
              const result = await players.claimEightDaySignUpAward(
                context.account,
                achievementId,
              );
              context.player = result.player;
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(result.player.taskValues),
              );
              if (result.updatedItems.length > 0) {
                send(
                  COMMAND.ITEM_UPDATE_NTF,
                  0,
                  makeItemUpdateNotification(result.updatedItems),
                );
              }
              sendGirlUpdates(result.updatedGirls);
              for (const money of result.updatedMoney) {
                send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
              }
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("MissionMgrMsg", {
                  nError: 0,
                  nMission: 0,
                }),
              );
              logger.info("lua.callback", {
                peer,
                account: context.account,
                method: "MissionMgrMsg",
                feature: "eight_day_sign_up.award",
                activityId,
                achievementId,
                awards: result.awards,
              });
            } catch (error) {
              if (!(error instanceof EightDaySignUpError)) throw error;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("MissionMgrMsg", {
                  nError: 1,
                  nMission: 0,
                }),
              );
              logger.warn("eight_day_sign_up.claim_rejected", {
                peer,
                account: context.account,
                activityId,
                achievementId,
                reason: error.reason,
              });
            }
            return;
          }
        }
        if (
          call?.method === "MissionGetAward" ||
          call?.method === "MissionActiveAward"
        ) {
          const parameters =
            call.parameters && typeof call.parameters === "object"
              ? (call.parameters as Record<string, unknown>)
              : {};
          const id = Number(parameters.nId);
          const claimAll =
            call.method === "MissionGetAward" &&
            id === 0 &&
            Number(parameters.nType) === 1;
          const missionType = call.method === "MissionGetAward" ? 1 : 2;
          try {
            const result =
              call.method === "MissionGetAward"
                ? await players.claimDailyMissionAwards(context.account, id, claimAll)
                : await players.claimDailyMissionActiveAward(context.account, id);
            context.player = result.player;
            send(
              COMMAND.TASK_VALUE_RSP,
              0,
              makeTaskValueSync(result.player.taskValues),
            );
            if (result.updatedItems.length > 0) {
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification(result.updatedItems),
              );
            }
            for (const money of result.updatedMoney) {
              send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
            }
            sendGirlUpdates(result.updatedGirls);

            if (result.claimedMissionIds.length > 0) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("MissionMgrMsg", {
                  nError: 0,
                  nMission: 1,
                  ...(claimAll ? { tbIdList: result.claimedMissionIds } : {}),
                }),
              );
            }
            if (result.claimedActiveAwardIds.length > 0) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("MissionMgrMsg", {
                  nError: 0,
                  nMission: 2,
                  ...(claimAll ? { tbItems: result.activeAwardItems } : {}),
                }),
              );
            }
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "MissionMgrMsg",
              feature: claimAll
                ? "daily_mission.claim_all"
                : missionType === 1
                  ? "daily_mission.award"
                  : "daily_mission.active_award",
              id,
              claimedMissionIds: result.claimedMissionIds,
              claimedActiveAwardIds: result.claimedActiveAwardIds,
              activeAwardItems: result.activeAwardItems,
            });
          } catch (error) {
            if (!(error instanceof DailyMissionError)) throw error;
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("MissionMgrMsg", {
                nError: 1,
                nMission: missionType,
              }),
            );
            logger.warn("daily_mission.claim_rejected", {
              peer,
              account: context.account,
              method: call.method,
              id,
              claimAll,
              reason: error.reason,
            });
          }
          return;
        }
        if (
          call?.method === "GuideMissionGetAward" ||
          call?.method === "GuideProgressGetAward"
        ) {
          const parameters =
            call.parameters && typeof call.parameters === "object"
              ? (call.parameters as Record<string, unknown>)
              : {};
          const id = Number(parameters.nId);
          const missionType = call.method === "GuideMissionGetAward" ? 3 : 4;
          try {
            const result =
              call.method === "GuideMissionGetAward"
                ? await players.claimGuideMissionAward(context.account, id)
                : await players.claimGuideProgressAward(context.account, id);
            context.player = result.player;
            send(
              COMMAND.TASK_VALUE_RSP,
              0,
              makeTaskValueSync(result.player.taskValues),
            );
            if (result.updatedItems.length > 0) {
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification(result.updatedItems),
              );
            }
            for (const money of result.updatedMoney) {
              send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
            }
            sendGirlUpdates(result.updatedGirls);
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("MissionMgrMsg", {
                nError: 0,
                nMission: missionType,
              }),
            );
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "MissionMgrMsg",
              feature:
                missionType === 3 ? "guide_mission.award" : "guide_progress.award",
              id,
              awards: result.awards,
            });
          } catch (error) {
            if (!(error instanceof GuideMissionError)) throw error;
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("MissionMgrMsg", {
                nError: 1,
                nMission: missionType,
              }),
            );
            logger.warn("guide_mission.claim_rejected", {
              peer,
              account: context.account,
              method: call.method,
              id,
              reason: error.reason,
            });
          }
          return;
        }
        if (call?.method === "GetOfflineGachaRotation") {
          if (context.player) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("OfflineGachaRotation", gachaRotation.at().manifest),
            );
          }
          return;
        }
        if (call?.method === "Lottery" || call?.method === "GetFirstGacha") {
          const parameters =
            call.parameters && typeof call.parameters === "object"
              ? (call.parameters as Record<string, unknown>)
              : {};
          const poolId = call.method === "GetFirstGacha" ? 666 : Number(parameters.nId);
          const ten = call.method === "GetFirstGacha" ? true : parameters.bTen === true;
          const rotation =
            poolId === ROTATING_GACHA_POOL_ID ? gachaRotation.at() : null;
          const pool = rotation
            ? context.player &&
              parameters.rotationRevision === rotation.manifest.revision
              ? rotation.character
              : null
            : gachaCatalog.get(poolId);
          if (!pool) {
            if (rotation && context.player) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("OfflineGachaRotation", rotation.manifest),
              );
            }
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("Lottery", { err: "error.gacha.notexists" }),
            );
            return;
          }
          const currentPlayer =
            context.player ?? (await players.getOrCreate(context.account));
          const rollFor = (player: Player) => {
            const pity = player.taskValues[String(makeGachaTaskId(2 + poolId))] ?? 0;
            let upPity = player.taskValues[String(makeGachaTaskId(2001 + poolId))] ?? 0;
            const storedRotationVersion =
              player.taskValues[String(makeGachaTaskId(10_005))] ?? 0;
            if (
              pool.rotateVersion > 0 &&
              storedRotationVersion !== pool.rotateVersion
            ) {
              upPity = 0;
            }
            const total =
              player.taskValues[String(makeGachaTaskId(3001 + poolId))] ?? 0;
            const selectedPacked =
              player.taskValues[String(makeGachaTaskId(6001 + poolId))] ?? 0;
            const selectedUpIds = [
              selectedPacked & 0xffff,
              (selectedPacked >>> 16) & 0xffff,
            ].filter((id) => id > 0);
            const ownedCards = new Set(
              player.inventory
                .filter((item) => isCharacterCard(item) && item.count > 0)
                .map(
                  ({ genre, detail, particular, templateLevel }) =>
                    `${genre}:${detail}:${particular}:${templateLevel}`,
                ),
            );
            return gachaCatalog.rollPool(
              pool,
              ten,
              { pity, upPity, total },
              ownedCards,
              selectedUpIds,
            );
          };
          try {
            if (pool.judgeType === 2 && call.method !== "GetFirstGacha") {
              const roll = rollFor(currentPlayer);
              context.player = await players.savePendingGacha(
                context.account,
                poolId,
                ten,
                roll,
              );
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("Lottery", {
                  bTen: ten,
                  bGetCard: false,
                  tbAwards: roll.awards,
                  ...(pool.getItem
                    ? {
                        getItem: [
                          ...pool.getItem.slice(0, 4),
                          pool.getItem[4] * roll.awards.length,
                        ],
                      }
                    : {}),
                }),
              );
              logger.info("gacha.pending.saved", {
                account: context.account,
                poolId,
                awards: roll.awards.length,
              });
              return;
            }
            const result = await players.performGacha(
              context.account,
              pool,
              ten,
              rollFor,
            );
            context.player = result.player;
            if (result.updatedItems.length > 0) {
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification(result.updatedItems),
              );
            }
            sendGirlUpdates(result.updatedGirls);
            for (const money of result.updatedMoney) {
              send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
            }
            send(
              COMMAND.TASK_VALUE_RSP,
              0,
              makeTaskValueSync(result.player.taskValues),
            );
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("Lottery", {
                bTen: ten,
                bGetCard: true,
                tbAwards: result.awards,
                ...(result.getItem ? { getItem: result.getItem } : {}),
              }),
            );
            logger.info("gacha.response", {
              account: context.account,
              poolId,
              ten,
              awards: result.awards.length,
            });
          } catch (error) {
            if (error instanceof InsufficientGachaCurrencyError) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("Lottery", {
                  err: "error.gacha.cash",
                }),
              );
              logger.warn("gacha.insufficient_currency", {
                account: context.account,
                poolId,
              });
              return;
            }
            throw error;
          }
          return;
        }
        if (call?.method === "WeaponLogicMsg") {
          const parameters =
            call.parameters && typeof call.parameters === "object"
              ? (call.parameters as Record<string, unknown>)
              : {};
          const weaponCommand = Number(parameters.nCmd);
          if (weaponCommand === WEAPON_LOGIC_COMMAND_DECOMPOSE) {
            const guids = parseWeaponDecompositionRequest(parameters);
            if (!guids) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", {
                  nError: 1,
                  nCmd: weaponCommand,
                }),
              );
              logger.warn("weapon.decompose.invalid_request", {
                account: context.account,
                parameters,
              });
              return;
            }
            try {
              const result = await players.decomposeWeapons(
                context.account,
                guids,
                (gdpl) => weaponGachaCatalog.rarityOf(gdpl),
              );
              context.player = result.player;
              const updatedItems = [...result.removedWeapons, ...result.updatedItems];
              if (updatedItems.length > 0) {
                send(
                  COMMAND.ITEM_UPDATE_NTF,
                  0,
                  makeItemUpdateNotification(updatedItems),
                );
              }
              for (const money of result.updatedMoney) {
                send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
              }
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(result.player.taskValues),
              );
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", {
                  nError: 0,
                  nCmd: weaponCommand,
                  tbParam: [result.gold, result.itemList],
                }),
              );
              logger.info("weapon.decompose.response", {
                account: context.account,
                guids,
                gold: result.gold,
                itemList: result.itemList,
              });
            } catch (error) {
              if (!(error instanceof WeaponDecompositionError)) throw error;
              const nError =
                error.reason === "weapon_locked"
                  ? 20015
                  : error.reason === "weapon_equipped"
                    ? 20016
                    : 1;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", {
                  nError,
                  nCmd: weaponCommand,
                }),
              );
              logger.warn("weapon.decompose.rejected", {
                account: context.account,
                guids,
                guid: error.guid,
                reason: error.reason,
                nError,
              });
            }
            return;
          }
          if (weaponCommand === 1) {
            const request = parseWeaponEnhancementRequest(parameters);
            if (!request) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", {
                  nError: 1,
                  nCmd: weaponCommand,
                }),
              );
              logger.warn("weapon.enhance.invalid_request", {
                account: context.account,
                parameters,
              });
              return;
            }
            try {
              const result = await players.enhanceWeapon(
                context.account,
                request.guid,
                request.materials,
                (gdpl) => weaponGachaCatalog.rarityOf(gdpl),
              );
              context.player = result.player;
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification([result.weapon, ...result.consumedItems]),
              );
              for (const money of result.updatedMoney) {
                send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
              }
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(result.player.taskValues),
              );
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", {
                  nError: 0,
                  nCmd: weaponCommand,
                }),
              );
              logger.info("weapon.enhance.response", {
                account: context.account,
                guid: request.guid,
                materials: request.materials,
                addedExperience: result.addedExperience,
                coinCost: result.coinCost,
                level: result.weapon.enhanceLevel,
                experience: result.weapon.enhanceExp,
              });
            } catch (error) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", {
                  nError: 1,
                  nCmd: weaponCommand,
                }),
              );
              logger.warn("weapon.enhance.rejected", {
                account: context.account,
                guid: request.guid,
                error: error instanceof Error ? error.message : String(error),
              });
            }
            return;
          }
          if (weaponCommand === 3) {
            const request = parseWeaponBreakthroughRequest(parameters);
            try {
              if (!request) throw new WeaponBreakthroughError("invalid_request");
              const result = await players.breakthroughWeapon(
                context.account,
                request.guid,
                request.materials,
              );
              context.player = result.player;
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification([result.weapon, ...result.consumedItems]),
              );
              for (const money of result.updatedMoney)
                send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(result.player.taskValues),
              );
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", { nError: 0, nCmd: 3 }),
              );
            } catch (error) {
              if (!(error instanceof WeaponBreakthroughError)) throw error;
              const nError =
                error.reason === "weapon_locked"
                  ? 20015
                  : error.reason === "weapon_equipped"
                    ? 20016
                    : 1;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", { nError, nCmd: 3 }),
              );
              logger.warn("weapon.breakthrough.rejected", {
                account: context.account,
                reason: error.reason,
                guid: error.guid,
              });
            }
            return;
          }
          if (weaponCommand === 0) {
            const poolId = Number(parameters.Id);
            const ten = parameters.isTen === true;
            const rotation =
              poolId === ROTATING_GACHA_POOL_ID ? gachaRotation.at() : null;
            const pool = rotation
              ? context.player &&
                parameters.rotationRevision === rotation.manifest.revision
                ? rotation.weapon
                : null
              : weaponGachaCatalog.get(poolId);
            if (!pool) {
              if (rotation && context.player) {
                send(
                  COMMAND.NTF_S2C_CALL,
                  0,
                  makeServerLuaCall("OfflineGachaRotation", rotation.manifest),
                );
              }
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", {
                  nError: 20096,
                  nCmd: weaponCommand,
                }),
              );
              logger.warn("weapon_gacha.pool_not_found", {
                account: context.account,
                poolId,
              });
              return;
            }
            if (!context.player) await players.getOrCreate(context.account);
            const rollFor = (player: Player) => {
              const pity =
                player.taskValues[String(makeGachaTaskId(1002 + poolId))] ?? 0;
              const total = player.taskValues[String(makeGachaTaskId(1001))] ?? 0;
              const selectedPacked =
                player.taskValues[String(makeGachaTaskId(4001 + poolId))] ?? 0;
              const selectedUpIds = [
                selectedPacked & 0xffff,
                (selectedPacked >>> 16) & 0xffff,
              ].filter((id) => id > 0);
              const ownedWeapons = new Set(
                player.inventory
                  .filter(({ genre, count }) => genre === 2 && count > 0)
                  .map(
                    ({ genre, detail, particular, templateLevel }) =>
                      `${genre}:${detail}:${particular}:${templateLevel}`,
                  ),
              );
              return weaponGachaCatalog.rollPool(
                pool,
                ten,
                { pity, upPity: 0, total },
                ownedWeapons,
                selectedUpIds,
              );
            };
            try {
              const result = await players.performGacha(
                context.account,
                pool,
                ten,
                rollFor,
                false,
                "weapon",
              );
              context.player = result.player;
              if (result.updatedItems.length > 0) {
                send(
                  COMMAND.ITEM_UPDATE_NTF,
                  0,
                  makeItemUpdateNotification(result.updatedItems),
                );
              }
              sendGirlUpdates(result.updatedGirls);
              for (const money of result.updatedMoney) {
                send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
              }
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(result.player.taskValues),
              );
              const weapons = result.updatedItems
                .filter(({ genre }) => genre === 2)
                .map(({ guid }) => ({ nGuid: guid }));
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", {
                  nError: 0,
                  nCmd: weaponCommand,
                  tbParam: weapons,
                }),
              );
              logger.info("weapon_gacha.response", {
                account: context.account,
                poolId,
                ten,
                awards: result.awards.length,
                weaponGuids: weapons.map(({ nGuid }) => nGuid),
              });
            } catch (error) {
              if (!(error instanceof InsufficientGachaCurrencyError)) throw error;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", {
                  nError: 1,
                  nCmd: weaponCommand,
                }),
              );
              logger.warn("weapon_gacha.insufficient_currency", {
                account: context.account,
                poolId,
              });
            }
            return;
          }
        }
        if (call?.method === "SetWeaponCustomUp") {
          const parameters =
            call.parameters && typeof call.parameters === "object"
              ? (call.parameters as Record<string, unknown>)
              : {};
          const poolId = Number(parameters.nId);
          const pool = weaponGachaCatalog.get(poolId);
          const availableIds = new Set(
            [...(pool?.normalCards.get(4) ?? [])].map(({ id }) => id),
          );
          const itemIds = [
            ...new Set(
              (Array.isArray(parameters.tbItems) ? parameters.tbItems : [])
                .map(Number)
                .filter(
                  (id) => Number.isSafeInteger(id) && id > 0 && availableIds.has(id),
                ),
            ),
          ].slice(0, 2);
          if (!pool || pool.judgeType !== 1 || itemIds.length !== 2) {
            logger.warn("weapon_gacha.custom_up.rejected", {
              account: context.account,
              poolId,
              itemIds,
            });
            return;
          }
          context.player = await players.setWeaponGachaCustomUp(
            context.account,
            poolId,
            itemIds,
          );
          send(COMMAND.TASK_VALUE_RSP, 0, makeTaskValueSync(context.player.taskValues));
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("SetWeaponCustomUp", { nId: poolId }),
          );
          logger.info("weapon_gacha.custom_up.updated", {
            account: context.account,
            poolId,
            itemIds,
          });
          return;
        }
        if (call?.method === "GetLastGacha") {
          const currentPlayer =
            context.player ?? (await players.getOrCreate(context.account));
          const pendingGacha = currentPlayer.gacha?.pending;
          if (!pendingGacha) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("GetLastGacha", {
                err: "error.gacha.nolast",
              }),
            );
            return;
          }
          const shouldClaim = call.parameters === true;
          if (!shouldClaim) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("GetLastGacha", {
                bTen: pendingGacha.ten,
                bGetCard: false,
                tbAwards: pendingGacha.awards,
              }),
            );
            return;
          }
          const pool = gachaCatalog.get(pendingGacha.poolId);
          if (!pool) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("GetLastGacha", {
                err: "error.gacha.nolast",
              }),
            );
            return;
          }
          const roll: GachaRollResult = {
            awards: pendingGacha.awards,
            counters: {
              pity: pendingGacha.pity,
              upPity: pendingGacha.upPity,
              total: pendingGacha.total,
            },
          };
          try {
            const result = await players.performGacha(
              context.account,
              pool,
              pendingGacha.ten,
              roll,
              true,
            );
            context.player = result.player;
            if (result.updatedItems.length > 0) {
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification(result.updatedItems),
              );
            }
            sendGirlUpdates(result.updatedGirls);
            for (const money of result.updatedMoney) {
              send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
            }
            send(
              COMMAND.TASK_VALUE_RSP,
              0,
              makeTaskValueSync(result.player.taskValues),
            );
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("GetLastGacha", {
                bTen: true,
                bGetCard: true,
                tbAwards: result.awards,
                ...(result.getItem ? { getItem: result.getItem } : {}),
              }),
            );
          } catch (error) {
            if (error instanceof InsufficientGachaCurrencyError) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("Lottery", {
                  err: "error.gacha.cash",
                }),
              );
              return;
            }
            throw error;
          }
          return;
        }
        if (call?.method === "SetCardCustomUp") {
          const parameters =
            call.parameters && typeof call.parameters === "object"
              ? (call.parameters as Record<string, unknown>)
              : {};
          const poolId = Number(parameters.nId);
          const itemIds = Array.isArray(parameters.tbItems)
            ? parameters.tbItems
                .map(Number)
                .filter((id) => Number.isSafeInteger(id) && id > 0)
            : [];
          context.player = await players.setGachaCustomUp(
            context.account,
            poolId,
            itemIds,
          );
          send(COMMAND.TASK_VALUE_RSP, 0, makeTaskValueSync(context.player.taskValues));
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("SetCardCustomUp", { nId: poolId }),
          );
          logger.info("gacha.custom_up.updated", {
            account: context.account,
            poolId,
            itemIds,
          });
          return;
        }
        if (call?.method === "PhoneMsg") {
          const parameters = call.parameters as Record<string, unknown> | undefined;
          const phoneCommand = Number(parameters?.nCmd);
          if (phoneCommand === 12 || phoneCommand === 13) {
            const storyPath = parameters?.nMsgId;
            if (
              typeof storyPath === "string" &&
              storyPath.length > 0 &&
              storyPath.length <= 240
            ) {
              await syncPhoneEvents(storyPath);
            }
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("ServerPhoneMsg", {
                nError: 0,
                nCmd: phoneCommand,
              }),
            );
            return;
          }
          if (phoneCommand === 8) {
            await syncPhoneEvents();
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("ServerPhoneMsg", {
                nError: 0,
                nCmd: 8,
                tbList: context.player?.phone.moments?.publishableIds ?? [],
              }),
            );
          } else if (phoneCommand === 1) {
            const topicId = Number(parameters?.nMsgId);
            const selectionId = Number(parameters?.nSelectId);
            try {
              if (!loggedIn) throw new MomentSelectionError();
              const result = await players.updatePhoneMoments(
                context.account,
                topicId,
                selectionId,
              );
              context.player = result.player;
              if (result.updatedGirl) {
                sendGirlUpdates([result.updatedGirl]);
                send(
                  COMMAND.TASK_VALUE_RSP,
                  0,
                  makeTaskValueSync(result.player.taskValues),
                );
              }
              const gain = result.affection;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("ServerPhoneMsg", {
                  nError: 0,
                  nCmd: 1,
                  nNpcId: result.initiator,
                  nMsgId: topicId,
                  nSelectId: selectionId,
                  ...(gain
                    ? {
                        tbExp: [
                          gain.addedExperience,
                          gain.oldExperience,
                          gain.newExperience,
                          gain.oldLevel,
                          gain.newLevel,
                        ],
                      }
                    : {}),
                }),
              );
              await syncPhoneEvents();
            } catch (error) {
              if (!(error instanceof MomentSelectionError)) throw error;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("ServerPhoneMsg", { nError: 20040, nCmd: 1 }),
              );
            }
          } else if ([3, 4, 7, 10, 11].includes(phoneCommand)) {
            if (!loggedIn) return;
            const emitLetter = (result: Record<string, unknown>) =>
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("ServerPhoneMsg", {
                  nError: 0,
                  nCmd: phoneCommand,
                  ...result,
                }),
              );
            const rejectLetter = () => emitLetter({ nError: 20040 });
            if (phoneCommand === 4) {
              const nNpcId = Number(parameters?.nNpcId);
              const title = parameters?.strTitle;
              if (typeof title !== "string" || !Number.isSafeInteger(nNpcId)) {
                rejectLetter();
                return;
              }
              const result = await players.setPhoneLetterTitle(
                context.account,
                nNpcId,
                title,
              );
              if (!result) {
                rejectLetter();
                return;
              }
              context.player = result.player;
              emitLetter({ nNpcId, strTitle: result.title });
              return;
            }

            const topicId = Number(parameters?.nMsgId);
            const definition = getPhoneLetterDefinition(topicId);
            if (!definition) {
              rejectLetter();
              return;
            }
            const letter = { nNpcId: definition.initiator, nMsgId: topicId };
            if (phoneCommand === 3) {
              const selection = Number(parameters?.nSelectId);
              const result = await players.choosePhoneLetterReply(
                context.account,
                topicId,
                selection,
              );
              context.player = result.player;
              if (result.replyId === null) {
                rejectLetter();
                return;
              }
              emitLetter({ ...letter, nSelectId: result.replyId });
              await syncPhoneEvents();
            } else if (phoneCommand === 7) {
              const result = await players.claimPhoneLetterAward(
                context.account,
                topicId,
              );
              if (!result) {
                rejectLetter();
                return;
              }
              context.player = result.player;
              if (result.girl) {
                sendGirlUpdates([result.girl]);
                send(
                  COMMAND.TASK_VALUE_RSP,
                  0,
                  makeTaskValueSync(result.player.taskValues),
                );
              }
              const gain = result.affection;
              emitLetter({
                ...letter,
                ...(gain
                  ? {
                      tbExp: [
                        gain.addedExperience,
                        gain.oldExperience,
                        gain.newExperience,
                        gain.oldLevel,
                        gain.newLevel,
                      ],
                    }
                  : {}),
              });
              await syncPhoneEvents();
            } else if (phoneCommand === 10) {
              context.player = await players.removePhoneLetter(
                context.account,
                topicId,
              );
              emitLetter(letter);
            } else {
              // Only the stock guide messages can be requested directly.
              if (topicId !== 1 && topicId !== 10_001) {
                rejectLetter();
                return;
              }
              const result = await players.deliverPhoneLetter(context.account, topicId);
              context.player = result.player;
              if (result.added) emitLetter({ ...letter, nCmd: 3, nSelectId: 0 });
              else emitLetter({ nCmd: 0 });
            }
          } else {
            logger.warn("phone.unhandled", {
              peer,
              account: context.account,
              command: phoneCommand,
              parameters,
            });
          }
          return;
        }
        if (luaCommand === 540) {
          const wrapped = call?.parameters as { tbParam?: Record<string, unknown> };
          const chapter = Number(wrapped.tbParam?.Chapter);
          const index = Number(wrapped.tbParam?.Index);
          const difficulty = Number(wrapped.tbParam?.Difficult);
          const level = chapterCatalog.get(chapter, index, difficulty);
          if (!level?.storyOnly) {
            logger.warn("chapter.story.invalid", { chapter, index, difficulty });
            return;
          }

          const levelId = makeLevelId(chapter, index, difficulty);
          const previous = context.player?.levels.find(({ id }) => id === levelId);
          const replay = (previous?.star ?? 0) >>> 3 > 0;
          const result = replay
            ? null
            : await players.completeStoryLevel(context.account, level);
          if (result) {
            context.player = result.player;
            for (const money of result.updatedMoney) {
              send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
            }
            if (result.updatedItems.length > 0) {
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification(result.updatedItems),
              );
            }
            send(
              COMMAND.TASK_VALUE_RSP,
              0,
              makeTaskValueSync(result.player.taskValues),
            );
          }
          if (result) await syncPhoneEvents();
          // UI_Cartoon waits for this callback even when there are no replay awards.
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("LuaCall", {
              sCmd: 540,
              tbParam: { tbNew: result?.awards ?? [] },
            }),
          );
          logger.info("chapter.story.completed", {
            chapter,
            index,
            difficulty,
            firstClear: (result?.awards.length ?? 0) > 0,
          });
          return;
        }

        if (luaCommand === LUA_COMMAND_WRITE_GUIDE_LOG) {
          const acknowledgement = makeGuideLogAcknowledgement(call?.parameters);
          if (acknowledgement) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_WRITE_GUIDE_LOG,
                tbParam: acknowledgement,
              }),
            );
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "LuaCall",
              command: LUA_COMMAND_WRITE_GUIDE_LOG,
              feature: "guide.log",
              ...acknowledgement,
            });
          }
          return;
        }
        if (luaCommand === LUA_COMMAND_CARD_DECOMPOSE) {
          const guids = parseCardDecompositionRequest(call?.parameters);
          if (!guids) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_CARD_DECOMPOSE,
                tbParam: { itemlist: [], goldnum: 0, errorKey: "Error.1" },
              }),
            );
            logger.warn("card.decompose.invalid_request", {
              peer,
              account: context.account,
              parameters: call?.parameters,
            });
            return;
          }
          try {
            const result = await players.decomposeCharacterCards(
              context.account,
              guids,
              (gdpl) =>
                cardRarityOf(
                  gdpl,
                  (value) =>
                    gachaCatalog.rarityOf(value) ?? gachaRotation.cardRarityOf(value),
                ),
            );
            context.player = result.player;
            const updatedItems = [...result.removedCards, ...result.updatedItems];
            if (updatedItems.length > 0) {
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification(updatedItems),
              );
            }
            for (const money of result.updatedMoney) {
              send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
            }
            sendGirlUpdates(result.updatedGirls);
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_CARD_DECOMPOSE,
                tbParam: {
                  itemlist: result.itemList,
                  goldnum: result.gold,
                },
              }),
            );
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "LuaCall",
              command: LUA_COMMAND_CARD_DECOMPOSE,
              feature: "card.decompose",
              guids,
              gold: result.gold,
              itemList: result.itemList,
            });
          } catch (error) {
            if (!(error instanceof CharacterCardDecompositionError)) throw error;
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_CARD_DECOMPOSE,
                tbParam: { itemlist: [], goldnum: 0, errorKey: "Error.1" },
              }),
            );
            logger.warn("card.decompose.rejected", {
              peer,
              account: context.account,
              guids,
              guid: error.guid,
              reason: error.reason,
            });
          }
          return;
        }
        if (
          luaCommand !== null &&
          [228, 229, 230, 231, 232, 233, 234, 235, 239].includes(luaCommand)
        ) {
          try {
            const result = await players.handlePromiseRequest(
              context.account,
              luaCommand,
              call?.parameters,
            );
            sendPromiseUpdates(result, luaCommand === 229);
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: luaCommand,
                tbParam: result.response,
              }),
            );
            logger.info("promise.callback", {
              account: context.account,
              command: luaCommand,
            });
          } catch (error) {
            if (!(error instanceof PromiseOperationError)) throw error;
            const envelope = call?.parameters as
              { tbParam?: Record<string, unknown> } | undefined;
            const parameters = envelope?.tbParam;
            let response: unknown = null;
            if (luaCommand === 234) response = { Err: 1 };
            else if (luaCommand === 229) response = { Error: 1 };
            else if (luaCommand === 239)
              response = {
                girlid: Number(parameters?.girlid) || 0,
                step: Number(parameters?.step) || 0,
                ncompletedtasknum: 0,
                errid: 1,
                tbaward: [],
              };
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: luaCommand,
                tbParam: response,
              }),
            );
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("CallClientTip", ["Error.1"]),
            );
            // Activation has an optimistic client cache. Refresh only with the
            // authoritative list, never an error object masquerading as a girl.
            const refreshed = await players.handlePromiseRequest(context.account, 231, {
              tbParam: {},
            });
            context.player = refreshed.player;
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: 231,
                tbParam: refreshed.response,
              }),
            );
            logger.info("promise.rejected", {
              account: context.account,
              command: luaCommand,
              reason: error.reason,
            });
          }
          return;
        }
        if (luaCommand !== null && [31, 33, 34, 35].includes(luaCommand)) {
          try {
            const result = await players.handleRuneRequest(
              context.account,
              luaCommand,
              call?.parameters,
            );
            context.player = result.player;
            send(
              COMMAND.ITEM_UPDATE_NTF,
              0,
              makeItemUpdateNotification(result.updatedItems),
            );
            for (const money of result.updatedMoney)
              send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
            send(
              COMMAND.TASK_VALUE_RSP,
              0,
              makeTaskValueSync(result.player.taskValues),
            );
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", { sCmd: luaCommand, tbParam: {} }),
            );
          } catch (error) {
            if (!(error instanceof RuneOperationError)) throw error;
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: luaCommand,
                tbParam: { nError: error.clientError },
              }),
            );
            logger.warn("rune.rejected", { command: luaCommand, reason: error.reason });
          }
          return;
        }
        const backgroundResponse = makeBackgroundLuaResponse(
          luaCommand,
          call?.parameters,
        );
        if (backgroundResponse !== undefined) {
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("LuaCall", {
              sCmd: luaCommand,
              tbParam: backgroundResponse,
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "LuaCall",
            command: luaCommand,
            feature: "background.empty_state",
          });
          return;
        }
        if (luaCommand === LUA_COMMAND_CARD_LEVEL_UP_COMMON) {
          const request = parseCardEnhancementRequest(call?.parameters);
          if (!request) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_CARD_LEVEL_UP_COMMON,
                tbParam: { errorKey: "Error.1" },
              }),
            );
            logger.warn("card.enhance.invalid_request", {
              peer,
              account: context.account,
              parameters: call?.parameters,
            });
            return;
          }
          const currentPlayer =
            context.player ?? (await players.getOrCreate(context.account));
          const currentCard = currentPlayer.inventory.find(
            (entry) => entry.guid === request.guid && isCharacterCard(entry),
          );
          if (currentCard?.enhanceLevel !== request.clientLevel) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_CARD_LEVEL_UP_COMMON,
                tbParam: { errorKey: "Error.1" },
              }),
            );
            logger.warn("card.enhance.level_mismatch", {
              peer,
              account: context.account,
              guid: request.guid,
              clientLevel: request.clientLevel,
              serverLevel: currentCard?.enhanceLevel,
            });
            return;
          }
          let result;
          try {
            result = await players.enhanceCard(
              context.account,
              request.guid,
              request.materials,
            );
          } catch (error) {
            if (!(error instanceof InsufficientGoldError)) throw error;
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_CARD_LEVEL_UP_COMMON,
                tbParam: { errorKey: "Error.1" },
              }),
            );
            logger.warn("card.enhance.insufficient_gold", {
              peer,
              account: context.account,
              guid: request.guid,
              required: error.required,
              available: error.available,
            });
            return;
          }
          context.player = result.player;
          send(
            COMMAND.ITEM_UPDATE_NTF,
            0,
            makeItemUpdateNotification([result.card, ...result.consumedItems]),
          );
          for (const money of result.updatedMoney) {
            send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
          }
          send(COMMAND.TASK_VALUE_RSP, 0, makeTaskValueSync(result.player.taskValues));
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("LuaCall", {
              sCmd: LUA_COMMAND_CARD_LEVEL_UP_COMMON,
              tbParam: {},
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "LuaCall",
            command: LUA_COMMAND_CARD_LEVEL_UP_COMMON,
            feature: "card.enhance",
            guid: request.guid,
            addedExperience: result.addedExperience,
            coinCost: result.coinCost,
            level: result.card.enhanceLevel,
            experience: result.card.enhanceExp,
          });
          return;
        }
        // 122 is a server-only business-report push, not a request.
        if (
          luaCommand !== null &&
          [
            14, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 123, 124, 125,
            126, 127, 135, 137, 138, 240,
          ].includes(luaCommand)
        ) {
          const retryKey =
            packet.serial > 0 &&
            luaCommand !== 112 &&
            luaCommand !== 124 &&
            luaCommand !== 240
              ? `${packet.serial}:${call?.json}`
              : null;
          const now = Date.now();
          for (const [key, cached] of context.cafeResponses) {
            if (cached.expiresAt <= now) context.cafeResponses.delete(key);
          }
          const cached = retryKey ? context.cafeResponses.get(retryKey) : undefined;
          if (cached) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: luaCommand,
                tbParam: cached.response,
              }),
            );
            return;
          }
          try {
            const result = await players.handleCafeRequest(
              context.account,
              luaCommand,
              call?.parameters,
            );
            sendCafeUpdates(result);
            sendCafeNotifications(result.notifications);
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: luaCommand,
                tbParam: result.response,
              }),
            );
            if (retryKey) {
              context.cafeResponses.set(retryKey, {
                response: result.response,
                expiresAt: now + SETTLEMENT_CACHE_TTL_MS,
              });
              if (context.cafeResponses.size > 64)
                context.cafeResponses.delete(
                  context.cafeResponses.keys().next().value!,
                );
            }
            logger.info("cafe.callback", {
              account: context.account,
              command: luaCommand,
            });
          } catch (error) {
            if (!(error instanceof CafeOperationError)) throw error;
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: luaCommand,
                tbParam:
                  luaCommand === 113 && players.get(context.account)
                    ? cafeRoomGirls(players.get(context.account)!)
                    : error.response,
              }),
            );
            if (luaCommand === 113)
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("CallClientTip", ["Error.1"]),
              );
            logger.info("cafe.rejected", {
              account: context.account,
              command: luaCommand,
              reason: error.reason,
            });
          }
          return;
        }
        if (luaCommand === LUA_COMMAND_SHOP_GOODS_LIST) {
          const parameters = call?.parameters as Record<string, unknown> | undefined;
          const tbParam = parameters?.tbParam as Record<string, unknown> | undefined;
          const shopId = Number(tbParam?.shopid);
          try {
            const result = await players.getShopGoodsList(
              context.account,
              shopCatalog,
              shopId,
            );
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_SHOP_GOODS_LIST,
                tbParam: makeShopGoodsListTbParam(result),
              }),
            );
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "LuaCall",
              command: LUA_COMMAND_SHOP_GOODS_LIST,
              feature: "shop.goods_list",
              shopId,
              isOpen: result.isOpen,
              goodsCount: result.goodsList.length,
            });
          } catch (error) {
            if (!(error instanceof ShopError)) throw error;
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_SHOP_GOODS_LIST,
                tbParam: {
                  shopid: shopId,
                  isopen: 0,
                  refreshcount: 0,
                  goodslist: [],
                  errorKey: error.clientErrorKey,
                },
              }),
            );
            logger.warn("shop.goods_list.rejected", {
              peer,
              account: context.account,
              shopId,
              reason: error.reason,
            });
          }
          return;
        }
        if (luaCommand === LUA_COMMAND_SHOP_REFRESH_GOODS_LIST) {
          const parameters = call?.parameters as Record<string, unknown> | undefined;
          const tbParam = parameters?.tbParam as Record<string, unknown> | undefined;
          const shopId = Number(tbParam?.shopid);
          try {
            const { result, updatedMoney } = await players.refreshShop(
              context.account,
              shopCatalog,
              shopId,
            );
            for (const money of updatedMoney) {
              send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
            }
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_SHOP_REFRESH_GOODS_LIST,
                tbParam: makeShopGoodsListTbParam(result),
              }),
            );
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "LuaCall",
              command: LUA_COMMAND_SHOP_REFRESH_GOODS_LIST,
              feature: "shop.refresh",
              shopId,
              refreshCount: result.refreshCount,
              goodsCount: result.goodsList.length,
            });
          } catch (error) {
            if (!(error instanceof ShopError)) throw error;
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_SHOP_REFRESH_GOODS_LIST,
                tbParam: {
                  shopid: shopId,
                  isopen: 0,
                  refreshcount: 0,
                  goodslist: [],
                  errorKey: error.clientErrorKey,
                },
              }),
            );
            logger.warn("shop.refresh.rejected", {
              peer,
              account: context.account,
              shopId,
              reason: error.reason,
            });
          }
          return;
        }
        if (luaCommand === LUA_COMMAND_SHOP_BUY_GOODS) {
          const parameters = call?.parameters as Record<string, unknown> | undefined;
          const tbParam = parameters?.tbParam as Record<string, unknown> | undefined;
          const shopId = Number(tbParam?.shopid);
          const goodsId = Number(tbParam?.goodsid);
          const buyNum = Number(tbParam?.buynum ?? 1);
          const cafeRetryKey =
            shopId === 40_001 && packet.serial > 0
              ? `${packet.serial}:${call?.json}`
              : null;
          const priorCafePurchase = cafeRetryKey
            ? context.cafeResponses.get(cafeRetryKey)
            : undefined;
          if (priorCafePurchase && priorCafePurchase.expiresAt > Date.now()) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_SHOP_BUY_GOODS,
                tbParam: priorCafePurchase.response,
              }),
            );
            return;
          }
          try {
            const { result, updatedItems, updatedMoney, updatedFurniture, price } =
              await players.buyShopGoods(
                context.account,
                shopCatalog,
                shopId,
                goodsId,
                buyNum,
              );
            if (updatedItems.length > 0) {
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification(updatedItems),
              );
            }
            for (const money of updatedMoney) {
              send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
            }
            context.player = players.get(context.account);
            if (updatedFurniture.length && context.player)
              send(
                COMMAND.ADD_FURNITURE_RSP,
                0,
                makeAddFurnitureResponse(context.player.roleId, updatedFurniture),
              );
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_SHOP_BUY_GOODS,
                tbParam: { shopid: shopId, goodsid: goodsId, buynum: buyNum },
              }),
            );
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_SHOP_GOODS_LIST,
                tbParam: makeShopGoodsListTbParam(result),
              }),
            );
            if (cafeRetryKey) {
              context.cafeResponses.set(cafeRetryKey, {
                response: { shopid: shopId, goodsid: goodsId, buynum: buyNum },
                expiresAt: Date.now() + SETTLEMENT_CACHE_TTL_MS,
              });
              if (context.cafeResponses.size > 64)
                context.cafeResponses.delete(
                  context.cafeResponses.keys().next().value!,
                );
            }
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "LuaCall",
              command: LUA_COMMAND_SHOP_BUY_GOODS,
              feature: "shop.buy",
              shopId,
              goodsId,
              buyNum,
              price,
            });
          } catch (error) {
            if (!(error instanceof ShopError)) throw error;
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_SHOP_BUY_GOODS,
                tbParam: {
                  shopid: shopId,
                  goodsid: 0,
                  buynum: 0,
                  errorKey: error.clientErrorKey,
                },
              }),
            );
            logger.warn("shop.buy.rejected", {
              peer,
              account: context.account,
              shopId,
              goodsId,
              buyNum,
              reason: error.reason,
            });
          }
          return;
        }
        if (luaCommand === LUA_COMMAND_CAFE_FURNITURE_COUNT) {
          const player = context.player ?? (await players.getOrCreate(context.account));
          const furnitureCount =
            player.cafe.furniture?.filter(
              (item) => !isNativeFixedHouseObjectId(item.objId),
            ).length ?? 0;
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("LuaCall", {
              sCmd: LUA_COMMAND_CAFE_FURNITURE_COUNT,
              tbParam: { nRet: 0, nNum: furnitureCount },
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "LuaCall",
            command: LUA_COMMAND_CAFE_FURNITURE_COUNT,
            feature: "cafe.furniture_count",
          });
          return;
        }
        if (call?.method === "NCafePetLogic") {
          const now = Date.now();
          for (const [key, cached] of context.petResponses)
            if (cached.expiresAt <= now) context.petResponses.delete(key);
          const key = packet.serial > 0 ? `${packet.serial}:${call.json}` : null;
          const cached = key ? context.petResponses.get(key) : undefined;
          if (cached) {
            sendCafeNotifications(cached.notifications);
            if (cached.response !== undefined)
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("NCafePetLogic", cached.response),
              );
            return;
          }
          try {
            const result = await players.handleCafePetRequest(
              context.account,
              call.parameters,
              now,
            );
            sendPromiseUpdates(result, result.taskValuesChanged);
            sendCafeNotifications(result.notifications);
            if (result.response !== undefined)
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("NCafePetLogic", result.response),
              );
            if (key) {
              context.petResponses.set(key, {
                response: result.response,
                notifications: result.notifications,
                expiresAt: now + SETTLEMENT_CACHE_TTL_MS,
              });
              if (context.petResponses.size > 64)
                context.petResponses.delete(context.petResponses.keys().next().value!);
            }
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "NCafePetLogic",
              feature: "cafe.pet",
            });
          } catch (error) {
            if (!(error instanceof CafePetOperationError)) throw error;
            // A failed claim must not keep a just-expired week visible forever.
            // Settle maintenance separately so rejected purchases stay atomic.
            if (
              call.parameters !== null &&
              typeof call.parameters === "object" &&
              (call.parameters as Record<string, unknown>).sCmd === "GetPetMissionAward"
            ) {
              const refreshed = await players.handleCafePetRequest(
                context.account,
                { sCmd: "GetCafeFoodNum" },
                now,
              );
              sendPromiseUpdates(refreshed, refreshed.taskValuesChanged);
              sendCafeNotifications(refreshed.notifications);
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("NCafePetLogic", refreshed.response),
              );
            }
            if (error.response)
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("NCafePetLogic", error.response),
              );
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("CallClientTip", ["Error.1"]),
            );
            logger.warn("cafe.pet.rejected", { reason: error.reason });
          }
          return;
        }
        const bountyCall = parseBountyCall(call);
        if (bountyCall) {
          const sendBountyCallback = (parameters: Record<string, unknown>): void => {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: bountyCall.command,
                tbParam: parameters,
              }),
            );
          };

          if (bountyCall.command === LUA_COMMAND_BOUNTY_JOIN) {
            const level = getBountyLevel(bountyCall.activityId, bountyCall.difficulty);
            if (!level) {
              sendBountyCallback({ nError: 2 });
              return;
            }
            const player = await players.getOrCreate(context.account);
            context.player = player;
            if (
              bountyCall.formationId <= 0 ||
              !player.formations.some(({ id }) => id === bountyCall.formationId)
            ) {
              sendBountyCallback({ nError: 10 });
              return;
            }
            const passDifficulty =
              player.taskValues[String(makeBountyPassTaskId(bountyCall.activityId))] ??
              0;
            if (bountyCall.difficulty > Math.min(6, passDifficulty + 1)) {
              sendBountyCallback({ nError: 1 });
              return;
            }

            let keyItem: [number, number, number, number, number] | null = null;
            if (!isBountyOpen(bountyCall.activityId)) {
              keyItem = bountyKeyItem(level.eventType, bountyCall.keyType);
              if (!keyItem || !hasInventoryAward(player, keyItem)) {
                sendBountyCallback({ nError: 3 });
                return;
              }
            }
            const vigour =
              player.money.find(({ id }) => id === MONEY_VIGOUR)?.count ?? 0;
            const energyCost = effectiveBountyEnergyCost(level, player.level);
            if (vigour < energyCost) {
              sendBountyCallback({ nError: 5 });
              return;
            }

            const completionCount =
              player.bounty?.completionCounts[
                `${bountyCall.activityId}:${bountyCall.difficulty}`
              ] ?? 0;
            const dailyRewardRemaining =
              player.taskValues[String(makeBountyDailyTaskId(level.eventType))] ?? 0;
            const run = rollBountyRun(
              level,
              [
                context.account,
                bountyOperationalDate(),
                bountyCall.activityId,
                bountyCall.difficulty,
                completionCount,
              ].join(":"),
              dailyRewardRemaining,
            );
            const cardGuids = promiseFightRoster(player, bountyCall.formationId);
            context.activeBounty = {
              run,
              formationId: bountyCall.formationId,
              keyItem,
              promiseFight: cardGuids
                ? {
                    kind: "bounty",
                    runId: randomUUID(),
                    formationId: bountyCall.formationId,
                    cardGuids,
                    activityId: bountyCall.activityId,
                    eventType: level.eventType,
                    difficulty: bountyCall.difficulty,
                    mapId: level.mapId,
                  }
                : null,
            };
            context.lastBountySettlement = null;
            sendBountyCallback({
              nError: 0,
              tbData: {
                id: bountyCall.activityId,
                diff: bountyCall.difficulty,
              },
              tbDrop: [],
              tbDropItems: run.awards,
              tbSpeThiefDrop: run.thiefDrops,
            });
            logger.info("bounty.joined", {
              account: context.account,
              activityId: bountyCall.activityId,
              difficulty: bountyCall.difficulty,
              formationId: bountyCall.formationId,
              mapId: level.mapId,
              energyCost,
              dailyBonusApplied: run.dailyBonusApplied,
              thiefAppeared: run.thiefDrops.length > 0,
            });
            return;
          }

          if (bountyCall.command === LUA_COMMAND_BOUNTY_FAIL) {
            if (
              context.activeBounty?.run.level.activityId === bountyCall.activityId &&
              context.activeBounty.run.level.difficulty === bountyCall.difficulty
            ) {
              context.activeBounty = null;
            }
            sendBountyCallback({ nError: 0 });
            logger.info("bounty.failed", {
              account: context.account,
              activityId: bountyCall.activityId,
              difficulty: bountyCall.difficulty,
            });
            return;
          }

          const settlementKey = [
            bountyCall.activityId,
            bountyCall.difficulty,
            bountyCall.formationId,
          ].join(":");
          if (
            !context.activeBounty &&
            context.lastBountySettlement?.key === settlementKey
          ) {
            sendBountyCallback(context.lastBountySettlement.response);
            return;
          }
          let active = context.activeBounty;
          if (!active) {
            const level = getBountyLevel(bountyCall.activityId, bountyCall.difficulty);
            const player = await players.getOrCreate(context.account);
            if (
              !level ||
              !player.formations.some(({ id }) => id === bountyCall.formationId)
            ) {
              sendBountyCallback({ nError: 6 });
              return;
            }
            let keyItem: [number, number, number, number, number] | null = null;
            if (!isBountyOpen(bountyCall.activityId)) {
              keyItem = bountyKeyItem(level.eventType, bountyCall.keyType);
              if (!keyItem || !hasInventoryAward(player, keyItem)) {
                sendBountyCallback({ nError: 3 });
                return;
              }
            }
            const completionCount =
              player.bounty?.completionCounts[
                `${bountyCall.activityId}:${bountyCall.difficulty}`
              ] ?? 0;
            active = {
              run: rollBountyRun(
                level,
                [
                  context.account,
                  bountyOperationalDate(),
                  bountyCall.activityId,
                  bountyCall.difficulty,
                  completionCount,
                ].join(":"),
                player.taskValues[String(makeBountyDailyTaskId(level.eventType))] ?? 0,
              ),
              formationId: bountyCall.formationId,
              keyItem,
              promiseFight: null,
            };
            context.activeBounty = active;
            logger.info("bounty.session.recovered", {
              account: context.account,
              activityId: bountyCall.activityId,
              difficulty: bountyCall.difficulty,
            });
          }
          if (
            active.run.level.activityId !== bountyCall.activityId ||
            active.run.level.difficulty !== bountyCall.difficulty ||
            active.formationId !== bountyCall.formationId
          ) {
            sendBountyCallback({ nError: 6 });
            return;
          }

          const randomGoldLimit = active.run.awards
            .filter(
              ([genre, detail, , , , flag]) =>
                genre === 15 && detail === 1 && flag === 7,
            )
            .reduce((total, award) => total + award[4], 0);
          const requestedGold = Number(bountyCall.parameters.nGold);
          const pickedGold = Number.isFinite(requestedGold)
            ? Math.max(0, Math.min(Math.floor(requestedGold), randomGoldLimit))
            : randomGoldLimit;
          const baseAwards =
            active.run.level.eventType === 1
              ? active.run.awards
                  .filter(
                    ([genre, detail, , , , flag]) =>
                      genre !== 15 || detail !== 1 || flag !== 7,
                  )
                  .concat(pickedGold > 0 ? [[15, 1, 1, 1, pickedGold, 100]] : [])
              : [...active.run.awards];
          const awards = [
            ...baseAwards,
            ...pickedThiefAwards(active.run, bountyCall.parameters),
          ];
          try {
            const settlement = await players.settleBounty(
              context.account,
              active.run.level,
              awards,
              active.run.dailyBonusApplied,
              active.keyItem,
              active.promiseFight ?? undefined,
            );
            context.player = settlement.player;
            for (const money of settlement.updatedMoney) {
              send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
            }
            if (settlement.updatedItems.length > 0) {
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification(settlement.updatedItems),
              );
            }
            sendGirlUpdates(settlement.updatedGirls);
            send(
              COMMAND.TASK_VALUE_RSP,
              0,
              makeTaskValueSync(settlement.player.taskValues),
            );
            if (
              settlement.experienceUpdate.addedExperience > 0 ||
              settlement.experienceUpdate.levelsGained > 0
            ) {
              send(
                COMMAND.PLAYER_UPDATE_NTF,
                0,
                makePlayerUpdateNotification(settlement.player),
              );
            }
            const response = {
              nError: 0,
              tbData: awards,
              nMasterExp: active.run.level.masterExp,
              nCardExp: 0,
            };
            context.lastBountySettlement = {
              key: settlementKey,
              response,
            };
            context.activeBounty = null;
            sendBountyCallback(response);
            logger.info("bounty.passed", {
              account: context.account,
              activityId: bountyCall.activityId,
              difficulty: bountyCall.difficulty,
              awards,
              energyCost: settlement.energyCost,
              dailyBonusApplied: active.run.dailyBonusApplied,
            });
          } catch (error) {
            if (error instanceof InsufficientVigourError) {
              sendBountyCallback({ nError: 5 });
            } else if (error instanceof BountySettlementError) {
              sendBountyCallback({ nError: 3 });
            } else {
              throw error;
            }
          }
          return;
        }

        const formationUpdate = parseFormationUpdateCall(call, context.player);
        if (formationUpdate) {
          context.player = await players.updateFormation(
            context.account,
            formationUpdate.formation,
          );
          send(
            COMMAND.FORMATION_UPDATE_NTF,
            0,
            makeFormationUpdateNotification(formationUpdate.formation),
          );
          send(COMMAND.TASK_VALUE_RSP, 0, makeTaskValueSync(context.player.taskValues));
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("LuaCall", {
              sCmd: formationUpdate.command,
              tbParam: { ret: 0 },
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "LuaCall",
            command: formationUpdate.command,
          });
        } else {
          const chapterCall = parseChapterCall(call);
          if (chapterCall?.state === 0) {
            const chapter = Number(chapterCall.parameters.Chapter);
            const index = Number(chapterCall.parameters.Index);
            const difficulty = Number(chapterCall.parameters.Difficult);
            const level = chapterCatalog.get(chapter, index, difficulty);
            if (!level) {
              logger.warn("chapter.level.missing", {
                account: context.account,
                chapter,
                index,
                difficulty,
              });
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("ChapterMsg", {
                  nError: 1,
                  nState: 0,
                }),
              );
              return;
            }

            const player =
              context.player ?? (await players.getOrCreate(context.account));
            context.player = player;
            const formationId = Number(chapterCall.parameters.nFormationId);
            const cardGuids = promiseFightRoster(player, formationId);
            context.activeChapter = null;
            const energyCost = effectiveEnergyCost(level, player.level);
            const availableVigour =
              player.money.find(({ id }) => id === MONEY_VIGOUR)?.count ?? 0;
            if (availableVigour < energyCost) {
              logger.info("chapter.enter.insufficient_vigour", {
                account: context.account,
                chapter,
                index,
                difficulty,
                required: energyCost,
                available: availableVigour,
              });
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("ChapterMsg", {
                  nError: 20014,
                  nState: 0,
                }),
              );
              return;
            }
            context.activeChapter = {
              chapter,
              index,
              difficulty,
              promiseFight: cardGuids
                ? {
                    kind: "chapter",
                    runId: randomUUID(),
                    formationId,
                    cardGuids,
                    chapter,
                    index,
                    difficulty,
                  }
                : null,
            };
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("ChapterMsg", {
                nError: 0,
                nState: 0,
                tbEnter: [],
                tbDropItems: [],
              }),
            );
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "ChapterMsg",
              command: "enter",
              chapter,
              index,
              difficulty,
              energyCost,
              availableVigour,
            });
          } else if (chapterCall?.state === 1) {
            const chapter = Number(chapterCall.parameters.Chapter);
            const index = Number(chapterCall.parameters.Index);
            const difficulty = Number(chapterCall.parameters.Difficult);
            const star = Number(chapterCall.parameters.nStar) || 0;
            // The client resends an identical settlement payload roughly every
            // 2 seconds until it receives a response, so dedupe by the full
            // payload (battle stats included) instead of just the coordinates:
            // replays of the same level produce different stats and must
            // settle normally.
            const settlementKey = JSON.stringify(chapterCall.parameters);
            const cached = context.settlementResponses.get(settlementKey);
            if (cached && cached.expiresAt > Date.now() && !context.activeChapter) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("ChapterMsg", cached.response),
              );
              return;
            }

            const level = chapterCatalog.get(chapter, index, difficulty);
            if (!level) {
              logger.warn("chapter.settlement.unknown", {
                account: context.account,
                chapter,
                index,
                difficulty,
                star,
              });
              return;
            }
            const player =
              context.player ?? (await players.getOrCreate(context.account));
            context.player = player;
            const levelId = makeLevelId(chapter, index, difficulty);
            const previous = player.levels.find(({ id }) => id === levelId);
            const passCount = (previous?.star ?? 0) >>> 3;
            const firstClear = passCount === 0;
            const energyCost = effectiveEnergyCost(level, player.level);

            const activeChapter = context.activeChapter;
            const promiseFight =
              activeChapter?.chapter === chapter &&
              activeChapter.index === index &&
              activeChapter.difficulty === difficulty
                ? activeChapter.promiseFight
                : null;
            let completedStar = star;
            let awards: ReturnType<typeof rollChapterAwards> = [];
            let masterExp = 0;
            let cardExp = 0;
            try {
              if (star > 0) {
                awards = rollChapterAwards(
                  level,
                  firstClear,
                  `${context.account}:${levelId}:${passCount}`,
                );
                masterExp = level.masterExp;
                cardExp = level.cardExp;
                const settlement = await players.settleLevel(
                  context.account,
                  chapter,
                  index,
                  difficulty,
                  star,
                  energyCost,
                  awards,
                  masterExp,
                  promiseFight ?? undefined,
                );
                context.player = settlement.player;
                completedStar =
                  context.player.levels.find(({ id }) => id === levelId)?.star ?? star;
                for (const money of settlement.updatedMoney) {
                  send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
                }
                if (settlement.updatedItems.length > 0) {
                  send(
                    COMMAND.ITEM_UPDATE_NTF,
                    0,
                    makeItemUpdateNotification(settlement.updatedItems),
                  );
                }
                sendGirlUpdates(settlement.updatedGirls);
                send(
                  COMMAND.TASK_VALUE_RSP,
                  0,
                  makeTaskValueSync(settlement.player.taskValues),
                );
                if (
                  settlement.experienceUpdate.addedExperience > 0 ||
                  settlement.experienceUpdate.levelsGained > 0
                ) {
                  send(
                    COMMAND.PLAYER_UPDATE_NTF,
                    0,
                    makePlayerUpdateNotification(settlement.player),
                  );
                }
                if (firstClear) await syncPhoneEvents();
              } else {
                // A failed fight still consumes vigour, matching the original
                // pre-deduct behaviour.
                context.player = await players.chargeLevelVigour(
                  context.account,
                  energyCost,
                );
                const vigour = context.player.money.find(
                  ({ id }) => id === MONEY_VIGOUR,
                );
                if (vigour) {
                  send(
                    COMMAND.MONEY_UPDATE_NTF,
                    0,
                    makeMoneyUpdateNotification(vigour),
                  );
                }
                send(
                  COMMAND.TASK_VALUE_RSP,
                  0,
                  makeTaskValueSync(context.player.taskValues),
                );
              }
            } catch (error) {
              if (!(error instanceof InsufficientVigourError)) throw error;
              logger.info("chapter.settlement.insufficient_vigour", {
                account: context.account,
                chapter,
                index,
                difficulty,
                star,
                required: error.required,
                available: error.available,
              });
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("ChapterMsg", {
                  nError: 20014,
                  nState: 1,
                }),
              );
              return;
            }
            const response = {
              nError: 0,
              nState: 1,
              nStar: completedStar,
              tbAwards: awards,
              tbExp: {
                MasterExp: masterExp,
                CardExp: cardExp,
              },
            };
            context.activeChapter = null;
            context.settlementResponses.set(settlementKey, {
              response,
              expiresAt: Date.now() + SETTLEMENT_CACHE_TTL_MS,
            });
            send(COMMAND.NTF_S2C_CALL, 0, makeServerLuaCall("ChapterMsg", response));
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "ChapterMsg",
              command: "settlement",
              chapter,
              index,
              difficulty,
              firstClear,
              energyCost,
              awards,
              masterExp,
              cardExp,
              playerLevel: context.player?.level,
              playerExp: context.player?.exp,
            });
          } else if (chapterCall?.state === 2) {
            const chapter = Number(chapterCall.parameters.Chapter);
            const difficulty = Number(chapterCall.parameters.Difficult);
            const position = Number(chapterCall.parameters.Pos);
            try {
              const result = await players.claimChapterStarAward(
                context.account,
                chapter,
                difficulty,
                position,
              );
              context.player = result.player;
              for (const money of result.updatedMoney) {
                send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
              }
              if (result.updatedItems.length > 0) {
                send(
                  COMMAND.ITEM_UPDATE_NTF,
                  0,
                  makeItemUpdateNotification(result.updatedItems),
                );
              }
              sendGirlUpdates(result.updatedGirls);
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(result.player.taskValues),
              );
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("ChapterMsg", {
                  nError: 0,
                  nState: 2,
                }),
              );
              logger.info("lua.callback", {
                peer,
                account: context.account,
                method: "ChapterMsg",
                command: "star_award",
                chapter,
                difficulty,
                position,
                awards: result.awards,
              });
            } catch (error) {
              if (!(error instanceof ChapterStarAwardError)) throw error;
              const nError =
                error.reason === "already_claimed"
                  ? 20033
                  : error.reason === "not_completed"
                    ? 20034
                    : 1;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("ChapterMsg", {
                  nError,
                  nState: 2,
                }),
              );
              logger.info("chapter.star_award.rejected", {
                account: context.account,
                chapter,
                difficulty,
                position,
                reason: error.reason,
              });
            }
          } else if (girlTrainingCall) {
            try {
              const result = await players.startGirlTraining(
                context.account,
                girlTrainingCall.girlId,
                girlTrainingCall.position,
              );
              context.player = result.player;
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(result.player.taskValues),
              );
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("GirlLogic", {
                  sCmd: "StartTrain",
                  nId: result.girlId,
                  nPos: result.position,
                }),
              );
              logger.info("girl.training.started", {
                peer,
                account: context.account,
                girlId: result.girlId,
                position: result.position,
                endTime: result.endTime,
                outdoorId: result.outdoorId,
              });
            } catch (error) {
              if (!(error instanceof GirlTrainingError)) throw error;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("GirlLogic", {
                  sCmd: "StartTrain",
                  nError: error.clientError,
                }),
              );
              logger.warn("girl.training.rejected", {
                peer,
                account: context.account,
                ...girlTrainingCall,
                reason: error.reason,
                clientError: error.clientError,
              });
            }
          } else if (girlAppearanceCall) {
            let callback: Record<string, unknown>;
            if (girlAppearanceCall.command === "SetMainGirl") {
              context.player = await players.setMainGirl(
                context.account,
                girlAppearanceCall.girlId,
              );
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(context.player.taskValues),
              );
              callback = {
                sCmd: girlAppearanceCall.command,
                nId: girlAppearanceCall.girlId,
              };
            } else if (girlAppearanceCall.command === "ChangeCloth") {
              callback = {
                sCmd: girlAppearanceCall.command,
                nId: girlAppearanceCall.girlId,
                nSuit: girlAppearanceCall.modelId,
              };
              try {
                const result = await players.changeGirlClothes(
                  context.account,
                  girlAppearanceCall.girlId,
                  girlAppearanceCall.modelId,
                );
                context.player = result.player;
                sendGirlUpdates([result.girl]);
              } catch (error) {
                if (!(error instanceof CustomGirlOutfitUnavailableError)) throw error;
                send(
                  COMMAND.NTF_S2C_CALL,
                  0,
                  makeServerLuaCall("GirlLogic", { ...callback, nError: 1 }),
                );
                logger.warn("girl.appearance.rejected", {
                  peer,
                  account: context.account,
                  ...girlAppearanceCall,
                  reason: error.message,
                });
                return;
              }
            } else {
              context.player = await players.setGirlFightModel(
                context.account,
                girlAppearanceCall.girlId,
                girlAppearanceCall.enabled,
              );
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(context.player.taskValues),
              );
              callback = {
                sCmd: girlAppearanceCall.command,
                nId: girlAppearanceCall.girlId,
                nUse: girlAppearanceCall.enabled ? 1 : 0,
                bSuccess: true,
              };
            }
            send(COMMAND.NTF_S2C_CALL, 0, makeServerLuaCall("GirlLogic", callback));
            logger.info("girl.appearance.updated", {
              peer,
              account: context.account,
              ...girlAppearanceCall,
            });
          } else if (girlGiftCall) {
            try {
              const result = await players.sendGirlGift(
                context.account,
                girlGiftCall.girlId,
                girlGiftCall.item,
                girlGiftCall.count,
              );
              context.player = result.player;
              send(COMMAND.GIRL_UPDATE_NTF, 0, makeGirlUpdateNotification(result.girl));
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification([result.consumedItem]),
              );
              if (
                result.unlockedSecretIds.length > 0 ||
                result.fetterUnlocks.length > 0
              ) {
                send(
                  COMMAND.TASK_VALUE_RSP,
                  0,
                  makeTaskValueSync(result.player.taskValues),
                );
              }
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("GirlLogic", {
                  sCmd: "GirlGift",
                  nId: result.girlId,
                  bLove: result.loved,
                  nIsMaxlevel: result.reachedMaxLevel,
                  nAddExp: result.addedExperience,
                  nOldExp: result.oldExperience,
                  nNewExp: result.newExperience,
                  nOldLevel: result.oldLevel,
                  nNewLevel: result.newLevel,
                  bAct: result.activityGift,
                  bSp: result.specialActivityGift,
                }),
              );
              logger.info("girl.gift.sent", {
                peer,
                account: context.account,
                girlId: result.girlId,
                item: result.item,
                count: result.count,
                loved: result.loved,
                addedExperience: result.addedExperience,
                oldLevel: result.oldLevel,
                newLevel: result.newLevel,
                unlockedSecretIds: result.unlockedSecretIds,
              });
            } catch (error) {
              if (!(error instanceof GirlGiftError)) throw error;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("GirlLogic", {
                  sCmd: "GirlGift",
                  nError: error.clientError,
                }),
              );
              logger.warn("girl.gift.rejected", {
                peer,
                account: context.account,
                ...girlGiftCall,
                reason: error.reason,
                clientError: error.clientError,
              });
            }
          } else if (girlLevelAwardCall) {
            try {
              context.player = await players.claimGirlLevelAward(
                context.account,
                girlLevelAwardCall.girlId,
                girlLevelAwardCall.level,
              );
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(context.player.taskValues),
              );
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("GirlLogic", {
                  sCmd: "LevelAward",
                  nId: girlLevelAwardCall.girlId,
                  nLevel: girlLevelAwardCall.level,
                }),
              );
              logger.info("girl.level_award.claimed", {
                peer,
                account: context.account,
                ...girlLevelAwardCall,
              });
            } catch (error) {
              if (!(error instanceof GirlLevelAwardError)) throw error;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("GirlLogic", {
                  sCmd: "LevelAward",
                  nId: girlLevelAwardCall.girlId,
                  nLevel: girlLevelAwardCall.level,
                  nError: 1,
                }),
              );
              logger.warn("girl.level_award.rejected", {
                peer,
                account: context.account,
                ...girlLevelAwardCall,
                reason: error.reason,
              });
            }
          } else if (girlEndTrainCall) {
            try {
              const result = await players.endGirlTraining(
                context.account,
                girlEndTrainCall.girlId,
              );
              context.player = result.player;
              send(COMMAND.GIRL_UPDATE_NTF, 0, makeGirlUpdateNotification(result.girl));
              for (const money of result.updatedMoney) {
                send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
              }
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(result.player.taskValues),
              );
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("GirlLogic", {
                  sCmd: "EndTrain",
                  nId: result.girlId,
                  nMoney: [15, 1, 1, 1, result.gold],
                  AddExpInfo: [
                    result.addedExperience,
                    result.oldExperience,
                    result.newExperience,
                    result.oldLevel,
                    result.newLevel,
                  ],
                }),
              );
              logger.info("girl.training.ended", {
                peer,
                account: context.account,
                girlId: result.girlId,
                position: result.position,
                gold: result.gold,
                addedExperience: result.addedExperience,
                oldLevel: result.oldLevel,
                newLevel: result.newLevel,
                unlockedSecretIds: result.unlockedSecretIds,
              });
            } catch (error) {
              if (!(error instanceof GirlTrainingError)) throw error;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("GirlLogic", {
                  sCmd: "EndTrain",
                  nId: girlEndTrainCall.girlId,
                  nError: error.clientError,
                }),
              );
              logger.warn("girl.training.end_rejected", {
                peer,
                account: context.account,
                ...girlEndTrainCall,
                reason: error.reason,
                clientError: error.clientError,
              });
            }
          } else if (girlViewStoryCall) {
            try {
              const result = await players.viewGirlStory(
                context.account,
                girlViewStoryCall.girlId,
                girlViewStoryCall.storyType,
                girlViewStoryCall.storyIndex,
              );
              context.player = result.player;
              if (result.updatedItems.length > 0) {
                send(
                  COMMAND.ITEM_UPDATE_NTF,
                  0,
                  makeItemUpdateNotification(result.updatedItems),
                );
              }
              for (const money of result.updatedMoney) {
                send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
              }
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(result.player.taskValues),
              );
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("GirlLogic", {
                  sCmd: "ViewStory",
                  nId: girlViewStoryCall.girlId,
                  nType: girlViewStoryCall.storyType,
                  nStoryId: girlViewStoryCall.storyIndex,
                }),
              );
              logger.info("girl.story.viewed", {
                peer,
                account: context.account,
                ...girlViewStoryCall,
                alreadyRead: result.alreadyRead,
                awards: result.awards,
              });
            } catch (error) {
              if (!(error instanceof GirlViewStoryError)) throw error;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("GirlLogic", {
                  sCmd: "ViewStory",
                  nId: girlViewStoryCall.girlId,
                  nType: girlViewStoryCall.storyType,
                  nStoryId: girlViewStoryCall.storyIndex,
                  nError: 1,
                }),
              );
              logger.warn("girl.story.view_rejected", {
                peer,
                account: context.account,
                ...girlViewStoryCall,
                reason: error.reason,
              });
            }
          } else if (isHeadTouchedCall(call)) {
            const { nId: girlId, nType: interactionType } = call.parameters;
            // Retries of one packet reuse its serial. Distinct physical gestures
            // have distinct serials and must each consume/count normally.
            const retryKey = packet.serial > 0 ? `${packet.serial}:${call.json}` : null;
            const now = Date.now();
            for (const [key, cached] of context.headpatResponses) {
              if (cached.expiresAt <= now) context.headpatResponses.delete(key);
            }
            const cached = retryKey
              ? context.headpatResponses.get(retryKey)
              : undefined;
            if (cached) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("GirlLogic", cached.response),
              );
              return;
            }
            try {
              if (
                typeof girlId !== "number" ||
                !Number.isSafeInteger(girlId) ||
                typeof interactionType !== "number" ||
                !Number.isSafeInteger(interactionType)
              ) {
                throw new HeadpatError("invalid_request");
              }
              const result = await players.headpatGirl(
                context.account,
                girlId,
                interactionType,
              );
              // Charges/affection must reach the client before OnHeadTouched
              // redraws the progress controls and the next refill timer.
              sendPromiseUpdates(result, interactionType !== 2);
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("GirlLogic", result.response),
              );
              if (retryKey) {
                context.headpatResponses.set(retryKey, {
                  response: result.response,
                  expiresAt: now + SETTLEMENT_CACHE_TTL_MS,
                });
                if (context.headpatResponses.size > 64) {
                  context.headpatResponses.delete(
                    context.headpatResponses.keys().next().value!,
                  );
                }
              }
              logger.info("girl.headpat.completed", {
                account: context.account,
                girlId,
                interactionType,
                serial: packet.serial,
                addedExperience: result.response.nAddExp ?? 0,
                completedOathTasks: result.completedTaskIds,
              });
            } catch (error) {
              if (!(error instanceof HeadpatError)) throw error;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("GirlLogic", {
                  sCmd: "HeadTouched",
                  nId:
                    typeof girlId === "number" && Number.isSafeInteger(girlId)
                      ? girlId
                      : 0,
                  nType:
                    typeof interactionType === "number" &&
                    Number.isSafeInteger(interactionType)
                      ? interactionType
                      : 0,
                  nError: error.clientError,
                }),
              );
              if (error.clientError !== 2) {
                send(
                  COMMAND.NTF_S2C_CALL,
                  0,
                  makeServerLuaCall("CallClientTip", ["Error.1"]),
                );
              }
              logger.info("girl.headpat.rejected", {
                account: context.account,
                reason: error.reason,
                serial: packet.serial,
              });
            }
          } else if (doRechargeCall) {
            const sendRechargeCallback = (tbParam: Record<string, unknown>): void => {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("LuaCall", {
                  sCmd: LUA_COMMAND_DO_RECHARGE,
                  tbParam,
                }),
              );
            };
            if (
              doRechargeCall.shopType === 1 &&
              doRechargeCall.id === FREE_GIFT_PACK_ID
            ) {
              try {
                const result = await players.claimIBShopFreePack(context.account);
                context.player = result.player;
                send(
                  COMMAND.ITEM_UPDATE_NTF,
                  0,
                  makeItemUpdateNotification([result.item]),
                );
                send(
                  COMMAND.TASK_VALUE_RSP,
                  0,
                  makeTaskValueSync(result.player.taskValues),
                );
                sendRechargeCallback({
                  Type: 1,
                  Id: FREE_GIFT_PACK_ID,
                  Error: 0,
                  tbItem: [FREE_GIFT_PACK_AWARD],
                });
                logger.info("ib_shop.free_pack.claimed", {
                  peer,
                  account: context.account,
                  packId: FREE_GIFT_PACK_ID,
                  purchaseCount: result.purchaseCount,
                  itemGuid: result.item.guid,
                });
              } catch (error) {
                if (!(error instanceof IBShopError)) throw error;
                sendRechargeCallback({
                  Type: 1,
                  Id: FREE_GIFT_PACK_ID,
                  Error: error.clientError,
                });
                logger.warn("ib_shop.free_pack.rejected", {
                  peer,
                  account: context.account,
                  packId: FREE_GIFT_PACK_ID,
                  reason: error.reason,
                  clientError: error.clientError,
                });
              }
            } else if (
              doRechargeCall.shopType === 2 &&
              doRechargeCall.id === MONTH_CARD_ITEM_ID
            ) {
              try {
                const result = await players.claimIBItemFree(
                  context.account,
                  doRechargeCall.id,
                );
                context.player = result.player;
                for (const money of result.updatedMoney) {
                  send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
                }
                send(
                  COMMAND.TASK_VALUE_RSP,
                  0,
                  makeTaskValueSync(result.player.taskValues),
                );
                sendRechargeCallback({
                  Type: 2,
                  Id: MONTH_CARD_ITEM_ID,
                  Error: 0,
                  TradeNo: `offline-${Date.now()}`,
                  Unit: "CNY",
                  CallBackUrl: "",
                });
                send(
                  COMMAND.NTF_S2C_CALL,
                  0,
                  makeServerLuaCall("BuyMonth", {
                    nType: 2,
                    bMonth: 1,
                    nId: MONTH_CARD_ITEM_ID,
                  }),
                );
                send(
                  COMMAND.NTF_S2C_CALL,
                  0,
                  makeServerLuaCall("LuaCall", {
                    sCmd: LUA_COMMAND_PAY_RESULT_SUCCESS,
                    tbParam: { nAllTimes: result.purchaseCount, nDailyTimes: 1 },
                  }),
                );
                logger.info("ib_item.month_card.claimed", {
                  peer,
                  account: context.account,
                  itemId: MONTH_CARD_ITEM_ID,
                  purchaseCount: result.purchaseCount,
                  diamonds: result.diamonds,
                  monthCardEndTime: result.monthCardEndTime,
                });
              } catch (error) {
                if (!(error instanceof IBShopError)) throw error;
                sendRechargeCallback({
                  Type: 2,
                  Id: MONTH_CARD_ITEM_ID,
                  Error: error.clientError,
                });
                logger.warn("ib_item.month_card.rejected", {
                  peer,
                  account: context.account,
                  itemId: MONTH_CARD_ITEM_ID,
                  reason: error.reason,
                  clientError: error.clientError,
                });
              }
            } else {
              sendRechargeCallback({
                Type: doRechargeCall.shopType,
                Id: doRechargeCall.id,
                Error: IB_SHOP_ERROR_UNKNOWN_ITEM,
              });
              logger.warn("ib_shop.unsupported", {
                peer,
                account: context.account,
                ...doRechargeCall,
              });
            }
          } else {
            logger.warn("lua.unhandled", {
              peer,
              account: context.account,
              method: call?.method,
              command: luaCommand,
              parameters: call?.parameters,
            });
          }
        }
        return;
      }

      if (packet.command === COMMAND.PVP_APPLY_CREATE_TEAM_REQ) {
        // 联机创建队伍：本机单人离线服，伪造 AI 机器人队友走通房间链路。
        // 客户端请求不带 PlayerBaseInfo/roleId（见 OnlineProto 只发
        // mapId/isPublic/activityId/isReady/solutionId），自己的房间资料
        // 由服务器从存档构建。
        const request = decodePvpCreateTeamRequest(packet.payload);
        const player = context.player;
        if (!player) return;
        const roleId = player.roleId;
        logger.info("pvp.create_team.request", {
          peer,
          account: context.account,
          mapId: request.mapId,
          roleId,
          solutionId: request.solutionId,
          isPublic: request.isPublic,
          activityId: request.activityId,
          isReady: request.isReady,
          payloadHex: packet.payload.toString("hex"),
        });
        const session = pvpSessions.createTeam({
          roleId,
          name: player.name,
          level: player.level,
          solutionRaw: buildPvpEquipSolution(player),
          ready: request.isReady,
          mapId: request.mapId,
          isPublic: request.isPublic,
          activityId: request.activityId,
        });
        const teamRaw = encodePvpTeamRaw(session);
        send(
          COMMAND.PVP_APPLY_CREATE_TEAM_RSP,
          packet.serial,
          makePvpCreateTeamResponse({
            teamId: session.team.teamId,
            teamRaw,
            roleId,
            mapId: session.team.mapId,
            activityId: session.team.activityId,
          }),
        );
        send(
          COMMAND.PVP_NOTIFY_TEAM_READY_DATA,
          0,
          makePvpNotifyTeamReadyData({
            roleId,
            whoId: roleId,
            whoName: session.team.players[0]?.name ?? "",
            players: session.team.players.map((player) => ({
              roleId: player.roleId,
              ready: player.ready,
              isInFormation: player.isInFormation,
            })),
          }),
        );
        logger.info("pvp.create_team.ok", {
          peer,
          account: context.account,
          teamId: session.team.teamId,
          players: session.team.players.length,
        });
        return;
      }

      if (packet.command === COMMAND.PVP_APPLY_BEGIN_MATCH_REQ) {
        // 匹配入口：直接伪装匹配成功——建队（含机器人）、推队伍数据、随后
        // 推 1652 让客户端连战斗通道，避开 UI_OnlineMatch 的 120 秒超时。
        const request = decodePvpBeginMatchRequest(packet.payload);
        const player = context.player;
        if (!player) return;
        const roleId = player.roleId;
        logger.info("pvp.begin_match.request", {
          peer,
          account: context.account,
          mapId: request.mapId,
          roleId,
          activityId: request.activityId,
        });
        const session =
          pvpSessions.getSession(roleId) ??
          pvpSessions.createTeam({
            roleId,
            name: player.name,
            level: player.level,
            solutionRaw: buildPvpEquipSolution(player),
            ready: true,
            mapId: request.mapId,
            isPublic: false,
            activityId: request.activityId,
          });
        send(
          COMMAND.PVP_APPLY_BEGIN_MATCH_RSP,
          packet.serial,
          makePvpBeginMatchResponse({ mapId: request.mapId, roleId, ret: 0 }),
        );
        setTimeout(() => {
          if (socket.destroyed) return;
          send(
            COMMAND.PVP_NOTIFY_TEAM_DATA,
            0,
            makePvpNotifyTeamData(roleId, encodePvpTeamRaw(session)),
          );
        }, 500);
        setTimeout(() => {
          if (socket.destroyed) return;
          sendPvpFightConnect(session, roleId);
        }, 1500);
        return;
      }

      if (packet.command === COMMAND.PVP_APPLY_END_MATCH_REQ) {
        const roleId = context.player?.roleId ?? 0;
        send(
          COMMAND.PVP_APPLY_END_MATCH_RSP,
          packet.serial,
          makePvpEndMatchResponse(roleId),
        );
        return;
      }

      if (packet.command === COMMAND.PVP_APPLY_TEAM_READY_REQ) {
        // 房主"开始战斗"也是这条（ready=true）。房主准备即开战：
        // 回 1636，推 1654 就绪状态，然后创建房间并推 1652 战斗通道地址。
        // 服务器重启后客户端可能仍停留在房间界面直接重发 1635（无会话），
        // 此时按请求 mapId 现场重建队伍，保证链路可恢复。
        const request = decodePvpTeamReadyRequest(packet.payload);
        const player = context.player;
        if (!player) return;
        const roleId = player.roleId;
        let session = pvpSessions.getSession(roleId);
        logger.info("pvp.team_ready.request", {
          peer,
          account: context.account,
          roleId,
          ...request,
          hasSession: session !== undefined,
        });
        pvpSessions.setReady(roleId, request.ready, request.isInFormation);
        send(
          COMMAND.PVP_APPLY_TEAM_READY_RSP,
          packet.serial,
          makePvpTeamReadyResponse(roleId, true),
        );
        if (!session && request.ready) {
          session = pvpSessions.createTeam({
            roleId,
            name: player.name,
            level: player.level,
            solutionRaw: buildPvpEquipSolution(player),
            ready: true,
            mapId: request.mapId,
            isPublic: false,
            activityId: 0,
          });
          logger.info("pvp.team_ready.session_recovered", {
            peer,
            account: context.account,
            roleId,
            mapId: request.mapId,
          });
        }
        if (!session) return;
        send(
          COMMAND.PVP_NOTIFY_TEAM_READY_DATA,
          0,
          makePvpNotifyTeamReadyData({
            roleId,
            whoId: roleId,
            whoName: session.team.players[0]?.name ?? "",
            players: session.team.players.map((entry) => ({
              roleId: entry.roleId,
              ready: entry.ready,
              isInFormation: entry.isInFormation,
            })),
          }),
        );
        if (request.ready && session.team.leaderId === roleId) {
          // 战斗结束后客户端会回房间并发 1635 ready=false（NotReady），
          // 此时房间已开过战：只刷新状态，不再重复推 1652 重开战斗。
          sendPvpFightConnect(session, roleId);
        }
        return;
      }

      if (packet.command === COMMAND.PVP_APPLY_EXIT_TEAM_REQ) {
        const roleId = context.player?.roleId ?? 0;
        pvpSessions.exitTeam(roleId);
        send(
          COMMAND.PVP_APPLY_EXIT_TEAM_RSP,
          packet.serial,
          makePvpExitTeamResponse(roleId),
        );
        logger.info("pvp.exit_team.ok", { peer, account: context.account, roleId });
        return;
      }

      if (packet.command === COMMAND.PVP_APPLY_TEAM_DATA_REQ) {
        const roleId = context.player?.roleId ?? 0;
        const session = pvpSessions.getSession(roleId);
        send(
          COMMAND.PVP_APPLY_TEAM_DATA_RSP,
          packet.serial,
          makePvpTeamDataResponse(roleId, session ? encodePvpTeamRaw(session) : null),
        );
        return;
      }

      if (packet.command === COMMAND.PVP_APPLY_UPDATE_PLAYERINFO_REQ) {
        // 客户端从房间进编队后刷新自己资料；请求不含编队内容，服务器直接
        // 按当前存档重建 solution 并重推队伍数据。
        const player = context.player;
        if (!player) return;
        const roleId = player.roleId;
        pvpSessions.updateSelfSolution(roleId, buildPvpEquipSolution(player));
        send(
          COMMAND.PVP_APPLY_UPDATE_PLAYERINFO_RSP,
          packet.serial,
          makePvpUpdatePlayerInfoResponse(roleId),
        );
        const session = pvpSessions.getSession(roleId);
        if (session) {
          // 仅在真正需要重开房间界面时推 1653。NotifyTeamData 的客户端
          // 处理（PvpClient.lua:373-380）在 UI_Main 打开时会
          // CloseAndOpen(UI_CreateTeam) 强制把房间界面提到最前——战斗结束
          // 回主界面时若因此附带 1653，会把主界面顶掉/重叠。
          // 房间未开战（编辑编队后刷新）才推；开战后房间界面自己会在
          // 结算界面"继续"时通过 1639 重新拉取。
          if (!session.room) {
            send(
              COMMAND.PVP_NOTIFY_TEAM_DATA,
              0,
              makePvpNotifyTeamData(roleId, encodePvpTeamRaw(session)),
            );
          }
        }
        return;
      }

      if (packet.command === COMMAND.PVP_APPLY_MODIFY_ROOM_PUBLIC_REQ) {
        const request = decodePvpRoomPublic(packet.payload);
        const roleId = context.player?.roleId ?? 0;
        pvpSessions.setPublic(roleId, request.isPublic);
        send(
          COMMAND.PVP_NOTIFY_ROOM_PUBLIC_ATTR,
          0,
          makePvpNotifyRoomPublicAttr(roleId, request.isPublic),
        );
        return;
      }

      if (packet.command === COMMAND.PVP_PING_MGR_REQ) {
        send(COMMAND.PVP_PING_MGR_RSP, packet.serial, makePvpPingMgrResponse());
        return;
      }

      if (packet.command === COMMAND.PVP_APPLY_CHECK_ROOM_REQ) {
        const roleId = context.player?.roleId ?? 0;
        send(
          COMMAND.PVP_APPLY_CHECK_ROOM_RSP,
          packet.serial,
          makePvpCheckRoomResponse(roleId),
        );
        return;
      }

      if (packet.command === COMMAND.PVP_APPLY_SEND_EMOJI_REQ) {
        const request = decodePvpEmoji(packet.payload);
        const roleId = context.player?.roleId ?? 0;
        send(
          COMMAND.PVP_NOTIFY_EMOJI,
          packet.serial,
          makePvpNotifyEmoji({
            roleId,
            sendId: roleId,
            emojiIndex: request.emojiIndex,
          }),
        );
        return;
      }

      if (packet.command === COMMAND.PVP_APPLY_ZAN_REQ) {
        const roleId = context.player?.roleId ?? 0;
        send(COMMAND.PVP_APPLY_ZAN_RSP, packet.serial, makePvpZanResponse(roleId));
        return;
      }

      if (packet.command === COMMAND.PVP_APPLY_KICKING_REQ) {
        const request = decodePvpKicking(packet.payload);
        const roleId = context.player?.roleId ?? 0;
        pvpSessions.kickPlayer(roleId, request.memId);
        send(
          COMMAND.PVP_APPLY_KICKING_RSP,
          packet.serial,
          makePvpKickingResponse({ roleId, memId: request.memId }),
        );
        const session = pvpSessions.getSession(roleId);
        if (session) {
          send(
            COMMAND.PVP_NOTIFY_TEAM_DATA,
            0,
            makePvpNotifyTeamData(roleId, encodePvpTeamRaw(session)),
          );
        }
        return;
      }

      logger.warn("gateway.unhandled", {
        peer,
        command: packet.command,
        commandName: commandName(packet.command),
        serial: packet.serial,
      });
    }

    socket.on("data", (data) => {
      pending = Buffer.concat([pending, data]);
      const packets = [];
      while (pending.length >= HEADER_SIZE) {
        const packetSize = pending.readUInt32LE(4);
        if (packetSize < HEADER_SIZE || packetSize > config.gateway.maxPacketBytes) {
          logger.error("gateway.invalid_packet_size", { peer, packetSize });
          socket.destroy();
          return;
        }
        if (pending.length < packetSize) break;
        packets.push(pending.subarray(0, packetSize));
        pending = pending.subarray(packetSize);
      }

      for (const packet of packets) {
        receiveQueue = receiveQueue
          .then(() => handlePacket(packet))
          .catch((error: unknown) => {
            const cause = error instanceof Error ? error : new Error(String(error));
            logger.error("gateway.packet_failed", {
              peer,
              message: cause.message,
              stack: cause.stack,
            });
          });
      }
    });

    socket.on("end", () => logger.info("gateway.ended", { peer }));
    socket.on("close", () => {
      clearTimeout(mailResetTimer);
      const roleId = context.player?.roleId;
      if (roleId !== undefined && pvpSessions.exitTeam(roleId)) {
        logger.info("pvp.session.closed_with_connection", { peer, roleId });
      }
    });
    socket.on("error", (error) =>
      logger.warn("gateway.socket_error", { peer, message: error.message }),
    );
  });
}
