export type TopSectionTone = 'positive' | 'caution' | 'neutral';

export type TopSectionHeroInput = {
  fitDecision?: 'fits' | 'mixed' | 'does_not_fit' | null;
  selectedGoalLabel?: string | null;
  previewGoalLabel?: string | null;
  previewTopTier?: 'strong_match' | 'related' | 'weak_match' | null;
};

export type TopSectionPersonalInsightInput = {
  supportLabels: string[];
  conflictSummary?: string | null;
};

export type TopSectionAllergyInput = {
  status?: 'ready' | 'pending' | 'unavailable' | null;
  reasonCode?: string | null;
  summary?: string | null;
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

export type TopSectionBannerKind = 'allergy' | 'safety' | 'overlap';
export type TopSectionInsightTopic = 'goal' | 'support' | 'allergy' | 'dose' | 'overlap' | 'safety';

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
};

export type TopSectionPresentation = {
  hero: TopSectionHeroPresentation;
  banner: TopSectionBannerPresentation | null;
  insights: TopSectionInsightPresentation[];
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

const uniqueLines = (values: (string | null | undefined)[], limit: number = 3): string[] => {
  const lines = Array.from(
    new Set(
      values
        .map((value) => ensurePeriod(value))
        .filter(Boolean),
    ),
  );
  return lines.slice(0, limit);
};

const joinLabels = (values: string[], limit: number = 3): string => {
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

const buildGoalTitle = (goalLabel?: string | null, strength: 'strong' | 'soft' | 'weak' = 'strong') => {
  const goal = lowerFirst(goalLabel);
  if (!goal) {
    if (strength === 'weak') return 'Not a strong goal match yet';
    if (strength === 'soft') return 'Could work for your goals';
    return 'Supports your health goals';
  }
  if (goal === 'immunity') {
    if (strength === 'weak') return 'Not a strong immunity match yet';
    if (strength === 'soft') return 'Could help with your immune health';
    return 'Supports your immunity health';
  }
  if (strength === 'weak') return `Not a strong match for your ${goal} goal`;
  if (strength === 'soft') return `Could help with your ${goal} goal`;
  return `Supports your ${goal} goal`;
};

const buildHeroBase = (goal: TopSectionHeroInput): TopSectionHeroPresentation => {
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
      summary: `Shows some support for your ${selectedGoalLabel} goal`,
    };
  }
  if (goal.fitDecision === 'does_not_fit' && selectedGoalLabel) {
    return {
      tone: 'caution',
      chip: 'Review before using',
      summary: `Not a strong match for your ${selectedGoalLabel} goal`,
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

const buildBanner = ({
  allergy,
  safety,
  personalInsight,
}: {
  allergy: TopSectionAllergyInput;
  safety: TopSectionSafetyInput;
  personalInsight: TopSectionPersonalInsightInput;
}): TopSectionBannerPresentation | null => {
  if (allergy.matchedLabels.length > 0) {
    return {
      kind: 'allergy',
      tone: 'caution',
      title: 'Ingredients may conflict with your allergies',
    };
  }

  if (normalizeText(safety.warningText) || normalizeText(safety.watchoutText)) {
    return {
      kind: 'safety',
      tone: 'caution',
      title: 'Check with a healthcare professional before use',
    };
  }

  if (normalizeText(personalInsight.conflictSummary)) {
    return {
      kind: 'overlap',
      tone: 'caution',
      title: 'May overlap with your saved supplements',
    };
  }

  return null;
};

const buildHero = ({
  goal,
  banner,
}: {
  goal: TopSectionHeroInput;
  banner: TopSectionBannerPresentation | null;
}): TopSectionHeroPresentation => {
  if (!banner) return buildHeroBase(goal);
  if (banner.kind === 'allergy') {
    return {
      tone: 'caution',
      chip: 'Review before using',
      summary: 'May conflict with your saved allergies',
    };
  }
  if (banner.kind === 'safety') {
    return {
      tone: 'caution',
      chip: 'Review before using',
      summary: 'May need extra caution before use',
    };
  }
  return {
    tone: 'neutral',
    chip: 'Could work for you',
    summary: 'May overlap with your saved supplements',
  };
};

const buildGoalInsight = (goal: TopSectionHeroInput): TopSectionInsightPresentation => {
  const selectedGoalLabel = normalizeText(goal.selectedGoalLabel);
  const previewGoalLabel = normalizeText(goal.previewGoalLabel);
  const resolvedGoalLabel = selectedGoalLabel || previewGoalLabel;

  if (goal.fitDecision === 'fits' && selectedGoalLabel) {
    return {
      key: 'goal_fit',
      topic: 'goal',
      tone: 'positive',
      collapsedTitle: buildGoalTitle(selectedGoalLabel, 'strong'),
      expandedBullets: uniqueLines([
        `This product is the clearest match for your ${selectedGoalLabel} goal`,
        'The strongest visible label signals line up well with that goal',
      ]),
      isExpandable: true,
    };
  }

  if (goal.fitDecision === 'mixed' && selectedGoalLabel) {
    return {
      key: 'goal_fit',
      topic: 'goal',
      tone: 'neutral',
      collapsedTitle: buildGoalTitle(selectedGoalLabel, 'soft'),
      expandedBullets: uniqueLines([
        `There is meaningful support for your ${selectedGoalLabel} goal`,
        'The fit is promising, but not fully clean yet',
      ]),
      isExpandable: true,
    };
  }

  if (goal.fitDecision === 'does_not_fit' && selectedGoalLabel) {
    return {
      key: 'goal_fit',
      topic: 'goal',
      tone: 'caution',
      collapsedTitle: buildGoalTitle(selectedGoalLabel, 'weak'),
      expandedBullets: uniqueLines([
        `The current product signals do not line up strongly with your ${selectedGoalLabel} goal`,
        'You may want a product with clearer goal support',
      ]),
      isExpandable: true,
    };
  }

  if (goal.previewTopTier === 'strong_match' && resolvedGoalLabel) {
    return {
      key: 'goal_fit',
      topic: 'goal',
      tone: 'positive',
      collapsedTitle: buildGoalTitle(resolvedGoalLabel, 'strong'),
      expandedBullets: uniqueLines([
        `This product looks most related to your ${resolvedGoalLabel} goal`,
        'The strongest visible label signals point in that direction',
      ]),
      isExpandable: true,
    };
  }

  if (goal.previewTopTier === 'related' && resolvedGoalLabel) {
    return {
      key: 'goal_fit',
      topic: 'goal',
      tone: 'neutral',
      collapsedTitle: buildGoalTitle(resolvedGoalLabel, 'soft'),
      expandedBullets: uniqueLines([
        `There is some support for your ${resolvedGoalLabel} goal`,
        'A stronger goal match would need clearer or more complete evidence',
      ]),
      isExpandable: true,
    };
  }

  return {
    key: 'goal_fit',
    topic: 'goal',
    tone: 'neutral',
    collapsedTitle: 'Need more context for a stronger match',
    expandedBullets: uniqueLines([
      'The current label does not point clearly to one goal yet',
      'A clearer goal match needs stronger ingredient or dose support',
    ]),
    isExpandable: true,
  };
};

const buildSupportInsight = (
  personalInsight: TopSectionPersonalInsightInput,
  banner: TopSectionBannerPresentation | null,
): TopSectionInsightPresentation | null => {
  const conflictSummary = normalizeText(personalInsight.conflictSummary);
  if (conflictSummary && banner?.kind !== 'overlap') {
    return {
      key: 'personal_overlap',
      topic: 'overlap',
      tone: 'caution',
      collapsedTitle: 'May overlap with your saved supplements',
      expandedBullets: uniqueLines([
        conflictSummary,
        'Review ingredient overlap before adding this product to your stack',
      ]),
      isExpandable: true,
    };
  }

  const supportLabels = personalInsight.supportLabels
    .map((label) => normalizeText(label))
    .filter(Boolean);
  if (supportLabels.length === 0) return null;

  const joinedLabels = joinLabels(supportLabels.map((label) => lowerFirst(label)));
  const collapsedTitle =
    supportLabels.length === 1
      ? buildGoalTitle(supportLabels[0], 'strong')
      : `Supports your ${joinedLabels} goals`;

  return {
    key: 'personal_support',
    topic: 'support',
    tone: 'positive',
    collapsedTitle,
    expandedBullets: uniqueLines([
      `Top support areas from the current label: ${joinLabels(supportLabels)}`,
      'These support signals come from the visible ingredient and dose pattern',
    ]),
    isExpandable: true,
  };
};

const buildAllergyInsight = (
  allergy: TopSectionAllergyInput,
  banner: TopSectionBannerPresentation | null,
): TopSectionInsightPresentation | null => {
  if (banner?.kind === 'allergy') return null;

  const summary = normalizeText(allergy.summary);
  if (/no allergy or restriction settings saved yet/i.test(summary)) {
    return {
      key: 'allergy_insight',
      topic: 'allergy',
      tone: 'neutral',
      collapsedTitle: 'Allergy preferences not set',
      expandedBullets: uniqueLines([
        'Save your allergy or ingredient restrictions to compare products automatically',
        summary || null,
      ]),
      isExpandable: true,
    };
  }

  if (
    allergy.status === 'pending' ||
    normalizeText(allergy.reasonCode).toUpperCase() === 'NORMALIZED_PRODUCT_ALLERGY_FLAGS_NOT_ATTACHED'
  ) {
    return {
      key: 'allergy_insight',
      topic: 'allergy',
      tone: 'neutral',
      collapsedTitle: 'Allergy check is still loading',
      expandedBullets: uniqueLines([
        summary || 'We are still attaching allergen coverage for this product',
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
        summary || 'This label does not show enough detail to confirm an allergy check yet',
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
      summary || 'This product does not appear to match your saved allergy settings',
      allergy.evidenceTexts.length > 0 ? `Checked against: ${joinLabels(allergy.evidenceTexts)}` : null,
    ]),
    isExpandable: true,
  };
};

const buildDoseInsight = (dose: TopSectionDoseInput): TopSectionInsightPresentation => {
  const details = uniqueLines([
    dose.productDoseText,
    dose.productDirectionsText,
    dose.status === 'unavailable' ? 'This label does not show enough dose detail to compare yet' : null,
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
          dose.productDoseText || 'The visible dose lines up well with normal daily use',
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
          dose.productDoseText || 'The visible dose may run on the lighter side',
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
          dose.productDoseText || 'The visible dose looks stronger than a basic daily baseline',
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
        collapsedTitle: 'Daily dose is listed on the label',
        expandedBullets: uniqueLines([
          dose.productDoseText || 'The label shows a visible dose and serving pattern',
          dose.productDirectionsText,
        ]),
        isExpandable: true,
      };
  }
};

const buildSafetyInsight = (
  safety: TopSectionSafetyInput,
  banner: TopSectionBannerPresentation | null,
): TopSectionInsightPresentation | null => {
  if (banner?.kind === 'safety') return null;

  const warning = normalizeText(safety.warningText);
  const watchout = normalizeText(safety.watchoutText);
  if (!warning && !watchout) return null;

  return {
    key: 'safety',
    topic: 'safety',
    tone: 'caution',
    collapsedTitle: 'May need extra caution before use',
    expandedBullets: uniqueLines([
      warning,
      watchout,
      'Check the product label and your personal health context before use',
    ]),
    isExpandable: true,
  };
};

const isLowSignalInsight = (insight: TopSectionInsightPresentation): boolean => {
  if (insight.topic === 'goal' && insight.collapsedTitle === 'Need more context for a stronger match') {
    return true;
  }
  if (insight.topic === 'allergy' && insight.collapsedTitle === 'Allergy preferences not set') {
    return true;
  }
  if (
    insight.topic === 'dose' &&
    (insight.collapsedTitle === 'Daily dose is listed on the label'
      || insight.collapsedTitle === 'Dose comparison unavailable')
  ) {
    return true;
  }
  return false;
};

export const buildAnalysisTopSectionPresentation = (input: {
  goal: TopSectionHeroInput;
  personalInsight: TopSectionPersonalInsightInput;
  allergy: TopSectionAllergyInput;
  dose: TopSectionDoseInput;
  safety: TopSectionSafetyInput;
}): TopSectionPresentation => {
  const banner = buildBanner(input);
  const hero = buildHero({ goal: input.goal, banner });
  const candidateInsights = [
    buildGoalInsight(input.goal),
    buildSupportInsight(input.personalInsight, banner),
    buildAllergyInsight(input.allergy, banner),
    buildDoseInsight(input.dose),
    buildSafetyInsight(input.safety, banner),
  ].filter((row): row is TopSectionInsightPresentation => Boolean(row));

  const highSignalInsights = candidateInsights.filter((row) => !isLowSignalInsight(row));
  const insights = (
    highSignalInsights.length > 0
      ? highSignalInsights
      : candidateInsights.slice(0, 1)
  ).slice(0, 4);

  return {
    hero,
    banner,
    insights,
  };
};
