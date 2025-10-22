import AsyncStorage from '@react-native-async-storage/async-storage';

import type { OnboardingFlags, ProfileDraft, TrialStatus } from '@/types/onboarding';

const STORAGE_KEYS = {
  draft: 'profileDraft',
  draftUpdatedAt: 'draftUpdatedAt',
  progress: 'progress',
  onbCompleted: 'onb_completed',
  trialStatus: 'trial_status',
  trialStartedAt: 'trial_started_at',
  serverSyncedAt: 'serverSyncedAt',
  version: 'version',
} as const;

const parseJSON = <T>(value: string | null): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn('Failed to parse onboarding storage JSON', error);
    return null;
  }
};

const parseNumber = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseTrialStatus = (value: string | null): TrialStatus => {
  if (value === 'active' || value === 'skipped' || value === 'expired') {
    return value;
  }
  return 'not_started';
};

const withPrefix = (key: typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS]) => `nu.onboarding:${key}`;

export const getDraft = async (): Promise<{ draft: ProfileDraft | null; updatedAt?: string }> => {
  const [[, draftRaw], [, updatedAt]] = await AsyncStorage.multiGet([
    withPrefix(STORAGE_KEYS.draft),
    withPrefix(STORAGE_KEYS.draftUpdatedAt),
  ]);

  return {
    draft: parseJSON<ProfileDraft>(draftRaw),
    updatedAt: updatedAt ?? undefined,
  };
};

export const saveDraft = async (draft: ProfileDraft | null, updatedAt: string) => {
  const draftKey = withPrefix(STORAGE_KEYS.draft);
  const updatedAtKey = withPrefix(STORAGE_KEYS.draftUpdatedAt);

  if (!draft) {
    await AsyncStorage.multiRemove([draftKey, updatedAtKey]);
    return;
  }

  await AsyncStorage.multiSet([
    [draftKey, JSON.stringify(draft)],
    [updatedAtKey, updatedAt],
  ]);
};

export const getProgress = async (): Promise<number> => {
  const raw = await AsyncStorage.getItem(withPrefix(STORAGE_KEYS.progress));
  const parsed = parseNumber(raw);
  if (!parsed || parsed < 1) {
    return 1;
  }
  return parsed;
};

export const setProgress = async (progress: number) => {
  const sanitized = Math.max(1, Math.min(progress, 7));
  await AsyncStorage.setItem(withPrefix(STORAGE_KEYS.progress), String(sanitized));
};

export const getFlags = async (): Promise<OnboardingFlags> => {
  const entries = await AsyncStorage.multiGet([
    withPrefix(STORAGE_KEYS.onbCompleted),
    withPrefix(STORAGE_KEYS.trialStatus),
    withPrefix(STORAGE_KEYS.trialStartedAt),
    withPrefix(STORAGE_KEYS.serverSyncedAt),
    withPrefix(STORAGE_KEYS.version),
    withPrefix(STORAGE_KEYS.draftUpdatedAt),
  ]);

  const map = Object.fromEntries(entries);

  return {
    onbCompleted: map[withPrefix(STORAGE_KEYS.onbCompleted)] === 'true',
    trialStatus: parseTrialStatus(map[withPrefix(STORAGE_KEYS.trialStatus)] ?? null),
    trialStartedAt: map[withPrefix(STORAGE_KEYS.trialStartedAt)] ?? undefined,
    serverSyncedAt: map[withPrefix(STORAGE_KEYS.serverSyncedAt)] ?? undefined,
    version: parseNumber(map[withPrefix(STORAGE_KEYS.version)] ?? null),
    draftUpdatedAt: map[withPrefix(STORAGE_KEYS.draftUpdatedAt)] ?? undefined,
  };
};

export const setFlags = async (nextFlags: Partial<OnboardingFlags>) => {
  const entries: [string, string][] = [];
  const removals: string[] = [];

  if (nextFlags.onbCompleted !== undefined) {
    entries.push([withPrefix(STORAGE_KEYS.onbCompleted), String(nextFlags.onbCompleted)]);
  }

  if (nextFlags.trialStatus !== undefined) {
    entries.push([withPrefix(STORAGE_KEYS.trialStatus), nextFlags.trialStatus]);
  }

  if (nextFlags.trialStartedAt !== undefined) {
    if (nextFlags.trialStartedAt) {
      entries.push([withPrefix(STORAGE_KEYS.trialStartedAt), nextFlags.trialStartedAt]);
    } else {
      removals.push(withPrefix(STORAGE_KEYS.trialStartedAt));
    }
  }

  if (nextFlags.serverSyncedAt !== undefined) {
    if (nextFlags.serverSyncedAt) {
      entries.push([withPrefix(STORAGE_KEYS.serverSyncedAt), nextFlags.serverSyncedAt]);
    } else {
      removals.push(withPrefix(STORAGE_KEYS.serverSyncedAt));
    }
  }

  if (nextFlags.version !== undefined) {
    entries.push([withPrefix(STORAGE_KEYS.version), String(nextFlags.version)]);
  }

  if (nextFlags.draftUpdatedAt !== undefined) {
    if (nextFlags.draftUpdatedAt) {
      entries.push([withPrefix(STORAGE_KEYS.draftUpdatedAt), nextFlags.draftUpdatedAt]);
    } else {
      removals.push(withPrefix(STORAGE_KEYS.draftUpdatedAt));
    }
  }

  if (entries.length > 0) {
    await AsyncStorage.multiSet(entries);
  }

  if (removals.length > 0) {
    await AsyncStorage.multiRemove(removals);
  }
};
