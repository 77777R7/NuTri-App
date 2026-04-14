import {
  buildGoalNarrativeHeroCopy,
  buildGoalNarrativeRowCopy,
  buildGoalSupportTitle,
  buildGoalSupportFallbackBullets,
  buildGoalSupportFallbackTitle,
  describeGoalNarrativeCompactStatus,
  mapLegacyFitDecisionToNarrativeFitLevel,
  mapPreviewTierToNarrativeFitLevel,
  type GoalNarrativeFitLevel,
} from '../personalization/goalFitCopy';
import { flatMapCompat } from '../utils/arrayCompat';

export type TopSectionTone = 'positive' | 'caution' | 'neutral';

export type TopSectionHeroInput = {
  fitDecision?: 'fits' | 'mixed' | 'does_not_fit' | 'unknown' | null;
  heroMode?: 'dominant_goal' | 'mixed_goals' | 'limited_goals' | 'single_goal' | 'insufficient_signal' | null;
  selectedGoalLabel?: string | null;
  dominantGoalLabel?: string | null;
  secondaryGoalLabel?: string | null;
  selectedGoalLabels?: string[];
  allSelectedGoalLabels?: string[];
  previewGoalLabel?: string | null;
  previewTopTier?: 'strong_match' | 'related' | 'weak_match' | 'unknown' | null;
  goalLensMode?: 'single_goal' | 'multi_goal_summary' | null;
  goalCoverage?: TopSectionGoalCoverageInput[];
  allGoalCoverage?: TopSectionGoalCoverageInput[];
  selectedGoalCount?: number;
  analyzedGoalCount?: number;
  surfacedGoalCount?: number;
  hiddenGoalsCount?: number | null;
  allGoalsAnalyzed?: boolean;
  dominanceGap?: number | null;
  goalNarrativeConfidence?: 'high' | 'medium' | 'low' | null;
  labelCompleteness?: 'high' | 'medium' | 'low' | null;
  defaultVisibleGoalLabels?: string[];
};

export type TopSectionPersonalInsightInput = {
  supportLabels: string[];
  preferSupportSignal?: boolean;
  resolvedSupportGoalLabel?: string | null;
  conflictSummary?: string | null;
  fitDecision?: 'fits' | 'mixed' | 'does_not_fit' | 'unknown' | null;
  heroMode?: 'dominant_goal' | 'mixed_goals' | 'limited_goals' | 'single_goal' | 'insufficient_signal' | null;
  selectedGoalLabel?: string | null;
  dominantGoalLabel?: string | null;
  secondaryGoalLabel?: string | null;
  goalLensMode?: 'single_goal' | 'multi_goal_summary' | null;
  goalCoverage?: TopSectionGoalCoverageInput[];
  allGoalCoverage?: TopSectionGoalCoverageInput[];
  selectedGoalCount?: number;
  analyzedGoalCount?: number;
  surfacedGoalCount?: number;
  hiddenGoalsCount?: number | null;
  allGoalsAnalyzed?: boolean;
  dominanceGap?: number | null;
  goalNarrativeConfidence?: 'high' | 'medium' | 'low' | null;
  labelCompleteness?: 'high' | 'medium' | 'low' | null;
  defaultVisibleGoalLabels?: string[];
};

export type TopSectionGoalCoverageInput = {
  goalLabel: string;
  tier: 'strong_match' | 'related' | 'weak_match' | 'no_match' | 'unknown';
  state: 'strong' | 'some' | 'limited' | 'none' | 'unknown';
  source: 'selected_goal_evaluation' | 'goal_match_scoring_preview';
  score?: number | null;
  reasonCodes?: string[];
  confidenceBucket?: 'high' | 'medium' | 'low';
  explanation?: {
    summary?: string | null;
    why?: string[];
    evidence?: string[];
    provenance?: string[];
    action?: string[];
  } | null;
};

export type TopSectionAllergyInput = {
  status?: 'ready' | 'pending' | 'unavailable' | null;
  reasonCode?: string | null;
  summary?: string | null;
  hasSavedPreferences?: boolean;
  matchedLabels: string[];
  evidenceTexts: string[];
};

export type TopSectionDoseInput = {
  status?: string | null;
  assessment?: 'aligned' | 'low' | 'high' | 'unclear' | 'unknown' | null;
  goalLabel?: string | null;
  productDoseText?: string | null;
  productDirectionsText?: string | null;
};

export type TopSectionSafetyInput = {
  warningText?: string | null;
  watchoutText?: string | null;
};

export type TopSectionBannerKind = 'allergy';
export type TopSectionInsightTopic = 'support' | 'allergy' | 'dose' | 'overlap' | 'safety';

export type TopSectionHeroPresentation = {
  tone: TopSectionTone;
  chip: string;
  summary: string;
};

export type TopSectionBannerPresentation = {
  kind: TopSectionBannerKind;
  tone: 'caution';
  title: string;
};

export type TopSectionInsightPresentation = {
  key: string;
  topic: TopSectionInsightTopic;
  tone: TopSectionTone;
  collapsedTitle: string;
  subtitle?: string;
  expandedSubtitle?: string;
  expandedBullets: string[];
  goalCoverageItems?: TopSectionGoalCoveragePresentation[];
  visibleGoalCoverageItems?: TopSectionGoalCoveragePresentation[];
  hiddenGoalCoverageItems?: TopSectionGoalCoveragePresentation[];
  goalCoveragePresentation?: 'primary' | 'secondary_inline';
  inlineGoalCoverageTitle?: string;
  inlineGoalCoveragePreview?: string;
  expandActionLabel?: string;
  collapseActionLabel?: string;
  canExpandAll?: boolean;
  isExpandable: boolean;
  defaultExpanded?: boolean;
};

