import type { FirstStackPlan, PersonalizationSnapshot } from '@/types/personalization';

export const selectFirstStackPlan = (
  snapshot: PersonalizationSnapshot,
): FirstStackPlan | undefined => snapshot.evaluations.firstStackPlan;
