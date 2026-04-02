import type { SavedSupplement } from '@/types/saved-supplements';
import type {
  GoalKey,
  SmartFilterProductMembership,
  SupplementTypeKey,
} from '@/types/personalization';
import {
  getGoalDisplayLabel,
  getSupplementTypeDisplayLabel,
} from '@/lib/personalization/uiLabels';

export const buildGoalTagToKeyMap = (visibleGoals: GoalKey[]) =>
  new Map(visibleGoals.map((goalKey) => [getGoalDisplayLabel(goalKey), goalKey] as const));

export const buildTypeTagToKeyMap = () =>
  new Map(
    (['vitamin', 'mineral', 'herb', 'probiotic', 'protein'] as const).map((typeKey) => [
      getSupplementTypeDisplayLabel(typeKey),
      typeKey,
    ]),
  );

export const getMembershipReasonCodes = (membership?: SmartFilterProductMembership) =>
  Array.from(new Set((membership?.reasons ?? []).map((reason) => reason.code).filter(Boolean)));

export const getMembershipMatchTier = (
  membership: SmartFilterProductMembership,
  goalKey?: GoalKey,
) =>
  goalKey
    ? membership.goalTiers[goalKey] ?? undefined
    : membership.highlightedGoal
      ? membership.goalTiers[membership.highlightedGoal]
      : undefined;

export const isEvaluatedCoverageReadyMembership = (membership?: SmartFilterProductMembership) =>
  !!membership && membership.coverageStatus === 'coverage_ready' && membership.bucket !== 'no_match';

export const matchesEvaluatedSmartFilterTag = ({
  tag,
  membership,
  goalTagToKey,
  typeTagToKey,
}: {
  tag: string;
  membership?: SmartFilterProductMembership;
  goalTagToKey: Map<string, GoalKey>;
  typeTagToKey: Map<string, SupplementTypeKey>;
}) => {
  if (!membership) return false;

  const goalKey = goalTagToKey.get(tag);
  if (goalKey) {
    const tier = membership.goalTiers[goalKey];
    return (
      membership.coverageStatus === 'coverage_ready' &&
      membership.eligibility?.rankEligible !== false &&
      !!tier
    );
  }

  const typeKey = typeTagToKey.get(tag);
  if (typeKey) {
    return (
      membership.coverageStatus === 'coverage_ready' &&
      membership.eligibility?.rankEligible !== false &&
      membership.typeKeys.includes(typeKey)
    );
  }

  return false;
};

export const filterSupplementsByActiveTags = ({
  items,
  activeTags,
  membershipById,
  goalTagToKey,
  typeTagToKey,
}: {
  items: SavedSupplement[];
  activeTags: Set<string>;
  membershipById: Record<string, SmartFilterProductMembership | undefined>;
  goalTagToKey: Map<string, GoalKey>;
  typeTagToKey: Map<string, SupplementTypeKey>;
}) =>
  items.filter((item) => {
    for (const tag of activeTags) {
      if (tag === 'Recently Viewed' && !!item.lastViewed) {
        return true;
      }

      if (item.tags?.some((itemTag) => itemTag === tag)) {
        return true;
      }

      if (
        matchesEvaluatedSmartFilterTag({
          tag,
          membership: membershipById[item.id],
          goalTagToKey,
          typeTagToKey,
        })
      ) {
        return true;
      }
    }

    return false;
  });
