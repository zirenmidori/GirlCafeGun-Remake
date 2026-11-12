export const LUA_COMMAND_FRIEND_LIST = 80;
export const LUA_COMMAND_VISITING_CARD_DATA = 94;
export const LUA_COMMAND_RANDOM_EVENT = 170;
export const LUA_COMMAND_GIRL_TEST_OPEN_PERIOD = 202;
export const LUA_COMMAND_ASSIST_LIST = 250;
export const LUA_COMMAND_CLUB_INFO = 10_002;

const BACKGROUND_COMMANDS = new Set([
  LUA_COMMAND_FRIEND_LIST,
  LUA_COMMAND_VISITING_CARD_DATA,
  LUA_COMMAND_RANDOM_EVENT,
  LUA_COMMAND_GIRL_TEST_OPEN_PERIOD,
  LUA_COMMAND_ASSIST_LIST,
  LUA_COMMAND_CLUB_INFO,
]);

function unwrapLuaParameters(parameters: unknown): unknown {
  if (typeof parameters !== "object" || parameters === null) return parameters;
  const envelope = parameters as Record<string, unknown>;
  return envelope.tbParam ?? parameters;
}

/**
 * Empty-state responses for optional systems requested during login/main-menu
 * initialization. Their shapes follow the corresponding client callbacks.
 */
export function makeBackgroundLuaResponse(
  command: number | null,
  parameters: unknown,
): unknown | undefined {
  if (command === null || !BACKGROUND_COMMANDS.has(command)) return undefined;

  switch (command) {
    case LUA_COMMAND_FRIEND_LIST: {
      const value = unwrapLuaParameters(parameters);
      const request =
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>)
          : {};
      return {
        reqfriendtype: Number(request.reqfriendtype) || 1,
        HYList: [],
        FXList: [],
        SQList: [],
        HMDList: [],
        BindList: [],
      };
    }
    case LUA_COMMAND_VISITING_CARD_DATA:
      return {
        VisitingCardID: 0,
        PlayerListSkinID: 0,
        ChatBubbleID: 0,
      };
    case LUA_COMMAND_RANDOM_EVENT:
      // Absence of random_event_ID explicitly means there is no active event.
      return {};
    case LUA_COMMAND_GIRL_TEST_OPEN_PERIOD:
      return { Result: 0 };
    case LUA_COMMAND_ASSIST_LIST:
      // UI_Support explicitly supports an empty result: it shows its
      // no-player state and still lets the pending sortie callback continue.
      return [];
    case LUA_COMMAND_CLUB_INFO:
      // ClubCommon treats a response without `primary` as "not in a club".
      return {};
  }
}
