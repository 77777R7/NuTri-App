import { createEmptyFeedbackState, loadPersonalizationFeedback, savePersonalizationFeedback } from '@/lib/storage/personalization-feedback';
import {
  appendPersonalizationEventsToSummary,
  createEmptyPersonalizationEventSummary,
  summarizePersonalizationEvents,
  toPersonalizationEventRecord,
} from '@/lib/personalization/feedback/personalizationEventSummary';
import { supabase } from '@/lib/supabase';
import { flatMapCompat } from '@/lib/utils/arrayCompat';
import type { FeedbackPersistenceAdapter } from '@/lib/personalization/feedback/feedbackStore';
import type {
  FeedbackState,
  PersonalizationEventName,
  PersonalizationEventSummary,
  PreferenceVector,
  SupportState,
} from '@/types/personalization';
import type { Json } from '@/types/supabase';

type PersonalizationEventInput = {
  userId?: string | null;
  eventName: PersonalizationEventName;
  surface?: string | null;
  snapshotId?: string | null;
  rulesVersion?: string | null;
  supportState?: SupportState | null;
  payload?: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const toJsonValue = (value: unknown): Json | undefined => {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value as Json;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => toJsonValue(item))
      .filter((item): item is Json => item !== undefined);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      flatMapCompat(Object.entries(value), ([key, nested]) => {
        const next = toJsonValue(nested);
        return next === undefined ? [] : [[key, next]];
      }),
    ) as Json;
  }

  return String(value);
};

const sanitizePayload = (payload?: Record<string, unknown>): Json =>
  (toJsonValue(payload ?? {}) ?? {}) as Json;

const normalizeFeedbackState = (value: unknown): FeedbackState => {
  if (!isRecord(value)) return createEmptyFeedbackState();

  const parsed = value as Partial<FeedbackState>;
  return {
    ...createEmptyFeedbackState(
      typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    ),
    ...parsed,
    version: typeof parsed.version === 'string' ? parsed.version : 'personalization-feedback/v1',
    events: Array.isArray(parsed.events) ? parsed.events : [],
    overrides: isRecord(parsed.overrides) ? parsed.overrides : {},
    dismissals: isRecord(parsed.dismissals) ? parsed.dismissals : {},
  };
};

const toTimestamp = (value?: string | null) => {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

const hasMeaningfulFeedback = (state: FeedbackState) =>
  state.events.length > 0 ||
  Object.keys(state.overrides).length > 0 ||
  Object.keys(state.dismissals).length > 0;

export const loadRemotePersonalizationFeedback = async (
  userId?: string | null,
): Promise<FeedbackState | null> => {
  if (!userId) return null;

  const { data, error } = await supabase
    .from('user_personalization_state')
    .select('feedback_state')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[personalization] Failed to load remote feedback state', error);
    return null;
  }

  return data?.feedback_state ? normalizeFeedbackState(data.feedback_state) : null;
};

export const loadRemotePersonalizationEventSummary = async (
  userId?: string | null,
  options: {
    days?: number;
    limit?: number;
  } = {},
): Promise<PersonalizationEventSummary> => {
  if (!userId) return createEmptyPersonalizationEventSummary();

  const days = Math.max(1, Math.min(30, Math.round(options.days ?? 14)));
  const limit = Math.max(1, Math.min(50, Math.round(options.limit ?? 20)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error, count } = await supabase
    .from('user_personalization_events')
    .select(
      'event_name, surface, created_at, snapshot_id, rules_version, support_state',
      {
        count: 'exact',
      },
    )
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[personalization] Failed to load personalization event summary', error);
    return createEmptyPersonalizationEventSummary();
  }

  return summarizePersonalizationEvents(data ?? [], count);
};

export const syncUserPersonalizationState = async (input: {
  userId?: string | null;
  feedbackState: FeedbackState;
  preferenceVector?: PreferenceVector | null;
  supportState?: SupportState | null;
  snapshotId?: string | null;
}) => {
  if (!input.userId) return;

  const payload = {
    user_id: input.userId,
    feedback_state: sanitizePayload(input.feedbackState),
    preference_vector: input.preferenceVector ? sanitizePayload(input.preferenceVector) : null,
    support_state: input.supportState ?? null,
    last_snapshot_id: input.snapshotId ?? null,
  };

  const { error } = await supabase
    .from('user_personalization_state')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
    console.warn('[personalization] Failed to sync personalization state', error);
  }
};

export const recordPersonalizationEvents = async (events: PersonalizationEventInput[]) => {
  const rows = events
    .filter((event): event is PersonalizationEventInput & { userId: string } => Boolean(event.userId))
    .map((event) => ({
      user_id: event.userId,
      event_name: event.eventName,
      surface: event.surface ?? null,
      snapshot_id: event.snapshotId ?? null,
      rules_version: event.rulesVersion ?? null,
      support_state: event.supportState ?? null,
      payload: sanitizePayload(event.payload),
    }));

  if (rows.length === 0) return;

  const { error } = await supabase.from('user_personalization_events').insert(rows);
  if (error) {
    console.warn('[personalization] Failed to record personalization events', error);
  }
};

export const createSupabaseBackedFeedbackAdapter = (): FeedbackPersistenceAdapter => ({
  async load(userId) {
    const local = await loadPersonalizationFeedback(userId);
    if (!userId) return local;

    const remote = await loadRemotePersonalizationFeedback(userId);
    if (!remote) return local;

    const localUpdatedAt = toTimestamp(local.updatedAt);
    const remoteUpdatedAt = toTimestamp(remote.updatedAt);

    if (remoteUpdatedAt > localUpdatedAt) {
      await savePersonalizationFeedback(userId, remote);
      return remote;
    }

    if (localUpdatedAt > remoteUpdatedAt && hasMeaningfulFeedback(local)) {
      await syncUserPersonalizationState({
        userId,
        feedbackState: local,
      });
    }

    return local;
  },
  async save(userId, state) {
    await savePersonalizationFeedback(userId, state);
    await syncUserPersonalizationState({
      userId,
      feedbackState: state,
    });
  },
});

export const personalizationSupabaseInternals = {
  appendPersonalizationEventsToSummary,
  createEmptyPersonalizationEventSummary,
  hasMeaningfulFeedback,
  normalizeFeedbackState,
  sanitizePayload,
  summarizePersonalizationEvents,
  toEventRecord: toPersonalizationEventRecord,
  toJsonValue,
  toTimestamp,
};
