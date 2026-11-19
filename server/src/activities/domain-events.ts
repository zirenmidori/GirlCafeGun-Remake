export interface LevelClearedEvent {
  type: "level.cleared";
  chapter: number;
  index: number;
  difficulty: number;
  stars: number;
  firstClear: boolean;
  /** True for a story level, which is read rather than fought. */
  story?: boolean;
}

export interface PlayerLevelChangedEvent {
  type: "player.level_changed";
  level: number;
}

/** A character card gained a level or a limit break. */
export interface CardProgressedEvent {
  type: "card.progressed";
  guid: number;
  level: number;
  breakLevel: number;
}

export interface GirlAffectionChangedEvent {
  type: "girl.affection_changed";
  girlId: number;
  level: number;
}

export interface GirlGiftSentEvent {
  type: "girl.gift_sent";
  girlId: number;
  count: number;
}

export interface GirlTrainingFinishedEvent {
  type: "girl.training_finished";
  girlId: number;
}

export interface VigourSpentEvent {
  type: "vigour.spent";
  amount: number;
}

export interface BountyClearedEvent {
  type: "bounty.cleared";
  activityId: number;
  difficulty: number;
}

export interface CoffeeSoldEvent {
  type: "coffee.sold";
  count: number;
}

export interface WeaponBrokenEvent {
  type: "weapon.broken";
  guid: number;
  breakLevel: number;
}

export interface CafeLevelChangedEvent {
  type: "cafe.level_changed";
  level: number;
}

/** The furniture placed in the cafe and rest rooms changed the comfort. */
export interface CafeComfortChangedEvent {
  type: "cafe.comfort_changed";
  comfort: number;
}

/** Furniture pieces bought in the furniture shop (shop 40001). */
export interface CafeFurnitureBoughtEvent {
  type: "cafe.furniture_bought";
  count: number;
}

export interface WeaponEnhancedEvent {
  type: "weapon.enhanced";
  guid: number;
  level: number;
}

export interface FormationUpdatedEvent {
  type: "formation.updated";
  formationId: number;
  hasEquippedWeapon: boolean;
}

export interface FightPowerChangedEvent {
  type: "fight_power.changed";
  value: number;
}

export type DomainEvent =
  | LevelClearedEvent
  | WeaponEnhancedEvent
  | FormationUpdatedEvent
  | FightPowerChangedEvent
  | PlayerLevelChangedEvent
  | CardProgressedEvent
  | GirlAffectionChangedEvent
  | GirlGiftSentEvent
  | GirlTrainingFinishedEvent
  | VigourSpentEvent
  | BountyClearedEvent
  | CoffeeSoldEvent
  | WeaponBrokenEvent
  | CafeLevelChangedEvent
  | CafeComfortChangedEvent
  | CafeFurnitureBoughtEvent;

export type DomainEventType = DomainEvent["type"];