export type TopSectionGoalCoveragePresentation = {
  key: string;
  goalLabel: string;
  state: TopSectionGoalCoverageInput['state'];
  description: string;
  stateLabel: string;
  tone: TopSectionTone;
  explanation?: TopSectionGoalCoverageInput['explanation'];
};

export type TopSectionPresentation = {
  hero: TopSectionHeroPresentation;
  banner: TopSectionBannerPresentation | null;
  insights: TopSectionInsightPresentation[];
  secondaryNote?: TopSectionSecondaryNotePresentation | null;
};

export type TopSectionSecondaryNotePresentation = {
  topic: 'safety';
  tone: 'caution';
  title: string;
  body?: string;
};

const DISPLAY_LABELS: Record<string, string> = {
  egg: 'Egg',
  fish: 'Fish',
  gelatin_animal_based: 'Animal-based gelatin',
  gluten: 'Gluten',
  milk: 'Dairy',
  peanuts: 'Peanuts',
  sesame: 'Sesame',
  shellfish: 'Shellfish',
  soy: 'Soy',
  tree_nuts: 'Tree nuts',
  wheat: 'Wheat',
};

const normalizeText = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() ?? '';

const lowerFirst = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  return normalized.charAt(0).toLowerCase() + normalized.slice(1);
};

const ensurePeriod = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};

const uniqueLines = (values: (string | null | undefined)[], limit = 3): string[] => {
  const deduped = Array.from(
    new Set(
      values
        .map((value) => ensurePeriod(value))
        .filter(Boolean),
    ),
  );
  return deduped.slice(0, limit);
};

const joinLabels = (values: string[], limit = 3): string => {
  const unique = Array.from(
    new Set(
      values
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  ).slice(0, limit);

  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
};

const formatDisplayLabel = (value?: string | null): string => {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return '';
  const mapped = DISPLAY_LABELS[raw];
  if (mapped) return mapped;
  const normalized = raw.replace(/_/g, ' ');
  if (!normalized) return '';
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
};

const joinDisplayLabels = (values: string[], limit = 3): string =>
  joinLabels(values.map((value) => formatDisplayLabel(value)).filter(Boolean), limit);

const compactEvidenceTexts = (values: string[], matchedLabels: string[], limit = 2): string[] => {
  const keywords = flatMapCompat(
    matchedLabels.map((label) => formatDisplayLabel(label).toLowerCase()),
    (label) => label.split(/\s+/),
  ).filter((token) => token.length >= 3);

  const fragments = Array.from(
    new Set(
      flatMapCompat(
        flatMapCompat(values, (value) => normalizeText(value).split(/[;•\n]+/)),
        (value) => value.split(/\s+and\s+/i),
      )
        .map((value) => value.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/g, ''))
        .filter(Boolean),
    ),
  );

  const prioritized = fragments.filter((fragment) => {
    const lower = fragment.toLowerCase();
    return keywords.some((keyword) => lower.includes(keyword));
  });

  return (prioritized.length > 0 ? prioritized : fragments).slice(0, limit);
};

const buildGoalSupportSummary = (goalLabel: string) => {
  const goal = lowerFirst(goalLabel);
  if (!goal) return 'This label looks supportive of your health goals.';
  return `This product looks most aligned with ${goal} support.`;
};

const buildGoalSupportReason = (goalLabel: string) => {
  const goal = lowerFirst(goalLabel);
  if (!goal) return 'The visible ingredients look more supportive of this goal than other goals we checked.';
  return `The visible ingredients look more supportive of ${goal} than other goals we checked.`;
};

const buildAllergyConflictTitle = (matchedLabels: string[]) => {
  const displayLabels = matchedLabels.map((label) => formatDisplayLabel(label)).filter(Boolean);
  if (displayLabels.length === 1) {
    return `${displayLabels[0]} found on the label`;
  }
  return 'Matched allergy ingredients found on the label';
};

const buildAllergyConflictAction = (matchedLabels: string[]) => {
  const displayLabels = matchedLabels.map((label) => formatDisplayLabel(label)).filter(Boolean);
  if (displayLabels.length === 1) {
    return `Avoid it if you need to avoid ${lowerFirst(displayLabels[0])} ingredients.`;
  }
  return 'Avoid it if you need to avoid any of these matched ingredients.';
};

const buildSafetyTitle = (warning: string, watchout: string) => {
  const combined = `${warning} ${watchout}`.toLowerCase();
  if (/medication|drug|prescription/.test(combined)) return 'If you take medication, check first';
  if (/pregnan|breastfeed|nursing/.test(combined)) return 'If you are pregnant or nursing, check first';
  if (/condition|medical/.test(combined)) return 'If you have a health condition, check first';
  return 'Check before use';
};

const GOAL_COVERAGE_STATE_PRIORITY: Record<TopSectionGoalCoverageInput['state'], number> = {
  strong: 5,
  some: 4,
  unknown: 3,
  limited: 2,
  none: 1,
};

const GOAL_COVERAGE_TONE_BY_STATE: Record<TopSectionGoalCoverageInput['state'], TopSectionTone> = {
  strong: 'positive',
  some: 'neutral',
  limited: 'neutral',
  unknown: 'neutral',
  none: 'neutral',
};

const GOAL_COVERAGE_STATE_LABELS: Record<TopSectionGoalCoverageInput['state'], string> = {
  strong: 'Strong support',
  some: 'Some support',
  limited: 'Limited support',
  none: 'No clear support',
  unknown: 'Not enough detail',
};

const getPrimaryGoalCoverage = (
  goal: TopSectionHeroInput | TopSectionPersonalInsightInput,
): TopSectionGoalCoverageInput[] => {
  const allCoverage = goal.allGoalCoverage ?? [];
  if (allCoverage.length > 0) return allCoverage;
  return goal.goalCoverage ?? [];
};

