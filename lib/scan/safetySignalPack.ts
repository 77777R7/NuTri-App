import { lookupFoundationForIngredient } from '@/lib/knowledge/foundationLookup';
import type { FactsDTO } from '@/shared/types/scan-insights';
import type {
  AnalysisBundle,
  SafetySignalItem,
  SafetySignalPack,
  SafetyUlAmount,
  SafetyUlEntry,
} from '@/types/analysisBundle';

type BuildSafetySignalPackParams = {
  bundle: AnalysisBundle | null | undefined;
  facts: FactsDTO | null | undefined;
  ingredientNames?: string[] | null;
};

const MAX_LABEL_WARNINGS = 6;
const MAX_UL_ENTRIES = 3;
const MAX_UL_SIGNALS = 3;
const MAX_ODS_INTERACTIONS = 3;
const MAX_ODS_WATCHOUTS = 3;
const MAX_QUALITY_NOTES = 3;

const INTERACTION_PATTERN =
  /\b(interact|interaction|medication|medicine|drug|warfarin|blood thinner|anticoagulant|contraindicat|avoid with|separate by|consult)\b/i;

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const normalizeLowerSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

const buildSignalId = (prefix: string, text: string) => {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized ? `${prefix}:${normalized}` : `${prefix}:signal`;
};

