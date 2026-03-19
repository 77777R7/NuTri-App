import type { HomePersonalizationVM, PersonalizationSnapshot } from '@/types/personalization';

export const selectHomePersonalization = (
  snapshot: PersonalizationSnapshot,
): HomePersonalizationVM => snapshot.surfaces.home;