const isGoalCoverageMultiGoal = (
  goal: TopSectionHeroInput | TopSectionPersonalInsightInput,
): boolean =>
  goal.goalLensMode === 'multi_goal_summary'
  && getPrimaryGoalCoverage(goal).length > 1;

const isDominantGoalMode = (
  goal: TopSectionHeroInput | TopSectionPersonalInsightInput,
): boolean =>
  goal.heroMode === 'dominant_goal'
  && isGoalCoverageMultiGoal(goal);

const isMixedGoalMode = (
  goal: TopSectionHeroInput | TopSectionPersonalInsightInput,
): boolean =>
  goal.heroMode === 'mixed_goals'
  && isGoalCoverageMultiGoal(goal);

const hasGoalCoverageExplanation = (
  entry: TopSectionGoalCoverageInput,
): boolean =>
  Boolean(
    normalizeText(entry.explanation?.summary)
    || (entry.explanation?.why?.length ?? 0) > 0
    || (entry.explanation?.evidence?.length ?? 0) > 0
    || (entry.explanation?.provenance?.length ?? 0) > 0
    || (entry.explanation?.action?.length ?? 0) > 0,
  );

const shouldReplaceGoalCoverageEntry = (
  current: TopSectionGoalCoverageInput,
  candidate: TopSectionGoalCoverageInput,
): boolean => {
  const currentPriority = GOAL_COVERAGE_STATE_PRIORITY[current.state];
  const candidatePriority = GOAL_COVERAGE_STATE_PRIORITY[candidate.state];
  if (candidatePriority !== currentPriority) return candidatePriority > currentPriority;

  const currentHasExplanation = hasGoalCoverageExplanation(current);
  const candidateHasExplanation = hasGoalCoverageExplanation(candidate);
  if (candidateHasExplanation !== currentHasExplanation) return candidateHasExplanation;

  const currentScore = current.score ?? Number.NEGATIVE_INFINITY;
  const candidateScore = candidate.score ?? Number.NEGATIVE_INFINITY;
  if (candidateScore !== currentScore) return candidateScore > currentScore;

  if (candidate.source !== current.source) {
    return candidate.source === 'selected_goal_evaluation';
  }

  return false;
};

const getSortedGoalCoverage = (coverage: TopSectionGoalCoverageInput[] = []): TopSectionGoalCoverageInput[] =>
  Array.from(
    coverage.reduce((map, entry) => {
      const normalizedLabel = normalizeText(entry.goalLabel);
      if (!normalizedLabel) return map;
      const existing = map.get(normalizedLabel);
      if (!existing) {
        map.set(normalizedLabel, entry);
        return map;
      }
      if (shouldReplaceGoalCoverageEntry(existing, entry)) {
        map.set(normalizedLabel, entry);
      }
      return map;
    }, new Map<string, TopSectionGoalCoverageInput>()).values(),
  );

const getBestAndWeakestGoalCoverage = (coverage: TopSectionGoalCoverageInput[]) => {
  const ordered = getSortedGoalCoverage(coverage);
  if (ordered.length === 0) return { best: null, weakest: null };

  let best = ordered[0] ?? null;
  let weakest = ordered[0] ?? null;

  ordered.forEach((entry) => {
    if (!best || GOAL_COVERAGE_STATE_PRIORITY[entry.state] > GOAL_COVERAGE_STATE_PRIORITY[best.state]) {
      best = entry;
    }
    if (!weakest || GOAL_COVERAGE_STATE_PRIORITY[entry.state] < GOAL_COVERAGE_STATE_PRIORITY[weakest.state]) {
      weakest = entry;
    }
  });

  return { best, weakest };
};

const getDominantGoalCoverage = (
  goal: TopSectionHeroInput | TopSectionPersonalInsightInput,
): TopSectionGoalCoverageInput | null => {
  if (!isDominantGoalMode(goal)) return null;
  const coverage = getSortedGoalCoverage(getPrimaryGoalCoverage(goal));
  const dominantGoalLabel = normalizeText(goal.dominantGoalLabel);
  const byDominantLabel = dominantGoalLabel
    ? coverage.find((entry) => normalizeText(entry.goalLabel) === dominantGoalLabel)
    : null;
  const { best } = getBestAndWeakestGoalCoverage(coverage);
  const resolved = byDominantLabel ?? best;
  if (!resolved) return null;
  if (resolved.state !== 'strong' && resolved.state !== 'some') return null;
  return resolved;
};

const getSingleGoalCoverage = (
  goal: TopSectionHeroInput | TopSectionPersonalInsightInput,
): TopSectionGoalCoverageInput | null => {
  if (isGoalCoverageMultiGoal(goal)) return null;
  const coverage = getSortedGoalCoverage(getPrimaryGoalCoverage(goal));
  if (coverage.length === 0) return null;

  const selectedGoalLabel = normalizeText(goal.selectedGoalLabel);
  if (selectedGoalLabel) {
    const bySelectedLabel = coverage.find((entry) => normalizeText(entry.goalLabel) === selectedGoalLabel);
    if (bySelectedLabel) return bySelectedLabel;
  }

  return coverage[0] ?? null;
};

const getLegacyNarrativeFitLevel = (
  goal: TopSectionHeroInput | TopSectionPersonalInsightInput,
): GoalNarrativeFitLevel | null => {
  if (goal.fitDecision) {
    return mapLegacyFitDecisionToNarrativeFitLevel(goal.fitDecision);
  }

  if (goal.previewTopTier) {
    return mapPreviewTierToNarrativeFitLevel(goal.previewTopTier);
  }

  return null;
};