const createSignal = (params: {
  prefix: string;
  text: string;
  scope: SafetySignalItem['scope'];
  source: SafetySignalItem['source'];
  reasonCode?: string | null;
  sourceUrl?: string | null;
  riskLevel?: string | null;
}): SafetySignalItem | null => {
  const text = normalizeText(params.text);
  if (!text) return null;
  const reasonCode = normalizeText(params.reasonCode);
  const sourceUrl = normalizeText(params.sourceUrl);
  const riskLevel = normalizeText(params.riskLevel);
  return {
    id: buildSignalId(params.prefix, text),
    text,
    scope: params.scope,
    source: params.source,
    ...(reasonCode ? { reasonCode } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(riskLevel ? { riskLevel } : {}),
  };
};

const dedupeSignals = (items: SafetySignalItem[], maxCount: number): SafetySignalItem[] => {
  const out: SafetySignalItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const text = normalizeText(item?.text);
    if (!text) continue;
    const key = `${item.scope}|${item.source}|${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, text });
    if (out.length >= maxCount) break;
  }
  return out;
};

const parseAmountText = (value: unknown): SafetyUlAmount => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { value, unit: null, text: String(value) };
  }
  if (value && typeof value === 'object') {
    const row = value as Partial<SafetyUlAmount>;
    const parsed = Number(row.value);
    const unit = normalizeText(row.unit).toLowerCase();
    const text = normalizeText(row.text) || (Number.isFinite(parsed) ? String(parsed) : '');
    return {
      value: Number.isFinite(parsed) ? parsed : null,
      unit: unit || null,
      text: text || null,
    };
  }
  const text = normalizeText(value);
  if (!text) {
    return { value: null, unit: null, text: null };
  }
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*(mcg|μg|µg|ug|mg|g|iu|ml)?/i);
  const amount = match ? Number(match[1]) : Number.NaN;
  const unitRaw = match?.[2] ?? null;
  const unit = unitRaw ? normalizeText(unitRaw).toLowerCase() : null;
  return {
    value: Number.isFinite(amount) ? amount : null,
    unit,
    text,
  };
};

const normalizeUlScope = (value: unknown): SafetyUlEntry['scope'] => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'total_intake') return 'total_intake';
  if (normalized === 'supplements_only') return 'supplements_only';
  if (normalized === 'supplements_or_fortified_only') return 'supplements_or_fortified_only';
  return 'unknown';
};

const normalizeRiskBand = (value: unknown): SafetyUlEntry['riskBand'] => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'low') return 'low';
  if (normalized === 'moderate') return 'moderate';
  if (normalized === 'high') return 'high';
  return 'unknown';
};

const normalizeEvidenceSource = (value: unknown, reasonCode: string): SafetyUlEntry['evidenceSource'] => {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === 'NIH_ODS_UL') return 'NIH_ODS_UL';
  if (normalized === 'LEGACY_UL_META') return 'LEGACY_UL_META';
  if (reasonCode === 'ODS_UL_MATCHED') return 'NIH_ODS_UL';
  if (reasonCode === 'LEGACY_UL_META_MATCHED') return 'LEGACY_UL_META';
  return 'UNKNOWN';
};

const inferNutrientKey = (data: Record<string, unknown>): string => {
  const canonical = normalizeText(data.nutrientKey || data.ingredientCanonicalKey || data.canonicalKey);
  if (canonical) return normalizeLowerSlug(canonical);
  const display = normalizeText(data.displayName || data.ingredient || data.ingredientName || data.name);
  const fallback = normalizeLowerSlug(display);
  return fallback || 'unknown_nutrient';
};

const normalizeUlAmount = (value: unknown, fallbackText: unknown): SafetyUlAmount => {
  if (value && typeof value === 'object') {
    const row = value as Partial<SafetyUlAmount>;
    const parsed = Number(row.value);
    const unit = normalizeText(row.unit);
    const text = normalizeText(row.text) || normalizeText(fallbackText);
    return {
      value: Number.isFinite(parsed) ? parsed : null,
      unit: unit || null,
      text: text || null,
    };
  }
  return parseAmountText(fallbackText);
};

const buildUlExplainLine = (entry: {
  displayName: string;
  currentDailyAmount: SafetyUlAmount;
  ulDailyAmount: SafetyUlAmount;
  riskBand: SafetyUlEntry['riskBand'];
  scope: SafetyUlEntry['scope'];
}): string => {
  const current = normalizeText(entry.currentDailyAmount.text);
  const ul = normalizeText(entry.ulDailyAmount.text);
  const risk = entry.riskBand !== 'unknown' ? `${entry.riskBand} risk` : '';
  const scope = entry.scope !== 'unknown' ? entry.scope.replace(/_/g, ' ') : '';
  const suffix = [risk, scope].filter(Boolean).join(', ');
  return [
    `${entry.displayName}: current ${current}`,
    `UL ${ul}`,
    suffix,
  ]
    .filter(Boolean)
    .join(' | ');
};

const normalizeUlEntry = (row: unknown): SafetyUlEntry | null => {
  if (!row || typeof row !== 'object') return null;
  const data = row as Record<string, unknown>;
  const displayName = normalizeText(data.displayName || data.ingredient || data.ingredientName || data.name);
  const nutrientKey = inferNutrientKey(data);
  const reasonCode = normalizeText(data.reasonCode || data.reason);
  const currentDailyAmount = normalizeUlAmount(data.currentDailyAmount, data.currentDose || data.dailyAmount || data.dose);
  const ulDailyAmount = normalizeUlAmount(data.ulDailyAmount, data.ulLimit || data.upperLimit || data.limit);

  if (currentDailyAmount.value == null || ulDailyAmount.value == null) {
    return null;
  }

  const riskBand = normalizeRiskBand(data.riskBand || data.riskLevel || data.risk || data.severity);
  const scope = normalizeUlScope(data.scope);
  const evidenceSource = normalizeEvidenceSource(data.evidenceSource, reasonCode);
  const sourceUrl = normalizeText(data.sourceUrl || data.sourceURL || data.url);
  const explainLine = normalizeText(data.explainLine) || buildUlExplainLine({
    displayName: displayName || nutrientKey.replace(/_/g, ' '),
    currentDailyAmount,
    ulDailyAmount,
    riskBand,
    scope,
  });

  if (!explainLine) return null;

  return {
    id: normalizeText(data.id) || buildSignalId('ul-entry', `${nutrientKey}-${explainLine}`),
    nutrientKey,
    displayName: displayName || nutrientKey.replace(/_/g, ' '),
    currentDailyAmount,
    ulDailyAmount,
    riskBand,
    scope,
    evidenceSource,
    explainLine,
    ...(reasonCode ? { reasonCode } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  };
};

const dedupeUlEntries = (items: SafetyUlEntry[], maxCount: number): SafetyUlEntry[] => {
  const out: SafetyUlEntry[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const line = normalizeText(item?.explainLine);
    if (!line) continue;
    const key = `${item.nutrientKey}|${line.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= maxCount) break;
  }
  return out;
};

