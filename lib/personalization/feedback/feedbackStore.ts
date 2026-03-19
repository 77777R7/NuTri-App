import type { FeedbackState, OverrideEvent } from '@/types/personalization';
import {
  createEmptyFeedbackState,
  loadPersonalizationFeedback,
  savePersonalizationFeedback,
} from '@/lib/storage/personalization-feedback';

export type FeedbackPersistenceAdapter = {
  load: (userId?: string | null) => Promise<FeedbackState>;
  save: (userId: string | null | undefined, state: FeedbackState) => Promise<void>;
};

const DEFAULT_ADAPTER: FeedbackPersistenceAdapter = {
  load: loadPersonalizationFeedback,
  save: savePersonalizationFeedback,
};

const dedupeStrings = (values: string[] | undefined) => Array.from(new Set(values ?? []));

const nextDismissals = (
  current: FeedbackState['dismissals'],
  surface: OverrideEvent['surface'],
  field: string,
  action: OverrideEvent['action'],
) => {
  const existing = new Set(current[surface] ?? []);
  if (action === 'dismiss') {
    existing.add(field);
  }
  if (action === 'accept' || action === 'remove' || action === 'set') {
    existing.delete(field);
  }

  return {
    ...current,
    [surface]: Array.from(existing),
  };
};

const applyScheduleDefaultsEvent = (state: FeedbackState, event: OverrideEvent) => {
  const current = state.overrides.scheduleDefaults ?? {};

  if (event.action === 'remove') {
    const next = { ...current };
    delete next[event.field as keyof typeof next];
    return {
      ...state,
      overrides: {
        ...state.overrides,
        scheduleDefaults: Object.keys(next).length > 0 ? next : undefined,
      },
    };
  }

  if (event.action !== 'set') return state;

  const next = { ...current } as NonNullable<FeedbackState['overrides']['scheduleDefaults']>;

  if (event.field === 'reminderPriority' && typeof event.value === 'string') {
    next.reminderPriority = event.value as NonNullable<typeof next.reminderPriority>;
  }
  if (event.field === 'suggestedTimingAnchors') {
    next.suggestedTimingAnchors = Array.isArray(event.value)
      ? event.value.filter((value): value is string => typeof value === 'string')
      : typeof event.value === 'string'
        ? [event.value]
        : [];
  }
  if (event.field === 'preferScheduleSetup' && typeof event.value === 'boolean') {
    next.preferScheduleSetup = event.value;
  }

  return {
    ...state,
    overrides: {
      ...state.overrides,
      scheduleDefaults: next,
    },
  };
};

const applySmartFilterEvent = (state: FeedbackState, event: OverrideEvent) => {
  const current = state.overrides.smartFilter ?? {};

  if (event.action === 'remove') {
    const next = { ...current };
    delete next[event.field as keyof typeof next];
    return {
      ...state,
      overrides: {
        ...state.overrides,
        smartFilter: Object.keys(next).length > 0 ? next : undefined,
      },
    };
  }

  if (event.action !== 'set') return state;
  const next = { ...current } as NonNullable<FeedbackState['overrides']['smartFilter']>;

  if (event.field === 'visibleGoals') {
    next.visibleGoals = dedupeStrings(
      Array.isArray(event.value)
        ? event.value.filter((value): value is string => typeof value === 'string')
        : typeof event.value === 'string'
          ? [event.value]
          : [],
    ) as typeof next.visibleGoals;
  }
  if (event.field === 'preselectedTypes') {
    next.preselectedTypes = dedupeStrings(
      Array.isArray(event.value)
        ? event.value.filter((value): value is string => typeof value === 'string')
        : typeof event.value === 'string'
          ? [event.value]
          : [],
    ) as typeof next.preselectedTypes;
  }
  if (event.field === 'highlightedGoal') {
    next.highlightedGoal = typeof event.value === 'string' ? (event.value as typeof next.highlightedGoal) : undefined;
  }

  return {
    ...state,
    overrides: {
      ...state.overrides,
      smartFilter: next,
    },
  };
};

