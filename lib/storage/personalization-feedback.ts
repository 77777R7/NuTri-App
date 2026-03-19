import AsyncStorage from '@react-native-async-storage/async-storage';

import type { FeedbackState } from '@/types/personalization';

const STORAGE_VERSION = 'personalization-feedback/v1';
const STORAGE_KEY_PREFIX = 'nu.personalization.feedback';

const buildStorageKey = (userId?: string | null) =>
  `${STORAGE_KEY_PREFIX}:${userId?.trim() || 'anonymous'}`;

const parseJSON = <T>(value: string | null): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn('[personalization-feedback] Failed to parse JSON', error);
    return null;
  }
};

export const createEmptyFeedbackState = (updatedAt: string = new Date().toISOString()): FeedbackState => ({
  version: STORAGE_VERSION,
  updatedAt,
  events: [],
  overrides: {},
  dismissals: {},
});

export const loadPersonalizationFeedback = async (
  userId?: string | null,
): Promise<FeedbackState> => {
  const raw = await AsyncStorage.getItem(buildStorageKey(userId));
  const parsed = parseJSON<FeedbackState>(raw);
  if (!parsed) {
    return createEmptyFeedbackState();
  }

  return {
    ...createEmptyFeedbackState(parsed.updatedAt ?? new Date().toISOString()),
    ...parsed,
    events: Array.isArray(parsed.events) ? parsed.events : [],
    overrides: parsed.overrides ?? {},
    dismissals: parsed.dismissals ?? {},
  };
};

export const savePersonalizationFeedback = async (
  userId: string | null | undefined,
  state: FeedbackState,
) => {
  await AsyncStorage.setItem(buildStorageKey(userId), JSON.stringify(state));
};

export const resetPersonalizationFeedback = async (userId?: string | null) => {
  await AsyncStorage.removeItem(buildStorageKey(userId));
};

export const personalizationFeedbackStorageInternals = {
  STORAGE_VERSION,
  buildStorageKey,
  parseJSON,
};