const shouldUseLegacyNarrativeFallback = (
  goal: TopSectionHeroInput | TopSectionPersonalInsightInput,
): boolean => {
  const coverage = getSortedGoalCoverage(getPrimaryGoalCoverage(goal));
  const hasNarrativeContract =
    Boolean(goal.heroMode)
    || Boolean(goal.goalLensMode)
    || coverage.length > 0
    || goal.goalNarrativeConfidence != null
    || goal.labelCompleteness != null
    || goal.dominanceGap != null;

  return !hasNarrativeContract;
};

const hasLowNarrativeConfidence = (
  goal: TopSectionHeroInput | TopSectionPersonalInsightInput,
) => goal.goalNarrativeConfidence === 'low' || goal.labelCompleteness === 'low';

const buildGoalCoverageHero = (goal: TopSectionHeroInput): TopSectionHeroPresentation | null => {
  const coverage = getSortedGoalCoverage(getPrimaryGoalCoverage(goal));
  const shouldUseMultiGoalHero =
    (goal.heroMode !== 'single_goal' && goal.heroMode !== 'insufficient_signal')
    && isGoalCoverageMultiGoal(goal);
  if (goal.heroMode === 'insufficient_signal' || goal.labelCompleteness === 'low') {
    return {
      tone: 'neutral',
      chip: goal.allGoalsAnalyzed === true
        ? 'Not enough evidence to judge all your goals'
        : 'Not enough evidence to judge the goals shown',
      summary: 'We need more label detail to judge this product well.',
    };
  }

  if (!shouldUseMultiGoalHero || coverage.length < 2 || getDominantGoalCoverage(goal)) return null;

  const { best, weakest } = getBestAndWeakestGoalCoverage(coverage);
  const hasMeaningfulSupport = coverage.some((entry) => entry.state === 'strong' || entry.state === 'some');
  const allLimitedOrUnknown = coverage.every(
    (entry) => entry.state === 'limited' || entry.state === 'none' || entry.state === 'unknown',
  );
  const acrossGoals = goal.allGoalsAnalyzed === true;

  if (!hasMeaningfulSupport && allLimitedOrUnknown) {
    return {
      tone: 'neutral',
      chip: acrossGoals ? 'Limited support across your selected goals' : 'Limited support for the goals shown',
      summary: "We don't see clear goal-specific support across the goals we checked.",
    };
  }

  if (goal.heroMode === 'limited_goals') {
    return {
      tone: 'neutral',
      chip: acrossGoals ? 'Limited support across your selected goals' : 'Limited support for the goals shown',
      summary: "We don't see clear goal-specific support across the goals we checked.",
    };
  }

  if ((goal.heroMode === 'mixed_goals' || isMixedGoalMode(goal) || !goal.heroMode) && best && weakest && best.goalLabel === weakest.goalLabel) {
    return {
      tone: 'neutral',
      chip: acrossGoals ? 'Mixed support across your selected goals' : 'Mixed support for the goals shown',
      summary: 'Supports some goals more than others.',
    };
  }

  if (best && weakest) {
    const secondaryGoalLabel = normalizeText(goal.secondaryGoalLabel);
    const secondary = secondaryGoalLabel
      ? coverage.find((entry) => normalizeText(entry.goalLabel) === secondaryGoalLabel)
      : weakest;
    return {
      tone: 'neutral',
      chip: acrossGoals ? 'Mixed support across your selected goals' : 'Mixed support for the goals shown',
      summary: `Looks stronger for ${best.goalLabel} than ${(secondary ?? weakest).goalLabel}`,
    };
  }

  return null;
};

const buildDominantGoalHero = (goal: TopSectionHeroInput): TopSectionHeroPresentation | null => {
  const dominantGoal = getDominantGoalCoverage(goal);
  if (!dominantGoal || hasLowNarrativeConfidence(goal)) return null;
  return buildGoalNarrativeHeroCopy(
    dominantGoal.goalLabel,
    dominantGoal.state,
    goal.analyzedGoalCount ?? getPrimaryGoalCoverage(goal).length,
  );
};

const buildSingleGoalCoverageHero = (
  goal: TopSectionHeroInput,
): TopSectionHeroPresentation | null => {
  const primaryCoverage = getSingleGoalCoverage(goal);
  if (!primaryCoverage) return null;

  const resolvedFitLevel: GoalNarrativeFitLevel =
    goal.heroMode === 'insufficient_signal' || hasLowNarrativeConfidence(goal)
      ? 'unknown'
      : primaryCoverage.state;

  return buildGoalNarrativeHeroCopy(
    primaryCoverage.goalLabel,
    resolvedFitLevel,
    goal.analyzedGoalCount ?? getPrimaryGoalCoverage(goal).length,
  );
};

const buildLegacyHero = (goal: TopSectionHeroInput): TopSectionHeroPresentation | null => {
  if (!shouldUseLegacyNarrativeFallback(goal)) return null;

  const selectedGoalLabel = normalizeText(goal.selectedGoalLabel);
  const previewGoalLabel = normalizeText(goal.previewGoalLabel);
  const resolvedGoalLabel = selectedGoalLabel || previewGoalLabel;
  if (!resolvedGoalLabel) return null;

  const fitLevel = getLegacyNarrativeFitLevel(goal);
  if (!fitLevel) return null;

  return buildGoalNarrativeHeroCopy(
    resolvedGoalLabel,
    fitLevel,
    goal.analyzedGoalCount ?? getPrimaryGoalCoverage(goal).length,
  );
};

