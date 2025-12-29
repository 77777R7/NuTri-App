import type { LabelDraft } from '@/backend/src/labelAnalysis';
import {
  detectProductType,
  extractFormSignals,
  formatCompactNumber,
  formatDoseText,
  isRiskCandidate,
  normalizeIngredientName,
  scoreCandidate,
  selectCoverActives,
  selectHighlightCandidates,
  shortenIngredientName,
  toDoseMg,
  type InsightCandidate,
  type InsightProductType,
} from './insightCandidates';

export type LabelProductType = InsightProductType;

export type LabelCandidate = InsightCandidate & {
  order: number;
  importanceScore: number;
};

export type LabelInsight = {
  productType: LabelProductType;
  productName: string;
  metaLine: string;
  profileLine: string;
  highlights: string[];
  highlightFooter?: string;
  watchout?: string;
  scienceBars: { name: string; amount: string; fill: number }[];
  scienceFooter?: string;
  detailHighlights: string[];
  fullActives: { name: string; shortName: string; doseText: string; hasDose: boolean }[];
  totalActives: number;
  missingDoseCount: number;
  duplicateCount: number;
  hasProprietaryBlend: boolean;
  formSignals: string[];
  completenessLine: string;
};

type LabelIssue = { type: string; message?: string };

const LABEL_NAME_NOISE_PATTERNS: RegExp[] = [
  /supplement facts/i,
  /nutrition facts/i,
  /serving size/i,
  /\bamount\b/i,
  /per serving/i,
  /daily value/i,
  /% ?dv/i,
  /\bvalue\b/i,
  /(medicinal|non-medicinal) ingredients/i,
  /other ingredients/i,
  /also contains/i,
  /directions?/i,
  /warnings?/i,
  /caution/i,
  /store/i,
  /^(each|in each|chaque|dans chaque)\b.*\bcontains?\b/i,
];

const ISSUE_PRIORITY: { type: string; message: string }[] = [
  { type: 'unit_boundary_suspect', message: 'Possible unit mismatch - review label.' },
  { type: 'dose_inconsistency_or_claim', message: 'Dose claims inconsistent - review label.' },
  { type: 'non_ingredient_line_detected', message: 'Some lines may not be ingredients.' },
  { type: 'incomplete_ingredients', message: 'Some ingredients may be missing.' },
];

function isNoiseLabelIngredientName(name?: string | null) {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 2) return true;
  return LABEL_NAME_NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function getServingUnitLabel(servingSize?: string | null) {
  if (!servingSize) return 'per serving';
  const lower = servingSize.toLowerCase();
  const perMatch = lower.match(/\bper\s+([a-z0-9]+(?:\s+[a-z0-9]+)?)/);
  if (perMatch) return `per ${perMatch[1].trim()}`;
  const unitMatch = lower.match(/\b(capsule|caplet|tablet|softgel|gummy|serving|sachet|scoop|drop)\b/);
  if (unitMatch) return `per ${unitMatch[1]}`;
  return 'per serving';
}

function getExtractionQualityLabel(confidenceScore?: number | null, parseCoverage?: number | null) {
  const score = confidenceScore ?? 0;
  const coverage = parseCoverage ?? 0;
  const percent = Math.round(score * 100);
  if (score >= 0.85 && coverage >= 0.85) return { label: 'High extraction', percent };
  if (score >= 0.7 && coverage >= 0.7) return { label: 'Medium extraction', percent };
  return { label: 'Low extraction', percent };
}


