import {
  detectProductType,
  extractFormSignals,
  formatDoseText,
  normalizeIngredientName,
  scoreCandidate,
  selectCoverActives,
  selectHighlightCandidates,
  shortenIngredientName,
  toDoseMg,
  type InsightCandidate,
  type InsightProductType,
} from './insightCandidates';

type BarcodeSource = {
  title: string;
  link: string;
  domain?: string;
  snippet?: string;
  qualityScore?: number | null;
  isHighQuality?: boolean;
};

type BarcodeIngredient = {
  name?: string | null;
  dosageValue?: number | null;
  dosageUnit?: string | null;
};

type ActiveIngredient = {
  name?: string | null;
  amount?: string | null;
};

type BrandExtraction = {
  brand?: string | null;
  product?: string | null;
  category?: string | null;
  confidence?: 'high' | 'medium' | 'low';
};

export type BarcodeInsight = {
  productType: InsightProductType;
  productName: string;
  metaLine: string;
  profileLine: string;
  coverFacts: string[];
  coverFooter?: string;
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
  evidenceSources: BarcodeSource[];
  evidenceSummary: string;
  evidenceNotes: string[];
  conflictFlags: string[];
};

const AMOUNT_REGEX = /(\d+(?:[.,]\d+)?)\s?(mcg|μg|ug|mg|g|iu|i\.u\.|cfu)\b/i;

function parseAmountUnit(text?: string | null) {
  if (!text) return null;
  const match = text.match(AMOUNT_REGEX);
  if (!match) return null;
  const rawValue = match[1].replace(/,/g, '');
  const value = Number.parseFloat(rawValue);
  if (Number.isNaN(value)) return null;
  let unit = match[2].toLowerCase();
  if (unit === 'i.u.') unit = 'iu';
  if (unit === 'μg' || unit === 'ug') unit = 'mcg';
  return { amount: value, unit };
}

