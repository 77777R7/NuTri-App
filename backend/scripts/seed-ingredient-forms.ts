import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import {
  dedupeSeedRows,
  normalizeFormKey,
  partitionSeedRowsByExisting,
  buildSeedKey,
  type ExistingFormRow,
  type SeedRow,
} from "../src/ingredientFormsSeedUtils.js";

type ProductIngredientSourceRow = {
  source: string | null;
  source_id: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string): boolean => args.includes(`--${flag}`);

const seedPath = getArg("seed");
if (!seedPath) {
  throw new Error("[seed-ingredient-forms] --seed is required");
}

const targetsPath = getArg("targets");
const outputDir =
  getArg("output-dir") ??
  path.join("output", "ingredient_forms_seed", new Date().toISOString().replace(/[:.]/g, "-"));
const batchSize = Math.max(1, Number(getArg("batch-size") ?? "200"));
const apply = hasFlag("apply");
const dryRunFlag = hasFlag("dry-run");

if (apply && dryRunFlag) {
  throw new Error("[seed-ingredient-forms] --apply and --dry-run are mutually exclusive");
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const normalizeComparableString = (value: string | null | undefined): string =>
  (value ?? "").trim();

const normalizeComparableGrade = (value: string | null | undefined): string =>
  normalizeComparableString(value).toUpperCase();

const normalizeComparableAuditStatus = (value: string | null | undefined): string =>
  normalizeComparableString(value).toLowerCase();

const asFiniteNumberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const numbersEqual = (a: number | null, b: number | null): boolean => {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= 1e-9;
};

const isNoopUpdate = (incoming: SeedRow, existing: ExistingFormRow | null): boolean => {
  if (!existing) return false;
  return (
    normalizeComparableString(incoming.form_label) === normalizeComparableString(existing.form_label) &&
    numbersEqual(asFiniteNumberOrNull(incoming.relative_factor), asFiniteNumberOrNull(existing.relative_factor)) &&
    numbersEqual(asFiniteNumberOrNull(incoming.confidence), asFiniteNumberOrNull(existing.confidence)) &&
    normalizeComparableGrade(incoming.evidence_grade) === normalizeComparableGrade(existing.evidence_grade) &&
    normalizeComparableAuditStatus(incoming.audit_status) === normalizeComparableAuditStatus(existing.audit_status)
  );
};

const ensureDir = async (dirPath: string) => {
  await mkdir(dirPath, { recursive: true });
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const parseSeedLine = (line: string): SeedRow | null => {
  try {
    const parsed = JSON.parse(line) as Partial<SeedRow>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.ingredient_id !== "string" || !parsed.ingredient_id.trim()) return null;
    if (typeof parsed.form_key !== "string" || !parsed.form_key.trim()) return null;
    const sourceLayer = parsed.source_layer;
    if (
      sourceLayer !== "reviewed_package" &&
      sourceLayer !== "explicit_as_form" &&
      sourceLayer !== "unspecified_fallback"
    ) {
      return null;
    }
    const targetOrigin =
      parsed.target_origin === "r1" ||
      parsed.target_origin === "topn" ||
      parsed.target_origin === "r1+topn"
        ? parsed.target_origin
        : "topn";

    const confidenceRaw =
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? parsed.confidence
        : 0.5;
    const relativeRaw =
      typeof parsed.relative_factor === "number" && Number.isFinite(parsed.relative_factor)
        ? parsed.relative_factor
        : 1;

    return {
      ingredient_id: parsed.ingredient_id.trim(),
      form_key: normalizeFormKey(parsed.form_key),
      form_label:
        typeof parsed.form_label === "string" && parsed.form_label.trim().length > 0
          ? parsed.form_label.trim()
          : normalizeFormKey(parsed.form_key),
      relative_factor: relativeRaw,
      confidence: clamp(confidenceRaw, 0, 1),
      evidence_grade:
        typeof parsed.evidence_grade === "string" && parsed.evidence_grade.trim().length > 0
          ? parsed.evidence_grade.trim().toUpperCase()
          : null,
      audit_status: parsed.audit_status === "verified" ? "verified" : "derived",
      source_layer: sourceLayer,
      quality_gate:
        parsed.quality_gate === "passed" ||
        parsed.quality_gate === "denied" ||
        parsed.quality_gate === "downgraded"
          ? parsed.quality_gate
          : undefined,
      source_reason:
        typeof parsed.source_reason === "string" && parsed.source_reason.trim().length > 0
          ? parsed.source_reason.trim()
          : sourceLayer,
      target_origin: targetOrigin,
      source_refs: Array.isArray(parsed.source_refs)
        ? parsed.source_refs
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        : [],
    };
  } catch {
    return null;
  }
};

const readSeedRows = async (filePath: string): Promise<SeedRow[]> => {
  const raw = await readFile(filePath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map(parseSeedLine).filter((row): row is SeedRow => Boolean(row));
};

const fetchExistingRows = async (ingredientIds: string[]): Promise<Map<string, ExistingFormRow>> => {
  const existingByKey = new Map<string, ExistingFormRow>();
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_forms")
      .select("ingredient_id,form_key,form_label,relative_factor,confidence,evidence_grade,audit_status")
      .in("ingredient_id", chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      const typed = row as ExistingFormRow;
      if (!typed.ingredient_id || !typed.form_key) return;
      const key = `${typed.ingredient_id}:${normalizeFormKey(typed.form_key)}`;
      existingByKey.set(key, typed);
    });
  }
  return existingByKey;
};

