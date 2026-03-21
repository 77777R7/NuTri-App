import type { FactsDigest } from "./factsDigest.js";
import { isNutritionLabelLikeIngredientName } from "./scoring/nutritionLabelLikeLexicon.js";

export type ScienceIngredientRow = {
  name: string;
  dose: string | null;
};

type OverlayNutritionalFactRow = {
  substancy?: string | null;
  amountPerServing?: string | null;
  dailyValuePercent?: string | null;
};

type OverlayClaimsLike = {
  nutritionalFacts?: OverlayNutritionalFactRow[] | null;
} | null | undefined;

type NormalizedScienceIngredientRow = ScienceIngredientRow & {
  primaryMatchKey: string;
  allMatchKeys: string[];
};

const normalizeWhitespace = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripTrailingSentencePunctuation = (value: string): string => value.replace(/[.!?]+$/g, "").trim();

const normalizeDisplayText = (value: string | null | undefined): string =>
  stripTrailingSentencePunctuation(normalizeWhitespace(value));

const HEADER_VALUE_PATTERN =
  /^(amount per (serving|tablet|capsule|softgel|packet)|% ?daily value|daily value|serving size|servings per container)$/i;

const EXPLANATORY_SEGMENT_PATTERN =
  /\b(providing|std\.?\s*to|standardized?|daily value|cfu\b|colony forming units?|heat treated|microencapsulation|daily amount)\b/i;

const BLEND_TAIL_SIGNAL_PATTERN =
  /^(\[|\(|[A-Z]\.|[A-Z0-9]{1,6}\b|lactobacillus|bifidobacterium|saccharomyces|streptococcus|bacillus|myoviridae|siphoviridae|podoviridae|b\.|l\.)/i;

const BLEND_LABEL_PATTERN = /\b(blend|complex|matrix|formula)\b/i;
const BLEND_PREFIX_PATTERN =
  /^(?:proprietary\s+)?(?:herbal\s+)?(?:blend|complex|matrix|formula)\s*:\s*/i;
const ALIAS_SEGMENT_EXCLUSION_PATTERN =
  /^(as|from|providing|std\.?\s*to|standardized?|daily value|cfu\b|colony forming units?)\b/i;
const ALIAS_KEY_REJECTION_LIST = new Set([
  "tg",
  "dv",
  "usp",
  "epa",
  "dha",
  "mk4",
  "mk7",
  "iu",
  "mg",
  "mcg",
  "g",
  "spu",
  "fcc",
]);
const UNMATCHED_OVERLAY_INDEX = Number.MAX_SAFE_INTEGER;

const isHeaderLike = (value: string | null | undefined): boolean => {
  const normalized = normalizeDisplayText(value).replace(/[%*†‡]+/g, "");
  return HEADER_VALUE_PATTERN.test(normalized);
};

const isNutritionLabelLike = (value: string | null | undefined): boolean => {
  const normalized = normalizeDisplayText(value);
  return isNutritionLabelLikeIngredientName(normalized);
};

const normalizeDose = (value: string | null | undefined): string | null => {
  const normalized = normalizeDisplayText(value);
  if (!normalized || isHeaderLike(normalized)) return null;
  return normalized;
};

const normalizePunctuationSpacing = (value: string): string =>
  normalizeWhitespace(
    value
      .replace(/[®™]/g, "")
      .replace(/([)\]])(?=[A-Za-z0-9])/g, "$1 ")
      .replace(/([,;])(?=\S)/g, "$1 ")
      .replace(/\b(Blend|Complex|Matrix|Formula|Probiotic|Prebiotic|Synbiotic|Fermentate|Extract)(?=[A-Z0-9])/g, "$1 "),
  );

const shouldStripSegment = (value: string): boolean => {
  const normalized = normalizeWhitespace(value).replace(/[†‡*]/g, "");
  if (!normalized) return true;
  if (/^(as|from)\b/i.test(normalized)) return false;
  if (/^\d+(?:\.\d+)?\s*(million|billion|trillion)?\s*cfu\b/i.test(normalized)) return true;
  return EXPLANATORY_SEGMENT_PATTERN.test(normalized);
};

const stripExplanatorySegments = (value: string): string => {
  let current = value;
  let previous = "";
  while (current !== previous) {
    previous = current;
    current = current.replace(/(\(|\[)([^()[\]]+)(\)|\])/g, (_match, open: string, inner: string, close: string) => {
      if (shouldStripSegment(inner)) return "";
      return `${open}${normalizeWhitespace(inner)}${close}`;
    });
  }
  return normalizeWhitespace(current);
};