const buildHero = (goal: TopSectionHeroInput): TopSectionHeroPresentation => {
  const dominantGoalHero = buildDominantGoalHero(goal);
  if (dominantGoalHero) return dominantGoalHero;

  const multiGoalHero = buildGoalCoverageHero(goal);
  if (multiGoalHero) return multiGoalHero;

  const singleGoalCoverageHero = buildSingleGoalCoverageHero(goal);
  if (singleGoalCoverageHero) return singleGoalCoverageHero;

  const legacyHero = buildLegacyHero(goal);
  if (legacyHero) return legacyHero;

  return {
    tone: 'neutral',
    chip: 'Not enough evidence to judge the goals shown',
    summary: 'We need more label detail to judge this product well.',
  };
};

const buildSupportAlignedHeroWhenEvidenceIsThin = (
  goal: TopSectionHeroInput,
  personalInsight: TopSectionPersonalInsightInput,
): TopSectionHeroPresentation | null => {
  const heroReadsAsEvidenceLimited =
    goal.heroMode === 'insufficient_signal'
    || goal.labelCompleteness === 'low'
    || hasLowNarrativeConfidence(goal);
  if (!heroReadsAsEvidenceLimited) return null;
  if (personalInsight.preferSupportSignal === false) return null;

  const dominantGoal = getDominantGoalCoverage(personalInsight);
  const fallbackGoalLabel =
    normalizeText(personalInsight.resolvedSupportGoalLabel)
    || dominantGoal?.goalLabel
    || personalInsight.supportLabels
      .map((label) => normalizeText(label))
      .find(Boolean)
    || null;
  const resolvedGoalLabel = normalizeText(fallbackGoalLabel);
  if (!resolvedGoalLabel) return null;

  const loweredGoal = lowerFirst(resolvedGoalLabel);
  const analyzedGoalCount = personalInsight.analyzedGoalCount ?? getPrimaryGoalCoverage(personalInsight).length;

  return {
    tone: 'neutral',
    chip: `Most aligned with your ${resolvedGoalLabel} goal`,
    summary: analyzedGoalCount > 1
      ? `Visible ingredients lean more toward ${loweredGoal} support than other goals we checked.`
      : `Visible ingredients lean more toward ${loweredGoal} support on this label.`,
  };
};

const findGoalCoverageByLabel = (
  coverage: TopSectionGoalCoverageInput[],
  goalLabel: string,
): TopSectionGoalCoverageInput | null => {
  const normalizedGoalLabel = normalizeText(goalLabel).toLowerCase();
  if (!normalizedGoalLabel) return null;
  return coverage.find((entry) => normalizeText(entry.goalLabel).toLowerCase() === normalizedGoalLabel) ?? null;
};

const buildBanner = (allergy: TopSectionAllergyInput): TopSectionBannerPresentation | null => {
  if (allergy.matchedLabels.length === 0) return null;
  return {
    kind: 'allergy',
    tone: 'caution',
    title: 'Ingredients may conflict with your allergies',
  };
};

const buildExplanationLines = (
  explanation?: TopSectionGoalCoverageInput['explanation'],
  limit = 3,
): string[] => {
  if (!explanation) return [];

  return uniqueLines([
    explanation.summary,
    ...(explanation.why ?? []),
    ...(explanation.evidence ?? []),
    ...(explanation.action ?? []),
  ], limit);
};

const toGoalCoveragePresentation = (
  entry: TopSectionGoalCoverageInput,
): TopSectionGoalCoveragePresentation => ({
  key: normalizeText(entry.goalLabel).toLowerCase().replace(/\s+/g, '_'),
  goalLabel: entry.goalLabel,
  state: entry.state,
  description: buildGoalNarrativeRowCopy(entry.goalLabel, entry.state),
  stateLabel: GOAL_COVERAGE_STATE_LABELS[entry.state],
  tone: GOAL_COVERAGE_TONE_BY_STATE[entry.state],
  explanation: entry.explanation ?? null,
});

const buildInlineCoveragePreview = (
  visibleItems: TopSectionGoalCoveragePresentation[],
  analyzedCount: number,
): string | undefined => {
  if (visibleItems.length === 0) return undefined;

  const previewItems = visibleItems.slice(0, 2);
  const fragments = previewItems.map((item) => `${item.goalLabel}: ${describeGoalNarrativeCompactStatus(item.state)}`);
  const hiddenCount = Math.max(0, analyzedCount - previewItems.length);
  if (hiddenCount > 0) {
    fragments.push(`${hiddenCount} more`);
  }
  return fragments.join(' · ');
};

const getDefaultVisibleGoalCoverage = (
  coverage: TopSectionGoalCoverageInput[],
  defaultVisibleGoalLabels: string[] | undefined,
  surfacedGoalCount: number | undefined,
): TopSectionGoalCoverageInput[] => {
  const desiredCount = Math.max(1, surfacedGoalCount ?? Math.min(3, coverage.length));
  const normalizedVisibleLabels = (defaultVisibleGoalLabels ?? [])
    .map((label) => normalizeText(label))
    .filter(Boolean);

  if (normalizedVisibleLabels.length === 0) return coverage.slice(0, desiredCount);

  const byLabel = new Map(
    coverage.map((entry) => [normalizeText(entry.goalLabel), entry] as const),
  );

  const ordered = normalizedVisibleLabels
    .map((label) => byLabel.get(label))
    .filter((entry): entry is TopSectionGoalCoverageInput => Boolean(entry));

  if (ordered.length > 0) return ordered.slice(0, desiredCount);
  return coverage.slice(0, desiredCount);
};

