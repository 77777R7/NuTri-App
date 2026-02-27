import type { FactsDTO } from '@/shared/types/scan-insights';
import type { AnalysisBundle } from '@/types/analysisBundle';

export type RecordFactIngredientRow = {
  name: string;
  doseLine: string | null;
  sourceDataset: 'lnhpd' | 'dsld' | 'label_record' | 'web' | 'unknown';
  confidence: 'high' | 'medium';
};

export type RecordFactsVM = {
  ingredientRows: RecordFactIngredientRow[];
  ingredientCount: number;
  topIngredient: RecordFactIngredientRow | null;
  servingSizeText: string | null;
  perServingDoseLine: string | null;
  directionsPresent: boolean;
  warningsPresent: boolean;
  regulatoryIds: {
    npn: string | null;
    dsldLabelId: string | null;
  };
  dataQualityFlags: string[];
};

type BuildRecordFactsViewModelParams = {
  bundle: AnalysisBundle | null | undefined;
  facts: FactsDTO | null | undefined;
};

const normalizeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const formatDoseFromFacts = (amount: unknown, unit: unknown): string | null => {
  const parsed = Number(amount);
  const normalizedUnit = normalizeText(unit);
  if (!Number.isFinite(parsed) || !normalizedUnit) return null;
  return `${parsed} ${normalizedUnit}`;
};

const uniq = (rows: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
};

const resolveBundleRows = (
  bundle: AnalysisBundle | null | undefined,
): RecordFactIngredientRow[] => {
  const sourceDataset = String(bundle?.meta?.sourceType ?? 'unknown');
  const rows = Array.isArray(bundle?.sections?.ingredients?.cover?.items)
    ? bundle.sections.ingredients.cover.items
    : [];
  return rows
    .map((row) => {
      const name = normalizeText(row?.name);
      if (!name) return null;
      const doseLine = normalizeText(row?.dose) || null;
      return {
        name,
        doseLine,
        sourceDataset:
          sourceDataset === 'lnhpd' ||
          sourceDataset === 'dsld' ||
          sourceDataset === 'label_record' ||
          sourceDataset === 'web'
            ? sourceDataset
            : 'unknown',
        confidence: bundle?.meta?.sourceTypeFinal === false ? 'medium' : 'high',
      } satisfies RecordFactIngredientRow;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
};

const resolveFactsRows = (
  facts: FactsDTO | null | undefined,
): RecordFactIngredientRow[] => {
  const sourceDataset = String(facts?.meta?.source ?? 'unknown');
  const rows = Array.isArray(facts?.ingredients?.actives) ? facts.ingredients.actives : [];
  return rows
    .map((row) => {
      const name = normalizeText(row?.name);
      if (!name) return null;
      return {
        name,
        doseLine: formatDoseFromFacts(row?.amount, row?.unit),
        sourceDataset:
          sourceDataset === 'lnhpd' ||
          sourceDataset === 'dsld' ||
          sourceDataset === 'label_record' ||
          sourceDataset === 'web'
            ? sourceDataset
            : 'unknown',
        confidence: 'medium',
      } satisfies RecordFactIngredientRow;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
};

export const buildRecordFactsViewModel = (
  params: BuildRecordFactsViewModelParams,
): RecordFactsVM => {
  const bundleRows = resolveBundleRows(params.bundle);
  const factsRows = resolveFactsRows(params.facts);
  const ingredientRows = (bundleRows.length > 0 ? bundleRows : factsRows).slice(0, 6);
  const topIngredient = ingredientRows[0] ?? null;

  const factsPerServingLine = (() => {
    const activeRows = Array.isArray(params.facts?.ingredients?.actives)
      ? params.facts.ingredients.actives
      : [];
    const firstWithDose = activeRows.find((row) => formatDoseFromFacts(row?.amount, row?.unit) !== null);
    if (!firstWithDose) return null;
    const dose = formatDoseFromFacts(firstWithDose.amount, firstWithDose.unit);
    if (!dose) return null;
    const name = normalizeText(firstWithDose.name);
    return name ? `${name} ${dose}` : dose;
  })();
  const perServingDoseLine =
    factsPerServingLine ||
    ingredientRows.find((row) => normalizeText(row.doseLine).length > 0)?.doseLine ||
    null;

  const servingSizeText = normalizeText(params.facts?.serving?.servingSizeText) || null;
  const directionsPresent =
    normalizeText(params.facts?.usage?.directionsText).length > 0 ||
    (Array.isArray(params.bundle?.sections?.usage?.detail?.scheduleFromLabel) &&
      params.bundle.sections.usage.detail.scheduleFromLabel.length > 0);
  const warningsPresent =
    (Array.isArray(params.facts?.safety?.labelWarnings) && params.facts.safety.labelWarnings.length > 0) ||
    (Array.isArray(params.bundle?.sections?.safety?.detail?.warnings) &&
      params.bundle.sections.safety.detail.warnings.length > 0);

  const identityType = normalizeText(params.bundle?.meta?.authoritativeIdentity?.type);
  const identityValue = normalizeText(params.bundle?.meta?.authoritativeIdentity?.value);
  const npn = identityType === 'npn' ? identityValue : null;
  const dsldLabelId = identityType === 'dsldLabelId' ? identityValue : null;

  const dataQualityFlags = uniq([
    ...(Array.isArray(params.facts?.dataQuality?.missingReasons)
      ? params.facts?.dataQuality?.missingReasons.map((item) => normalizeText(item))
      : []),
    ...(directionsPresent ? [] : ['missing_directions']),
    ...(warningsPresent ? [] : ['missing_warnings']),
    ...(perServingDoseLine ? [] : ['missing_amounts']),
  ]).filter(Boolean);

  return {
    ingredientRows,
    ingredientCount: ingredientRows.length,
    topIngredient,
    servingSizeText,
    perServingDoseLine,
    directionsPresent,
    warningsPresent,
    regulatoryIds: {
      npn,
      dsldLabelId,
    },
    dataQualityFlags,
  };
};
