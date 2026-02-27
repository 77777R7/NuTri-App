import type { AnalysisBundle } from '@/types/analysisBundle';
import type { RecordFactsVM } from '@/lib/scan/recordFactsViewModel';

export const DATA_CEILING_REASONS = Object.freeze({
  MISSING_MEDICINAL_INGREDIENTS: 'MISSING_MEDICINAL_INGREDIENTS',
  MISSING_AMOUNT_FIELDS: 'MISSING_AMOUNT_FIELDS',
  PARSER_GAP_FIXABLE: 'PARSER_GAP_FIXABLE',
  MAPPING_GAP_NO_BARCODE: 'MAPPING_GAP_NO_BARCODE',
  DATA_CEILING: 'DATA_CEILING',
});

export type DataCeilingReason =
  (typeof DATA_CEILING_REASONS)[keyof typeof DATA_CEILING_REASONS];

export type DataCeilingSignal = {
  isDataCeiling: boolean;
  reason: DataCeilingReason | null;
  ingredientCount: number;
  doseCount: number;
  dataQualityFlags: string[];
};

type ResolveDataCeilingSignalParams = {
  bundle: AnalysisBundle | null | undefined;
  recordFacts?: RecordFactsVM | null;
};

const normalizeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const countDoseFromCover = (bundle: AnalysisBundle | null | undefined): number => {
  const rows = Array.isArray(bundle?.sections?.ingredients?.cover?.items)
    ? bundle.sections.ingredients.cover.items
    : [];
  return rows.reduce((acc, row) => (normalizeText(row?.dose).length > 0 ? acc + 1 : acc), 0);
};

const pickReasonFromDiagnostics = (diagnostics: string[]): DataCeilingReason => {
  const set = new Set(diagnostics.map((code) => code.toUpperCase()));
  if (set.has(DATA_CEILING_REASONS.MISSING_MEDICINAL_INGREDIENTS)) {
    return DATA_CEILING_REASONS.MISSING_MEDICINAL_INGREDIENTS;
  }
  if (set.has(DATA_CEILING_REASONS.MISSING_AMOUNT_FIELDS)) {
    return DATA_CEILING_REASONS.MISSING_AMOUNT_FIELDS;
  }
  if (set.has(DATA_CEILING_REASONS.PARSER_GAP_FIXABLE)) {
    return DATA_CEILING_REASONS.PARSER_GAP_FIXABLE;
  }
  if (set.has(DATA_CEILING_REASONS.MAPPING_GAP_NO_BARCODE)) {
    return DATA_CEILING_REASONS.MAPPING_GAP_NO_BARCODE;
  }
  return DATA_CEILING_REASONS.DATA_CEILING;
};

export const resolveDataCeilingSignal = (
  params: ResolveDataCeilingSignalParams,
): DataCeilingSignal => {
  const deterministicSignals =
    params.bundle?.meta?.deterministicSignals && typeof params.bundle.meta.deterministicSignals === 'object'
      ? params.bundle.meta.deterministicSignals
      : null;
  const ingredientCount =
    Number(deterministicSignals?.ingredientCount ?? Number.NaN);
  const doseCount =
    Number(deterministicSignals?.doseCount ?? Number.NaN);
  const normalizedIngredientCount = Number.isFinite(ingredientCount)
    ? ingredientCount
    : Number(params.recordFacts?.ingredientCount ?? (params.bundle?.sections?.ingredients?.cover?.items?.length ?? 0)) || 0;
  const normalizedDoseCount = Number.isFinite(doseCount)
    ? doseCount
    : countDoseFromCover(params.bundle);
  const sourceTypeFinal = params.bundle?.meta?.sourceTypeFinal === true;
  const isDataCeiling =
    sourceTypeFinal
    && normalizedIngredientCount === 0
    && normalizedDoseCount === 0;

  if (!isDataCeiling) {
    return {
      isDataCeiling: false,
      reason: null,
      ingredientCount: normalizedIngredientCount,
      doseCount: normalizedDoseCount,
      dataQualityFlags: [],
    };
  }

  const diagnostics = Array.isArray(deterministicSignals?.parserDiagnosticsTop)
    ? deterministicSignals.parserDiagnosticsTop.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
  const reason = pickReasonFromDiagnostics(diagnostics);
  return {
    isDataCeiling: true,
    reason,
    ingredientCount: normalizedIngredientCount,
    doseCount: normalizedDoseCount,
    dataQualityFlags: ['DATA_CEILING', reason],
  };
};

