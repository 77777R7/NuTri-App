import type {
  PersonalizationSnapshot,
  ScheduleDefaultsPersonalizationVM,
} from '@/types/personalization';

export const selectScheduleDefaultsPersonalization = (
  snapshot: PersonalizationSnapshot,
): ScheduleDefaultsPersonalizationVM => snapshot.surfaces.scheduleDefaults;

