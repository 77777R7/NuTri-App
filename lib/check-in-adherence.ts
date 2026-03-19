import { getCheckInEffectiveStartDate, validateCheckInDateForItem } from '@/lib/check-in-eligibility';
import { buildCheckInKey, getLocalDateKey } from '@/lib/check-ins';
import type { DailyCheckInsByDate } from '@/lib/storage/daily-check-ins';
import type { SavedSupplement } from '@/types/saved-supplements';

export type CheckInDaySummary = {
  dateKey: string;
  expectedCount: number;
  completedCount: number;
  isScheduledDay: boolean;
  isPerfectDay: boolean;
};

export type StreakAchievementBadge = {
  label: 'FIRST' | '3 DAY' | '7 DAY' | 'CHAMP';
  unlocked: boolean;
  daysRequired: number;
  tint: string;
};

const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const toDateKey = (value: string | Date) => {
  if (value instanceof Date) return getLocalDateKey(value);
  if (CALENDAR_DAY_PATTERN.test(value)) return value;
  return getLocalDateKey(new Date(value));
};

const dateKeyToLocalDate = (value: string) => {
  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10);
  const day = Number.parseInt(value.slice(8, 10), 10);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

const shiftDateKey = (value: string, offsetDays: number) => {
  const date = dateKeyToLocalDate(value);
  date.setDate(date.getDate() + offsetDays);
  return getLocalDateKey(date);
};

export const summarizeCheckInDay = (
  items: readonly SavedSupplement[],
  checkInsByDate: DailyCheckInsByDate,
  dateKey: string,
  now: string | Date = dateKey,
): CheckInDaySummary => {
  const expectedKeys = items
    .filter(item => validateCheckInDateForItem(item, dateKey, now).isValid)
    .map(item => buildCheckInKey({ supplementId: item.supplementId, localId: item.id }));

  const expectedKeySet = new Set(expectedKeys);
  const completedKeySet = new Set(checkInsByDate[dateKey] ?? []);

  let completedCount = 0;
  expectedKeySet.forEach(key => {
    if (completedKeySet.has(key)) completedCount += 1;
  });

  const expectedCount = expectedKeySet.size;
  return {
    dateKey,
    expectedCount,
    completedCount,
    isScheduledDay: expectedCount > 0,
    isPerfectDay: expectedCount > 0 && completedCount === expectedCount,
  };
};

export const buildCheckInSeries = (
  items: readonly SavedSupplement[],
  checkInsByDate: DailyCheckInsByDate,
  endDate: string | Date,
  length: number,
): CheckInDaySummary[] => {
  const endDateKey = toDateKey(endDate);
  const startDateKey = shiftDateKey(endDateKey, -(length - 1));

  return Array.from({ length }, (_, index) => {
    const dateKey = shiftDateKey(startDateKey, index);
    return summarizeCheckInDay(items, checkInsByDate, dateKey, endDateKey);
  });
};

export const getCurrentPerfectStreakDays = (
  items: readonly SavedSupplement[],
  checkInsByDate: DailyCheckInsByDate,
  endDate: string | Date,
): number => {
  const endDateKey = toDateKey(endDate);
  const earliestStartDate = items.reduce<string | null>((currentEarliest, item) => {
    const next = getCheckInEffectiveStartDate(item);
    if (!next) return currentEarliest;
    if (!currentEarliest || next < currentEarliest) return next;
    return currentEarliest;
  }, null);

  if (!earliestStartDate) return 0;

  let streakDays = 0;
  for (let cursor = endDateKey; cursor >= earliestStartDate; cursor = shiftDateKey(cursor, -1)) {
    const summary = summarizeCheckInDay(items, checkInsByDate, cursor, endDateKey);
    if (!summary.isScheduledDay) continue;
    if (!summary.isPerfectDay) break;
    streakDays += 1;
  }

  return streakDays;
};

export const buildStreakAchievementBadges = (
  currentStreakDays: number,
  hasAnyCompletedDay: boolean,
): StreakAchievementBadge[] => [
  {
    label: 'FIRST',
    unlocked: hasAnyCompletedDay,
    daysRequired: 1,
    tint: hasAnyCompletedDay ? '#CFF6E3' : 'rgba(15,23,42,0.04)',
  },
  {
    label: '3 DAY',
    unlocked: currentStreakDays >= 3,
    daysRequired: 3,
    tint: currentStreakDays >= 3 ? '#FFE9C7' : 'rgba(15,23,42,0.04)',
  },
  {
    label: '7 DAY',
    unlocked: currentStreakDays >= 7,
    daysRequired: 7,
    tint: currentStreakDays >= 7 ? '#E7DEFF' : 'rgba(15,23,42,0.04)',
  },
  {
    label: 'CHAMP',
    unlocked: currentStreakDays >= 30,
    daysRequired: 30,
    tint: currentStreakDays >= 30 ? '#D8F0B3' : 'rgba(15,23,42,0.04)',
  },
];

export const getNextStreakMilestone = (currentStreakDays: number) => {
  const thresholds = [1, 3, 7, 30];
  const nextTarget = thresholds.find(target => currentStreakDays < target) ?? 30;
  return {
    goalDays: nextTarget,
    daysRemaining: Math.max(0, nextTarget - currentStreakDays),
  };
};

export const hasAnyCompletedCheckInDay = (checkInsByDate: DailyCheckInsByDate) =>
  Object.values(checkInsByDate).some(keys => keys.length > 0);

export const checkInAdherenceInternals = {
  shiftDateKey,
  toDateKey,
  dateKeyToLocalDate,
  DAY_MS,
};
