/**
 * The profile page (UI_User) and its edit windows.
 *
 * - LuaCall 71 Player_GetSign / 72 Player_SetSign: the signature. The reply is
 *   a bare array, tbParam[1] is the text (UI_User:OnRecvSign,
 *   UI_ChangeSignature:OnRecvSign); "" shows ui.UI_User.DefaultSign.
 *   UI_ChangeSignature sends {text} and closes at once; UI_User:OnRecvSetSign
 *   shows the reply, and reads tbParam.nError first (any value is an error).
 * - LuaCall 73/74 Player_Get/SetExhibitionItem and 77/78
 *   Player_Get/SetExhibitionWeapon: the three show slots of the page.
 *   UI_ShowCardSelect:CheckCardChange sends all three guids, 0 for an empty
 *   slot; UI_User:OnRecvExhibitionItem/Weapon draw tbParam[1..3] by position.
 *   So a reply always has three entries, and a guid the player does not own
 *   (or a repeat) becomes 0 in its place. Cards are genre 1, weapons genre 2.
 *   The set replies only call UI_ShowCardSelect:OnChangeSuccuss.
 * - Task (1, 14): how often the player has renamed. UI_ChangeName shows the
 *   first-naming panel of the newplayer1 cartoon while it is 0, and prices the
 *   next rename as PlayerRename.txt[count + 1] Diamonds (free 3 first, then
 *   paid 12: MoneyLogic:UseFreeDiamondDialog). PlayerLogic:IsFirstLevelComplete
 *   also counts it ("entered the story after the tutorial and set a name").
 * - Task (1, 29): signature changes left. UI_ChangeSignature hides OK and
 *   locks the input at 0. No client file gives the allowance.
 * - Head frame 1 (HeadFrame.txt: Type 1, HeadSource 0) is the default frame;
 *   UI_HeadPortrait:IsUnlock needs task 11/1 above 0 for it too.
 */

export const LUA_COMMAND_GET_SIGN = 71;
export const LUA_COMMAND_SET_SIGN = 72;
export const LUA_COMMAND_GET_EXHIBITION_ITEM = 73;
export const LUA_COMMAND_SET_EXHIBITION_ITEM = 74;
export const LUA_COMMAND_GET_EXHIBITION_WEAPON = 77;
export const LUA_COMMAND_SET_EXHIBITION_WEAPON = 78;

const PROFILE_PAGE_COMMANDS = new Set([
  LUA_COMMAND_GET_SIGN,
  LUA_COMMAND_SET_SIGN,
  LUA_COMMAND_GET_EXHIBITION_ITEM,
  LUA_COMMAND_SET_EXHIBITION_ITEM,
  LUA_COMMAND_GET_EXHIBITION_WEAPON,
  LUA_COMMAND_SET_EXHIBITION_WEAPON,
]);

export function isProfilePageCommand(command: number | null): boolean {
  return command !== null && PROFILE_PAGE_COMMANDS.has(command);
}

export const RENAME_COUNT_TASK_ID = (1 << 16) | 14;
export const SIGN_CHANGES_LEFT_TASK_ID = (1 << 16) | 29;
const FIRST_LEVEL_TASK_ID = (1 << 16) | 15;
const DEFAULT_HEAD_FRAME_TASK_ID = (11 << 16) | 1;

/**
 * Signature changes per day. [INFER] No client file holds the number; the
 * window only needs it above 0. Refilled at the daily 04:00 (UTC+8) reset.
 */
export const SIGN_CHANGES_PER_DAY = 5;
/** UI_ChangeSignature has no length limit; this keeps the save small. */
export const SIGN_MAX_LENGTH = 100;
export const EXHIBITION_SLOTS = 3;
export const CARD_GENRE = 1;
export const WEAPON_GENRE = 2;

/**
 * Player/PlayerRename.txt (setting.u 0.1.3): Diamond cost of the nth rename.
 * PlayerLogic:GetRenamDiamond takes the last row for any count past it.
 */
const RENAME_DIAMONDS: readonly number[] = [0, 500, 1000, 1500, 2000];