const normalizeSignalArray = (input: unknown): SafetySignalItem[] => {
  const rows = Array.isArray(input) ? input : [];
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const data = row as Partial<SafetySignalItem>;
      const text = normalizeText(data.text);
      const source = normalizeText(data.source) as SafetySignalItem['source'];
      const scope = normalizeText(data.scope) as SafetySignalItem['scope'];
      if (!text || !source || !scope) return null;
      return createSignal({
        prefix: normalizeText(data.id) || source,
        text,
        source,
        scope,
        reasonCode: normalizeText(data.reasonCode),
        sourceUrl: normalizeText(data.sourceUrl),
        riskLevel: normalizeText(data.riskLevel),
      });
    })
    .filter((item): item is SafetySignalItem => item !== null);
};

const normalizeUlEntryArray = (input: unknown): SafetyUlEntry[] => {
  const rows = Array.isArray(input) ? input : [];
  return dedupeUlEntries(
    rows.map((row) => normalizeUlEntry(row)).filter((item): item is SafetyUlEntry => item !== null),
    MAX_UL_ENTRIES,
  );
};

const readPackFromBundle = (bundle: AnalysisBundle | null | undefined): SafetySignalPack | null => {
  const raw = bundle?.sections?.safety?.signals;
  if (!raw || typeof raw !== 'object') return null;
  return {
    schemaVersion: 1,
    labelWarnings: normalizeSignalArray((raw as SafetySignalPack).labelWarnings),
    ulEntries: normalizeUlEntryArray((raw as SafetySignalPack).ulEntries),
    ulSignals: normalizeSignalArray((raw as SafetySignalPack).ulSignals),
    odsInteractions: normalizeSignalArray((raw as SafetySignalPack).odsInteractions),
    odsWatchouts: normalizeSignalArray((raw as SafetySignalPack).odsWatchouts),
    qualityNotes: normalizeSignalArray((raw as SafetySignalPack).qualityNotes),
  };
};

const extractLabelWarningsFromBundle = (
  bundle: AnalysisBundle | null | undefined,
  facts: FactsDTO | null | undefined,
): SafetySignalItem[] => {
  const textRows: string[] = [];
  const push = (value: unknown) => {
    const text = normalizeText(value);
    if (text) textRows.push(text);
  };

  for (const row of bundle?.sections?.safety?.detail?.warnings ?? []) push((row as { text?: unknown })?.text ?? row);
  for (const row of bundle?.sections?.safety?.detail?.consultDoctorIf ?? []) push((row as { text?: unknown })?.text ?? row);
  for (const row of bundle?.sections?.safety?.detail?.redFlags ?? []) push((row as { text?: unknown })?.text ?? row);
  for (const row of facts?.safety?.labelWarnings ?? []) push(row);

  return textRows
    .map((text) =>
      createSignal({
        prefix: 'label',
        text,
        scope: 'label_specific',
        source: 'label_record',
      }),
    )
    .filter((item): item is SafetySignalItem => item !== null);
};

const ulEntryToSignal = (entry: SafetyUlEntry): SafetySignalItem | null =>
  createSignal({
    prefix: `ul-${entry.nutrientKey}`,
    text: entry.explainLine,
    scope: 'ods_general',
    source: 'ul_reference',
    reasonCode: entry.reasonCode,
    sourceUrl: entry.sourceUrl,
    riskLevel: entry.riskBand,
  });

const collectIngredientNames = (
  bundle: AnalysisBundle | null | undefined,
  facts: FactsDTO | null | undefined,
  ingredientNames?: string[] | null,
): string[] => {
  const out: string[] = [];
  const push = (value: unknown) => {
    const text = normalizeText(value);
    if (text) out.push(text);
  };
  for (const value of ingredientNames ?? []) push(value);
  for (const row of bundle?.sections?.ingredients?.cover?.items ?? []) push((row as { name?: unknown })?.name);
  for (const row of facts?.ingredients?.actives ?? []) push((row as { name?: unknown })?.name);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const name of out) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(name);
  }
  return deduped.slice(0, 3);
};