function isPlaceholderLabelName(name?: string | null) {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (/^label scan result$/i.test(trimmed)) return true;
  if (/^supplement$/i.test(trimmed)) return true;
  return LABEL_NAME_NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function buildProductName({
  analysisName,
  productType,
  candidates,
  totalActives,
}: {
  analysisName?: string | null;
  productType: LabelProductType;
  candidates: LabelCandidate[];
  totalActives: number;
}) {
  if (analysisName && !isPlaceholderLabelName(analysisName)) return analysisName;
  const first = candidates[0];
  if (productType === 'b_complex') return `B-Complex (${totalActives} actives)`;
  if (productType === 'omega3_fish_oil') return 'Omega-3 Fish Oil';
  if (productType === 'vitamin_d') return 'Vitamin D3';
  if (productType === 'probiotic') {
    const cfu = candidates.find((candidate) => candidate.unit?.toLowerCase() === 'cfu');
    if (cfu?.amount != null) return `Probiotic (${formatCompactNumber(cfu.amount)} CFU)`;
    return 'Probiotic';
  }
  if (productType === 'multi_active_general') return `Multi-Active (${totalActives} actives)`;
  if (productType === 'single_active' && first) return shortenIngredientName(first.name);
  return first ? shortenIngredientName(first.name) : 'Label Scan Result';
}


function buildWatchout({
  issues,
  hasProprietaryBlend,
  missingDoseCount,
  duplicateCount,
  ranked,
}: {
  issues: LabelIssue[];
  hasProprietaryBlend: boolean;
  missingDoseCount: number;
  duplicateCount: number;
  ranked: LabelCandidate[];
}) {
  for (const issue of ISSUE_PRIORITY) {
    if (issues.some((item) => item.type === issue.type)) return issue.message;
  }
  if (hasProprietaryBlend) return 'Proprietary blend: doses not fully disclosed.';
  if (missingDoseCount > 0) return `${missingDoseCount} actives missing dose`;
  if (duplicateCount > 0) return 'Possible bilingual duplicates detected.';
  const riskPick = ranked.find((candidate) => isRiskCandidate(candidate));
  if (riskPick) {
    const doseText = riskPick.doseText && riskPick.doseText !== 'dose not specified' ? ` ${riskPick.doseText}` : '';
    return `${riskPick.shortName}${doseText} stands out - review total intake.`;
  }
  return undefined;
}

function buildProfileLine(productType: LabelProductType, totalActives: number, candidates: LabelCandidate[]) {
  if (productType === 'b_complex') return `B-complex formula with ${totalActives} actives.`;
  if (productType === 'omega3_fish_oil') return 'Omega-3 profile focused on EPA and DHA.';
  if (productType === 'vitamin_d') return 'Vitamin D-focused single-active formula.';
  if (productType === 'probiotic') {
    const cfuLine = candidates.find((candidate) => candidate.unit?.toLowerCase() === 'cfu');
    return cfuLine ? `Probiotic blend: ${cfuLine.shortName} ${cfuLine.doseText}.` : `Probiotic blend with ${totalActives} actives.`;
  }
  if (productType === 'single_active') {
    const first = candidates[0];
    return first ? `Single-active formula centered on ${first.shortName}.` : 'Single-active formula from label evidence.';
  }
  if (productType === 'multi_active_general') return `${totalActives} active ingredients detected on the label.`;
  return 'Label-only summary based on extracted ingredients.';
}

export function buildLabelInsights(options: {
  draft?: LabelDraft | null;
  issues?: LabelIssue[] | null;
  analysisName?: string | null;
}): LabelInsight {
  const draft = options.draft;
  const issues = options.issues ?? draft?.issues ?? [];
  const analysisName = options.analysisName ?? null;

  if (!draft) {
    return {
      productType: 'unknown',
      productName: analysisName ?? 'Label Scan Result',
      metaLine: 'Label scan',
      profileLine: 'Label-only summary based on extracted ingredients.',
      highlights: [],
      scienceBars: [],
      detailHighlights: [],
      fullActives: [],
      totalActives: 0,
      missingDoseCount: 0,
      duplicateCount: 0,
      hasProprietaryBlend: false,
      formSignals: [],
      completenessLine: 'No actives detected.',
    };
  }

  const rawCandidates = draft.ingredients
    .map((ingredient, index) => {
      const rawName = ingredient.name?.trim();
      if (!rawName || isNoiseLabelIngredientName(rawName)) return null;
      const normalized = normalizeIngredientName(rawName);
      const doseText = formatDoseText(ingredient.amount ?? null, ingredient.unit ?? null, ingredient.dvPercent ?? null);
      return {
        name: rawName,
        shortName: shortenIngredientName(rawName),
        normalized,
        doseText: doseText || 'dose not specified',
        amount: ingredient.amount ?? null,
        unit: ingredient.unit ?? null,
        dvPercent: ingredient.dvPercent ?? null,
        doseValueMg: toDoseMg(ingredient.amount ?? null, ingredient.unit ?? null),
        hasNumericDose: ingredient.amount != null && !!ingredient.unit,
        order: index,
      };
    })
    .filter((item): item is Omit<LabelCandidate, 'importanceScore'> => Boolean(item));

  const seen = new Set<string>();
  const uniqueCandidates: LabelCandidate[] = [];
  let duplicateCount = 0;

  for (const candidate of rawCandidates) {
    if (seen.has(candidate.normalized)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(candidate.normalized);
    uniqueCandidates.push({ ...candidate, importanceScore: 0 });
  }

  const totalActives = uniqueCandidates.length;
  const missingDoseCount = uniqueCandidates.filter(
    (candidate) => !candidate.hasNumericDose && candidate.dvPercent == null
  ).length;
  const hasProprietaryBlend = rawCandidates.some((candidate) => {
    const normalized = candidate.normalized;
    if (normalized.includes('proprietary')) return true;
    if (normalized.includes('blend') && !candidate.hasNumericDose && candidate.dvPercent == null) return true;
    return false;
  });

  const productType = detectProductType(uniqueCandidates);
  const maxDoseMg = Math.max(...uniqueCandidates.map((candidate) => candidate.doseValueMg ?? 0), 0);
  const maxDv = Math.max(...uniqueCandidates.map((candidate) => candidate.dvPercent ?? 0), 0);

  const scoredCandidates = uniqueCandidates.map((candidate) => ({
    ...candidate,
    importanceScore: scoreCandidate(candidate, productType, maxDoseMg, maxDv),
  }));

  const ranked = [...scoredCandidates].sort((a, b) => b.importanceScore - a.importanceScore);
  const highlightCandidates = selectHighlightCandidates({ ranked, productType });
  const coverHighlights = selectCoverActives(highlightCandidates, totalActives);
  const highlightFooter = totalActives > coverHighlights.length ? `+${totalActives - coverHighlights.length} more` : undefined;

  const detailHighlights = highlightCandidates
    .slice(0, Math.min(3, totalActives))
    .map((candidate) => {
      const doseLabel = candidate.doseText !== 'dose not specified' ? candidate.doseText : '';
      return doseLabel ? `${candidate.name} ${doseLabel}` : candidate.name;
    });

  const coverHighlightLines = coverHighlights.map((candidate) => {
    const doseLabel = candidate.doseText !== 'dose not specified' ? candidate.doseText : '';
    return doseLabel ? `${candidate.shortName} ${doseLabel}` : candidate.shortName;
  });

  const formSignals = extractFormSignals(uniqueCandidates);
  const watchout = buildWatchout({
    issues,
    hasProprietaryBlend,
    missingDoseCount,
    duplicateCount,
    ranked,
  });

  const barCount = totalActives >= 8 ? 2 : totalActives >= 4 ? 3 : totalActives;
  const scienceBars = ranked.slice(0, barCount).map((candidate) => ({
    name: candidate.shortName,
    amount: candidate.doseText && candidate.doseText !== 'dose not specified' ? candidate.doseText : 'See label',
    fill: Math.min(100, Math.max(12, Math.round(40 + candidate.importanceScore * 60))),
  }));
  const scienceFooter = totalActives > barCount ? `+${totalActives - barCount} more` : undefined;

  const fullActives = [...uniqueCandidates]
    .sort((a, b) => a.order - b.order)
    .map((candidate) => ({
      name: candidate.name,
      shortName: candidate.shortName,
      doseText: candidate.doseText && candidate.doseText !== 'dose not specified' ? candidate.doseText : 'dose missing',
      hasDose: candidate.hasNumericDose || candidate.dvPercent != null,
    }));

  const extraction = getExtractionQualityLabel(draft.confidenceScore ?? 0, draft.parseCoverage ?? 0);
  const metaLine = `${totalActives || 'No'} actives | ${getServingUnitLabel(draft.servingSize)} | ${extraction.label} ${extraction.percent}%`;
  const profileLine = buildProfileLine(productType, totalActives, ranked);
  const completenessLine =
    totalActives === 0
      ? 'No actives detected.'
      : missingDoseCount > 0
        ? `${totalActives} actives detected | ${missingDoseCount} without dose`
        : `${totalActives} actives detected | doses listed`;

  return {
    productType,
    productName: buildProductName({ analysisName, productType, candidates: ranked, totalActives }),
    metaLine,
    profileLine,
    highlights: coverHighlightLines,
    highlightFooter,
    watchout,
    scienceBars,
    scienceFooter,
    detailHighlights,
    fullActives,
    totalActives,
    missingDoseCount,
    duplicateCount,
    hasProprietaryBlend,
    formSignals,
    completenessLine,
  };
}
