import type { PersonalizationSnapshot, PlanPreviewPersonalizationVM } from '@/types/personalization';

export const selectPlanPreviewPersonalization = (
  snapshot: PersonalizationSnapshot,
): PlanPreviewPersonalizationVM => snapshot.surfaces.planPreview;