const fetchRebackfillSourceIds = async (ingredientIds: string[]): Promise<{
  lnhpd: string[];
  dsld: string[];
}> => {
  const lnhpd = new Set<string>();
  const dsld = new Set<string>();

  for (const chunk of chunkArray(ingredientIds, 100)) {
    let cursor: string | null = null;
    while (true) {
      let query = supabase
        .from("product_ingredients")
        .select("id,source,source_id")
        .in("source", ["lnhpd", "dsld"])
        .in("ingredient_id", chunk)
        .order("id", { ascending: true })
        .limit(1000);
      if (cursor) {
        query = query.gt("id", cursor as never);
      }
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as Array<ProductIngredientSourceRow & { id?: string | null }>;
      if (!rows.length) break;
      rows.forEach((row) => {
        if (!row.source_id) return;
        if (row.source === "lnhpd") lnhpd.add(row.source_id);
        if (row.source === "dsld") dsld.add(row.source_id);
      });
      if (rows.length < 1000) break;
      const nextCursor = rows[rows.length - 1]?.id ?? null;
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
  }

  return {
    lnhpd: Array.from(lnhpd).sort((a, b) => a.localeCompare(b)),
    dsld: Array.from(dsld).sort((a, b) => a.localeCompare(b)),
  };
};

const writeJsonl = async (filePath: string, rows: unknown[]) => {
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(filePath, `${body}${body ? "\n" : ""}`, "utf8");
};

const run = async () => {
  await ensureDir(outputDir);

  const sourceSeedRows = await readSeedRows(seedPath);
  const dedupedSeedRows = dedupeSeedRows(sourceSeedRows);

  const ingredientIds = Array.from(new Set(dedupedSeedRows.map((row) => row.ingredient_id))).sort((a, b) =>
    a.localeCompare(b),
  );
  const existingRowsByKey = await fetchExistingRows(ingredientIds);

  const { skippedExisting, skippedLowerPriority, toInsert, toUpdate } = partitionSeedRowsByExisting(
    dedupedSeedRows,
    existingRowsByKey,
  );
  const toUpdateWithExisting = toUpdate.map((row) => {
    const key = buildSeedKey(row);
    const existing = existingRowsByKey.get(key) ?? null;
    return { incoming: row, existing, key };
  });
  const noopUpdates = toUpdateWithExisting.filter((entry) => isNoopUpdate(entry.incoming, entry.existing));
  const realUpdates = toUpdateWithExisting.filter((entry) => !isNoopUpdate(entry.incoming, entry.existing));
  const toUpdateReal = realUpdates.map((entry) => entry.incoming);
  const toUpsert = [...toInsert, ...toUpdateReal];

  const updateKeySet = new Set(toUpdateReal.map((row) => buildSeedKey(row)));
  const preview = toUpsert.slice(0, 20).map((row) => ({
    action: updateKeySet.has(buildSeedKey(row)) ? "update" : "insert",
    ...row,
  }));
  const upgradableExisting = realUpdates;
  const skippedNoop = noopUpdates;
  const skippedExistingWithCurrent = skippedExisting.map((row) => {
    const key = buildSeedKey(row);
    return {
      incoming: row,
      existing: existingRowsByKey.get(key) ?? null,
      key,
    };
  });

  const dryRunSummary = {
    generatedAt: new Date().toISOString(),
    seedInputPath: seedPath,
    targetsInputPath: targetsPath ?? null,
    outputDir,
    apply,
    seedInputRows: sourceSeedRows.length,
    seedDedupedRows: dedupedSeedRows.length,
    ingredientCount: ingredientIds.length,
    existingConflictCount: skippedExisting.length + toUpdate.length,
    wouldInsert: toInsert.length,
    wouldUpdate: toUpdate.length,
    wouldUpdateReal: toUpdateReal.length,
    wouldUpdateNoop: noopUpdates.length,
    skippedExisting: skippedExisting.length,
    skippedNoop: noopUpdates.length,
    skippedLowerPriority: skippedLowerPriority.length,
    upsertCandidateCount: toUpsert.length,
    preview,
  };

  const normalizedSeedPath = path.join(outputDir, "seed.jsonl");
  const dryRunSummaryPath = path.join(outputDir, "dry_run_summary.json");
  const skippedExistingPath = path.join(outputDir, "skipped_existing.jsonl");
  const skippedNoopPath = path.join(outputDir, "skipped_noop.jsonl");
  const updatedExistingPath = path.join(outputDir, "updated_existing.jsonl");
  const appliedRowsPath = path.join(outputDir, "applied_rows.jsonl");
  const touchedIngredientPath = path.join(outputDir, "touched_ingredient_ids.json");
  const rebackfillLnhpdPath = path.join(outputDir, "rebackfill_source_ids_lnhpd.json");
  const rebackfillDsldPath = path.join(outputDir, "rebackfill_source_ids_dsld.json");

  await writeJsonl(normalizedSeedPath, dedupedSeedRows);
  await writeFile(dryRunSummaryPath, JSON.stringify(dryRunSummary, null, 2), "utf8");
  await writeJsonl(skippedExistingPath, skippedExistingWithCurrent);
  await writeJsonl(skippedNoopPath, skippedNoop);
  await writeJsonl(updatedExistingPath, upgradableExisting);

  if (targetsPath) {
    const targetCopyPath = path.join(outputDir, "targets.json");
    const sourceResolved = path.resolve(targetsPath);
    const targetResolved = path.resolve(targetCopyPath);
    if (sourceResolved !== targetResolved) {
      await cp(targetsPath, targetCopyPath);
    }
  }

  if (!apply) {
    await writeJsonl(appliedRowsPath, []);
    await writeFile(touchedIngredientPath, JSON.stringify({ ingredientIds: [] }, null, 2), "utf8");
    await writeFile(
      rebackfillLnhpdPath,
      JSON.stringify({ source: "lnhpd", sourceIds: [], count: 0 }, null, 2),
      "utf8",
    );
    await writeFile(
      rebackfillDsldPath,
      JSON.stringify({ source: "dsld", sourceIds: [], count: 0 }, null, 2),
      "utf8",
    );

    console.log(
      `[seed-ingredient-forms] dry-run seed=${sourceSeedRows.length} deduped=${dedupedSeedRows.length} insert=${toInsert.length} updateReal=${toUpdateReal.length} updateNoop=${noopUpdates.length} skippedExisting=${skippedExisting.length} skippedLowerPriority=${skippedLowerPriority.length} toUpsert=${toUpsert.length}`,
    );
    console.log(`[seed-ingredient-forms] outputDir=${outputDir}`);
    return;
  }

  for (const [index, batch] of chunkArray(toUpsert, batchSize).entries()) {
    const payload = batch.map((row) => ({
      ingredient_id: row.ingredient_id,
      form_key: row.form_key,
      form_label: row.form_label,
      relative_factor: row.relative_factor,
      confidence: row.confidence,
      evidence_grade: row.evidence_grade,
      audit_status: row.audit_status,
    }));

    // eslint-disable-next-line no-await-in-loop
    const { error } = await supabase
      .from("ingredient_forms")
      .upsert(payload, { onConflict: "ingredient_id,form_key" });
    if (error) {
      throw new Error(`[seed-ingredient-forms] upsert batch ${index + 1} failed: ${error.message}`);
    }
  }

  const touchedIngredientIds = Array.from(new Set(toUpsert.map((row) => row.ingredient_id))).sort((a, b) =>
    a.localeCompare(b),
  );
  const rebackfill = await fetchRebackfillSourceIds(touchedIngredientIds);

  await writeJsonl(appliedRowsPath, toUpsert);
  await writeFile(
    touchedIngredientPath,
    JSON.stringify({ ingredientIds: touchedIngredientIds, count: touchedIngredientIds.length }, null, 2),
    "utf8",
  );
  await writeFile(
    rebackfillLnhpdPath,
    JSON.stringify({ source: "lnhpd", sourceIds: rebackfill.lnhpd, count: rebackfill.lnhpd.length }, null, 2),
    "utf8",
  );
  await writeFile(
    rebackfillDsldPath,
    JSON.stringify({ source: "dsld", sourceIds: rebackfill.dsld, count: rebackfill.dsld.length }, null, 2),
    "utf8",
  );

  console.log(
    `[seed-ingredient-forms] apply complete inserted=${toInsert.length} updated=${toUpdateReal.length} skippedNoop=${noopUpdates.length} skippedExisting=${skippedExisting.length} skippedLowerPriority=${skippedLowerPriority.length} touchedIngredients=${touchedIngredientIds.length}`,
  );
  console.log(`[seed-ingredient-forms] outputDir=${outputDir}`);
};

run().catch((error) => {
  console.error("[seed-ingredient-forms] failed:", error);
  process.exit(1);
});
