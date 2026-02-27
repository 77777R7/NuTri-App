import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type MatchAttempt = {
  candidateText?: string;
  candidateNormalized?: string;
  candidateSource?: "form_raw" | "name_raw";
  aliasMatchedFormKeys?: string[];
  aliasMatches?: Array<{
    aliasText?: string;
    aliasNorm?: string | null;
    formKey?: string;
  }>;
  formsAvailable?: Array<{
    formKey?: string;
    formLabel?: string;
  }>;
};

type MismatchExampleRow = {
  source?: string;
  sourceId?: string;
  canonicalSourceId?: string | null;
  ingredientId?: string | null;
  nameRaw?: string;
  formRaw?: string | null;
  matchAttempt?: MatchAttempt;
};

type PlanFormRow = {
  ingredient_id: string;
  form_key: string;
  form_label: string;
  occurrence: number;
  consensus: number;
  candidate_normalized: string;
  source_ids: string[];
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
    | "no_form_key_votes"
    | "occurrence_below_threshold"
    | "consensus_below_threshold"
    | "ambiguous_consensus";
  source_ids: string[];
};

type IngredientFormLabelRow = {
  form_key: string;
  form_label: string | null;
};

type ExistingAliasRow = {
  ingredient_id: string | null;
  alias_norm: string | null;
  form_key: string | null;
};

type GroupBucket = {
  ingredientId: string;
  candidateNormalized: string;
  candidateTextCounts: Map<string, number>;
  sourceIds: Set<string>;
  canonicalSourceIds: Set<string>;
  votes: Map<string, number>;
  existingFormKeys: Set<string>;
  candidateSourceCounts: Map<string, number>;
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

const source = (getArg("source") ?? "lnhpd").toLowerCase();
const diagDir = getArg("diag-dir") ?? `output/form-taxonomy`;
const examplesPath =
  getArg("examples") ?? path.join(diagDir, `mismatch_examples_${source}.jsonl`);
const outputPath =
  getArg("output") ?? path.join(diagDir, `mismatch_remediation_plan_${source}.json`);
const minOccurrence = Math.max(1, Number(getArg("min-occurrence") ?? "3"));
const minConsensus = Math.max(0, Math.min(1, Number(getArg("min-consensus") ?? "0.8")));
const pageSize = Math.max(1, Number(getArg("page-size") ?? "1000"));
const verbose = hasFlag("verbose");

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const toTitleCase = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");

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

const readJsonl = async <T>(filePath: string): Promise<T[]> => {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
};

const fetchFormLabels = async (formKeys: string[]): Promise<Map<string, string>> => {
  const labelByKey = new Map<string, string>();
  for (const chunk of chunkArray(formKeys, 200)) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("ingredient_forms")
        .select("form_key,form_label")
        .in("form_key", chunk)
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const rows = (data ?? []) as IngredientFormLabelRow[];
      rows.forEach((row) => {
        const key = normalizeText(row.form_key ?? "");
        const label = (row.form_label ?? "").trim();
        if (!key || !label) return;
        if (!labelByKey.has(key)) labelByKey.set(key, label);
      });
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
  }
  return labelByKey;
};

const fetchExistingScopedAliases = async (
  ingredientIds: string[],
  aliasNorms: string[],
): Promise<Set<string>> => {
  const keyset = new Set<string>();
  if (!ingredientIds.length || !aliasNorms.length) return keyset;

  for (const ingredientChunk of chunkArray(ingredientIds, 100)) {
    for (const normChunk of chunkArray(aliasNorms, 100)) {
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from("ingredient_form_aliases")
          .select("ingredient_id,alias_norm,form_key")
          .in("ingredient_id", ingredientChunk)
          .in("alias_norm", normChunk)
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        const rows = (data ?? []) as ExistingAliasRow[];
        rows.forEach((row) => {
          const ingredientId = (row.ingredient_id ?? "").trim();
          const aliasNorm = normalizeText(row.alias_norm ?? "");
          const formKey = normalizeText(row.form_key ?? "");
          if (!ingredientId || !aliasNorm || !formKey) return;
          keyset.add(`${ingredientId}\u0001${aliasNorm}\u0001${formKey}`);
        });
        if (rows.length < pageSize) break;
        offset += pageSize;
      }
    }
  }
  return keyset;
};