const buildGoalCoverageRowDetails = (
  personalInsight: TopSectionPersonalInsightInput,
) => {
  const coverage = getSortedGoalCoverage(getPrimaryGoalCoverage(personalInsight));
  const fullItems = coverage.map(toGoalCoveragePresentation);
  const defaultVisibleCoverage = getDefaultVisibleGoalCoverage(
    coverage,
    personalInsight.defaultVisibleGoalLabels,
    personalInsight.surfacedGoalCount,
  );
  const visibleItems = defaultVisibleCoverage.map(toGoalCoveragePresentation);
  const hiddenByLabel = new Set(defaultVisibleCoverage.map((entry) => normalizeText(entry.goalLabel)));
  const hiddenItems = fullItems.filter((entry) => !hiddenByLabel.has(normalizeText(entry.goalLabel)));
  const analyzedCount = personalInsight.analyzedGoalCount ?? coverage.length;
  const surfacedCount = Math.min(
    personalInsight.surfacedGoalCount ?? visibleItems.length,
    analyzedCount,
  );
  const allGoalsAnalyzed = personalInsight.allGoalsAnalyzed === true;
  const subtitle = allGoalsAnalyzed
    ? analyzedCount > surfacedCount
      ? `${surfacedCount} of ${analyzedCount} goals shown`
      : analyzedCount > 0
        ? `${analyzedCount} goals checked`
        : undefined
    : visibleItems.length > 0
      ? `${visibleItems.length} goals checked`
      : undefined;
  const expandedSubtitle = allGoalsAnalyzed
    ? analyzedCount > 0
      ? `${analyzedCount} goals checked`
      : undefined
    : undefined;
  const canExpandAll = allGoalsAnalyzed && analyzedCount > surfacedCount;

  return {
    coverage,
    fullItems,
    visibleItems,
    hiddenItems,
    analyzedCount,
    canExpandAll,
    subtitle,
    expandedSubtitle,
    expandActionLabel: canExpandAll ? 'See all goals' : undefined,
    collapseActionLabel: canExpandAll ? 'Hide goals' : undefined,
    inlinePreview: buildInlineCoveragePreview(visibleItems, analyzedCount),
  };
};

const buildSupportInsight = (
  personalInsight: TopSectionPersonalInsightInput,
): TopSectionInsightPresentation | null => {
  const coverage = getSortedGoalCoverage(getPrimaryGoalCoverage(personalInsight));
  const resolvedSupportGoalLabel = normalizeText(personalInsight.resolvedSupportGoalLabel);
  const dominantGoal =
    (
      personalInsight.preferSupportSignal && resolvedSupportGoalLabel
        ? findGoalCoverageByLabel(coverage, resolvedSupportGoalLabel)
        : null
    )
    ?? getDominantGoalCoverage(personalInsight);
  if (dominantGoal) {
    const {
      fullItems,
      analyzedCount,
      expandedSubtitle,
      canExpandAll,
      inlinePreview,
    } = buildGoalCoverageRowDetails(personalInsight);
    const dominantPresentation = toGoalCoveragePresentation(dominantGoal);
    const lowerGoal = lowerFirst(dominantGoal.goalLabel);
    const collapsedTitle =
      personalInsight.preferSupportSignal && resolvedSupportGoalLabel
        ? buildGoalSupportTitle(dominantGoal.goalLabel)
        : dominantGoal.state === 'strong'
        ? buildGoalSupportTitle(dominantGoal.goalLabel)
        : `Most aligned with your ${dominantGoal.goalLabel} goal`;

    return {
      key: 'personal_support',
      topic: 'support',
      tone: dominantGoal.state === 'strong' ? 'positive' : 'neutral',
      collapsedTitle,
      expandedBullets: buildExplanationLines(dominantPresentation.explanation, 3).length > 0
        ? buildExplanationLines(dominantPresentation.explanation, 3)
        : dominantGoal.state === 'strong'
          ? uniqueLines([
              buildGoalSupportSummary(dominantGoal.goalLabel),
              buildGoalSupportReason(dominantGoal.goalLabel),
              'Other goals look weaker on this label.',
            ])
          : uniqueLines([
              `This label shows its clearest signal for ${lowerGoal} support.`,
              'Support is present, but not strong.',
              'Other goals look less supported on this label.',
            ]),
      goalCoverageItems: fullItems,
      goalCoveragePresentation: 'secondary_inline',
      inlineGoalCoverageTitle: 'Goal check',
      inlineGoalCoveragePreview: inlinePreview,
      expandedSubtitle,
      expandActionLabel: analyzedCount > 1 ? 'See all goals' : undefined,
      collapseActionLabel: analyzedCount > 1 ? 'Hide goals' : undefined,
      canExpandAll: canExpandAll || analyzedCount > 1,
      isExpandable: true,
    };
  }

  const shouldRenderPrimaryCoverageRow =
    !personalInsight.preferSupportSignal
    &&
    isGoalCoverageMultiGoal(personalInsight)
    && (
      personalInsight.heroMode === 'mixed_goals'
      || personalInsight.heroMode === 'limited_goals'
      || personalInsight.heroMode === 'insufficient_signal'
      || (personalInsight.heroMode === 'dominant_goal' && !dominantGoal)
      || !personalInsight.heroMode
    );
  if (shouldRenderPrimaryCoverageRow) {
    const {
      coverage,
      fullItems,
      visibleItems,
      hiddenItems,
      subtitle,
      expandedSubtitle,
      canExpandAll,
      expandActionLabel,
      collapseActionLabel,
    } = buildGoalCoverageRowDetails(personalInsight);
    const tone = coverage.every((entry) => entry.state === 'limited' || entry.state === 'none' || entry.state === 'unknown')
      ? 'neutral'
      : coverage.some((entry) => entry.state === 'strong')
        ? 'positive'
        : 'neutral';

    return {
      key: 'goal_coverage',
      topic: 'support',
      tone,
      collapsedTitle: 'Goal check',
      subtitle,
      expandedSubtitle,
      expandedBullets: [],
      goalCoverageItems: fullItems,
      visibleGoalCoverageItems: visibleItems,
      hiddenGoalCoverageItems: hiddenItems,
      goalCoveragePresentation: 'primary',
      expandActionLabel,
      collapseActionLabel,
      canExpandAll,
      isExpandable: true,
    };
  }

  const supportLabels = Array.from(new Set([
    personalInsight.preferSupportSignal ? resolvedSupportGoalLabel : null,
    ...personalInsight.supportLabels,
  ]
    .map((label) => normalizeText(label))
    .filter(Boolean)));
  if (supportLabels.length > 0) {
    const collapsedTitle =
      supportLabels.length === 1
        ? buildGoalSupportTitle(supportLabels[0])
        : `Supports your ${joinLabels(supportLabels.map((label) => lowerFirst(label)))} goals`;

    return {
      key: 'personal_support',
      topic: 'support',
      tone: 'positive',
      collapsedTitle,
      expandedBullets: uniqueLines([
        buildGoalSupportSummary(joinLabels(supportLabels)),
        buildGoalSupportReason(joinLabels(supportLabels)),
      ]),
      isExpandable: true,
    };
  }

  const goalLabel = normalizeText(personalInsight.selectedGoalLabel);
  const singleGoalCoverage = getSingleGoalCoverage(personalInsight);
  if (singleGoalCoverage) {
    const fitLevel: GoalNarrativeFitLevel =
      personalInsight.heroMode === 'insufficient_signal' || hasLowNarrativeConfidence(personalInsight)
        ? 'unknown'
        : singleGoalCoverage.state;

    return {
      key: 'personal_support',
      topic: 'support',
      tone: fitLevel === 'strong' ? 'positive' : 'neutral',
      collapsedTitle: buildGoalSupportFallbackTitle(singleGoalCoverage.goalLabel, fitLevel),
      expandedBullets:
        buildExplanationLines(singleGoalCoverage.explanation, 4).length > 0
          ? buildExplanationLines(singleGoalCoverage.explanation, 4)
          : buildGoalSupportFallbackBullets(singleGoalCoverage.goalLabel, fitLevel),
      isExpandable: true,
    };
  }

  if (!goalLabel || !shouldUseLegacyNarrativeFallback(personalInsight)) return null;

  const fitLevel = getLegacyNarrativeFitLevel(personalInsight) ?? 'unknown';
  return {
    key: 'personal_support',
    topic: 'support',
    tone: fitLevel === 'strong' ? 'positive' : 'neutral',
    collapsedTitle: buildGoalSupportFallbackTitle(goalLabel, fitLevel),
    expandedBullets: buildGoalSupportFallbackBullets(goalLabel, fitLevel),
    isExpandable: true,
  };
};