const truncateBlendLikeTail = (value: string): string => {
  const match = value.match(BLEND_LABEL_PATTERN);
  if (!match || match.index == null) return value;
  const head = normalizeWhitespace(value.slice(0, match.index + match[0].length));
  const tail = normalizeWhitespace(value.slice(match.index + match[0].length));
  if (!tail) return head;
  if (BLEND_TAIL_SIGNAL_PATTERN.test(tail) || /[;,]/.test(tail)) return head;
  return value;
};

const cleanOverlayIngredientName = (value: string | null | undefined): string | null => {
  const normalized = normalizePunctuationSpacing(String(value ?? ""));
  if (!normalized || isHeaderLike(normalized) || isNutritionLabelLike(normalized)) return null;

  const withoutExplanatorySegments = normalizePunctuationSpacing(stripExplanatorySegments(normalized));
  const truncated = truncateBlendLikeTail(withoutExplanatorySegments);
  const cleaned = normalizeDisplayText(
    truncated
      .replace(/\s+([)\]])/g, "$1")
      .replace(/([(\[])\s+/g, "$1")
      .replace(/[:;,/-]+$/g, ""),
  );

  if (!cleaned || isHeaderLike(cleaned) || isNutritionLabelLike(cleaned)) return null;
  return cleaned;
};

const stripTrailingOverlayMarkers = (value: string): string =>
  normalizeWhitespace(
    value
      .replace(/\s*[ⓞ®™†‡*]+$/g, "")
      .replace(/\s+\(([ow])\)$/i, "")
      .replace(/\s+([ow])$/i, ""),
  );

const expandBlendMemberRows = (
  name: string | null | undefined,
  dose: string | null,
): Array<{ name: string; dose: string | null }> | null => {
  const normalized = normalizePunctuationSpacing(String(name ?? ""));
  if (!BLEND_PREFIX_PATTERN.test(normalized)) return null;

  const tail = normalizeWhitespace(normalized.replace(BLEND_PREFIX_PATTERN, ""));
  if (!tail) return null;

  const members = Array.from(
    new Set(
      tail
        .split(/\s*,\s*/)
        .map((segment) => stripTrailingOverlayMarkers(segment))
        .map((segment) => cleanOverlayIngredientName(segment))
        .filter((segment): segment is string => Boolean(segment)),
    ),
  );

  if (members.length === 0) return null;

  if (members.length === 1) {
    return [{ name: members[0], dose }];
  }

  return members.map((member) => ({
    name: member,
    // The blend total does not belong to each member, so keep identity and intentionally withhold dose.
    dose: null,
  }));
};

const normalizeMatchKey = (value: string): string =>
  normalizeDisplayText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const toPrimaryMatchKey = (value: string): string => {
  const normalized = normalizeDisplayText(value)
    .replace(/(\(|\[)[^()[\]]+(\)|\])/g, " ")
    .replace(/\b(as|from)\s+[^,;]+$/i, "")
    .trim();
  const blendMatch = normalized.match(/^(.*?\b(?:blend|complex|matrix|formula)\b)/i);
  return normalizeMatchKey(blendMatch?.[1] ?? normalized);
};

const isBlendLike = (value: string): boolean => BLEND_LABEL_PATTERN.test(normalizeDisplayText(value));

const extractSupplementAliasKeys = (name: string): string[] => {
  const normalized = normalizeDisplayText(name);
  const seen = new Set<string>();
  const aliasKeys: string[] = [];

  for (const match of normalized.matchAll(/\(([^()]+)\)/g)) {
    const segment = normalizeDisplayText(match[1]).replace(/[®™]/g, "");
    if (!segment) continue;
    if (ALIAS_SEGMENT_EXCLUSION_PATTERN.test(segment)) continue;
    if (/\d/.test(segment)) continue;
    if (!/[a-z]/i.test(segment)) continue;

    const key = normalizeMatchKey(segment);
    if (!key || key.length < 6) continue;
    if (ALIAS_KEY_REJECTION_LIST.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    aliasKeys.push(key);
  }

  return aliasKeys;
};

const dedupeMatchKeys = (keys: string[]): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(key);
  }
  return deduped;
};