export interface ProfilePageState {
  sign: string;
  cards: number[];
  weapons: number[];
  /** dailyMissionOperationalDate of the last signature refill. */
  signDate?: string;
}

interface OwnedItem {
  guid: number;
  genre: number;
  count: number;
}

export function renameDiamondCost(renameNumber: number): number {
  if (renameNumber < 1) return 0;
  return RENAME_DIAMONDS[Math.min(renameNumber, RENAME_DIAMONDS.length) - 1]!;
}

/** Lua sends {a, b} as [a, b] or as {"1": a, "2": b}. */
function luaArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => /^\d+$/.test(key))
    .map(([key, entry]) => [Number(key), entry] as const)
    .sort(([a], [b]) => a - b);
  if (entries.length === 0) return null;
  return entries.map(([, entry]) => entry);
}

/** The tbParam of a LuaCall, whether parameters is {sCmd, tbParam} or tbParam. */
function luaParameter(parameters: unknown): unknown {
  if (
    typeof parameters === "object" &&
    parameters !== null &&
    !Array.isArray(parameters) &&
    "sCmd" in parameters
  )
    return (parameters as Record<string, unknown>).tbParam;
  return parameters;
}

export function parseSign(parameters: unknown): string | null {
  const value = luaParameter(parameters);
  const first = typeof value === "string" ? value : luaArray(value)?.[0];
  if (typeof first !== "string") return null;
  return [...first].slice(0, SIGN_MAX_LENGTH).join("");
}

/** The three guids of a set call; null when the call holds no guid list. */
export function parseSlots(parameters: unknown): number[] | null {
  const list = luaArray(luaParameter(parameters));
  if (!list) return null;
  return Array.from({ length: EXHIBITION_SLOTS }, (_, index) => {
    const guid = Number(list[index] ?? 0);
    return Number.isSafeInteger(guid) && guid > 0 ? guid : 0;
  });
}

/** Three slots; unowned, wrong-genre and repeated guids become 0 in place. */
export function ownedSlots(
  requested: readonly number[] | undefined,
  inventory: readonly OwnedItem[],
  genre: number,
): number[] {
  const owned = new Set(
    inventory
      .filter((item) => item.genre === genre && item.count > 0)
      .map((item) => item.guid),
  );
  const seen = new Set<number>();
  return Array.from({ length: EXHIBITION_SLOTS }, (_, index) => {
    const guid = requested?.[index] ?? 0;
    if (guid <= 0 || !owned.has(guid) || seen.has(guid)) return 0;
    seen.add(guid);
    return guid;
  });
}

export function makeProfilePage(): ProfilePageState {
  return { sign: "", cards: [0, 0, 0], weapons: [0, 0, 0] };
}

/**
 * Login repair:
 * - head frame 1 owned since registration;
 * - a save that finished the tutorial with a chosen name gets rename count 1,
 *   so the profile opens the paid rename window instead of the first-naming
 *   panel (the C# build does the same at login);
 * - signature changes refilled once per operational day.
 */
export function reconcileProfilePage(
  player: {
    name: string;
    registerTime: number;
    taskValues: Record<string, number>;
    profilePage?: ProfilePageState;
  },
  defaultName: string,
  operationalDate: string,
): void {
  const tasks = player.taskValues;
  if (!((tasks[String(DEFAULT_HEAD_FRAME_TASK_ID)] ?? 0) > 0))
    tasks[String(DEFAULT_HEAD_FRAME_TASK_ID)] = Math.max(1, player.registerTime);
  if (
    (tasks[String(FIRST_LEVEL_TASK_ID)] ?? 0) >= 6 &&
    (tasks[String(RENAME_COUNT_TASK_ID)] ?? 0) === 0 &&
    player.name.trim() !== "" &&
    player.name !== defaultName
  )
    tasks[String(RENAME_COUNT_TASK_ID)] = 1;
  const page = (player.profilePage ??= makeProfilePage());
  if (page.signDate !== operationalDate) {
    page.signDate = operationalDate;
    tasks[String(SIGN_CHANGES_LEFT_TASK_ID)] = SIGN_CHANGES_PER_DAY;
  }
}
