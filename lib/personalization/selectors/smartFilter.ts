import type { PersonalizationSnapshot, SmartFilterPersonalizationVM } from '@/types/personalization';

export const selectSmartFilterPersonalization = (
  snapshot: PersonalizationSnapshot,
): SmartFilterPersonalizationVM => snapshot.surfaces.smartFilter;