const run = async () => {
  const rows = await readJsonl<MismatchExampleRow>(examplesPath);
  const groups = new Map<string, GroupBucket>();

  rows.forEach((row) => {
    const ingredientId = (row.ingredientId ?? "").trim();
    const matchAttempt = row.matchAttempt ?? {};
    const candidateNormalized = normalizeText(matchAttempt.candidateNormalized ?? "");
    if (!ingredientId || !candidateNormalized) return;

    const key = `${ingredientId}\u0001${candidateNormalized}`;
    const bucket =
      groups.get(key) ??
      {
        ingredientId,
        candidateNormalized,
        candidateTextCounts: new Map<string, number>(),
        sourceIds: new Set<string>(),
        canonicalSourceIds: new Set<string>(),
        votes: new Map<string, number>(),
        existingFormKeys: new Set<string>(),
        candidateSourceCounts: new Map<string, number>(),
      };

    const sourceId = (row.sourceId ?? "").trim();
    if (sourceId) bucket.sourceIds.add(sourceId);
    const canonicalSourceId = (row.canonicalSourceId ?? "").trim();
    if (canonicalSourceId) bucket.canonicalSourceIds.add(canonicalSourceId);

    const candidateText = (matchAttempt.candidateText ?? "").trim();
    if (candidateText) {
      bucket.candidateTextCounts.set(
        candidateText,
        (bucket.candidateTextCounts.get(candidateText) ?? 0) + 1,
      );
    }

    const sourceLabel = (matchAttempt.candidateSource ?? "").trim();
    if (sourceLabel) {
      bucket.candidateSourceCounts.set(
        sourceLabel,
        (bucket.candidateSourceCounts.get(sourceLabel) ?? 0) + 1,
      );
    }

    const voteKeys = Array.from(
      new Set(
        (matchAttempt.aliasMatchedFormKeys ?? [])
          .map((formKey) => normalizeText(formKey ?? ""))
          .filter(Boolean),
      ),
    );
    voteKeys.forEach((voteKey) => {
      bucket.votes.set(voteKey, (bucket.votes.get(voteKey) ?? 0) + 1);
    });

    (matchAttempt.formsAvailable ?? []).forEach((form) => {
      const formKey = normalizeText(form.formKey ?? "");
      if (formKey) bucket.existingFormKeys.add(formKey);
    });

    groups.set(key, bucket);
  });

  const grouped = Array.from(groups.values());
  const candidateFormKeys = Array.from(
    new Set(
      grouped.flatMap((group) => Array.from(group.votes.keys())),
    ),
  );
  const labelByFormKey = await fetchFormLabels(candidateFormKeys);

  const prelimFormRows: PlanFormRow[] = [];
  const prelimAliasRows: PlanAliasRow[] = [];
  const reviewQueue: PlanReviewRow[] = [];

  grouped.forEach((group) => {
    const occurrence = group.sourceIds.size;
    const votes = Array.from(group.votes.entries())
      .map(([formKey, count]) => ({
        form_key: formKey,
        count,
        ratio: occurrence > 0 ? Number((count / occurrence).toFixed(4)) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const top = votes[0] ?? null;
    const second = votes[1] ?? null;
    const consensus = top && occurrence > 0 ? top.count / occurrence : 0;
    const hasAmbiguousConsensus = Boolean(top && second && second.count === top.count);
    const candidateTextSample =
      Array.from(group.candidateTextCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      group.candidateNormalized;

    const review = (reason: PlanReviewRow["reason"]) => {
      reviewQueue.push({
        ingredient_id: group.ingredientId,
        candidate_normalized: group.candidateNormalized,
        candidate_text_sample: candidateTextSample,
        occurrence,
        consensus: Number(consensus.toFixed(4)),
        top_form_key: top?.form_key ?? null,
        votes,
        reason,
        source_ids: Array.from(group.sourceIds).sort(),
      });
    };

    if (!top) {
      review("no_form_key_votes");
      return;
    }
    if (occurrence < minOccurrence) {
      review("occurrence_below_threshold");
      return;
    }
    if (consensus < minConsensus) {
      review("consensus_below_threshold");
      return;
    }
    if (hasAmbiguousConsensus) {
      review("ambiguous_consensus");
      return;
    }

    const formKey = top.form_key;
    const formLabel =
      labelByFormKey.get(formKey) ??
      toTitleCase(formKey.replace(/\s+/g, " ").trim()) ??
      formKey;

    if (!group.existingFormKeys.has(formKey)) {
      prelimFormRows.push({
        ingredient_id: group.ingredientId,
        form_key: formKey,
        form_label: formLabel,
        occurrence,
        consensus: Number(consensus.toFixed(4)),
        candidate_normalized: group.candidateNormalized,
        source_ids: Array.from(group.sourceIds).sort(),
      });
    }

    const dominantSource =
      Array.from(group.candidateSourceCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "form_raw";
    if (dominantSource === "form_raw") {
      prelimAliasRows.push({
        ingredient_id: group.ingredientId,
        alias_text: candidateTextSample,
        alias_norm: group.candidateNormalized,
        form_key: formKey,
        occurrence,
        consensus: Number(consensus.toFixed(4)),
        candidate_normalized: group.candidateNormalized,
        source_ids: Array.from(group.sourceIds).sort(),
      });
    }
  });

  const aliasIngredientIds = Array.from(
    new Set(prelimAliasRows.map((row) => row.ingredient_id)),
  );
  const aliasNorms = Array.from(
    new Set(prelimAliasRows.map((row) => row.alias_norm)),
  );
  const existingAliasScoped = await fetchExistingScopedAliases(aliasIngredientIds, aliasNorms);
  const aliases = prelimAliasRows.filter((row) => {
    const key = `${row.ingredient_id}\u0001${row.alias_norm}\u0001${normalizeText(row.form_key)}`;
    return !existingAliasScoped.has(key);
  });

  const formsDedupMap = new Map<string, PlanFormRow>();
  prelimFormRows.forEach((row) => {
    const key = `${row.ingredient_id}\u0001${normalizeText(row.form_key)}`;
    if (!formsDedupMap.has(key)) formsDedupMap.set(key, row);
  });
  const forms = Array.from(formsDedupMap.values()).sort((a, b) =>
    a.ingredient_id === b.ingredient_id
      ? a.form_key.localeCompare(b.form_key)
      : a.ingredient_id.localeCompare(b.ingredient_id),
  );

  const aliasDedupMap = new Map<string, PlanAliasRow>();
  aliases.forEach((row) => {
    const key = `${row.ingredient_id}\u0001${row.alias_norm}\u0001${normalizeText(row.form_key)}`;
    if (!aliasDedupMap.has(key)) aliasDedupMap.set(key, row);
  });
  const aliasRows = Array.from(aliasDedupMap.values()).sort((a, b) =>
    a.ingredient_id === b.ingredient_id
      ? a.alias_norm.localeCompare(b.alias_norm)
      : a.ingredient_id.localeCompare(b.ingredient_id),
  );

  reviewQueue.sort((a, b) =>
    a.occurrence === b.occurrence
      ? a.candidate_normalized.localeCompare(b.candidate_normalized)
      : b.occurrence - a.occurrence,
  );

  const output = {
    source,
    generatedAt: new Date().toISOString(),
    rules: {
      scope: "ingredient_id_scoped_only",
      minOccurrence,
      minConsensus,
      formKeyPriorityOverAlias: true,
      globalAliasWritesAllowed: false,
    },
    summary: {
      groupedCandidates: grouped.length,
      formsToInsert: forms.length,
      aliasesToInsert: aliasRows.length,
      reviewQueue: reviewQueue.length,
    },
    forms,
    aliases: aliasRows,
    review_queue: reviewQueue,
  };

  await ensureDir(outputPath);
  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

  if (verbose) {
    console.log(JSON.stringify(output.summary, null, 2));
  }
  console.log(`[mismatch-plan] wrote ${outputPath}`);
};

run().catch((error) => {
  console.error(
    "[mismatch-plan] failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