const buildAllergyInsight = (
  allergy: TopSectionAllergyInput,
): TopSectionInsightPresentation | null => {
  const summary = normalizeText(allergy.summary);
  const reasonCode = normalizeText(allergy.reasonCode).toUpperCase();

  if (allergy.matchedLabels.length > 0) {
    const evidence = compactEvidenceTexts(allergy.evidenceTexts, allergy.matchedLabels);
    return {
      key: 'allergy_insight',
      topic: 'allergy',
      tone: 'caution',
      collapsedTitle: buildAllergyConflictTitle(allergy.matchedLabels),
      expandedBullets: uniqueLines([
        'This product may conflict with your saved allergy settings.',
        `Matched against: ${joinDisplayLabels(allergy.matchedLabels)}.`,
        evidence.length > 0 ? `Found on label: ${joinLabels(evidence)}.` : null,
        buildAllergyConflictAction(allergy.matchedLabels),
      ], 4),
      isExpandable: true,
    };
  }

  if (/no allergy or restriction settings saved yet/i.test(summary)) {
    if (allergy.hasSavedPreferences) {
      return {
        key: 'allergy_insight',
        topic: 'allergy',
        tone: 'neutral',
        collapsedTitle: 'Saved allergy preferences did not attach to this scan',
        expandedBullets: uniqueLines([
          'This device already has saved allergy or ingredient restrictions, but this scan result did not attach them correctly.',
          'Retrying the scan should use your saved allergy settings automatically.',
        ]),
        isExpandable: true,
      };
    }

    return {
      key: 'allergy_insight',
      topic: 'allergy',
      tone: 'neutral',
      collapsedTitle: 'Add your allergy preferences for automatic checks',
      expandedBullets: uniqueLines([
        'Save your allergy or ingredient restrictions to compare products automatically.',
        summary || null,
      ]),
      isExpandable: true,
    };
  }

  if (
    allergy.status === 'pending' ||
    reasonCode === 'NORMALIZED_PRODUCT_ALLERGY_FLAGS_NOT_ATTACHED' ||
    /still attaching allergen coverage/i.test(summary)
  ) {
    return {
      key: 'allergy_insight',
      topic: 'allergy',
      tone: 'neutral',
      collapsedTitle: 'Allergy check is still loading',
      expandedBullets: uniqueLines([
        summary || 'We are still attaching allergen coverage for this product.',
      ]),
      isExpandable: true,
    };
  }

  if (/needs more label detail/i.test(summary)) {
    return {
      key: 'allergy_insight',
      topic: 'allergy',
      tone: 'neutral',
      collapsedTitle: 'Not enough label detail for an allergy check',
      expandedBullets: uniqueLines([
        summary || 'This label does not show enough detail to confirm an allergy check yet.',
      ]),
      isExpandable: true,
    };
  }

  return {
    key: 'allergy_insight',
    topic: 'allergy',
    tone: 'positive',
    collapsedTitle: 'No ingredients flagged by your allergies',
    expandedBullets: uniqueLines([
      "We didn't find a conflict with your saved allergy settings.",
      summary && !/no allergy-related flags detected/i.test(summary) ? summary : null,
    ]),
    isExpandable: true,
  };
};

