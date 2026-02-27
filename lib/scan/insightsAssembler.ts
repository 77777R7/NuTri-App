import type { FactsDTO, IngredientInsight, LayerTag, InsightsDTO } from '@/shared/types/scan-insights';
import type { ScoreBundleV4 } from '@/types/scoreBundle';

const toKey = (value: string | null | undefined): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const asSentence = (value: string): string => (/[^.!?]$/.test(value.trim()) ? `${value.trim()}.` : value.trim());

export const toRbfBand = (factor: number | null): IngredientInsight['rbf']['band'] => {
  if (typeof factor !== 'number' || !Number.isFinite(factor)) return 'unknown';
  if (factor >= 1.1) return 'high';
  if (factor >= 0.9) return 'normal';
  return 'low';
};

export const toConfidenceTier = (
  matchScore: number | null,
  evidenceGrade: string | null,
): 'high' | 'medium' | 'low' | 'none' => {
  const grade = typeof evidenceGrade === 'string' ? evidenceGrade.trim().toUpperCase() : null;
  if (typeof matchScore === 'number' && matchScore >= 0.55 && (grade === 'A' || grade === 'B')) return 'high';
  if ((typeof matchScore === 'number' && matchScore >= 0.4) || grade === 'C') return 'medium';
  if (typeof matchScore === 'number' && matchScore >= 0.35) return 'low';
  return 'none';
};

type ScoreFormSignal = {
  ingredientId: string | null;
  ingredientName: string;
  formKey: string | null;
  reasonCode: string | null;
  formLabel: string | null;
  matchScore: number | null;
  evidenceGrade: string | null;
  effectiveFactor: number | null;
  doseSignal:
    | {
        status: string;
        dailyAmount: number | null;
        unit: string | null;
      }
    | null;
};

const extractScoreSignals = (bundle: ScoreBundleV4 | null): ScoreFormSignal[] => {
  if (!bundle || !bundle.explain || typeof bundle.explain !== 'object') return [];
  const evidence = bundle.explain.evidence as Record<string, unknown> | undefined;
  const rawSignals = Array.isArray(evidence?.formSignals) ? (evidence?.formSignals as Array<Record<string, unknown>>) : [];
  const rawDose = Array.isArray(evidence?.ingredientDoseSignals)
    ? (evidence?.ingredientDoseSignals as Array<Record<string, unknown>>)
    : [];

  const doseByName = new Map<string, ScoreFormSignal['doseSignal']>();
  rawDose.forEach((row) => {
    const key = toKey(typeof row.ingredientName === 'string' ? row.ingredientName : '');
    if (!key) return;
    doseByName.set(key, {
      status: typeof row.status === 'string' ? row.status : 'unknown',
      dailyAmount: typeof row.dailyAmount === 'number' ? row.dailyAmount : null,
      unit: typeof row.unit === 'string' ? row.unit : null,
    });
  });

  return rawSignals
    .map((row) => ({
      ingredientId: typeof row.ingredientId === 'string' ? row.ingredientId : null,
      ingredientName: typeof row.ingredientName === 'string' ? row.ingredientName : '',
      formKey: typeof row.formKey === 'string' ? row.formKey : null,
      reasonCode: typeof row.reasonCode === 'string' ? row.reasonCode : null,
      formLabel: typeof row.formLabel === 'string' ? row.formLabel : null,
      matchScore: typeof row.matchScore === 'number' ? row.matchScore : null,
      evidenceGrade: typeof row.evidenceGrade === 'string' ? row.evidenceGrade : null,
      effectiveFactor: typeof row.effectiveFactor === 'number' ? row.effectiveFactor : null,
      doseSignal: doseByName.get(toKey(typeof row.ingredientName === 'string' ? row.ingredientName : '')) ?? null,
    }))
    .filter((row) => row.ingredientName);
};

type ReviewedSegments = Record<string, string[]> | null | undefined;

