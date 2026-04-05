export type TopSectionTone = 'positive' | 'caution' | 'neutral';

export type TopSectionHeroInput = {
  fitDecision?: 'fits' | 'mixed' | 'does_not_fit' | 'unknown' | null;
  selectedGoalLabel?: string | null;
  selectedGoalLabels?: string[];
  previewGoalLabel?: string | null;
  previewTopTier?: 'strong_match' | 'related' | 'weak_match' | 'unknown' | null;
  goalLensMode?: 'single_goal' | 'multi_goal_summary' | null;
  goalCoverage?: TopSectionGoalCoverageInput[];
};

export type TopSectionPersonalInsightInput = {
  supportLabels: string[];
  conflictSummary?: string | null;
  fitDecision?: 'fits' | 'mixed' | 'does_not_fit' | 'unknown' | null;
  selectedGoalLabel?: string | null;
  goalLensMode?: 'single_goal' | 'multi_goal_summary' | null;
  goalCoverage?: TopSectionGoalCoverageInput[];
};

export type TopSectionGoalCoverageInput = {
  goalLabel: string;
  tier: 'strong_match' | 'related' | 'weak_match' | 'no_match' | 'unknown';
  state: 'strong' | 'some' | 'limited' | 'none';
  source: 'selected_goal_evaluation' | 'goal_match_scoring_preview';
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
  expandedBullets: string[];
  isExpandable: boolean;
  defaultExpanded?: boolean;
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
  const keywords = matchedLabels
    .map((label) => formatDisplayLabel(label).toLowerCase())
    .flatMap((label) => label.split(/\s+/))
    .filter((token) => token.length >= 3);

  const fragments = Array.from(
    new Set(
      values
        .flatMap((value) => normalizeText(value).split(/[;•\n]+/))
        .flatMap((value) => value.split(/\s+and\s+/i))
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

const buildSupportFallbackTitle = (fitDecision: TopSectionPersonalInsightInput['fitDecision'], goalLabel: string) => {
  const goal = normalizeText(goalLabel);
  switch (fitDecision) {
    case 'fits':
      return buildSupportTitle(goal);
    case 'mixed':
      return `Some support for your ${lowerFirst(goal)} goal`;
    case 'does_not_fit':
      return `${goal} support looks limited`;
    case 'unknown':
    default:
      return `No clear match for your ${goal} goal yet`;
  }
};

const buildSupportFallbackBullets = (
  fitDecision: TopSectionPersonalInsightInput['fitDecision'],
  goalLabel: string,
): string[] => {
  const goal = normalizeText(goalLabel);
  const lowerGoal = lowerFirst(goal);

  switch (fitDecision) {
    case 'fits':
      return uniqueLines([
        `This label looks strongly aligned with your ${lowerGoal} goal.`,
        `The visible ingredients look more supportive of ${lowerGoal} than other goals we checked.`,
      ]);
    case 'mixed':
      return uniqueLines([
        `This label shows some support for ${lowerGoal}, but not enough to count as a strong match.`,
        `It may support other goals more clearly than ${goal}.`,
      ]);
    case 'does_not_fit':
      return uniqueLines([
        `We don't see strong ${lowerGoal} support on this label.`,
        `This product may be better suited to other goals than ${goal}.`,
      ]);
    case 'unknown':
    default:
      return uniqueLines([
        `We can't tell from this label whether it clearly supports ${lowerGoal}.`,
        'This product may still be useful, but the current label does not show a clear goal signal yet.',
      ]);
  }
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

const buildSupportTitle = (goalLabel?: string | null) => {
  const goal = lowerFirst(goalLabel);
  if (!goal) return 'Supports your health goals';
  if (goal === 'immunity') return 'Supports your immunity health';
  return `Supports your ${goal} goal`;
};

const GOAL_COVERAGE_STATE_PRIORITY: Record<TopSectionGoalCoverageInput['state'], number> = {
  strong: 4,
  some: 3,
  limited: 2,
  none: 1,
};

const isGoalCoverageMultiGoal = (
  goal: TopSectionHeroInput | TopSectionPersonalInsightInput,
): boolean =>
  goal.goalLensMode === 'multi_goal_summary'
  && (goal.goalCoverage?.length ?? 0) > 1;

const getSortedGoalCoverage = (coverage: TopSectionGoalCoverageInput[] = []): TopSectionGoalCoverageInput[] =>
  coverage.filter((entry) => normalizeText(entry.goalLabel).length > 0);

const describeGoalCoverageState = (state: TopSectionGoalCoverageInput['state']) => {
  switch (state) {
    case 'strong':
      return 'strong support';
    case 'some':
      return 'some support';
    case 'limited':
      return 'limited support';
    case 'none':
    default:
      return 'no clear support';
  }
};

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

const buildGoalCoverageHero = (goal: TopSectionHeroInput): TopSectionHeroPresentation | null => {
  const coverage = getSortedGoalCoverage(goal.goalCoverage);
  if (!isGoalCoverageMultiGoal(goal) || coverage.length < 2) return null;

  const { best, weakest } = getBestAndWeakestGoalCoverage(coverage);
  const hasStrong = coverage.some((entry) => entry.state === 'strong');
  const allPositive = coverage.every((entry) => entry.state === 'strong' || entry.state === 'some');
  const allLimited = coverage.every((entry) => entry.state === 'limited' || entry.state === 'none');

  if (allPositive && hasStrong && best) {
    return {
      tone: 'positive',
      chip: 'Strong fit across your goals',
      summary: `Best aligned with ${best.goalLabel}, with support across your selected goals`,
    };
  }

  if (allLimited) {
    return {
      tone: 'caution',
      chip: 'Limited fit across your goals',
      summary: 'Support looks limited across your selected goals',
    };
  }

  if (coverage.every((entry) => entry.state === 'some')) {
    return {
      tone: 'neutral',
      chip: 'Mixed fit across your goals',
      summary: 'Shows some support across your selected goals',
    };
  }

  if (best && weakest && best.goalLabel === weakest.goalLabel) {
    return {
      tone: 'neutral',
      chip: 'Mixed fit across your goals',
      summary: 'Support varies across your selected goals',
    };
  }

  if (best && weakest) {
    return {
      tone: 'neutral',
      chip: 'Mixed fit across your goals',
      summary: `Looks stronger for ${best.goalLabel} than ${weakest.goalLabel}`,
    };
  }

  return null;
};

const buildHero = (goal: TopSectionHeroInput): TopSectionHeroPresentation => {
  const multiGoalHero = buildGoalCoverageHero(goal);
  if (multiGoalHero) return multiGoalHero;

  const selectedGoalLabel = normalizeText(goal.selectedGoalLabel);
  const previewGoalLabel = normalizeText(goal.previewGoalLabel);
  const resolvedGoalLabel = selectedGoalLabel || previewGoalLabel;

  if (goal.fitDecision === 'fits' && selectedGoalLabel) {
    return {
      tone: 'positive',
      chip: 'Strong fit for you',
      summary: `Best aligned with your ${selectedGoalLabel} goal`,
    };
  }

  if (goal.fitDecision === 'mixed' && selectedGoalLabel) {
    return {
      tone: 'neutral',
      chip: 'Could work for you',
      summary: `This label shows some support for your ${selectedGoalLabel} goal`,
    };
  }

  if (goal.fitDecision === 'does_not_fit' && selectedGoalLabel) {
    return {
      tone: 'caution',
      chip: `Not a strong fit for your ${selectedGoalLabel} goal`,
      summary: `We don't see strong ${selectedGoalLabel} support on this label`,
    };
  }

  if (goal.previewTopTier === 'strong_match' && resolvedGoalLabel) {
    return {
      tone: 'positive',
      chip: 'Strong fit for you',
      summary: `Best aligned with your ${resolvedGoalLabel} goal`,
    };
  }

  if (goal.previewTopTier === 'related' && resolvedGoalLabel) {
    return {
      tone: 'neutral',
      chip: 'Could work for you',
      summary: `Most related to your ${resolvedGoalLabel} goal`,
    };
  }

  if (goal.previewTopTier === 'weak_match' && resolvedGoalLabel) {
    return {
      tone: 'neutral',
      chip: 'Need a bit more context',
      summary: `Only light support for your ${resolvedGoalLabel} goal`,
    };
  }

  return {
    tone: 'neutral',
    chip: 'Need a bit more context',
    summary: 'We need a little more detail to judge this product',
  };
};

const buildBanner = (allergy: TopSectionAllergyInput): TopSectionBannerPresentation | null => {
  if (allergy.matchedLabels.length === 0) return null;
  return {
    kind: 'allergy',
    tone: 'caution',
    title: 'Ingredients may conflict with your allergies',
  };
};

const buildSupportInsight = (
  personalInsight: TopSectionPersonalInsightInput,
): TopSectionInsightPresentation | null => {
  if (isGoalCoverageMultiGoal(personalInsight)) {
    const coverage = getSortedGoalCoverage(personalInsight.goalCoverage);
    const tone = coverage.every((entry) => entry.state === 'limited' || entry.state === 'none')
      ? 'caution'
      : coverage.some((entry) => entry.state === 'strong')
        ? 'positive'
        : 'neutral';

    return {
      key: 'goal_coverage',
      topic: 'support',
      tone,
      collapsedTitle: 'How it maps to your goals',
      expandedBullets: coverage.map((entry) => `${entry.goalLabel}: ${describeGoalCoverageState(entry.state)}.`),
      isExpandable: true,
    };
  }

  const supportLabels = personalInsight.supportLabels
    .map((label) => normalizeText(label))
    .filter(Boolean);
  if (supportLabels.length > 0) {
    const collapsedTitle =
      supportLabels.length === 1
        ? buildSupportTitle(supportLabels[0])
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
  if (!goalLabel) return null;

  switch (personalInsight.fitDecision) {
    case 'fits':
      return {
        key: 'personal_support',
        topic: 'support',
        tone: 'positive',
        collapsedTitle: buildSupportFallbackTitle(personalInsight.fitDecision, goalLabel),
        expandedBullets: buildSupportFallbackBullets(personalInsight.fitDecision, goalLabel),
        isExpandable: true,
      };
    case 'mixed':
      return {
        key: 'personal_support',
        topic: 'support',
        tone: 'neutral',
        collapsedTitle: buildSupportFallbackTitle(personalInsight.fitDecision, goalLabel),
        expandedBullets: buildSupportFallbackBullets(personalInsight.fitDecision, goalLabel),
        isExpandable: true,
      };
    case 'does_not_fit':
      return {
        key: 'personal_support',
        topic: 'support',
        tone: 'caution',
        collapsedTitle: buildSupportFallbackTitle(personalInsight.fitDecision, goalLabel),
        expandedBullets: buildSupportFallbackBullets(personalInsight.fitDecision, goalLabel),
        isExpandable: true,
      };
    case 'unknown':
    default:
      return {
        key: 'personal_support',
        topic: 'support',
        tone: 'neutral',
        collapsedTitle: buildSupportFallbackTitle(personalInsight.fitDecision, goalLabel),
        expandedBullets: buildSupportFallbackBullets(personalInsight.fitDecision, goalLabel),
        isExpandable: true,
      };
  }
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

const buildSecondarySafetyNote = (
  safety: TopSectionSafetyInput,
  hero: TopSectionHeroPresentation,
): TopSectionSecondaryNotePresentation | null => {
  if (hero.tone === 'caution') return null;

  const warning = normalizeText(safety.warningText);
  const watchout = normalizeText(safety.watchoutText);
  if (!warning && !watchout) return null;

  const title = buildSafetyTitle(warning, watchout);
  if (!/^If you /.test(title)) return null;

  const combined = `${warning} ${watchout}`.toLowerCase();
  if (/blood thinner|surgery|avoid|do not use|stop use|contraindicat|anticoagulant/.test(combined)) {
    return null;
  }

  return {
    topic: 'safety',
    tone: 'caution',
    title,
    body: uniqueLines([
      warning,
      watchout,
      'This reminder matters only if that situation applies to you.',
    ], 1)[0],
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
  const hero = buildHero(input.goal);
  const secondaryNote = buildSecondarySafetyNote(input.safety, hero);
  const insights = [
    buildSupportInsight(input.personalInsight),
    buildAllergyInsight(input.allergy),
    buildDoseInsight(input.dose),
    secondaryNote ? null : buildSafetyInsight(input.safety),
    buildOverlapInsight(input.personalInsight),
  ]
    .filter((row): row is TopSectionInsightPresentation => Boolean(row))
    .slice(0, 4);

  const preferredExpandedKey = banner?.kind === 'allergy'
    ? 'allergy_insight'
    : input.goal.goalLensMode === 'multi_goal_summary'
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
    secondaryNote,
    insights: insights.map((row) => ({
      ...row,
      defaultExpanded: row.key === resolvedExpandedKey,
    })),
  };
};
