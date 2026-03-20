import dietReviewBundlesData from '@/data/personalization/diet_review_bundles.v2.json';
import type { DecisionReason, DietReviewLane, PersonalizationProfile } from '@/types/personalization';
import { REASON_CODES, RULE_IDS, buildReason } from './reasonCodes';

type DietReviewBundlesFile = {
  version: string;
  bundles: Array<{
    laneKey: string;
    reviewBundleKey: string;
    focusAreas: string[];
  }>;
};

const DIET_REVIEW_BUNDLES = dietReviewBundlesData as DietReviewBundlesFile;
const BUNDLE_BY_LANE_KEY = new Map(
  DIET_REVIEW_BUNDLES.bundles.map((bundle) => [bundle.laneKey, bundle] as const),
);

export const compileDietLanes = (profile: PersonalizationProfile): DietReviewLane[] =>
  profile.derived.dietReviewLanes.map((laneKey, index) => {
    const bundle = BUNDLE_BY_LANE_KEY.get(laneKey);

    return {
      laneKey,
      priority: index === 0 ? 'high' : index < 3 ? 'medium' : 'low',
      reasons: [
        buildReason(
          REASON_CODES.dietLaneStrategySelected,
          RULE_IDS.dietLaneStrategySelected,
          'derived',
          {
            laneKey,
            rank: index + 1,
            ...(bundle ? { reviewBundleKey: bundle.reviewBundleKey } : {}),
          },
        ),
      ],
      ...(bundle ? { reviewBundleKey: bundle.reviewBundleKey, focusAreas: [...bundle.focusAreas] } : {}),
    };
  });

export const dietReviewLanesInternals = {
  compileDietLanes,
};