const buildDoseInsight = (dose: TopSectionDoseInput): TopSectionInsightPresentation | null => {
  const details = uniqueLines([
    dose.productDoseText,
    dose.productDirectionsText,
    dose.status === 'unavailable' ? 'This label does not show enough dose detail to compare yet.' : null,
  ]);

  if (dose.status === 'unavailable') {
    return {
      key: 'dosage_context',
      topic: 'dose',
      tone: 'neutral',
      collapsedTitle: 'Dose comparison unavailable',
      expandedBullets: details,
      isExpandable: details.length > 0,
    };
  }

  switch (dose.assessment) {
    case 'aligned':
      return {
        key: 'dosage_context',
        topic: 'dose',
        tone: 'positive',
        collapsedTitle: 'Dose looks aligned for daily use',
        expandedBullets: uniqueLines([
          'The listed dose looks reasonable for a general daily routine.',
          dose.productDoseText,
          dose.productDirectionsText,
        ]),
        isExpandable: true,
      };
    case 'low':
      return {
        key: 'dosage_context',
        topic: 'dose',
        tone: 'caution',
        collapsedTitle: 'Dose may be lighter than expected',
        expandedBullets: uniqueLines([
          'The listed dose may be lighter than expected for this kind of product.',
          dose.productDoseText,
          dose.productDirectionsText,
        ]),
        isExpandable: true,
      };
    case 'high':
      return {
        key: 'dosage_context',
        topic: 'dose',
        tone: 'caution',
        collapsedTitle: 'Stronger dose than a basic daily baseline',
        expandedBullets: uniqueLines([
          'The listed dose looks stronger than a basic daily baseline.',
          dose.productDoseText,
          dose.productDirectionsText,
        ]),
        isExpandable: true,
      };
    case 'unclear':
    case 'unknown':
    default:
      return {
        key: 'dosage_context',
        topic: 'dose',
        tone: 'neutral',
        collapsedTitle: 'Dose is listed, but hard to benchmark',
        expandedBullets: uniqueLines([
          "The dose is shown, but it's hard to judge whether it is the right amount for your goal from this label alone.",
          dose.productDoseText,
          dose.productDirectionsText,
        ]),
        isExpandable: true,
      };
  }
};

const buildOverlapInsight = (
  personalInsight: TopSectionPersonalInsightInput,
): TopSectionInsightPresentation | null => {
  const conflictSummary = normalizeText(personalInsight.conflictSummary);
  if (!conflictSummary) return null;

  return {
    key: 'personal_overlap',
    topic: 'overlap',
    tone: 'caution',
    collapsedTitle: 'May overlap with your saved supplements',
    expandedBullets: uniqueLines([
      conflictSummary,
      'Review ingredient overlap before adding this product to your stack.',
    ]),
    isExpandable: true,
  };
};

const buildSafetyInsight = (safety: TopSectionSafetyInput): TopSectionInsightPresentation | null => {
  const warning = normalizeText(safety.warningText);
  const watchout = normalizeText(safety.watchoutText);
  if (!warning && !watchout) return null;
  const combined = `${warning} ${watchout}`.toLowerCase();
  const needsActionLine = !/consult|check with|ask|doctor|clinician|physician|healthcare professional/.test(combined);

  return {
    key: 'safety',
    topic: 'safety',
    tone: 'caution',
    collapsedTitle: buildSafetyTitle(warning, watchout),
    expandedBullets: uniqueLines([
      warning,
      watchout,
      needsActionLine ? 'Check with a healthcare professional before use if this applies to you.' : null,
    ], 4),
    isExpandable: true,
  };
};

export const buildAnalysisTopSectionPresentation = (input: {
  goal: TopSectionHeroInput;
  personalInsight: TopSectionPersonalInsightInput;
  allergy: TopSectionAllergyInput;
  dose: TopSectionDoseInput;
  safety: TopSectionSafetyInput;
}): TopSectionPresentation => {
  const banner = buildBanner(input.allergy);
  const hero = buildSupportAlignedHeroWhenEvidenceIsThin(input.goal, input.personalInsight)
    ?? buildHero(input.goal);
  const insights = [
    buildSupportInsight(input.personalInsight),
    buildAllergyInsight(input.allergy),
    buildDoseInsight(input.dose),
    buildSafetyInsight(input.safety),
    buildOverlapInsight(input.personalInsight),
  ]
    .filter((row): row is TopSectionInsightPresentation => Boolean(row))
    .slice(0, 4);

  const preferredExpandedKey = banner?.kind === 'allergy'
    ? 'allergy_insight'
    : input.personalInsight.preferSupportSignal
      ? 'personal_support'
    : input.goal.heroMode === 'dominant_goal'
      ? 'personal_support'
      : input.goal.goalLensMode === 'multi_goal_summary'
        || input.goal.heroMode === 'mixed_goals'
        || input.goal.heroMode === 'limited_goals'
        || input.goal.heroMode === 'insufficient_signal'
      ? 'goal_coverage'
      : 'personal_support';
  const fallbackExpandedKey = insights[0]?.key ?? null;
  const resolvedExpandedKey =
    insights.find((row) => row.key === preferredExpandedKey)?.key ??
    insights.find((row) => row.key === 'safety')?.key ??
    fallbackExpandedKey;

  return {
    hero,
    banner,
    secondaryNote: null,
    insights: insights.map((row) => ({
      ...row,
      defaultExpanded: row.key === resolvedExpandedKey,
    })),
  };
};
