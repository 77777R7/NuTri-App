import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { supabase } from "../src/supabase.js";

type Source = "lnhpd" | "dsld";
type IdColumn = "source_id" | "canonical_source_id";

type ProductIngredientRow = {
  id: string;
  source_id: string | null;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string | null;
  form_raw: string | null;
  is_active: boolean | null;
};

type IngredientFormRow = {
  ingredient_id: string | null;
  form_key: string | null;
  form_label: string | null;
  audit_status: string | null;
};

type ExistingAliasRow = {
  ingredient_id: string | null;
  alias_norm: string | null;
  form_key: string | null;
};

type SourceIdsPayload =
  | string[]
  | {
      sourceIds?: unknown[];
    };

type AliasCandidateGroup = {
  ingredientId: string;
  aliasNorm: string;
  aliasTextSample: string;
  sourceIds: Set<string>;
  canonicalSourceIds: Set<string>;
  candidateSourceCounts: Map<"form_raw" | "name_raw", number>;
};

type PlanAliasRow = {
  ingredient_id: string;
  alias_text: string;
  alias_norm: string;
  form_key: string;
  occurrence: number;
  consensus: number;
  candidate_normalized: string;
  source_ids: string[];
  match_rule?: DeterministicRule;
  match_confidence?: number;
  verified_form_choices?: number;
};

type PlanReviewRow = {
  ingredient_id: string;
  candidate_normalized: string;
  candidate_text_sample: string;
  occurrence: number;
  consensus: number;
  top_form_key: string | null;
  votes: Array<{ form_key: string; count: number; ratio: number }>;
  reason:
    | "no_verified_forms"
    | "multiple_verified_forms"
    | "invalid_candidate";
  source_ids: string[];
};

type DeterministicRule =
  | "exact_norm"
  | "token_reorder_equivalence"
  | "safe_plural_fold_equivalence"
  | "strict_subset_unique";

type DeterministicResolution = {
  formKey: string | null;
  rule: DeterministicRule | null;
  confidence: number;
};

const args = process.argv.slice(2);
const hasFlag = (flag: string): boolean => args.includes(`--${flag}`);
const getArg = (flag: string): string | null => {
  const prefixed = args.find((arg) => arg.startsWith(`--${flag}=`));
  if (prefixed) return prefixed.slice(`--${flag}=`.length);
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  const next = args[index + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
};

const sourceArg = (getArg("source") ?? "lnhpd").trim().toLowerCase();
const source: Source = sourceArg === "dsld" ? "dsld" : "lnhpd";
const idColumnArg = (getArg("id-column") ?? "canonical_source_id")
  .trim()
  .toLowerCase();
const idColumn: IdColumn =
  idColumnArg === "source_id" ? "source_id" : "canonical_source_id";
const sourceIdsFile = getArg("source-ids-file");
const outputPath =
  getArg("output") ?? `output/form-taxonomy/formraw_alias_remediation_plan_${source}.json`;
const summaryPath =
  getArg("summary") ??
  `output/form-taxonomy/formraw_alias_remediation_summary_${source}.json`;
const pageSize = Math.max(1, Number(getArg("page-size") ?? "1000"));
const verbose = hasFlag("verbose");

const CONNECTOR_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

const SUBSET_MATCH_BLOCK_TOKENS = new Set([
  "blend",
  "complex",
  "formula",
  "support",
  "plus",
  "advanced",
  "max",
  "extract",
  "whole",
  "root",
  "seed",
  "leaf",
  "fruit",
  "flower",
  "powder",
  "oil",
  "vitamin",
]);

const MIN_ALIAS_UNIQUE_TOKENS_FOR_SUBSET = 2;
const MAX_EXTRA_TOKENS_FOR_SUBSET = 2;
const SUBSET_SCORE_MIN = 0.5;
const SUBSET_SCORE_MARGIN = 0.12;

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const denoiseAliasNorm = (value: string): string => {
  const basic = normalizeText(value);
  if (!basic) return "";
  const filtered = basic
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !CONNECTOR_STOP_WORDS.has(token));
  return filtered.length ? filtered.join(" ") : basic;
};

