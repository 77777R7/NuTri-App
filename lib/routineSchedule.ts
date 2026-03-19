import type { RoutineDayOfWeek, RoutinePreferences } from '@/types/saved-supplements';

const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidCalendarDay = (value: string) => {
  if (!CALENDAR_DAY_PATTERN.test(value)) return false;

  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10);
  const day = Number.parseInt(value.slice(8, 10), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;

  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
};

export const normalizeRoutineStartDate = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || !isValidCalendarDay(trimmed)) return undefined;
  return trimmed;
};

export const normalizeRoutineDaysOfWeek = (value: unknown): RoutineDayOfWeek[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const next = Array.from(
    new Set(
      value
        .filter((entry): entry is number => Number.isInteger(entry))
        .filter((entry): entry is RoutineDayOfWeek => entry >= 0 && entry <= 6),
    ),
  ).sort((left, right) => left - right);

  return next.length > 0 ? next : undefined;
};

export const normalizeRoutinePreferences = (
  routine: RoutinePreferences | null | undefined,
): RoutinePreferences | undefined => {
  if (!routine || typeof routine !== 'object') return undefined;

  const next: RoutinePreferences = {};

  if (typeof routine.note === 'string') next.note = routine.note;
  if (typeof routine.time === 'string') next.time = routine.time;
  if (typeof routine.timeUserSet === 'boolean') next.timeUserSet = routine.timeUserSet;
  if (typeof routine.withFood === 'boolean') next.withFood = routine.withFood;
  if (typeof routine.whenToTake === 'string') next.whenToTake = routine.whenToTake;
  if (typeof routine.howToTake === 'string') next.howToTake = routine.howToTake;

  const startDate = normalizeRoutineStartDate(routine.startDate);
  if (startDate) next.startDate = startDate;

  const daysOfWeek = normalizeRoutineDaysOfWeek(routine.daysOfWeek);
  if (daysOfWeek) next.daysOfWeek = daysOfWeek;

  return Object.keys(next).length > 0 ? next : undefined;
};
