import type { SavedSupplement } from '@/types/saved-supplements';
import { normalizeRoutineDaysOfWeek, normalizeRoutineStartDate } from '@/lib/routineSchedule';

export type CheckInEligibleItem = Pick<SavedSupplement, 'syncedToCheckIn' | 'routine'> & {
  createdAt?: string | null;
};

export type CheckInDateLike = string | number | Date | null | undefined;

export type CheckInDateValidationReason =
  | 'ineligible_item'
  | 'invalid_date'
  | 'future_date'
  | 'before_effective_start'
  | 'outside_schedule';

export type CheckInDateValidationResult =
  | {
      isValid: true;
      effectiveStartDate: string;
      normalizedDate: string;
    }
  | {
      isValid: false;
      reason: CheckInDateValidationReason;
      effectiveStartDate?: string;
      normalizedDate?: string;
    };

const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const pad2 = (value: number) => String(value).padStart(2, '0');

const formatLocalCalendarDay = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const parseCalendarDayToLocalDate = (value: string) => {
  const match = CALENDAR_DAY_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

const toDate = (value: CheckInDateLike) => {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (CALENDAR_DAY_PATTERN.test(trimmed)) {
    return parseCalendarDayToLocalDate(trimmed);
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toLocalCalendarDay = (value: CheckInDateLike) => {
  const date = toDate(value);
  return date ? formatLocalCalendarDay(date) : null;
};

const compareCalendarDays = (left: string, right: string) => left.localeCompare(right);

const getCalendarDayWeekday = (value: string) => {
  const date = parseCalendarDayToLocalDate(value);
  return date ? (date.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6) : null;
};

export function getCheckInEffectiveStartDate(item: CheckInEligibleItem): string | null {
  if (!item.syncedToCheckIn) return null;
  const routineStartDate = normalizeRoutineStartDate(item.routine?.startDate);
  if (routineStartDate) return routineStartDate;
  return toLocalCalendarDay(item.createdAt);
}

export function isCheckInEligibleItem(item: CheckInEligibleItem): boolean {
  return getCheckInEffectiveStartDate(item) !== null;
}

export function getEligibleCheckInItems<T extends CheckInEligibleItem>(items: readonly T[]): T[] {
  return items.filter(isCheckInEligibleItem);
}

export function isFutureCheckInDate(candidateDate: CheckInDateLike, now: CheckInDateLike = new Date()): boolean {
  const normalizedDate = toLocalCalendarDay(candidateDate);
  const today = toLocalCalendarDay(now);
  if (!normalizedDate || !today) return false;
  return compareCalendarDays(normalizedDate, today) > 0;
}

export function validateCheckInDateForItem(
  item: CheckInEligibleItem,
  candidateDate: CheckInDateLike,
  now: CheckInDateLike = new Date(),
): CheckInDateValidationResult {
  const effectiveStartDate = getCheckInEffectiveStartDate(item);
  if (!effectiveStartDate) {
    return { isValid: false, reason: 'ineligible_item' };
  }

  const normalizedDate = toLocalCalendarDay(candidateDate);
  if (!normalizedDate) {
    return { isValid: false, reason: 'invalid_date', effectiveStartDate };
  }

  const today = toLocalCalendarDay(now);
  if (!today) {
    return { isValid: false, reason: 'invalid_date', effectiveStartDate, normalizedDate };
  }

  if (compareCalendarDays(normalizedDate, today) > 0) {
    return { isValid: false, reason: 'future_date', effectiveStartDate, normalizedDate };
  }

  if (compareCalendarDays(normalizedDate, effectiveStartDate) < 0) {
    return { isValid: false, reason: 'before_effective_start', effectiveStartDate, normalizedDate };
  }

  const scheduledDaysOfWeek = normalizeRoutineDaysOfWeek(item.routine?.daysOfWeek);
  if (scheduledDaysOfWeek?.length) {
    const weekday = getCalendarDayWeekday(normalizedDate);
    if (weekday == null || !scheduledDaysOfWeek.includes(weekday)) {
      return { isValid: false, reason: 'outside_schedule', effectiveStartDate, normalizedDate };
    }
  }

  return {
    isValid: true,
    effectiveStartDate,
    normalizedDate,
  };
}

export function getCheckInEligibilityDateRange(item: CheckInEligibleItem, now: CheckInDateLike = new Date()) {
  const effectiveStartDate = getCheckInEffectiveStartDate(item);
  const today = toLocalCalendarDay(now);
  if (!effectiveStartDate || !today) return null;

  return {
    effectiveStartDate,
    latestAllowedDate: today,
  };
}

export const checkInEligibilityInternals = {
  toLocalCalendarDay,
  compareCalendarDays,
  formatLocalCalendarDay,
  getCalendarDayWeekday,
};