export const foldTokenForSafeMatch = (token: string): string => {
  const normalized = normalizeText(token);
  if (!normalized) return "";
  if (normalized.length <= 2) return normalized;
  if (normalized.endsWith("ies") && normalized.length > 4) {
    return `${normalized.slice(0, -3)}y`;
  }
  if (normalized.endsWith("es") && normalized.length > 4) {
    const stem = normalized.slice(0, -2);
    if (stem.length >= 3) return stem;
  }
  if (
    normalized.endsWith("s") &&
    normalized.length > 3 &&
    !normalized.endsWith("ss")
  ) {
    return normalized.slice(0, -1);
  }
  return normalized;
};

export const tokenizeForSafeMatch = (
  value: string,
  options?: { fold?: boolean; unique?: boolean },
): string[] => {
  const fold = options?.fold ?? false;
  const unique = options?.unique ?? false;
  const tokens = denoiseAliasNorm(value)
    .split(/\s+/)
    .map((token) => (fold ? foldTokenForSafeMatch(token) : normalizeText(token)))
    .filter(Boolean);
  if (!unique) return tokens;
  return Array.from(new Set(tokens)).sort((a, b) => a.localeCompare(b));
};

export const buildTokenMultisetKey = (tokens: string[]): string =>
  [...tokens].sort((a, b) => a.localeCompare(b)).join(" ");

const isStrictSubset = (subset: Set<string>, superset: Set<string>): boolean => {
  if (subset.size >= superset.size) return false;
  for (const token of subset) {
    if (!superset.has(token)) return false;
  }
  return true;
};

export const resolveDeterministicFormKey = (
  candidateNormalized: string,
  verifiedFormKeys: string[],
): DeterministicResolution => {
  const normalizedCandidate = denoiseAliasNorm(candidateNormalized);
  if (!normalizedCandidate || verifiedFormKeys.length <= 1) {
    return { formKey: null, rule: null, confidence: 0 };
  }

  const forms = verifiedFormKeys
    .map((value) => value.trim())
    .filter(Boolean)
    .map((formKey) => ({
      formKey,
      normalized: denoiseAliasNorm(formKey),
      rawTokens: tokenizeForSafeMatch(formKey),
      foldedTokens: tokenizeForSafeMatch(formKey, { fold: true }),
      foldedTokenSet: new Set(tokenizeForSafeMatch(formKey, { fold: true, unique: true })),
    }));

  const exact = forms.filter((form) => form.normalized === normalizedCandidate);
  if (exact.length === 1) {
    return { formKey: exact[0].formKey, rule: "exact_norm", confidence: 1 };
  }

  const candidateRawTokens = tokenizeForSafeMatch(normalizedCandidate);
  const candidateRawKey = buildTokenMultisetKey(candidateRawTokens);
  const reorderMatches = forms.filter(
    (form) =>
      form.rawTokens.length > 0 &&
      buildTokenMultisetKey(form.rawTokens) === candidateRawKey,
  );
  if (reorderMatches.length === 1) {
    return {
      formKey: reorderMatches[0].formKey,
      rule: "token_reorder_equivalence",
      confidence: 0.98,
    };
  }

  const candidateFoldedTokens = tokenizeForSafeMatch(normalizedCandidate, { fold: true });
  const candidateFoldedKey = buildTokenMultisetKey(candidateFoldedTokens);
  const foldedMatches = forms.filter(
    (form) =>
      form.foldedTokens.length > 0 &&
      buildTokenMultisetKey(form.foldedTokens) === candidateFoldedKey,
  );
  if (foldedMatches.length === 1) {
    return {
      formKey: foldedMatches[0].formKey,
      rule: "safe_plural_fold_equivalence",
      confidence: 0.94,
    };
  }

  const candidateTokenSet = new Set(
    tokenizeForSafeMatch(normalizedCandidate, { fold: true, unique: true }),
  );
  if (
    candidateTokenSet.size < MIN_ALIAS_UNIQUE_TOKENS_FOR_SUBSET ||
    Array.from(candidateTokenSet).some((token) => SUBSET_MATCH_BLOCK_TOKENS.has(token))
  ) {
    return { formKey: null, rule: null, confidence: 0 };
  }

  const subsetCandidates = forms
    .map((form) => {
      if (!isStrictSubset(candidateTokenSet, form.foldedTokenSet)) return null;
      const extraTokens = form.foldedTokenSet.size - candidateTokenSet.size;
      if (extraTokens > MAX_EXTRA_TOKENS_FOR_SUBSET) return null;
      const overlapRatio = candidateTokenSet.size / form.foldedTokenSet.size;
      const lengthPenalty = extraTokens * 0.08;
      const score = overlapRatio - lengthPenalty;
      if (score < SUBSET_SCORE_MIN) return null;
      return {
        formKey: form.formKey,
        score,
        extraTokens,
      };
    })
    .filter(
      (value): value is { formKey: string; score: number; extraTokens: number } =>
        Boolean(value),
    )
    .sort((a, b) =>
      b.score === a.score ? a.extraTokens - b.extraTokens : b.score - a.score,
    );

  if (!subsetCandidates.length) return { formKey: null, rule: null, confidence: 0 };
  const best = subsetCandidates[0];
  const second = subsetCandidates[1];
  if (second && best.score - second.score < SUBSET_SCORE_MARGIN) {
    return { formKey: null, rule: null, confidence: 0 };
  }
  return {
    formKey: best.formKey,
    rule: "strict_subset_unique",
    confidence: Number(best.score.toFixed(4)),
  };
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const readSourceIds = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as SourceIdsPayload;
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.sourceIds)
      ? parsed.sourceIds
      : [];
  return items
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
};

