import type { LabelDraft } from '@/backend/src/labelAnalysis';

export type LabelProductType =
  | 'b_complex'
  | 'omega3_fish_oil'
  | 'vitamin_d'
  | 'probiotic'
  | 'single_active'
  | 'multi_active_general'
  | 'unknown';

export type LabelCandidate = {
  name: string;
  shortName: string;
  normalized: string;
  doseText: string;
  amount: number | null;
  unit: string | null;
  dvPercent: number | null;
  doseValueMg: number | null;
  hasNumericDose: boolean;
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

const RISK_KEYWORDS = [
  'vitamin a',
  'vitamin d',
  'vitamin e',
  'vitamin k',
  'retinol',
  'folate',
  'folic',
  'niacin',
  'iron',
  'selenium',
];

const FORM_KEYWORDS = [
  'methyl',
  'methylcobalamin',
  'p-5-p',
  'p5p',
  'pantethine',
  'glycinate',
  'chelate',
  'citrate',
  'liposomal',
];

const B_COMPLEX_PRIORITY = [
  'b12',
  'cobalamin',
  'folate',
  'folic acid',
  'b6',
  'pyridox',
  'p-5-p',
  'p5p',
  'niacin',
  'b3',
  'biotin',
  'b5',
  'pantethine',
  'pantothen',
  'b2',
  'riboflavin',
  'b1',
  'thiamine',
];

function isNoiseLabelIngredientName(name?: string | null) {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 2) return true;
  return LABEL_NAME_NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function normalizeIngredientName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9\s.-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function shortenIngredientName(name: string) {
  const normalized = normalizeIngredientName(name);
  if (/(epa|eicosapentaenoic)/i.test(normalized)) return 'EPA';
  if (/(dha|docosahexaenoic)/i.test(normalized)) return 'DHA';
  if (/omega[-\s]?3/i.test(normalized)) return 'Omega-3';
  if (/fish oil/i.test(normalized)) return 'Fish Oil';
  if (/probiotic/i.test(normalized)) return 'Probiotic';
  if (/lactobacillus/i.test(normalized)) return 'Lactobacillus';
  if (/bifidobacter/i.test(normalized)) return 'Bifidobacterium';
  if (/(vitamin\s*d3|cholecalciferol|\bd3\b)/i.test(normalized)) return 'Vitamin D3';
  if (/vitamin\s*d\b/i.test(normalized)) return 'Vitamin D';
  if (/folate|folic\s*acid/i.test(normalized)) return 'Folate';
  if (/biotin/i.test(normalized)) return 'Biotin';
  if (/niacinamide|niacin/i.test(normalized)) return 'B3';
  if (/thiamin/i.test(normalized)) return 'B1';
  if (/riboflavin/i.test(normalized)) return 'B2';
  if (/pantethine|pantothenic/i.test(normalized)) return 'B5';
  if (/pyridox/i.test(normalized)) return 'B6';
  if (/cobalamin/i.test(normalized)) return 'B12';
  const vitaminMatch = normalized.match(/\bvitamin\s*([a-z]|\d{1,2})\b/);
  if (vitaminMatch) {
    return `Vitamin ${vitaminMatch[1].toUpperCase()}`;
  }
  const bMatch = normalized.match(/\bb\s*(\d{1,2})\b/);
  if (bMatch) return `B${bMatch[1]}`;
  const cleaned = name.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter(Boolean);
  return words.slice(0, 2).join(' ');
}

function formatCompactNumber(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.00$/, '').replace(/\.0$/, '');
}

function formatDoseText(amount?: number | null, unit?: string | null, dvPercent?: number | null) {
  if (amount != null && unit) {
    const unitLower = unit.toLowerCase();
    if (unitLower === 'cfu') {
      return `${formatCompactNumber(amount)} CFU`;
    }
    const valueText = formatCompactNumber(amount);
    const unitText = unitLower === 'iu' ? 'IU' : unit;
    return `${valueText} ${unitText}`;
  }
  if (dvPercent != null) return `${dvPercent}% DV`;
  return '';
}

