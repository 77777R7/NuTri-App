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

type RankedInsight = TopSectionInsightPresentation & {
  priority: number;
  lowSignal?: boolean;
  required?: boolean;
};

const normalizeText = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() ?? '';

const ensurePeriod = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};

const lowerFirst = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  return normalized.charAt(0).toLowerCase() + normalized.slice(1);
};

const uniqueLines = (values: (string | null | undefined)[], limit = 3): string[] => {
  const lines = Array.from(new Set(values.map((value) => ensurePeriod(value)).filter(Boolean)));
  return lines.slice(0, limit);
};

const joinLabels = (values: string[], limit = 3): string => {
  const unique = Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean))).slice(0, limit);

  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
};

const safeGoalSummary = (goalLabel?: string | null, kind: 'best' | 'some' | 'weak' = 'best') => {
  const goal = normalizeText(goalLabel);
  if (!goal) {
    if (kind === 'weak') return 'Not a strong match for your goal';
    if (kind === 'some') return 'Shows some support for your goals';
    return 'Best aligned with your goals';
  }
  if (kind === 'weak') return `Not a strong match for your ${goal} goal`;
  if (kind === 'some') return `Shows some support for your ${goal} goal`;
  return `Best aligned with your ${goal} goal`;
};

const buildHero = (goal: TopSectionHeroInput): TopSectionHeroPresentation => {
  const selectedGoalLabel = normalizeText(goal.selectedGoalLabel);
  const previewGoalLabel = normalizeText(goal.previewGoalLabel);
  const resolvedGoalLabel = selectedGoalLabel || previewGoalLabel;

  if (goal.fitDecision === 'fits' && selectedGoalLabel) {
    return {
      tone: 'positive',
      chip: 'Strong fit for you',
      summary: safeGoalSummary(selectedGoalLabel, 'best'),
    };
  }

  if (goal.fitDecision === 'mixed' && selectedGoalLabel) {
    return {
      tone: 'neutral',
      chip: 'Could work for you',
      summary: safeGoalSummary(selectedGoalLabel, 'some'),
    };
  }

  if (goal.fitDecision === 'does_not_fit' && selectedGoalLabel) {
    return {
      tone: 'caution',
      chip: 'Not a strong fit for your goal',
      summary: safeGoalSummary(selectedGoalLabel, 'weak'),
    };
  }

  if (goal.previewTopTier === 'strong_match' && resolvedGoalLabel) {
    return {
      tone: 'positive',
      chip: 'Strong fit for you',
      summary: safeGoalSummary(resolvedGoalLabel, 'best'),
    };
  }

  if (goal.previewTopTier === 'related' && resolvedGoalLabel) {
    return {
      tone: 'neutral',
      chip: 'Could work for you',
      summary: safeGoalSummary(resolvedGoalLabel, 'some'),
    };
  }

  if (goal.previewTopTier === 'weak_match' && resolvedGoalLabel) {
    return {
      tone: 'neutral',
      chip: 'Need a bit more context',
      summary: safeGoalSummary(resolvedGoalLabel, 'weak'),
    };
  }

  return {
    tone: 'neutral',
    chip: 'Need a bit more context',
    summary: 'We need a little more detail to judge this product',
  };
};

const hasAllergyConflict = (allergy: TopSectionAllergyInput): boolean => {
  const matched = allergy.matchedLabels.map((value) => normalizeText(value)).filter(Boolean);
  if (matched.length > 0) return true;

  const summary = normalizeText(allergy.summary).toLowerCase();
  if (!summary) return false;
  const positiveSafePatterns = [
    'does not appear to match',
    'no allergy or restriction settings saved yet',
    'still loading',
    'needs more label detail',
    'not enough label detail',
  ];
  if (positiveSafePatterns.some((pattern) => summary.includes(pattern))) return false;
  return /conflict|matched your saved settings|matched your saved allergies|may conflict/i.test(summary);
};

const buildBanner = (allergy: TopSectionAllergyInput): TopSectionBannerPresentation | null => {
  if (!hasAllergyConflict(allergy)) return null;
  return {
    kind: 'allergy',
    tone: 'caution',
    title: 'Ingredients may conflict with your allergies',
  };
};

