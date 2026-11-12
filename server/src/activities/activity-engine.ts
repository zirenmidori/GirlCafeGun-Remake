import type { DomainEvent, DomainEventType } from "./domain-events.js";

export interface ActivityPlayerState {
  taskValues: Record<string, number>;
}

export interface ActivityContext {
  now: number;
  emit(event: DomainEvent): void;
}

export interface ActivityHandler<Player extends ActivityPlayerState> {
  id: string;
  revision: number;
  subscriptions: readonly DomainEventType[];
  isActive?(player: Readonly<Player>, now: number): boolean;
  reconcile?(player: Player, context: ActivityContext): void;
  onEvent?(player: Player, event: DomainEvent, context: ActivityContext): void;
}

export interface ActivityRunResult {
  changedTaskIds: number[];
  handledEvents: number;
}

const MAX_EVENT_CASCADE = 256;

function changedTaskIds(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): number[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => before[key] !== after[key])
    .map(Number)
    .filter(Number.isSafeInteger)
    .sort((left, right) => left - right);
}

export class ActivityRegistry<Player extends ActivityPlayerState> {
  readonly #handlers: readonly ActivityHandler<Player>[];
  readonly #byEvent = new Map<DomainEventType, readonly ActivityHandler<Player>[]>();

  constructor(handlers: readonly ActivityHandler<Player>[]) {
    const ids = new Set<string>();
    for (const handler of handlers) {
      if (ids.has(handler.id)) {
        throw new Error(`Duplicate activity handler: ${handler.id}`);
      }
      ids.add(handler.id);
    }
    this.#handlers = [...handlers];

    const mutable = new Map<DomainEventType, ActivityHandler<Player>[]>();
    for (const handler of handlers) {
      for (const eventType of new Set(handler.subscriptions)) {
        const subscribed = mutable.get(eventType) ?? [];
        subscribed.push(handler);
        mutable.set(eventType, subscribed);
      }
    }
    for (const [eventType, subscribed] of mutable) {
      this.#byEvent.set(eventType, [...subscribed]);
    }
  }

  all(): readonly ActivityHandler<Player>[] {
    return this.#handlers;
  }

  forEvent(eventType: DomainEventType): readonly ActivityHandler<Player>[] {
    return this.#byEvent.get(eventType) ?? [];
  }
}

export class ActivityEngine<Player extends ActivityPlayerState> {
  constructor(readonly registry: ActivityRegistry<Player>) {}

  reconcile(player: Player, now = Date.now()): ActivityRunResult {
    const before = { ...player.taskValues };
    const queue: DomainEvent[] = [];
    const context: ActivityContext = {
      now,
      emit(event) {
        queue.push(event);
      },
    };

    for (const handler of this.registry.all()) {
      if (handler.isActive && !handler.isActive(player, now)) continue;
      handler.reconcile?.(player, context);
    }

    const handledEvents = this.#drain(player, queue, context);
    return {
      changedTaskIds: changedTaskIds(before, player.taskValues),
      handledEvents,
    };
  }

  dispatch(
    player: Player,
    events: readonly DomainEvent[],
    now = Date.now(),
  ): ActivityRunResult {
    const before = { ...player.taskValues };
    const queue = [...events];
    const context: ActivityContext = {
      now,
      emit(event) {
        queue.push(event);
      },
    };
    const handledEvents = this.#drain(player, queue, context);
    return {
      changedTaskIds: changedTaskIds(before, player.taskValues),
      handledEvents,
    };
  }

  #drain(player: Player, queue: DomainEvent[], context: ActivityContext): number {
    let handledEvents = 0;
    while (queue.length > 0) {
      if (handledEvents >= MAX_EVENT_CASCADE) {
        throw new Error(`Activity event cascade exceeded ${MAX_EVENT_CASCADE} events`);
      }
      const event = queue.shift();
      if (!event) break;
      handledEvents += 1;
      for (const handler of this.registry.forEvent(event.type)) {
        if (handler.isActive && !handler.isActive(player, context.now)) continue;
        handler.onEvent?.(player, event, context);
      }
    }
    return handledEvents;
  }
}