function extractDomain(url?: string | null) {
  if (!url) return undefined;
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function clampText(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 3).trim()}...`;
}

function formatPrice(costPerServing?: number | null) {
  if (typeof costPerServing !== 'number' || Number.isNaN(costPerServing)) {
    return 'Price varies';
  }
  return `$${costPerServing.toFixed(2)}/serving`;
}

function buildProfileLine(productType: InsightProductType, totalActives: number, candidates: InsightCandidate[]) {
  if (productType === 'b_complex') return `B-complex formula with ${totalActives} actives.`;
  if (productType === 'omega3_fish_oil') return 'Omega-3 profile focused on EPA and DHA.';
  if (productType === 'vitamin_d') return 'Vitamin D-focused single-active formula.';
  if (productType === 'probiotic') {
    const cfuLine = candidates.find((candidate) => candidate.unit?.toLowerCase() === 'cfu');
    return cfuLine ? `Probiotic blend: ${cfuLine.shortName} ${cfuLine.doseText}.` : `Probiotic blend with ${totalActives} actives.`;
  }
  if (productType === 'single_active') {
    const first = candidates[0];
    return first ? `Single-active formula centered on ${first.shortName}.` : 'Single-active formula from sources.';
  }
  if (productType === 'multi_active_general') return `${totalActives} active ingredients detected from sources.`;
  return 'Barcode scan summary based on available sources.';
}

function buildProductName({
  productName,
  productType,
  totalActives,
  candidates,
}: {
  productName?: string | null;
  productType: InsightProductType;
  totalActives: number;
  candidates: InsightCandidate[];
}) {
  if (productName) return productName;
  if (productType === 'b_complex') return `B-Complex (${totalActives} actives)`;
  if (productType === 'omega3_fish_oil') return 'Omega-3 Fish Oil';
  if (productType === 'vitamin_d') return 'Vitamin D3';
  if (productType === 'probiotic') {
    const cfu = candidates.find((candidate) => candidate.unit?.toLowerCase() === 'cfu');
    if (cfu?.amount != null) return `Probiotic (${cfu.doseText})`;
    return 'Probiotic';
  }
  if (productType === 'multi_active_general') return `Multi-Active (${totalActives} actives)`;
  if (productType === 'single_active' && candidates[0]) return candidates[0].shortName;
  return 'Barcode Scan Result';
}

export function buildBarcodeInsights(options: {
  productInfo?: { brand?: string | null; name?: string | null; category?: string | null; image?: string | null } | null;
  efficacy?: { ingredients?: BarcodeIngredient[]; activeIngredients?: ActiveIngredient[]; primaryActive?: BarcodeIngredient | null } | null;
  safety?: { redFlags?: string[]; ulWarnings?: { ingredient: string; currentDose: string }[] } | null;
  value?: { costPerServing?: number | null } | null;
  sources?: BarcodeSource[];
  brandExtraction?: BrandExtraction | null;
}): BarcodeInsight {
  const productInfo = options.productInfo ?? {};
  const efficacy = options.efficacy ?? {};
  const safety = options.safety ?? {};
  const sources = options.sources ?? [];
  const brandExtraction = options.brandExtraction ?? null;
  const value = options.value ?? {};

  const rawCandidates: (InsightCandidate & { order: number })[] = [];

  const addCandidate = (name?: string | null, amount?: number | null, unit?: string | null) => {
    const trimmed = name?.trim();
    if (!trimmed) return;
    const normalized = normalizeIngredientName(trimmed);
    const doseText = formatDoseText(amount ?? null, unit ?? null, null);
    rawCandidates.push({
      name: trimmed,
      shortName: shortenIngredientName(trimmed),
      normalized,
      doseText: doseText || 'dose not specified',
      amount: amount ?? null,
      unit: unit ?? null,
      dvPercent: null,
      doseValueMg: toDoseMg(amount ?? null, unit ?? null),
      hasNumericDose: amount != null && !!unit,
      order: rawCandidates.length,
    });
  };

  (efficacy.ingredients ?? []).forEach((ingredient) => {
    addCandidate(ingredient.name, ingredient.dosageValue ?? null, ingredient.dosageUnit ?? null);
  });

  if (!rawCandidates.length) {
    (efficacy.activeIngredients ?? []).forEach((ingredient) => {
      const parsed = parseAmountUnit(ingredient.amount ?? null);
      addCandidate(ingredient.name, parsed?.amount ?? null, parsed?.unit ?? null);
    });
  }

  if (efficacy.primaryActive?.name) {
    const exists = rawCandidates.some(
      (candidate) => candidate.normalized === normalizeIngredientName(efficacy.primaryActive?.name ?? '')
    );
    if (!exists) {
      addCandidate(efficacy.primaryActive?.name, efficacy.primaryActive?.dosageValue ?? null, efficacy.primaryActive?.dosageUnit ?? null);
    }
  }

  const seen = new Set<string>();
  const uniqueCandidates: (InsightCandidate & { order: number })[] = [];
  let duplicateCount = 0;
  const doseConflicts = new Map<string, Set<string>>();
  const conflictFlags = new Set<string>();

  rawCandidates.forEach((candidate) => {
    const doseKey = candidate.doseText !== 'dose not specified' ? candidate.doseText : '';
    if (doseKey) {
      const doseSet = doseConflicts.get(candidate.normalized) ?? new Set<string>();
      if (doseSet.size > 0 && !doseSet.has(doseKey)) {
        conflictFlags.add('Dose values vary across sources.');
      }
      doseSet.add(doseKey);
      doseConflicts.set(candidate.normalized, doseSet);
    }

    if (seen.has(candidate.normalized)) {
      duplicateCount += 1;
      return;
    }
    seen.add(candidate.normalized);
    uniqueCandidates.push(candidate);
  });

  const totalActives = uniqueCandidates.length;
  const missingDoseCount = uniqueCandidates.filter(
    (candidate) => !candidate.hasNumericDose && candidate.dvPercent == null
  ).length;
  const hasProprietaryBlend = rawCandidates.some((candidate) => {
    const normalized = candidate.normalized;
    if (normalized.includes('proprietary')) return true;
    if (normalized.includes('blend') && !candidate.hasNumericDose) return true;
    return false;
  });

  const productType = detectProductType(uniqueCandidates);
  const maxDoseMg = Math.max(...uniqueCandidates.map((candidate) => candidate.doseValueMg ?? 0), 0);
  const maxDv = 0;
  const scoredCandidates = uniqueCandidates.map((candidate) => ({
    ...candidate,
    importanceScore: scoreCandidate(candidate, productType, maxDoseMg, maxDv),
  }));
  const ranked = [...scoredCandidates].sort((a, b) => b.importanceScore - a.importanceScore);
  const highlightCandidates = selectHighlightCandidates({ ranked, productType });
  const coverHighlights = selectCoverActives(highlightCandidates, totalActives);

  const coverFacts = coverHighlights.map((candidate) => {
    const doseLabel = candidate.doseText !== 'dose not specified' ? candidate.doseText : '';
    return doseLabel ? `${candidate.shortName} ${doseLabel}` : candidate.shortName;
  });
  const coverFooter = totalActives > coverHighlights.length ? `+${totalActives - coverHighlights.length} more` : undefined;

  const detailHighlights = highlightCandidates
    .slice(0, Math.min(3, totalActives))
    .map((candidate) => {
      const doseLabel = candidate.doseText !== 'dose not specified' ? candidate.doseText : '';
      return doseLabel ? `${candidate.name} ${doseLabel}` : candidate.name;
    });

  const barCount = totalActives >= 8 ? 2 : totalActives >= 4 ? 3 : totalActives;
  const scienceBars = ranked.slice(0, barCount).map((candidate) => ({
    name: candidate.shortName,
    amount: candidate.doseText !== 'dose not specified' ? candidate.doseText : 'See label',
    fill: Math.min(100, Math.max(12, Math.round(40 + candidate.importanceScore * 60))),
  }));
  const scienceFooter = totalActives > barCount ? `+${totalActives - barCount} more` : undefined;

  const formSignals = extractFormSignals(uniqueCandidates);
  const profileLine = buildProfileLine(productType, totalActives, ranked);

  const fullActives = [...uniqueCandidates]
    .sort((a, b) => a.order - b.order)
    .map((candidate) => ({
      name: candidate.name,
      shortName: candidate.shortName,
      doseText: candidate.doseText !== 'dose not specified' ? candidate.doseText : 'dose missing',
      hasDose: candidate.hasNumericDose || candidate.dvPercent != null,
    }));

  const sourceSummary = (() => {
    if (!sources.length) return { label: 'Low', note: 'No verified sources yet.' };
    const scores = sources.map((source) => source.qualityScore ?? 0);
    const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
    const highQualityCount = sources.filter((source) => source.isHighQuality || (source.qualityScore ?? 0) >= 70).length;
    if (highQualityCount >= 2 || average >= 70) return { label: 'High', note: 'High source confidence.' };
    if (highQualityCount >= 1 || average >= 45) return { label: 'Medium', note: 'Moderate source confidence.' };
    return { label: 'Low', note: 'Limited source confidence - verify label.' };
  })();

  const evidenceNotes: string[] = [];
  if (sourceSummary.label === 'Low') evidenceNotes.push(sourceSummary.note);
  if (missingDoseCount > 0) evidenceNotes.push(`${missingDoseCount} actives missing dose.`);
  if (duplicateCount > 0) evidenceNotes.push('Possible duplicate actives detected.');
  conflictFlags.forEach((flag) => evidenceNotes.push(flag));
  if (hasProprietaryBlend) evidenceNotes.push('Proprietary blend detected.');

  const watchout = (() => {
    const ulWarning = safety.ulWarnings?.[0];
    if (ulWarning?.ingredient && ulWarning.currentDose) {
      return clampText(`${ulWarning.ingredient} ${ulWarning.currentDose} near UL.`, 60);
    }
    const redFlag = safety.redFlags?.[0];
    if (redFlag) return clampText(redFlag, 60);
    if (missingDoseCount > 0) return clampText(`${missingDoseCount} actives missing dose.`, 60);
    if (conflictFlags.size > 0) return clampText(Array.from(conflictFlags)[0], 60);
    if (sourceSummary.label === 'Low') return clampText(sourceSummary.note, 60);
    if (hasProprietaryBlend) return 'Proprietary blend - dose not disclosed.';
    return undefined;
  })();

  const productName = buildProductName({
    productName: brandExtraction?.product ?? productInfo.name ?? null,
    productType,
    totalActives,
    candidates: ranked,
  });

  const brandLabel = clampText(brandExtraction?.brand ?? productInfo.brand ?? productName, 26);
  const categoryFallback =
    productInfo.category ?? (productType === 'unknown' ? 'supplement' : productType.replace(/_/g, ' '));
  const categoryLabel = clampText(categoryFallback, 22);
  const priceLabel = formatPrice(value.costPerServing);
  const metaLine = [brandLabel, categoryLabel, priceLabel].filter(Boolean).join(' • ') || 'Barcode scan';

  const completenessLine =
    totalActives === 0
      ? 'No actives detected from sources.'
      : missingDoseCount > 0
        ? `${totalActives} actives detected | ${missingDoseCount} without dose`
        : `${totalActives} actives detected | doses listed`;

  const evidenceSources = sources.map((source) => ({
    title: source.title,
    link: source.link,
    domain: source.domain ?? extractDomain(source.link),
    snippet: source.snippet,
    qualityScore: source.qualityScore ?? null,
    isHighQuality: source.isHighQuality,
  }));
  const evidenceSummary = sources.length
    ? `Sources: ${sources.length} • ${sourceSummary.label} confidence`
    : 'Sources: none yet';

  return {
    productType,
    productName,
    metaLine,
    profileLine,
    coverFacts,
    coverFooter,
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
    evidenceSources,
    evidenceSummary,
    evidenceNotes,
    conflictFlags: Array.from(conflictFlags),
  };
}
