import nonSupplementGoalGating from '@/data/personalization/non_supplement_goal_gating.v1.json';

type NonSupplementGoalGatingFile = {
  version: 'v1';
  excludedSourceZipPaths: string[];
  excludedBrandPhrases: string[];
  excludedTitlePhrases: string[];
  sourceZipSpecificExcludedTitlePhrases: Record<string, string[]>;
  supplementOverrideTitlePhrases: string[];
};

type GateRuleHit = {
  type: 'source_zip' | 'brand_phrase' | 'title_phrase' | 'supplement_override';
  value: string;
};

export type NonSupplementGoalGateDecision = {
  shouldGate: boolean;
  confidence: 'high' | 'none';
  reasonCode: 'out_of_scope_non_supplement' | null;
  matchedRules: GateRuleHit[];
};

const GATING_RULES = nonSupplementGoalGating as NonSupplementGoalGatingFile;
const SOURCE_ZIP_SUPPLEMENT_OVERRIDE_ALLOWLIST = new Set([
  'capsule',
  'capsules',
  'tablet',
  'tablets',
  'softgel',
  'softgels',
  'soft-gel',
  'soft-gels',
  'soft gel',
  'soft gels',
  'gummies',
  'extract',
  'enzyme',
  'enzymes',
  'probiotic',
  'cfu',
  'protein powder',
  'whey protein',
  'whey',
  'isolate',
  'collagen',
  'creatine',
  'l-carnitine',
  'carnitine',
  'bcaa',
  'amino acid',
  'greens powder',
  'fat burner',
  'fat-burner',
  'thermogenic',
  'pre-workout',
  'pre workout',
  'post-workout',
  'post workout',
]);

const normalizeText = (value: string | null | undefined): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const includesPhrase = (corpus: string, phrase: string): boolean => {
  if (!phrase) return false;
  return corpus.includes(normalizeText(phrase));
};

export const assessNonSupplementGoalGate = (params: {
  title?: string | null;
  brandName?: string | null;
  sourceZipPath?: string | null;
}): NonSupplementGoalGateDecision => {
  const title = normalizeText(params.title);
  const brandName = normalizeText(params.brandName);
  const sourceZipPath = normalizeText(params.sourceZipPath);
  const titleCorpus = title;
  const brandCorpus = brandName;

  const matchedRules: GateRuleHit[] = [];

  if (sourceZipPath && GATING_RULES.excludedSourceZipPaths.some((entry) => normalizeText(entry) === sourceZipPath)) {
    matchedRules.push({ type: 'source_zip', value: params.sourceZipPath ?? '' });
  }

  for (const phrase of GATING_RULES.excludedBrandPhrases) {
    if (brandCorpus && includesPhrase(brandCorpus, phrase)) {
      matchedRules.push({ type: 'brand_phrase', value: phrase });
    }
  }

  for (const phrase of GATING_RULES.excludedTitlePhrases) {
    if (titleCorpus && includesPhrase(titleCorpus, phrase)) {
      matchedRules.push({ type: 'title_phrase', value: phrase });
    }
  }

  const sourceSpecificTitlePhrases = sourceZipPath
    ? GATING_RULES.sourceZipSpecificExcludedTitlePhrases[sourceZipPath] ?? []
    : [];
  for (const phrase of sourceSpecificTitlePhrases) {
    if (titleCorpus && includesPhrase(titleCorpus, phrase)) {
      matchedRules.push({ type: 'title_phrase', value: phrase });
    }
  }

  const overrideRules: GateRuleHit[] = [];
  for (const phrase of GATING_RULES.supplementOverrideTitlePhrases) {
    if (titleCorpus && includesPhrase(titleCorpus, phrase)) {
      overrideRules.push({ type: 'supplement_override', value: phrase });
    }
  }

  if (matchedRules.length === 0) {
    return {
      shouldGate: false,
      confidence: 'none',
      reasonCode: null,
      matchedRules: [],
    };
  }

  const hasSourceZipMatch = matchedRules.some((rule) => rule.type === 'source_zip');
  const effectiveOverrideRules = hasSourceZipMatch
    ? overrideRules.filter((rule) => SOURCE_ZIP_SUPPLEMENT_OVERRIDE_ALLOWLIST.has(normalizeText(rule.value)))
    : overrideRules;

  if (effectiveOverrideRules.length > 0) {
    return {
      shouldGate: false,
      confidence: 'none',
      reasonCode: null,
      matchedRules: [...matchedRules, ...effectiveOverrideRules],
    };
  }

  return {
    shouldGate: true,
    confidence: 'high',
    reasonCode: 'out_of_scope_non_supplement',
    matchedRules,
  };
};

export const getNonSupplementGoalGatingRules = () => GATING_RULES;