const isUnspecifiedFormSignal = (params: { formKey?: string | null; reasonCode?: string | null }): boolean => {
  const normalizedFormKey = String(params.formKey ?? '').trim().toLowerCase();
  const normalizedReason = String(params.reasonCode ?? '').trim().toUpperCase();
  return normalizedFormKey === 'unspecified' || normalizedReason === 'FORM_NOT_DISCLOSED';
};

const pickReasonFromSegments = (segments: ReviewedSegments, rbfBand: IngredientInsight['rbf']['band']): string | null => {
  if (!segments) return null;
  const byPriority =
    rbfBand === 'high'
      ? ['absorption', 'solubility', 'tolerability', 'caveats']
      : rbfBand === 'low'
        ? ['caveats', 'absorption', 'tolerability', 'solubility']
        : ['caveats', 'tolerability', 'absorption', 'solubility'];

  for (const key of byPriority) {
    const first = segments[key]?.[0];
    if (typeof first === 'string' && first.trim()) return first.trim();
  }
  return null;
};

export const buildWhyBullets = (params: {
  ingredientName: string;
  formText: string | null;
  formSource: 'facts' | 'inferred' | 'none';
  formKey?: string | null;
  reasonCode?: string | null;
  formLabel: string | null;
  matchScore: number | null;
  evidenceGrade: string | null;
  rbfFactor: number | null;
  rbfBand: IngredientInsight['rbf']['band'];
  doseSignal: ScoreFormSignal['doseSignal'];
  reviewedSegments?: ReviewedSegments;
}): { bullets: string[]; layerTags: LayerTag[] } => {
  const bullets: string[] = [];
  const tags = new Set<LayerTag>();
  const unspecifiedForm = isUnspecifiedFormSignal({
    formKey: params.formKey ?? null,
    reasonCode: params.reasonCode ?? null,
  });
  const inferredSpecificForm = Boolean(params.formSource === 'inferred' && params.formLabel && !unspecifiedForm);

  if (params.formText) {
    bullets.push(asSentence(`Label lists the form as "${params.formText}"`));
    tags.add('Facts');
  } else if (inferredSpecificForm) {
    const scorePart = typeof params.matchScore === 'number' ? ` (match score ${params.matchScore.toFixed(2)})` : '';
    bullets.push(asSentence(`Detected "${params.formLabel}" from reviewed matching${scorePart}`));
    tags.add('Dataset');
  } else {
    bullets.push(asSentence('Form is not disclosed in this record, so scoring keeps a conservative neutral form assumption'));
    tags.add('Facts');
  }

  if (unspecifiedForm) {
    bullets.push(asSentence('RBF remains neutral (1.00) because chemical form is not disclosed'));
    tags.add('Dataset');
  } else if (typeof params.rbfFactor === 'number') {
    bullets.push(
      asSentence(
        `RBF is ${params.rbfFactor.toFixed(2)} (${params.rbfBand} band; High>=1.10, Normal 0.90-1.09, Low<0.90) from the reviewed dataset`,
      ),
    );
    tags.add('Dataset');
  } else {
    bullets.push(asSentence('No verified relative bioavailability signal is available for this ingredient yet'));
    tags.add('Dataset');
  }

  const reason = pickReasonFromSegments(params.reviewedSegments, params.rbfBand);
  if (reason && !unspecifiedForm) {
    bullets.push(asSentence(`Why this band: ${reason}`));
    tags.add('ReviewedKB');
  } else {
    bullets.push(
      asSentence('Why this band: this estimate comes from reviewed evidence for the detected form; individual response varies'),
    );
    tags.add('Dataset');
  }

  if (params.doseSignal?.status && params.doseSignal.status !== 'unknown') {
    const amountPart =
      typeof params.doseSignal.dailyAmount === 'number' && params.doseSignal.unit
        ? `daily ${params.doseSignal.dailyAmount} ${params.doseSignal.unit}`
        : null;
    bullets.push(
      asSentence(
        `Dose check: ${params.doseSignal.status.replace(/_/g, ' ')}${amountPart ? ` (${amountPart})` : ''}`,
      ),
    );
    tags.add('Dataset');
  } else {
    bullets.push(asSentence('Dose check is limited because daily frequency is not available in this record'));
    tags.add('Facts');
  }

  return {
    bullets: bullets.slice(0, 4),
    layerTags: Array.from(tags),
  };
};