const fetchActiveRows = async (
  sourceIds: string[],
): Promise<ProductIngredientRow[]> => {
  const rows: ProductIngredientRow[] = [];
  for (const chunk of chunkArray(sourceIds, 200)) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("product_ingredients")
        .select(
          "id,source_id,canonical_source_id,ingredient_id,name_raw,form_raw,is_active",
        )
        .eq("source", source)
        .eq("is_active", true)
        .in(idColumn, chunk)
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as ProductIngredientRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
  }
  return rows;
};

const fetchVerifiedFormsByIngredient = async (
  ingredientIds: string[],
): Promise<Map<string, string[]>> => {
  const byIngredient = new Map<string, string[]>();
  if (!ingredientIds.length) return byIngredient;

  for (const chunk of chunkArray(ingredientIds, 200)) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("ingredient_forms")
        .select("ingredient_id,form_key,form_label,audit_status")
        .in("ingredient_id", chunk)
        .eq("audit_status", "verified")
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as IngredientFormRow[];
      page.forEach((row) => {
        const ingredientId = (row.ingredient_id ?? "").trim();
        const formKey = normalizeText(row.form_key ?? "");
        if (!ingredientId || !formKey) return;
        const existing = byIngredient.get(ingredientId) ?? [];
        if (!existing.includes(formKey)) {
          existing.push(formKey);
          byIngredient.set(ingredientId, existing);
        }
      });
      if (page.length < pageSize) break;
      offset += pageSize;
    }
  }

  for (const [ingredientId, keys] of byIngredient.entries()) {
    byIngredient.set(ingredientId, keys.sort());
  }
  return byIngredient;
};