const buildSupportInsight = (personalInsight: TopSectionPersonalInsightInput): RankedInsight | null => {
  const supportLabels = personalInsight.supportLabels.map((label) => normalizeText(label)).filter(Boolean);
  if (supportLabels.length === 0) return null;

  const single = supportLabels.length === 1 ? supportLabels[0] : null;
  const collapsedTitle = single
    ? single.toLowerCase() === 'immunity'
      ? 'Supports your immunity health'
      : `Supports your ${lowerFirst(single)} goal`
    : `Supports your ${joinLabels(supportLabels.map((label) => lowerFirst(label)))} goals`;

  return {
    key: 'personal_support',
    topic: 'support',
    tone: 'positive',
    collapsedTitle,
    expandedBullets: uniqueLines([
      `Visible ingredients may support ${joinLabels(supportLabels)}.`,
      'This looks more aligned with those goals than with an unrelated baseline.',
    ]),
    isExpandable: true,
    priority: 100,
  };
};

const buildAllergyInsight = (allergy: TopSectionAllergyInput, banner: TopSectionBannerPresentation | null): RankedInsight | null => {
  if (banner?.kind === 'allergy') return null;

  const summary = normalizeText(allergy.summary);
  const upperReason = normalizeText(allergy.reasonCode).toUpperCase();

  if (/no allergy or restriction settings saved yet/i.test(summary)) {
    return {
      key: 'allergy_insight',
      topic: 'allergy',
      tone: 'neutral',
      collapsedTitle: 'Add your allergy preferences for automatic checks',
      expandedBullets: uniqueLines([
        'Save your allergy or ingredient preferences so NuTri can check products automatically.',
        summary,
      ]),
      isExpandable: true,
      priority: 28,
      lowSignal: true,
    };
  }

  if (allergy.status === 'pending' || upperReason === 'NORMALIZED_PRODUCT_ALLERGY_FLAGS_NOT_ATTACHED') {
    return {
      key: 'allergy_insight',
      topic: 'allergy',
      tone: 'neutral',
      collapsedTitle: 'Allergy check is still loading',
      expandedBullets: uniqueLines([
        summary || 'NuTri is still attaching allergy coverage for this product.',
      ]),
      isExpandable: true,
      priority: 34,
      lowSignal: true,
    };
  }

  if (/needs more label detail/i.test(summary) || /not enough label detail/i.test(summary)) {
    return {
      key: 'allergy_insight',
      topic: 'allergy',
      tone: 'neutral',
      collapsedTitle: 'Not enough label detail for an allergy check',
      expandedBullets: uniqueLines([
        summary || 'This product label does not show enough detail for a full allergy check yet.',
      ]),
      isExpandable: true,
      priority: 32,
      lowSignal: true,
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
    priority: 92,
  };
};

const buildDoseInsight = (dose: TopSectionDoseInput): RankedInsight => {
  const goalLabel = normalizeText(dose.goalLabel);

  if (dose.status === 'unavailable') {
    return {
      key: 'dosage_context',
      topic: 'dose',
      tone: 'neutral',
      collapsedTitle: 'Dose comparison unavailable',
      expandedBullets: uniqueLines([
        'This label does not show enough dose detail to compare yet.',
      ]),
      isExpandable: true,
      priority: 30,
      lowSignal: true,
    };
  }

  switch (dose.assessment) {
    case 'aligned':
      return {
        key: 'dosage_context',
        topic: 'dose',
        tone: 'positive',
        collapsedTitle: goalLabel ? `Dose looks aligned for ${lowerFirst(goalLabel)}` : 'Dose looks aligned for daily use',
        expandedBullets: uniqueLines([
          dose.productDoseText || 'The visible dose looks aligned for everyday use.',
          dose.productDirectionsText,
        ]),
        isExpandable: true,
        priority: 84,
      };
    case 'low':
      return {
        key: 'dosage_context',
        topic: 'dose',
        tone: 'neutral',
        collapsedTitle: 'Dose may be lighter than expected',
        expandedBullets: uniqueLines([
          dose.productDoseText || 'The visible dose may run a little lighter than expected.',
          dose.productDirectionsText,
        ]),
        isExpandable: true,
        priority: 74,
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
        priority: 76,
      };
    case 'unclear':
    case 'unknown':
    default:
      return {
        key: 'dosage_context',
        topic: 'dose',
        tone: 'neutral',
        collapsedTitle: 'Dose comparison unavailable',
        expandedBullets: uniqueLines([
          dose.productDoseText || 'The label shows a dose, but it is still hard to compare.',
          dose.productDirectionsText,
        ]),
        isExpandable: true,
        priority: 36,
        lowSignal: true,
      };
  }
};

const buildOverlapInsight = (personalInsight: TopSectionPersonalInsightInput): RankedInsight | null => {
  const conflictSummary = normalizeText(personalInsight.conflictSummary);
  if (!conflictSummary) return null;

  return {
    key: 'personal_overlap',
    topic: 'overlap',
    tone: 'neutral',
    collapsedTitle: 'May overlap with your saved supplements',
    expandedBullets: uniqueLines([
      conflictSummary,
      'Review your saved stack before adding this product.',
    ]),
    isExpandable: true,
    priority: 68,
  };
};

const buildSafetyInsight = (safety: TopSectionSafetyInput): RankedInsight | null => {
  const warning = normalizeText(safety.warningText);
  const watchout = normalizeText(safety.watchoutText);
  if (!warning && !watchout) return null;

  const collapsedTitle = /pregnan|nurs|blood thinner|surgery|medication|clinician|healthcare professional/i.test(`${warning} ${watchout}`)
    ? 'Check with a healthcare professional first'
    : 'May need extra caution based on the label';

  return {
    key: 'safety',
    topic: 'safety',
    tone: 'caution',
    collapsedTitle,
    expandedBullets: uniqueLines([
      warning,
      watchout,
      'Review the label and your personal health context before use.',
    ]),
    isExpandable: true,
    priority: 90,
    required: true,
  };
};

const buildLowSignalFallback = (): RankedInsight => ({
  key: 'limited_personalization',
  topic: 'support',
  tone: 'neutral',
  collapsedTitle: 'Limited personalized signals right now',
  expandedBullets: uniqueLines([
    'We need a little more product detail or saved context to judge this item more clearly.',
  ]),
  isExpandable: true,
  priority: 12,
  lowSignal: true,
});

const orderRows = (rows: RankedInsight[]): RankedInsight[] => {
  const order: TopSectionInsightTopic[] = ['support', 'allergy', 'dose', 'safety', 'overlap'];
  return [...rows].sort((a, b) => {
    const topicDelta = order.indexOf(a.topic) - order.indexOf(b.topic);
    if (topicDelta !== 0) return topicDelta;
    return b.priority - a.priority;
  });
};

const capRows = (rows: RankedInsight[]): RankedInsight[] => {
  let ordered = orderRows(rows);
  if (ordered.length <= 4) return ordered;

  const safetyRow = ordered.find((row) => row.topic === 'safety');
  if (!safetyRow) return ordered.slice(0, 4);

  const kept = ordered.filter((row) => row.topic !== 'overlap');
  if (kept.length <= 4) return orderRows(kept);

  ordered = kept.filter((row) => !(row.lowSignal && row.topic === 'dose'));
  if (ordered.length <= 4) return orderRows(ordered);

  ordered = ordered.filter((row) => !(row.lowSignal && row.topic === 'allergy'));
  if (ordered.length <= 4) return orderRows(ordered);

  return orderRows(ordered.slice(0, 4));
};

export const resolveAnalysisTopSectionDefaultExpandedKey = (
  presentation: TopSectionPresentation,
  preferredKey?: string | null,
): string | null => {
  if (preferredKey && presentation.insights.some((row) => row.key === preferredKey)) return preferredKey;
  return presentation.insights[0]?.key ?? null;
};

export const buildAnalysisTopSectionSyncKey = (input: {
  productIdentity?: string | null;
  hero: TopSectionHeroPresentation;
  banner: TopSectionBannerPresentation | null;
  insights: TopSectionInsightPresentation[];
}): string => {
  const identity = normalizeText(input.productIdentity) || 'unknown-product';
  const insightSignature = input.insights.map((row) => `${row.key}:${row.collapsedTitle}`).join('|');
  return [identity, input.hero.chip, input.hero.summary, input.banner?.title ?? 'no-banner', insightSignature].join('::');
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

  const support = buildSupportInsight(input.personalInsight);
  const allergy = buildAllergyInsight(input.allergy, banner);
  const dose = buildDoseInsight(input.dose);
  const overlap = buildOverlapInsight(input.personalInsight);
  const safety = buildSafetyInsight(input.safety);

  const highSignalRows = [support, allergy, dose, safety, overlap].filter(
    (row): row is RankedInsight => Boolean(row && !row.lowSignal),
  );

  let insights = capRows(highSignalRows);

  if (insights.length < 4) {
    const lowSignalRows = [allergy, dose].filter((row): row is RankedInsight => Boolean(row?.lowSignal));
    for (const row of lowSignalRows) {
      if (insights.some((existing) => existing.key === row.key)) continue;
      insights.push(row);
      if (insights.length >= 4) break;
    }
    insights = orderRows(insights);
  }

  if (insights.length === 0) {
    insights = [buildLowSignalFallback()];
  }

  return {
    hero,
    banner,
    insights: insights.map(({ priority, lowSignal, required, ...rest }) => rest),
  };
};