const buildNormalizedScienceIngredientRow = (params: {
  name: string | null | undefined;
  dose: string | null;
}): NormalizedScienceIngredientRow | null => {
  const name = normalizeDisplayText(params.name);
  if (!name) return null;

  const primaryMatchKey = toPrimaryMatchKey(name);
  if (!primaryMatchKey) return null;

  const allMatchKeys = dedupeMatchKeys([
    primaryMatchKey,
    ...extractSupplementAliasKeys(name).filter((key) => key !== primaryMatchKey),
  ]);

  return {
    name,
    dose: params.dose,
    primaryMatchKey,
    allMatchKeys,
  };
};

const toOfficialRows = (digest: FactsDigest): NormalizedScienceIngredientRow[] =>
  (digest.actives ?? [])
    .map((active) => {
      const dose =
        normalizeDose(active?.amountText) ??
        (active?.amount != null && normalizeWhitespace(active?.unit)
          ? normalizeDisplayText(`${active.amount} ${active.unit ?? ""}`)
          : null);
      return buildNormalizedScienceIngredientRow({
        name: active?.name,
        dose,
      });
    })
    .filter((row): row is NormalizedScienceIngredientRow => row !== null);

const mergeRowMatchKeys = (
  preferred: NormalizedScienceIngredientRow,
  alternate: NormalizedScienceIngredientRow,
): NormalizedScienceIngredientRow => ({
  ...preferred,
  allMatchKeys: dedupeMatchKeys([
    preferred.primaryMatchKey,
    ...preferred.allMatchKeys,
    ...alternate.allMatchKeys,
  ]),
});

const pickPreferredRow = (
  current: NormalizedScienceIngredientRow,
  incoming: NormalizedScienceIngredientRow,
): NormalizedScienceIngredientRow => {
  if (incoming.dose && !current.dose) return mergeRowMatchKeys(incoming, current);
  if (!incoming.dose && current.dose) return mergeRowMatchKeys(current, incoming);
  if (incoming.name.length < current.name.length) return mergeRowMatchKeys(incoming, current);
  return mergeRowMatchKeys(current, incoming);
};

const normalizeIherbSupplementFactsRowsInternal = (
  rows: OverlayNutritionalFactRow[] | null | undefined,
): NormalizedScienceIngredientRow[] => {
  const order: string[] = [];
  const deduped = new Map<string, NormalizedScienceIngredientRow>();

  for (const row of rows ?? []) {
    const normalizedDose = normalizeDose(row?.amountPerServing);
    const expandedRows =
      expandBlendMemberRows(row?.substancy, normalizedDose) ??
      (() => {
        const cleaned = cleanOverlayIngredientName(row?.substancy);
        return cleaned ? [{ name: cleaned, dose: normalizedDose }] : [];
      })();

    for (const expandedRow of expandedRows) {
      const next = buildNormalizedScienceIngredientRow(expandedRow);
      if (!next) continue;
      const existing = deduped.get(next.primaryMatchKey);
      if (!existing) {
        order.push(next.primaryMatchKey);
        deduped.set(next.primaryMatchKey, next);
        continue;
      }
      deduped.set(next.primaryMatchKey, pickPreferredRow(existing, next));
    }
  }

  return order
    .map((key) => deduped.get(key))
    .filter((row): row is NormalizedScienceIngredientRow => Boolean(row));
};

export const normalizeIherbSupplementFactsRows = (
  rows: OverlayNutritionalFactRow[] | null | undefined,
): ScienceIngredientRow[] =>
  normalizeIherbSupplementFactsRowsInternal(rows).map((row) => ({
    name: row.name,
    dose: row.dose,
  }));

const rowsMatchForCoverage = (
  officialRow: NormalizedScienceIngredientRow,
  overlayRow: NormalizedScienceIngredientRow,
): boolean => {
  if (officialRow.allMatchKeys.some((key) => overlayRow.allMatchKeys.includes(key))) return true;
  if (!isBlendLike(officialRow.name) || !isBlendLike(overlayRow.name)) return false;
  return (
    officialRow.primaryMatchKey.includes(overlayRow.primaryMatchKey) ||
    overlayRow.primaryMatchKey.includes(officialRow.primaryMatchKey)
  );
};

const selectOfficialCoverageRows = (
  officialRows: NormalizedScienceIngredientRow[],
): NormalizedScienceIngredientRow[] => officialRows.filter((row) => !isNutritionLabelLike(row.name)).slice(0, 3);

type CoverageAssignment = {
  matchedCount: number;
  matchedDoseCount: number;
  overlayIndexes: number[];
};

