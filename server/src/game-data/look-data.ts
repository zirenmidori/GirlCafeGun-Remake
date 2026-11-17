/**
 * The profile look of UI_SkinSelected: card skin (Skin.txt), player-list mark
 * (Board.txt) and chat bubble (Babble.txt).
 *
 * - LuaCall 91/92/93 (Player_SetVisitingCard, Player_SetPlayerListSkin,
 *   Player_SetChatBubble) send the chosen id as a bare number
 *   (UI_SkinSelected.lua). 0 takes the look off (CardCommon.lua sends 0 when
 *   a timed look expired).
 * - LuaCall 94 (Player_GetVisitingCardData) reads the three ids back:
 *   {VisitingCardID, PlayerListSkinID, ChatBubbleID}. UI_User:OnChangeSkin
 *   reads the same object from the 91 reply.
 * - Owned when task 76, 77 or 78/id holds the time it was received
 *   (UI_SkinSelected:IsUnlock; the items set it, auto-use-item-data.ts).
 *   Expiry of timed looks is left to the client, which checks it itself.
 */
export const LUA_COMMAND_SET_VISITING_CARD = 91;
export const LUA_COMMAND_SET_PLAYER_LIST_SKIN = 92;
export const LUA_COMMAND_SET_CHAT_BUBBLE = 93;
export const LUA_COMMAND_GET_VISITING_CARD_DATA = 94;
/** ui.Error.20015 "Locked. Action disabled."; UI_User shows ui.Error.<nError>. */
export const PROFILE_LOOK_LOCKED_ERROR = 20015;

export interface ProfileLookState {
  visitingCardId: number;
  playerListSkinId: number;
  chatBubbleId: number;
}

const PARTS = {
  [LUA_COMMAND_SET_VISITING_CARD]: { field: "visitingCardId", group: 76 },
  [LUA_COMMAND_SET_PLAYER_LIST_SKIN]: { field: "playerListSkinId", group: 77 },
  [LUA_COMMAND_SET_CHAT_BUBBLE]: { field: "chatBubbleId", group: 78 },
} as const;

export function isProfileLookCommand(
  command: number | null,
): command is keyof typeof PARTS {
  return command !== null && command in PARTS;
}

export function profileLookReply(
  look: ProfileLookState | undefined,
): Record<string, number> {
  return {
    VisitingCardID: look?.visitingCardId ?? 0,
    PlayerListSkinID: look?.playerListSkinId ?? 0,
    ChatBubbleID: look?.chatBubbleId ?? 0,
  };
}

function scalarId(parameters: unknown): number {
  let value = parameters;
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "sCmd" in value
  )
    value = (value as Record<string, unknown>).tbParam;
  if (Array.isArray(value) && value.length === 1) value = value[0];
  if (typeof value === "object" && value !== null && "id" in value)
    value = (value as Record<string, unknown>).id;
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 0 && id <= 0xffff ? id : -1;
}

export type ProfileLookChange =
  { ok: true; look: ProfileLookState } | { ok: false; reason: string };

/** Sets one part of the look when the player owns that id (0 always passes). */
export function changeProfileLook(
  current: ProfileLookState | undefined,
  taskValues: Record<string, number>,
  command: keyof typeof PARTS,
  parameters: unknown,
): ProfileLookChange {
  const id = scalarId(parameters);
  if (id < 0) return { ok: false, reason: "bad_id" };
  const { field, group } = PARTS[command];
  if (id !== 0 && !(Number(taskValues[String((group << 16) | id)] ?? 0) > 0))
    return { ok: false, reason: `not_owned:${group}/${id}` };
  return {
    ok: true,
    look: {
      visitingCardId: current?.visitingCardId ?? 0,
      playerListSkinId: current?.playerListSkinId ?? 0,
      chatBubbleId: current?.chatBubbleId ?? 0,
      [field]: id,
    },
  };
}
