import AsyncStorage from '@react-native-async-storage/async-storage';

export type DailyCheckInsByDate = Record<string, string[]>;

const STORAGE_KEY = 'nu.dailyCheckIns:v1';

const sanitizeCheckIns = (input: unknown): DailyCheckInsByDate => {
  if (!input || typeof input !== 'object') return {};

  const sanitized: DailyCheckInsByDate = {};
  Object.entries(input as Record<string, unknown>).forEach(([dateKey, value]) => {
    if (!Array.isArray(value)) return;
    const next = value.filter((item): item is string => typeof item === 'string');
    if (next.length > 0) {
      sanitized[dateKey] = Array.from(new Set(next));
    }
  });

  return sanitized;
};

export const loadDailyCheckIns = async (): Promise<DailyCheckInsByDate> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return {};

  try {
    return sanitizeCheckIns(JSON.parse(raw));
  } catch (error) {
    console.warn('[daily-check-ins] Failed to parse storage JSON', error);
    return {};
  }
};

export const saveDailyCheckIns = async (checkIns: DailyCheckInsByDate) => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(checkIns));
};