const isBetterCoverageAssignment = (
  candidate: CoverageAssignment,
  best: CoverageAssignment,
): boolean => {
  if (candidate.matchedCount !== best.matchedCount) {
    return candidate.matchedCount > best.matchedCount;
  }
  if (candidate.matchedDoseCount !== best.matchedDoseCount) {
    return candidate.matchedDoseCount > best.matchedDoseCount;
  }

  for (let index = 0; index < candidate.overlayIndexes.length; index += 1) {
    const candidateValue = candidate.overlayIndexes[index] ?? UNMATCHED_OVERLAY_INDEX;
    const bestValue = best.overlayIndexes[index] ?? UNMATCHED_OVERLAY_INDEX;
    if (candidateValue === bestValue) continue;
    return candidateValue < bestValue;
  }

  return false;
};

const findBestCoverageAssignment = (
  officialRows: NormalizedScienceIngredientRow[],
  overlayRows: NormalizedScienceIngredientRow[],
): CoverageAssignment => {
  const best: CoverageAssignment = {
    matchedCount: 0,
    matchedDoseCount: 0,
    overlayIndexes: Array.from({ length: officialRows.length }, () => UNMATCHED_OVERLAY_INDEX),
  };
  const currentIndexes = Array.from({ length: officialRows.length }, () => UNMATCHED_OVERLAY_INDEX);
  const usedOverlayIndexes = new Set<number>();

  // Coverage rows are capped at 3, so exhaustively evaluating legal one-to-one assignments stays tiny and stable.
  const search = (officialIndex: number, matchedCount: number, matchedDoseCount: number): void => {
    if (officialIndex >= officialRows.length) {
      const candidate: CoverageAssignment = {
        matchedCount,
        matchedDoseCount,
        overlayIndexes: [...currentIndexes],
      };
      if (isBetterCoverageAssignment(candidate, best)) {
        best.matchedCount = candidate.matchedCount;
        best.matchedDoseCount = candidate.matchedDoseCount;
        best.overlayIndexes = [...candidate.overlayIndexes];
      }
      return;
    }

    currentIndexes[officialIndex] = UNMATCHED_OVERLAY_INDEX;
    search(officialIndex + 1, matchedCount, matchedDoseCount);

    for (let overlayIndex = 0; overlayIndex < overlayRows.length; overlayIndex += 1) {
      if (usedOverlayIndexes.has(overlayIndex)) continue;
      if (!rowsMatchForCoverage(officialRows[officialIndex], overlayRows[overlayIndex])) continue;
      usedOverlayIndexes.add(overlayIndex);
      currentIndexes[officialIndex] = overlayIndex;
      search(
        officialIndex + 1,
        matchedCount + 1,
        matchedDoseCount + (overlayRows[overlayIndex]?.dose ? 1 : 0),
      );
      usedOverlayIndexes.delete(overlayIndex);
      currentIndexes[officialIndex] = UNMATCHED_OVERLAY_INDEX;
    }
  };

  search(0, 0, 0);
  return best;
};

const requiredCoverageMatches = (officialPrimaryCount: number): number => {
  if (officialPrimaryCount <= 1) return officialPrimaryCount;
  if (officialPrimaryCount === 2) return 2;
  return 2;
};

export const selectScienceIngredientRows = (params: {
  digest: FactsDigest;
  overlayClaims: OverlayClaimsLike;
}): {
  ingredientSourceTier: "overlay_iherb" | "official_record";
  ingredientRows: ScienceIngredientRow[];
} => {
  const officialRows = toOfficialRows(params.digest);
  const fallback = {
    ingredientSourceTier: "official_record" as const,
    ingredientRows: officialRows.map((row) => ({ name: row.name, dose: row.dose })),
  };

  if (params.digest.sourceType !== "dsld") return fallback;

  const overlayRows = normalizeIherbSupplementFactsRowsInternal(params.overlayClaims?.nutritionalFacts);
  if (overlayRows.length === 0) return fallback;

  const officialCoverageRows = selectOfficialCoverageRows(officialRows);
  if (officialCoverageRows.length === 0) return fallback;

  const bestCoverage = findBestCoverageAssignment(officialCoverageRows, overlayRows);
  if (
    bestCoverage.matchedCount < requiredCoverageMatches(officialCoverageRows.length) ||
    bestCoverage.matchedDoseCount < 1
  ) {
    return fallback;
  }

  return {
    ingredientSourceTier: "overlay_iherb",
    ingredientRows: overlayRows.map((row) => ({
      name: row.name,
      dose: row.dose,
    })),
  };
};

export const iherbOverlayIngredientInternals = {
  cleanOverlayIngredientName,
  expandBlendMemberRows,
  stripTrailingOverlayMarkers,
};