const applyFirstStackEvent = (state: FeedbackState, event: OverrideEvent) => {
  const current = state.overrides.firstStack ?? {};

  if (event.action === 'dismiss' && typeof event.value === 'string') {
    return {
      ...state,
      overrides: {
        ...state.overrides,
        firstStack: {
          ...current,
          dismissedProductIds: dedupeStrings([...(current.dismissedProductIds ?? []), event.value]),
          acceptedProductIds: dedupeStrings(
            (current.acceptedProductIds ?? []).filter((productId) => productId !== event.value),
          ),
        },
      },
    };
  }

  if (event.action === 'accept' && typeof event.value === 'string') {
    return {
      ...state,
      overrides: {
        ...state.overrides,
        firstStack: {
          ...current,
          acceptedProductIds: dedupeStrings([...(current.acceptedProductIds ?? []), event.value]),
          dismissedProductIds: dedupeStrings(
            (current.dismissedProductIds ?? []).filter((productId) => productId !== event.value),
          ),
        },
      },
    };
  }

  if (event.action === 'set' && event.field === 'scheduleTemplateKey' && typeof event.value === 'string') {
    return {
      ...state,
      overrides: {
        ...state.overrides,
        firstStack: {
          ...current,
          scheduleTemplateKey: event.value,
        },
      },
    };
  }

  if (event.action === 'remove') {
    const next = { ...current };
    delete next[event.field as keyof typeof next];
    return {
      ...state,
      overrides: {
        ...state.overrides,
        firstStack: Object.keys(next).length > 0 ? next : undefined,
      },
    };
  }

  return state;
};

export const reduceFeedbackState = (
  current: FeedbackState,
  events: OverrideEvent[],
): FeedbackState => {
  return events.reduce<FeedbackState>((state, event) => {
    const withEvent = {
      ...state,
      updatedAt: event.timestamp,
      events: [...state.events, event],
      dismissals: nextDismissals(state.dismissals, event.surface, event.field, event.action),
    };

    switch (event.surface) {
      case 'schedule_defaults':
        return applyScheduleDefaultsEvent(withEvent, event);
      case 'smart_filter':
        return applySmartFilterEvent(withEvent, event);
      case 'first_stack':
        return applyFirstStackEvent(withEvent, event);
      case 'plan_preview':
      default:
        return withEvent;
    }
  }, current);
};

export const loadFeedbackState = async (
  userId?: string | null,
  adapter: FeedbackPersistenceAdapter = DEFAULT_ADAPTER,
) => adapter.load(userId);

export const persistFeedbackState = async (
  userId: string | null | undefined,
  state: FeedbackState,
  adapter: FeedbackPersistenceAdapter = DEFAULT_ADAPTER,
) => adapter.save(userId, state);

export const recordFeedbackEvents = async (
  userId: string | null | undefined,
  events: OverrideEvent[],
  adapter: FeedbackPersistenceAdapter = DEFAULT_ADAPTER,
) => {
  const existing = await adapter.load(userId);
  const next = reduceFeedbackState(existing, events);
  await adapter.save(userId, next);
  return next;
};

export const createFeedbackMemoryAdapter = (
  seed?: Record<string, FeedbackState>,
): FeedbackPersistenceAdapter => {
  const store = new Map(Object.entries(seed ?? {}));

  return {
    async load(userId?: string | null) {
      return store.get(userId?.trim() || 'anonymous') ?? createEmptyFeedbackState();
    },
    async save(userId, state) {
      store.set(userId?.trim() || 'anonymous', state);
    },
  };
};

export const feedbackStoreInternals = {
  DEFAULT_ADAPTER,
  applyFirstStackEvent,
  applyScheduleDefaultsEvent,
  applySmartFilterEvent,
  nextDismissals,
};
