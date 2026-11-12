/**
 * Exact final-CN CharacterCard P=17 (Little Dress/Fantasy Oath) templates.
 * Generated from the reviewed native-schema export, not guessed skill IDs.
 * Source setting.u SHA256: 89418a55f80c346b24673bfc2f0cabfa731a0b7c0b77913a1a19b0df6d540ef8
 * CharacterCard.json SHA256: 41e71a1b5ff1c171f5725303d93fd16a8e488328d875d9f1695cef55a4fbf764
 *
 * UI_PromiseEnhance.GetSkillInfo (253-257) orders PldgeSteps.cardskilllv as
 * [TacticalSkill, PassiveSkill1, PassiveSkill2, ResistanceSkill]. Native
 * EquipManager.GetProtoItemInfo at 0x1d9ee7c exports skilltype 3 for tactical,
 * and 2 for passive/resistance. AddCharacterCard matches MiniSkill.skillid
 * against these template IDs. All 42 oath templates have TacticalSkill2=0.
 *
 * Heart presentation needs no item attribute: final oath GDPL P=17/L=5,
 * level 70 and PldgeData step/rewardstep drive the existing client visuals.
 */
const OATH_CARD_SKILLS = new Map<string, readonly [number, number, number, number]>([
  ["1:3", [31245, 31247, 31251, 38180]],
  ["1:4", [31253, 31256, 31261, 38181]],
  ["1:5", [31253, 31256, 31261, 38181]],
  ["2:3", [30392, 28267, 28271, 38144]],
  ["2:4", [30398, 28269, 28272, 38145]],
  ["2:5", [30398, 28269, 28272, 38145]],
  ["3:3", [30627, 30629, 30631, 38177]],
  ["3:4", [30633, 30635, 30637, 38178]],
  ["3:5", [30633, 30635, 30637, 38178]],
  ["4:3", [30917, 30920, 30923, 38162]],
  ["4:4", [30925, 30928, 30931, 38163]],
  ["4:5", [30925, 30928, 30931, 38163]],
  ["5:3", [31427, 31429, 31430, 38174]],
  ["5:4", [31433, 31435, 31436, 38175]],
  ["5:5", [31433, 31435, 31436, 38175]],
  ["6:3", [30435, 30440, 30446, 38168]],
  ["6:4", [30436, 30443, 30448, 38169]],
  ["6:5", [30436, 30443, 30448, 38169]],
  ["7:3", [30933, 30934, 30935, 38147]],
  ["7:4", [30936, 30937, 30938, 38148]],
  ["7:5", [30936, 30937, 30938, 38148]],
  ["8:3", [30402, 28273, 28276, 38165]],
  ["8:4", [30403, 28274, 28278, 38166]],
  ["8:5", [30403, 28274, 28278, 38166]],
  ["9:3", [31294, 31299, 31300, 38144]],
  ["9:4", [31302, 31306, 31307, 38145]],
  ["9:5", [31302, 31306, 31307, 38145]],
  ["10:3", [30639, 30640, 30641, 38171]],
  ["10:4", [30643, 30644, 30645, 38172]],
  ["10:5", [30643, 30644, 30645, 38172]],
  ["11:3", [30453, 30455, 30459, 38156]],
  ["11:4", [30454, 30457, 30462, 38157]],
  ["11:5", [30454, 30457, 30462, 38157]],
  ["12:3", [31388, 31389, 31391, 38147]],
  ["12:4", [31393, 31396, 31400, 38148]],
  ["12:5", [31393, 31396, 31400, 38148]],
  ["14:3", [32091, 32093, 32099, 38162]],
  ["14:4", [32092, 32094, 32100, 38163]],
  ["14:5", [32092, 32094, 32100, 38163]],
  ["15:3", [32103, 32105, 32109, 38144]],
  ["15:4", [32104, 32106, 32110, 38145]],
  ["15:5", [32104, 32106, 32110, 38145]],
]);

export interface OathCardSkillState {
  genre: number;
  detail: number;
  particular: number;
  templateLevel: number;
  cardSkillLevels?: readonly [number, number, number, number];
}

export interface OathCardSkillInfo {
  skillId: number;
  skillLevel: number;
  skillType: 2 | 3;
}

/** Optional oath progression only; legacy cards and all weapons stay unchanged. */
export function oathCardSkills(card: OathCardSkillState): OathCardSkillInfo[] {
  if (card.genre !== 1 || card.particular !== 17 || !card.cardSkillLevels) {
    return [];
  }
  const ids = OATH_CARD_SKILLS.get(`${card.detail}:${card.templateLevel}`);
  if (!ids) return [];
  const levels = card.cardSkillLevels;
  if (
    levels.length !== 4 ||
    levels.some((level) => !Number.isSafeInteger(level) || level < 1 || level > 4)
  ) {
    throw new RangeError(
      "Oath card skill levels must contain four integers from 1 to 4",
    );
  }
  return ids.map((skillId, index) => ({
    skillId,
    skillLevel: levels[index]!,
    skillType: index === 0 ? 3 : 2,
  }));
}
