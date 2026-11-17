/**
 * Main-screen themes and backgrounds (UI_MainThemeTip, MainOrnament.lua).
 *
 * All state lives in task group 87 (MainOrnament.TaskGroup):
 * - 87/0: current theme id (0 is read as 1, MainOrnament:UpdateThemeID).
 * - 87/1000: show the theme's UI decoration when above 0.
 * - 87/2000: current background id (0 is read as 1, MainOrnament:GetSkinBgId).
 * - 87/id: time the theme was received. MainOrnament:IsUseTheme locks the
 *   theme while it is 0 or below. 87/(id + 20000) is read as ">= 0 means
 *   permanent", so the default 0 already makes an owned theme permanent.
 * - 87/(2000 + id): background owned when above 0 (MainOrnament:CheckSkin).
 *   Backgrounds 0 and 1 are always owned.
 *
 * The client's ItemList has theme items (ItemDecorateAuto, 6-24-N-3,
 * ExtParam1 = theme id) only for themes 6 to 11. Themes 1 to 5 of
 * Player/MainOrnament.txt (Default, Concert, Celebration, Mid-Autumn,
 * Halloween) have no item, so a player could never receive them, and the
 * lock tip (UI_ThemeUnlockTip, item 6-24-id-3) stops on a nil item and shows
 * an empty white icon. This server gives those five themes to every player.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const MAIN_ORNAMENT_TASK_GROUP = 87;
export const CURRENT_THEME_TASK = 0;
export const SHOW_DECORATION_TASK = 1000;
export const CURRENT_BACKGROUND_TASK = 2000;
const BACKGROUND_OWNED_OFFSET = 2000;

/** LuaCall.ChangeDecorate: {{type = 1, id = theme}, {type = 2, id = theme or 0}}. */
export const LUA_COMMAND_CHANGE_DECORATE = 95;
/** LuaCall.ChangeBackground: {id = background, 0 for the default}. */
export const LUA_COMMAND_CHANGE_BACKGROUND = 96;

/** MainOrnament.txt themes that have no 6-24-N item in ItemList. */
export const ITEMLESS_THEME_IDS: readonly number[] = [1, 2, 3, 4, 5];
/** The highest theme id in MainOrnament.txt; theme items name 6 to 11. */
const MAX_THEME_ID = 11;
/** The highest background id in Player/MainSkinBg.txt. */
const MAX_BACKGROUND_ID = 26;

export function makeOrnamentTaskId(offset: number): number {
  return (MAIN_ORNAMENT_TASK_GROUP << 16) | offset;
}

type TaskValues = Record<string, number>;

function task(values: TaskValues, offset: number): number {
  return Number(values[String(makeOrnamentTaskId(offset))] ?? 0);
}

/** Gives the item-less themes to the player; returns the task ids it set. */
export function reconcileMainThemes(values: TaskValues, unixNow: number): number[] {
  const changed: number[] = [];
  for (const id of ITEMLESS_THEME_IDS) {
    if (task(values, id) > 0) continue;
    values[String(makeOrnamentTaskId(id))] = unixNow;
    changed.push(makeOrnamentTaskId(id));
  }
  return changed;
}

export function ownsTheme(values: TaskValues, id: number): boolean {
  return (
    Number.isSafeInteger(id) && id >= 1 && id <= MAX_THEME_ID && task(values, id) > 0
  );
}

export function ownsBackground(values: TaskValues, id: number): boolean {
  if (!Number.isSafeInteger(id) || id < 0 || id > MAX_BACKGROUND_ID) return false;
  return id <= 1 || task(values, BACKGROUND_OWNED_OFFSET + id) > 0;
}

export type OrnamentChange =
  { ok: true; changed: Record<number, number> } | { ok: false; reason: string };

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function unwrap(parameters: unknown): unknown {
  return isRecord(parameters) && "sCmd" in parameters ? parameters.tbParam : parameters;
}

/**
 * ChangeDecorate. Type 1 sets the current theme (it must be owned), type 2
 * the decoration switch (the client sends the theme id to show it, 0 to hide).
 */
export function changeDecorate(
  values: TaskValues,
  parameters: unknown,
): OrnamentChange {
  const body = unwrap(parameters);
  const entries = Array.isArray(body)
    ? body
    : isRecord(body)
      ? Object.keys(body).every((key) => /^\d+$/.test(key))
        ? Object.values(body)
        : [body]
      : [];
  const parts = entries.filter(isRecord).map((entry) => ({
    type: number(entry.type),
    id: number(entry.id),
  }));
  if (parts.length === 0) return { ok: false, reason: "no_entries" };
  const changed: Record<number, number> = {};
  for (const { type, id } of parts) {
    if (type === 1) {
      if (!ownsTheme(values, id)) return { ok: false, reason: `theme_not_owned:${id}` };
      changed[makeOrnamentTaskId(CURRENT_THEME_TASK)] = id;
    } else if (type === 2) {
      changed[makeOrnamentTaskId(SHOW_DECORATION_TASK)] = id > 0 ? 1 : 0;
    }
  }
  if (Object.keys(changed).length === 0) return { ok: false, reason: "no_known_type" };
  for (const [taskId, value] of Object.entries(changed)) values[taskId] = value;
  return { ok: true, changed };
}

/** ChangeBackground: {id = N}; 0 and 1 both mean the default background. */
export function changeBackground(
  values: TaskValues,
  parameters: unknown,
): OrnamentChange {
  const body = unwrap(parameters);
  const id = number(isRecord(body) ? body.id : body);
  if (!ownsBackground(values, id))
    return { ok: false, reason: `background_not_owned:${id}` };
  const taskId = makeOrnamentTaskId(CURRENT_BACKGROUND_TASK);
  values[String(taskId)] = id;
  return { ok: true, changed: { [taskId]: id } };
}