const extractOdsSignals = (ingredientNames: string[]): {
  interactions: SafetySignalItem[];
  watchouts: SafetySignalItem[];
} => {
  const interactions: SafetySignalItem[] = [];
  const watchouts: SafetySignalItem[] = [];

  ingredientNames.forEach((ingredient) => {
    const hit = lookupFoundationForIngredient(ingredient);
    if (hit.kind !== 'ods') return;
    const rows = Array.isArray(hit.watchOuts) ? hit.watchOuts : [];
    rows.forEach((line, index) => {
      const text = normalizeText(line);
      if (!text) return;
      const fullText = `${ingredient}: ${text}`;
      const isInteraction = INTERACTION_PATTERN.test(text);
      const signal = createSignal({
        prefix: `${isInteraction ? 'ods-int' : 'ods-watch'}-${ingredient}-${index + 1}`,
        text: fullText,
        scope: 'ods_general',
        source: isInteraction ? 'ods_interaction' : 'ods_watchout',
      });
      if (!signal) return;
      if (isInteraction) {
        interactions.push(signal);
      } else {
        watchouts.push(signal);
      }
    });
  });

  return {
    interactions: dedupeSignals(interactions, MAX_ODS_INTERACTIONS),
    watchouts: dedupeSignals(watchouts, MAX_ODS_WATCHOUTS),
  };
};

const buildQualityNotes = (
  existing: SafetySignalItem[],
  labelWarningsCount: number,
): SafetySignalItem[] => {
  if (labelWarningsCount > 0) {
    return dedupeSignals(existing, MAX_QUALITY_NOTES);
  }
  const note = createSignal({
    prefix: 'quality',
    text: 'This regulatory record did not provide label-specific warnings.',
    scope: 'label_specific',
    source: 'quality_note',
    reasonCode: 'LABEL_WARNINGS_NOT_PROVIDED',
  });
  return dedupeSignals(
    [note, ...existing].filter((item): item is SafetySignalItem => item !== null),
    MAX_QUALITY_NOTES,
  );
};

export const buildSafetySignalPack = (params: BuildSafetySignalPackParams): SafetySignalPack => {
  const base = readPackFromBundle(params.bundle);
  const ingredientNames = collectIngredientNames(params.bundle, params.facts, params.ingredientNames);
  const ods = extractOdsSignals(ingredientNames);
  const labelWarnings = dedupeSignals(
    [...(base?.labelWarnings ?? []), ...extractLabelWarningsFromBundle(params.bundle, params.facts)],
    MAX_LABEL_WARNINGS,
  );
  const ulEntries = dedupeUlEntries(base?.ulEntries ?? [], MAX_UL_ENTRIES);
  const ulSignals = dedupeSignals(
    [
      ...(base?.ulSignals ?? []),
      ...ulEntries.map((entry) => ulEntryToSignal(entry)).filter((item): item is SafetySignalItem => item !== null),
    ],
    MAX_UL_SIGNALS,
  );
  let odsInteractions = dedupeSignals(
    [...(base?.odsInteractions ?? []), ...ods.interactions],
    MAX_ODS_INTERACTIONS,
  );
  const odsWatchouts = dedupeSignals(
    [...(base?.odsWatchouts ?? []), ...ods.watchouts],
    MAX_ODS_WATCHOUTS,
  );
  if (labelWarnings.length === 0 && ulEntries.length === 0 && odsInteractions.length === 0 && odsWatchouts.length > 0) {
    const promoted = createSignal({
      prefix: 'ods-int-fallback',
      text: odsWatchouts[0]?.text ?? '',
      scope: 'ods_general',
      source: 'ods_interaction',
      reasonCode: 'ODS_WATCHOUT_PROMOTED',
    });
    if (promoted) {
      odsInteractions = dedupeSignals([promoted, ...odsInteractions], MAX_ODS_INTERACTIONS);
    }
  }
  const qualityNotes = buildQualityNotes(base?.qualityNotes ?? [], labelWarnings.length);

  return {
    schemaVersion: 1,
    labelWarnings,
    ulEntries,
    ulSignals,
    odsInteractions,
    odsWatchouts,
    qualityNotes,
  };
};

export const safetySignalsToPriorityLines = (pack: SafetySignalPack): string[] =>
  [
    ...pack.labelWarnings.map((item) => item.text),
    ...(Array.isArray(pack.ulEntries) ? pack.ulEntries.map((item) => item.explainLine) : []),
    ...pack.ulSignals.map((item) => item.text),
    ...pack.odsInteractions.map((item) => item.text),
    ...pack.odsWatchouts.map((item) => item.text),
    ...pack.qualityNotes.map((item) => item.text),
  ].filter((line, index, list) => {
    const normalized = normalizeText(line).toLowerCase();
    if (!normalized) return false;
    return list.findIndex((candidate) => normalizeText(candidate).toLowerCase() === normalized) === index;
  });