export const assembleInsightsDTO = (params: {
  facts: FactsDTO | null;
  scoreBundle: ScoreBundleV4 | null;
  reviewedSegmentsByIngredient?: Record<string, ReviewedSegments>;
}): InsightsDTO | null => {
  if (!params.facts) return null;

  const scoreSignals = extractScoreSignals(params.scoreBundle);
  const signalByKey = new Map<string, ScoreFormSignal>();
  scoreSignals.forEach((signal) => {
    const key = toKey(signal.ingredientName);
    if (!key) return;
    const existing = signalByKey.get(key);
    const existingScore = existing?.matchScore ?? -1;
    const nextScore = signal.matchScore ?? -1;
    if (!existing || nextScore > existingScore) signalByKey.set(key, signal);
  });

  const actives = params.facts.ingredients.actives ?? [];
  const selected = actives.slice(0, 3);
  const insights: IngredientInsight[] = selected.map((active) => {
    const key = toKey(active.name);
    const signal = signalByKey.get(key) ?? null;

    const matchScore = signal?.matchScore ?? null;
    const evidenceGrade = signal?.evidenceGrade ?? null;
    const confidenceTier = toConfidenceTier(matchScore, evidenceGrade);
    const rbfFactor = signal?.effectiveFactor ?? null;
    const rbfBand = toRbfBand(rbfFactor);

    const formSource: IngredientInsight['form']['source'] = active.formText
      ? 'facts'
      : signal?.formLabel && !isUnspecifiedFormSignal({ formKey: signal.formKey, reasonCode: signal.reasonCode })
        ? 'inferred'
        : 'none';
    const formText =
      active.formText ??
      (signal?.formLabel && !isUnspecifiedFormSignal({ formKey: signal.formKey, reasonCode: signal.reasonCode })
        ? signal.formLabel
        : null);

    const reviewedSegments = params.reviewedSegmentsByIngredient?.[key] ?? null;
    const whyPayload = buildWhyBullets({
      ingredientName: active.name,
      formText: active.formText ?? null,
      formSource,
      formKey: signal?.formKey ?? null,
      reasonCode: signal?.reasonCode ?? null,
      formLabel: signal?.formLabel ?? null,
      matchScore,
      evidenceGrade,
      rbfFactor,
      rbfBand,
      doseSignal: signal?.doseSignal ?? null,
      reviewedSegments,
    });

    return {
      name: active.name,
      ingredientId: signal?.ingredientId ?? null,
      form: {
        text: formText,
        source: formSource,
        matchScore,
        evidenceGrade,
      },
      rbf: {
        factor: rbfFactor,
        band: rbfBand,
      },
      dose: {
        dailyAmount: signal?.doseSignal?.dailyAmount ?? null,
        unit: signal?.doseSignal?.unit ?? null,
        status:
          signal?.doseSignal?.status === 'below_typical' ||
          signal?.doseSignal?.status === 'within_typical' ||
          signal?.doseSignal?.status === 'above_typical'
            ? signal.doseSignal.status
            : 'unknown',
      },
      whyBullets: whyPayload.bullets,
      layerTags: whyPayload.layerTags,
      confidenceNote: `Confidence is ${confidenceTier} based on form match quality and evidence grade.`,
    };
  });

  return {
    meta: {
      datasetVersion: params.scoreBundle?.provenance?.datasetVersion ?? null,
    },
    keyIngredients: {
      selected: insights.map((insight) => ({ ingredientName: insight.name, ingredientId: insight.ingredientId ?? null })),
      selectionReason: 'Top label actives with available dose/form evidence.',
    },
    keyIngredientsInsights: insights,
    assumptions: {
      dailyMultiplierSource: 'unknown',
      dailyMultiplierReliability: 'unknown',
      notes: ['Daily multiplier assumptions are inherited from score v4 explain when available.'],
    },
    summary: null,
  };
};