function toDoseMg(amount?: number | null, unit?: string | null) {
  if (amount == null || !unit) return null;
  const unitLower = unit.toLowerCase();
  if (unitLower === 'mg') return amount;
  if (unitLower === 'mcg' || unitLower === 'ug' || unitLower === '\u00b5g') return amount / 1000;
  if (unitLower === 'g') return amount * 1000;
  return null;
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

function detectLabelProductType(candidates: LabelCandidate[]): LabelProductType {
  const normalized = candidates.map((c) => c.normalized);
  const bSignals = [
    'b1',
    'b2',
    'b3',
    'b5',
    'b6',
    'b7',
    'b9',
    'b12',
    'thiamine',
    'riboflavin',
    'niacin',
    'pantothen',
    'pantethine',
    'pyridox',
    'biotin',
    'folate',
    'folic acid',
    'cobalamin',
  ];
  const bHits = new Set<string>();
  normalized.forEach((name) => {
    bSignals.forEach((signal) => {
      if (name.includes(signal)) bHits.add(signal);
    });
  });
  if (bHits.size >= 5) return 'b_complex';
  if (normalized.some((name) => name.includes('epa') || name.includes('dha') || name.includes('omega-3') || name.includes('fish oil'))) {
    return 'omega3_fish_oil';
  }
  if (normalized.some((name) => name.includes('vitamin d') || name.includes('d3') || name.includes('cholecalciferol'))) {
    return 'vitamin_d';
  }
  if (normalized.some((name) => name.includes('probiotic') || name.includes('lactobacillus') || name.includes('bifidobacter'))) {
    return 'probiotic';
  }
  if (candidates.length <= 2) return 'single_active';
  if (candidates.length >= 6) return 'multi_active_general';
  return 'unknown';
}

function isRiskCandidate(candidate: LabelCandidate) {
  if (candidate.dvPercent != null && candidate.dvPercent >= 100) return true;
  if (candidate.doseValueMg != null && candidate.doseValueMg >= 100) return true;
  return RISK_KEYWORDS.some((keyword) => candidate.normalized.includes(keyword));
}

function hasFormSignal(candidate: LabelCandidate) {
  return FORM_KEYWORDS.some((keyword) => candidate.normalized.includes(keyword));
}

function scoreLabelCandidate(candidate: LabelCandidate, type: LabelProductType, maxDoseMg: number, maxDv: number) {
  const doseScore =
    candidate.doseValueMg != null && maxDoseMg > 0
      ? Math.log1p(candidate.doseValueMg) / Math.log1p(maxDoseMg)
      : candidate.dvPercent != null && maxDv > 0
        ? Math.log1p(candidate.dvPercent) / Math.log1p(maxDv)
        : candidate.amount != null
          ? 0.35
          : 0.15;
  const doseWeight = 0.35;
  const formScore = hasFormSignal(candidate) ? 0.3 : 0;
  const riskScore = isRiskCandidate(candidate) ? 0.35 : 0;
  const typeBoost =
    type === 'b_complex' && B_COMPLEX_PRIORITY.some((signal) => candidate.normalized.includes(signal))
      ? 0.2
      : type === 'omega3_fish_oil' && (candidate.normalized.includes('epa') || candidate.normalized.includes('dha'))
        ? 0.25
        : type === 'probiotic' && (candidate.unit?.toLowerCase() === 'cfu' || candidate.normalized.includes('probiotic'))
          ? 0.25
          : type === 'vitamin_d' && (candidate.normalized.includes('vitamin d') || candidate.normalized.includes('d3'))
            ? 0.25
            : 0;
  const confidenceWeight = candidate.hasNumericDose ? 1 : candidate.dvPercent != null ? 0.85 : 0.6;
  return (doseScore * doseWeight + formScore + riskScore + typeBoost) * confidenceWeight;
}

function selectCoverActives(ranked: LabelCandidate[], totalCount: number) {
  if (totalCount <= 2) return ranked.slice(0, totalCount);
  return ranked.slice(0, 2);
}

function extractFormSignals(candidates: LabelCandidate[]) {
  const signals = new Set<string>();
  candidates.forEach((candidate) => {
    const name = candidate.normalized;
    if (name.includes('methylcobalamin')) signals.add('Methylcobalamin (B12)');
    if (name.includes('p-5-p') || name.includes('p5p') || name.includes('pyridoxal')) signals.add('P-5-P (B6)');
    if (name.includes('pantethine')) signals.add('Pantethine (B5)');
    if (name.includes('glycinate')) signals.add('Glycinate form');
    if (name.includes('citrate')) signals.add('Citrate form');
    if (name.includes('chelate')) signals.add('Chelated form');
    if (name.includes('liposomal')) signals.add('Liposomal form');
  });
  return Array.from(signals);
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

function selectHighlightCandidates({
  ranked,
  productType,
}: {
  ranked: LabelCandidate[];
  productType: LabelProductType;
}) {
  const picks: LabelCandidate[] = [];
  const used = new Set<string>();
  const isBComplex = productType === 'b_complex';

  const addPick = (candidate?: LabelCandidate | null) => {
    if (!candidate) return;
    if (used.has(candidate.normalized)) return;
    picks.push(candidate);
    used.add(candidate.normalized);
  };

  const findBy = (predicate: (candidate: LabelCandidate) => boolean) =>
    ranked.find((candidate) => predicate(candidate) && !used.has(candidate.normalized));
  const pickByPrioritySignals = (signals: string[]) => {
    for (const signal of signals) {
      const candidate = findBy((item) => item.normalized.includes(signal));
      if (candidate) {
        addPick(candidate);
        return;
      }
    }
  };
  const matchesBPriority = (candidate: LabelCandidate) =>
    B_COMPLEX_PRIORITY.some((signal) => candidate.normalized.includes(signal));

  if (productType === 'omega3_fish_oil') {
    pickByPrioritySignals(['epa']);
    pickByPrioritySignals(['dha']);
  }

  if (productType === 'probiotic') {
    addPick(
      findBy((candidate) => candidate.unit?.toLowerCase() === 'cfu' || candidate.normalized.includes('cfu'))
    );
    addPick(
      findBy(
        (candidate) =>
          candidate.normalized.includes('lactobacillus') || candidate.normalized.includes('bifidobacter')
      )
    );
  }

  if (productType === 'vitamin_d') {
    pickByPrioritySignals(['vitamin d', 'd3', 'cholecalciferol']);
  }

  if (picks.length < 2) {
    addPick(findBy((candidate) => isRiskCandidate(candidate) && (!isBComplex || matchesBPriority(candidate))));
  }
  if (picks.length < 2) {
    addPick(findBy((candidate) => hasFormSignal(candidate) && (!isBComplex || matchesBPriority(candidate))));
  }

  if (picks.length < 2) {
    if (isBComplex) {
      pickByPrioritySignals(B_COMPLEX_PRIORITY);
    } else {
      addPick(ranked.find((candidate) => !used.has(candidate.normalized)));
    }
  }

  if (picks.length < 3) addPick(ranked.find((candidate) => !used.has(candidate.normalized)));

  return picks;
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

  const productType = detectLabelProductType(uniqueCandidates);
  const maxDoseMg = Math.max(...uniqueCandidates.map((candidate) => candidate.doseValueMg ?? 0), 0);
  const maxDv = Math.max(...uniqueCandidates.map((candidate) => candidate.dvPercent ?? 0), 0);

  const scoredCandidates = uniqueCandidates.map((candidate) => ({
    ...candidate,
    importanceScore: scoreLabelCandidate(candidate, productType, maxDoseMg, maxDv),
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
