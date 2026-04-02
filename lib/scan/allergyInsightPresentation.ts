type AllergyInsightDetail = {
  flag: string;
  source: 'active_ingredient' | 'inactive_ingredient' | 'label_disclosure' | 'warning';
  matchedText?: string | null;
  confidence: 'high' | 'medium' | 'low';
};

type AllergyInsightPayload = {
  status: 'ready' | 'pending' | 'unavailable';
  reasonCode?: 'ALLERGY_PROFILE_NOT_ATTACHED' | 'NORMALIZED_PRODUCT_ALLERGY_FLAGS_NOT_ATTACHED' | null;
  summary: string;
  matchedAllergyFlags: string[];
  matchedRestrictions: string[];
  details: AllergyInsightDetail[];
};

export type AllergyInsightPresentation = {
  title: string;
  body: string;
  tone: 'positive' | 'caution' | 'neutral';
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

const formatFlagLabel = (flag: string): string => {
  const normalized = normalizeText(flag).toLowerCase();
  if (!normalized) return '';
  return DISPLAY_LABELS[normalized] ?? normalized.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};

const joinLabels = (values: string[], limit: number = 3): string => {
  const unique = Array.from(new Set(values.map(formatFlagLabel).filter(Boolean)));
  if (unique.length === 0) return '';
  if (unique.length <= limit) return unique.join(', ');
  const visible = unique.slice(0, limit);
  return `${visible.join(', ')} +${unique.length - visible.length} more`;
};

const joinEvidence = (details: AllergyInsightDetail[]): string => {
  const evidence = Array.from(
    new Set(details.map((detail) => normalizeText(detail.matchedText)).filter(Boolean)),
  );
  if (evidence.length === 0) return '';
  return evidence.slice(0, 2).join(' • ');
};

export const buildAllergyInsightPresentation = (
  insight: AllergyInsightPayload | null | undefined,
): AllergyInsightPresentation => {
  if (!insight) {
    return {
      title: 'Allergy check unavailable',
      body: 'We could not load an allergy comparison for this product yet.',
      tone: 'neutral',
    };
  }

  const matchedLabels = joinLabels([
    ...(insight.matchedAllergyFlags ?? []),
    ...(insight.matchedRestrictions ?? []),
  ]);
  const evidence = joinEvidence(insight.details ?? []);

  if (matchedLabels) {
    return {
      title: 'Potential allergy conflict',
      body: evidence
        ? `Matched your saved settings: ${matchedLabels}. Found in ${evidence}.`
        : `Matched your saved settings: ${matchedLabels}.`,
      tone: 'caution',
    };
  }

  if (insight.status === 'pending' || insight.reasonCode === 'NORMALIZED_PRODUCT_ALLERGY_FLAGS_NOT_ATTACHED') {
    return {
      title: 'Allergy check pending',
      body: normalizeText(insight.summary) || 'We are still attaching allergen coverage for this product.',
      tone: 'neutral',
    };
  }

  if (/no allergy or restriction settings saved yet/i.test(insight.summary)) {
    return {
      title: 'Add allergy preferences',
      body: 'Save your allergy or ingredient restrictions to compare products automatically.',
      tone: 'neutral',
    };
  }

  if (/needs more label detail/i.test(insight.summary)) {
    return {
      title: 'Allergy check needs more detail',
      body: normalizeText(insight.summary) || 'This label does not show enough detail to confirm yet.',
      tone: 'neutral',
    };
  }

  return {
    title: 'No saved allergy conflicts found',
    body: normalizeText(insight.summary) || 'This product does not appear to match your saved allergy settings.',
    tone: 'positive',
  };
};
