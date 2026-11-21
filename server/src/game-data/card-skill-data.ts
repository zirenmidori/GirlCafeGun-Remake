import type { InventoryEntryState } from "../persistence/player-repository.js";
import {
  CharacterCardCatalog,
  type CharacterCardTemplate,
} from "./character-card-template-data.js";

export const CARD_SKILL_MAXIMUM_LEVEL = 4;
/** A same-card duplicate always gives this many skill points before its own levels. */
const DUPLICATE_BASE_SKILL_POINTS = 3;

export interface CardSkillInfo {
  skillId: number;
  skillLevel: number;
  skillType: 2 | 3;
}

type CardSkillLevels = [number, number, number, number];

/**
 * Skill slots of a template, in [Tactical, Passive1, Passive2, Resistance]
 * order. Slots without a skill id are skipped, as CardCommon does for a card
 * without a second passive, and a skill id that repeats counts once.
 */
function skillSlots(template: CharacterCardTemplate): number[] {
  const seen = new Set<number>();
  const slots: number[] = [];
  template.skillIds.forEach((skillId, index) => {
    if (skillId <= 0 || seen.has(skillId)) return;
    seen.add(skillId);
    slots.push(index);
  });
  return slots;
}

function skillLevel(card: InventoryEntryState, index: number): number {
  return Math.max(1, card.cardSkillLevels?.[index] ?? 1);
}

/** CardSkills.FeedPoints: 3 points plus the levels the donor already raised. */
export function cardSkillFeedPoints(
  donor: InventoryEntryState,
  template: CharacterCardTemplate,
): number {
  return (
    DUPLICATE_BASE_SKILL_POINTS +
    skillSlots(template).reduce((sum, index) => sum + skillLevel(donor, index) - 1, 0)
  );
}

/** CardCommon:GetCardMaxSkillLevelUPCount. */
export function cardSkillPointsRemaining(
  card: InventoryEntryState,
  template: CharacterCardTemplate | null,
): number {
  if (!template) return 0;
  return skillSlots(template).reduce(
    (sum, index) =>
      sum + Math.max(0, CARD_SKILL_MAXIMUM_LEVEL - skillLevel(card, index)),
    0,
  );
}

/**
 * The original UI exposes a number of skill-level increases, not a chosen
 * skill, so each point goes to a random skill that is still below level 4.
 * Returns the points that changed a level; the rest is wasted.
 */
export function applyCardSkillPoints(
  card: InventoryEntryState,
  template: CharacterCardTemplate,
  points: number,
  random: () => number = Math.random,
): number {
  const slots = skillSlots(template);
  const levels = [0, 1, 2, 3].map((index) =>
    skillLevel(card, index),
  ) as CardSkillLevels;
  let applied = 0;
  for (let remaining = points; remaining > 0; remaining--) {
    const available = slots.filter(
      (index) => levels[index]! < CARD_SKILL_MAXIMUM_LEVEL,
    );
    if (available.length === 0) break;
    const choice = Math.min(
      Math.floor(random() * available.length),
      available.length - 1,
    );
    const index = available[choice]!;
    levels[index] = levels[index]! + 1;
    applied += 1;
  }
  card.cardSkillLevels = levels;
  return applied;
}

/**
 * MiniSkill entries of every normal (non-oath) card, level 1 for a skill that
 * was never raised. Without them the client reads level 0: a new card shows
 * "Awakened -3/9" and its first awakening "LV.0 > n". The client's own card
 * previews (item boxes, missions) also start skills at 1. Oath cards keep
 * their own projection in oath-card-skill-data.ts.
 */
export function characterCardSkills(card: InventoryEntryState): CardSkillInfo[] {
  if (card.genre !== 1 || card.particular === 17) return [];
  const template = CharacterCardCatalog.loadDefault().get(card);
  if (!template) return [];
  return skillSlots(template).map((index) => ({
    skillId: template.skillIds[index]!,
    skillLevel: Math.min(skillLevel(card, index), CARD_SKILL_MAXIMUM_LEVEL),
    skillType: index === 0 ? 3 : 2,
  }));
}
