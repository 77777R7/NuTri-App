import type { DecisionReason, DietReviewLane, PersonalizationProfile } from '@/types/personalization';
import { REASON_CODES, RULE_IDS, buildReason } from './reasonCodes';

export const compileDietLanes = (profile: PersonalizationProfile): DietReviewLane[] =>
  profile.derived.dietReviewLanes.map((laneKey, index) => ({
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
        },
      ),
    ],
  }));

export const dietReviewLanesInternals = {
  compileDietLanes,
};
