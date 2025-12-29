export type InsightProductType =
  | 'b_complex'
  | 'omega3_fish_oil'
  | 'vitamin_d'
  | 'probiotic'
  | 'single_active'
  | 'multi_active_general'
  | 'unknown';

export type InsightCandidate = {
  name: string;
  shortName: string;
  normalized: string;
  doseText: string;
  amount: number | null;
  unit: string | null;
  dvPercent: number | null;
  doseValueMg: number | null;
  hasNumericDose: boolean;
};

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

export function normalizeIngredientName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9\s.-]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function shortenIngredientName(name: string) {
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

export function formatCompactNumber(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.00$/, '').replace(/\.0$/, '');
}

export function formatDoseText(amount?: number | null, unit?: string | null, dvPercent?: number | null) {
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

export function toDoseMg(amount?: number | null, unit?: string | null) {
  if (amount == null || !unit) return null;
  const unitLower = unit.toLowerCase();
  if (unitLower === 'mg') return amount;
  if (unitLower === 'mcg' || unitLower === 'ug' || unitLower === '\u00b5g') return amount / 1000;
  if (unitLower === 'g') return amount * 1000;
  return null;
}

export function detectProductType(candidates: InsightCandidate[]): InsightProductType {
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

export function isRiskCandidate(candidate: InsightCandidate) {
  if (candidate.dvPercent != null && candidate.dvPercent >= 100) return true;
  if (candidate.doseValueMg != null && candidate.doseValueMg >= 100) return true;
  return RISK_KEYWORDS.some((keyword) => candidate.normalized.includes(keyword));
}

export function hasFormSignal(candidate: InsightCandidate) {
  return FORM_KEYWORDS.some((keyword) => candidate.normalized.includes(keyword));
}

export function scoreCandidate(candidate: InsightCandidate, type: InsightProductType, maxDoseMg: number, maxDv: number) {
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

export function selectCoverActives(ranked: InsightCandidate[], totalCount: number) {
  if (totalCount <= 2) return ranked.slice(0, totalCount);
  return ranked.slice(0, 2);
}

export function extractFormSignals(candidates: InsightCandidate[]) {
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

export function selectHighlightCandidates({
  ranked,
  productType,
}: {
  ranked: InsightCandidate[];
  productType: InsightProductType;
}) {
  const picks: InsightCandidate[] = [];
  const used = new Set<string>();
  const isBComplex = productType === 'b_complex';

  const addPick = (candidate?: InsightCandidate | null) => {
    if (!candidate) return;
    if (used.has(candidate.normalized)) return;
    picks.push(candidate);
    used.add(candidate.normalized);
  };

  const findBy = (predicate: (candidate: InsightCandidate) => boolean) =>
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
  const matchesBPriority = (candidate: InsightCandidate) =>
    B_COMPLEX_PRIORITY.some((signal) => candidate.normalized.includes(signal));

  if (productType === 'omega3_fish_oil') {
    pickByPrioritySignals(['epa']);
    pickByPrioritySignals(['dha']);
  }

  if (productType === 'probiotic') {
    addPick(findBy((candidate) => candidate.unit?.toLowerCase() === 'cfu' || candidate.normalized.includes('cfu')));
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
