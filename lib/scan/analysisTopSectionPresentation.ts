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

const buildSupportTitle = (goalLabel?: string | null) => {
  const goal = lowerFirst(goalLabel);
  if (!goal) return 'Supports your health goals';
  if (goal === 'immunity') return 'Supports your immunity health';
  return `Supports your ${goal} goal`;
};

const buildHero = (goal: TopSectionHeroInput): TopSectionHeroPresentation => {
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
      chip: 'Not a strong fit for your goal',
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
  const supportLabels = personalInsight.supportLabels
    .map((label) => normalizeText(label))
    .filter(Boolean);
  if (supportLabels.length === 0) return null;

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
      `Top support areas from the current label: ${joinLabels(supportLabels)}.`,
      'These support signals come from the visible ingredient and dose pattern.',
    ]),
    isExpandable: true,
  };
};

const buildAllergyInsight = (
  allergy: TopSectionAllergyInput,
  banner: TopSectionBannerPresentation | null,
): TopSectionInsightPresentation | null => {
  if (banner) return null;

  const summary = normalizeText(allergy.summary);
  const reasonCode = normalizeText(allergy.reasonCode).toUpperCase();

  if (/no allergy or restriction settings saved yet/i.test(summary)) {
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
      summary || 'This product does not appear to match your saved allergy settings.',
      allergy.evidenceTexts.length > 0 ? `Checked against: ${joinLabels(allergy.evidenceTexts)}.` : null,
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
          dose.productDoseText || 'The visible dose lines up well with normal daily use.',
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
          dose.productDoseText || 'The visible dose may run on the lighter side.',
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
          dose.productDoseText || 'The visible dose looks stronger than a basic daily baseline.',
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
        collapsedTitle: 'Dose is shown, but hard to compare',
        expandedBullets: uniqueLines([
          dose.productDoseText || 'The label shows dose, but the comparison is still not specific enough.',
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

  return {
    key: 'safety',
    topic: 'safety',
    tone: 'caution',
    collapsedTitle: 'May need extra caution before use',
    expandedBullets: uniqueLines([
      warning,
      watchout,
      'Check the product label and your personal health context before use.',
    ]),
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
  const hero = buildHero(input.goal);
  const insights = [
    buildSupportInsight(input.personalInsight),
    buildAllergyInsight(input.allergy, banner),
    buildDoseInsight(input.dose),
    buildOverlapInsight(input.personalInsight),
    buildSafetyInsight(input.safety),
  ]
    .filter((row): row is TopSectionInsightPresentation => Boolean(row))
    .slice(0, 4);

  return {
    hero,
    banner,
    insights,
  };
};