const fetchExistingScopedAliases = async (
  ingredientIds: string[],
  aliasNorms: string[],
): Promise<Set<string>> => {
  const existing = new Set<string>();
  if (!ingredientIds.length || !aliasNorms.length) return existing;

  for (const ingredientChunk of chunkArray(ingredientIds, 100)) {
    for (const aliasChunk of chunkArray(aliasNorms, 100)) {
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from("ingredient_form_aliases")
          .select("ingredient_id,alias_norm,form_key")
          .in("ingredient_id", ingredientChunk)
          .in("alias_norm", aliasChunk)
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as ExistingAliasRow[];
        page.forEach((row) => {
          const ingredientId = (row.ingredient_id ?? "").trim();
          const aliasNorm = normalizeText(row.alias_norm ?? "");
          const formKey = normalizeText(row.form_key ?? "");
          if (!ingredientId || !aliasNorm || !formKey) return;
          existing.add(`${ingredientId}\u0001${aliasNorm}\u0001${formKey}`);
        });
        if (page.length < pageSize) break;
        offset += pageSize;
      }
    }
  }

  return existing;
};

const run = async () => {
  if (!sourceIdsFile) {
    throw new Error("[formraw-alias-plan] --source-ids-file is required");
  }

  const sourceIdsRaw = await readSourceIds(sourceIdsFile);
  const sourceIds = Array.from(new Set(sourceIdsRaw));
  if (!sourceIds.length) {
    throw new Error("[formraw-alias-plan] source ids list is empty");
  }

  const activeRows = await fetchActiveRows(sourceIds);
  const groups = new Map<string, AliasCandidateGroup>();

  let skippedMissingIngredientId = 0;
  let skippedInvalidCandidate = 0;

  for (const row of activeRows) {
    const ingredientId = (row.ingredient_id ?? "").trim();
    if (!ingredientId) {
      skippedMissingIngredientId += 1;
      continue;
    }

    const formRaw = (row.form_raw ?? "").trim();
    const nameRaw = (row.name_raw ?? "").trim();
    const candidateText = formRaw || nameRaw;
    const candidateSource: "form_raw" | "name_raw" = formRaw ? "form_raw" : "name_raw";
    const aliasNorm = denoiseAliasNorm(candidateText);
    if (!candidateText || !aliasNorm) {
      skippedInvalidCandidate += 1;
      continue;
    }

    const key = `${ingredientId}\u0001${aliasNorm}`;
    const existing = groups.get(key);
    const sourceId = (row.source_id ?? "").trim();
    const canonicalSourceId = (row.canonical_source_id ?? "").trim();
    if (existing) {
      existing.sourceIds.add(sourceId || canonicalSourceId);
      if (canonicalSourceId) existing.canonicalSourceIds.add(canonicalSourceId);
      existing.candidateSourceCounts.set(
        candidateSource,
        (existing.candidateSourceCounts.get(candidateSource) ?? 0) + 1,
      );
      if (candidateSource === "form_raw" && existing.aliasTextSample !== formRaw && formRaw) {
        // Prefer a concrete form_raw sample over name_raw when available.
        existing.aliasTextSample = formRaw;
      }
      continue;
    }

    groups.set(key, {
      ingredientId,
      aliasNorm,
      aliasTextSample: candidateText,
      sourceIds: new Set(sourceId || canonicalSourceId ? [sourceId || canonicalSourceId] : []),
      canonicalSourceIds: new Set(canonicalSourceId ? [canonicalSourceId] : []),
      candidateSourceCounts: new Map([[candidateSource, 1]]),
    });
  }

  const ingredientIds = Array.from(
    new Set(Array.from(groups.values()).map((group) => group.ingredientId)),
  );
  const verifiedFormsByIngredient = await fetchVerifiedFormsByIngredient(ingredientIds);

  const planAliasesPreDedup: PlanAliasRow[] = [];
  const reviewQueue: PlanReviewRow[] = [];

  let groupsNoVerifiedForms = 0;
  let groupsMultipleVerifiedForms = 0;
  let groupsMultipleVerifiedAutoResolved = 0;
  let groupsMultipleVerifiedReviewQueue = 0;
  let groupsSingleVerifiedForms = 0;
  const autoResolvedByRule = new Map<DeterministicRule, number>();

  for (const group of groups.values()) {
    const verifiedFormKeys = verifiedFormsByIngredient.get(group.ingredientId) ?? [];
    const occurrence = group.sourceIds.size;

    if (!group.aliasNorm) {
      reviewQueue.push({
        ingredient_id: group.ingredientId,
        candidate_normalized: group.aliasNorm,
        candidate_text_sample: group.aliasTextSample,
        occurrence,
        consensus: 0,
        top_form_key: null,
        votes: [],
        reason: "invalid_candidate",
        source_ids: Array.from(group.sourceIds).sort(),
      });
      continue;
    }

    if (verifiedFormKeys.length === 0) {
      groupsNoVerifiedForms += 1;
      reviewQueue.push({
        ingredient_id: group.ingredientId,
        candidate_normalized: group.aliasNorm,
        candidate_text_sample: group.aliasTextSample,
        occurrence,
        consensus: 0,
        top_form_key: null,
        votes: [],
        reason: "no_verified_forms",
        source_ids: Array.from(group.sourceIds).sort(),
      });
      continue;
    }

    if (verifiedFormKeys.length > 1) {
      groupsMultipleVerifiedForms += 1;
      const deterministic = resolveDeterministicFormKey(group.aliasNorm, verifiedFormKeys);
      if (deterministic.formKey && deterministic.rule) {
        groupsMultipleVerifiedAutoResolved += 1;
        autoResolvedByRule.set(
          deterministic.rule,
          (autoResolvedByRule.get(deterministic.rule) ?? 0) + 1,
        );
        planAliasesPreDedup.push({
          ingredient_id: group.ingredientId,
          alias_text: group.aliasTextSample,
          alias_norm: group.aliasNorm,
          form_key: deterministic.formKey,
          occurrence,
          consensus: 1,
          candidate_normalized: group.aliasNorm,
          source_ids: Array.from(group.sourceIds).sort(),
          match_rule: deterministic.rule,
          match_confidence: deterministic.confidence,
          verified_form_choices: verifiedFormKeys.length,
        });
        continue;
      }
      groupsMultipleVerifiedReviewQueue += 1;
      reviewQueue.push({
        ingredient_id: group.ingredientId,
        candidate_normalized: group.aliasNorm,
        candidate_text_sample: group.aliasTextSample,
        occurrence,
        consensus: 0,
        top_form_key: null,
        votes: verifiedFormKeys.map((formKey) => ({
          form_key: formKey,
          count: 1,
          ratio: Number((1 / verifiedFormKeys.length).toFixed(4)),
        })),
        reason: "multiple_verified_forms",
        source_ids: Array.from(group.sourceIds).sort(),
      });
      continue;
    }

    groupsSingleVerifiedForms += 1;
    const formKey = verifiedFormKeys[0];
    planAliasesPreDedup.push({
      ingredient_id: group.ingredientId,
      alias_text: group.aliasTextSample,
      alias_norm: group.aliasNorm,
      form_key: formKey,
      occurrence,
      consensus: 1,
      candidate_normalized: group.aliasNorm,
      source_ids: Array.from(group.sourceIds).sort(),
    });
  }

  const aliasIngredientIds = Array.from(
    new Set(planAliasesPreDedup.map((row) => row.ingredient_id)),
  );
  const aliasNorms = Array.from(
    new Set(planAliasesPreDedup.map((row) => row.alias_norm)),
  );
  const existingScopedAliases = await fetchExistingScopedAliases(aliasIngredientIds, aliasNorms);

  const dedupMap = new Map<string, PlanAliasRow>();
  for (const row of planAliasesPreDedup) {
    const key = `${row.ingredient_id}\u0001${normalizeText(row.alias_norm)}\u0001${normalizeText(row.form_key)}`;
    if (existingScopedAliases.has(key)) continue;
    if (!dedupMap.has(key)) dedupMap.set(key, row);
  }
  const aliases = Array.from(dedupMap.values()).sort((a, b) =>
    a.ingredient_id === b.ingredient_id
      ? a.alias_norm.localeCompare(b.alias_norm)
      : a.ingredient_id.localeCompare(b.ingredient_id),
  );

  reviewQueue.sort((a, b) =>
    a.ingredient_id === b.ingredient_id
      ? a.candidate_normalized.localeCompare(b.candidate_normalized)
      : a.ingredient_id.localeCompare(b.ingredient_id),
  );

  const touchedIngredientIds = Array.from(
    new Set(aliases.map((row) => row.ingredient_id)),
  ).sort();

  const planPayload = {
    source,
    generatedAt: new Date().toISOString(),
    rules: {
      scope: "ingredient_id_scoped_only",
      mode: "alias_only_harvest",
      idColumn,
      onlySingleVerifiedFormAutoApplied: true,
      allowDeterministicMultiVerifiedAutoResolution: true,
      globalAliasWritesAllowed: false,
      deterministicAutoResolutionRules: [
        "exact_norm",
        "token_reorder_equivalence",
        "safe_plural_fold_equivalence",
        "strict_subset_unique",
      ],
    },
    summary: {
      targetSourceIds: sourceIds.length,
      activeRowsScanned: activeRows.length,
      groupsTotal: groups.size,
      groupsSingleVerifiedForms,
      groupsNoVerifiedForms,
      groupsMultipleVerifiedForms,
      groupsMultipleVerifiedAutoResolved,
      groupsMultipleVerifiedReviewQueue,
      autoResolvedByRule: {
        exact_norm: autoResolvedByRule.get("exact_norm") ?? 0,
        token_reorder_equivalence: autoResolvedByRule.get("token_reorder_equivalence") ?? 0,
        safe_plural_fold_equivalence: autoResolvedByRule.get("safe_plural_fold_equivalence") ?? 0,
        strict_subset_unique: autoResolvedByRule.get("strict_subset_unique") ?? 0,
      },
      skippedMissingIngredientId,
      skippedInvalidCandidate,
      aliasesToInsert: aliases.length,
      reviewQueue: reviewQueue.length,
      touchedIngredientIds: touchedIngredientIds.length,
    },
    forms: [] as unknown[],
    aliases,
    review_queue: reviewQueue,
  };

  const summaryPayload = {
    source,
    generatedAt: planPayload.generatedAt,
    inputs: {
      sourceIdsFile: path.resolve(sourceIdsFile),
      idColumn,
      targetSourceIds: sourceIds.length,
      outputPath: path.resolve(outputPath),
    },
    counts: {
      activeRowsScanned: activeRows.length,
      groupsTotal: groups.size,
      groupsSingleVerifiedForms,
      groupsNoVerifiedForms,
      groupsMultipleVerifiedForms,
      groupsMultipleVerifiedAutoResolved,
      groupsMultipleVerifiedReviewQueue,
      skippedMissingIngredientId,
      skippedInvalidCandidate,
      aliasesCandidateBeforeDedup: planAliasesPreDedup.length,
      aliasesToInsert: aliases.length,
      reviewQueue: reviewQueue.length,
      touchedIngredientIds: touchedIngredientIds.length,
    },
    touchedIngredientIds,
    planPath: path.resolve(outputPath),
  };

  await ensureDir(outputPath);
  await writeFile(outputPath, JSON.stringify(planPayload, null, 2), "utf8");
  await ensureDir(summaryPath);
  await writeFile(summaryPath, JSON.stringify(summaryPayload, null, 2), "utf8");

  if (verbose) {
    console.log(JSON.stringify(summaryPayload, null, 2));
  }
  console.log(`[formraw-alias-plan] wrote ${outputPath}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((error) => {
    console.error(
      "[formraw-alias-plan] failed:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
