export interface LevelClearedEvent {
  type: "level.cleared";
  chapter: number;
  index: number;
  difficulty: number;
  stars: number;
  firstClear: boolean;
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
  | FightPowerChangedEvent;

export type DomainEventType = DomainEvent["type"];
