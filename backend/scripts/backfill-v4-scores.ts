import { supabase } from "../src/supabase.js";
import { upsertProductIngredientsFromLabelFacts } from "../src/productIngredients.js";
import { computeScoreBundleV4, computeV4InputsHash, V4_SCORE_VERSION } from "../src/scoring/v4ScoreEngine.js";
import type { ScoreBundleV4, ScoreSource } from "../src/types.js";

type LabelFactsInput = {
  actives: { name: string; amount: number | null; unit: string | null }[];
  inactive: string[];
  proprietaryBlends: {
    name: string;
    totalAmount: number | null;
    unit: string | null;
    ingredients: string[] | null;
  }[];
};

type DsldFactsRow = {
  dsld_label_id: number | string | null;
  facts_json: unknown;
};

type LnhpdFactsRow = {
  lnhpd_id: number | string | null;
  npn: string | null;
  facts_json: unknown;
};

const args = process.argv.slice(2);
const hasFlag = (flag: string) => args.includes(`--${flag}`);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeUnitLabel = (unitRaw?: string | null): string | null => {
  if (!unitRaw) return null;
  const normalized = unitRaw.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized.startsWith("mcg") ||
    normalized.startsWith("ug") ||
    normalized.startsWith("\u00b5g") ||
    normalized.startsWith("\u03bcg") ||
    normalized.startsWith("microgram")
  ) {
    return "mcg";
  }
  if (normalized.startsWith("mg") || normalized.startsWith("milligram")) return "mg";
  if (normalized.startsWith("g") || normalized.startsWith("gram")) return "g";
  if (normalized.startsWith("iu") || normalized.startsWith("i.u")) return "iu";
  if (normalized.startsWith("ml") || normalized.startsWith("milliliter") || normalized.startsWith("millilitre")) {
    return "ml";
  }
  if (normalized.includes("cfu") || normalized.includes("ufc")) return "cfu";
  if (normalized.startsWith("kcal")) return "kcal";
  if (normalized.startsWith("cal")) return "cal";
  if (normalized.startsWith("%") || normalized.includes("percent")) return "%";
  return normalized;
};

const parseCfuMultiplier = (unitLower: string): number | null => {
  if (!unitLower.includes("cfu") && !unitLower.includes("ufc")) return null;
  if (unitLower.includes("trillion")) return 1_000_000_000_000;
  if (unitLower.includes("billion")) return 1_000_000_000;
  if (unitLower.includes("million")) return 1_000_000;
  return 1;
};

const normalizeAmountAndUnit = (
  amount: number | null,
  unitRaw?: string | null,
): { amount: number | null; unit: string | null } => {
  if (!unitRaw) return { amount, unit: null };
  const normalizedUnit = normalizeUnitLabel(unitRaw) ?? unitRaw.trim();
  if (amount == null) return { amount, unit: normalizedUnit };
  const unitLower = unitRaw.trim().toLowerCase();
  const cfuMultiplier = parseCfuMultiplier(unitLower);
  if (cfuMultiplier) {
    return { amount: amount * cfuMultiplier, unit: "cfu" };
  }
  return { amount, unit: normalizedUnit };
};

const normalizeNameKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const pickStringField = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const pickNameField = (record: Record<string, unknown>, keys: string[]): string | null => {
  const direct = pickStringField(record, keys);
  if (direct) return direct;
  for (const [key, value] of Object.entries(record)) {
    if (!key.toLowerCase().includes("name")) continue;
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const pickNumberField = (record: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const parsed = parseNumber(record[key]);
    if (parsed != null) return parsed;
  }
  return null;
};

const extractTextList = (payload: unknown, nameKeys: string[]): string[] => {
  if (!Array.isArray(payload)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  payload.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const name = pickNameField(item as Record<string, unknown>, nameKeys);
    if (!name) return;
    const normalized = normalizeNameKey(name);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(name);
  });
  return output;
};

const extractLnhpdIngredients = (payload: unknown, options: {
  nameKeys: string[];
  amountKeys: string[];
  unitKeys: string[];
}): { name: string; amount: number | null; unit: string | null }[] => {
  if (!Array.isArray(payload)) return [];
  const map = new Map<string, { name: string; amount: number | null; unit: string | null }>();
  payload.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const name = pickNameField(record, options.nameKeys);
    if (!name) return;
    const amount = pickNumberField(record, options.amountKeys);
    const unitRaw = pickStringField(record, options.unitKeys);
    const { amount: normalizedAmount, unit } = normalizeAmountAndUnit(amount, unitRaw);
    const key = normalizeNameKey(name);
    if (!key) return;
    const existing = map.get(key);
    const candidate = {
      name,
      amount: normalizedAmount ?? null,
      unit: unit ?? null,
    };
    if (!existing) {
      map.set(key, candidate);
      return;
    }
    if (existing.amount == null && candidate.amount != null) {
      map.set(key, candidate);
    }
  });
  return Array.from(map.values());
};

const LNHPD_MEDICINAL_NAME_KEYS = [
  "medicinal_ingredient_name",
  "ingredient_name",
  "medicinal_ingredient_name_en",
  "ingredient_name_en",
  "proper_name",
  "substance_name",
  "name",
];

const LNHPD_NON_MEDICINAL_NAME_KEYS = [
  "nonmedicinal_ingredient_name",
  "non_medicinal_ingredient_name",
  "ingredient_name",
  "name",
];

const LNHPD_AMOUNT_KEYS = [
  "quantity",
  "quantity_value",
  "quantity_amount",
  "strength",
  "strength_value",
  "amount",
  "dose",
  "dosage",
];

const LNHPD_UNIT_KEYS = [
  "quantity_unit",
  "quantity_unit_of_measure",
  "unit",
  "unit_of_measure",
  "strength_unit",
  "dose_unit",
  "dosage_unit",
];

const normalizeStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/;|•/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const buildDsldLabelFacts = (factsJson: unknown): LabelFactsInput | null => {
  if (!factsJson || typeof factsJson !== "object") return null;
  const record = factsJson as Record<string, unknown>;
  const activesRaw = Array.isArray(record.actives) ? record.actives : [];
  const actives = activesRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = typeof (item as { name?: unknown }).name === "string" ? String((item as { name?: unknown }).name).trim() : "";
      if (!name) return null;
      const amount = parseNumber((item as { amount?: unknown }).amount);
      const unit = typeof (item as { unit?: unknown }).unit === "string" ? String((item as { unit?: unknown }).unit).trim() : null;
      return { name, amount, unit };
    })
    .filter((item): item is { name: string; amount: number | null; unit: string | null } => Boolean(item));

  const inactive = normalizeStringList(record.inactive);

  const blendsRaw = Array.isArray(record.proprietaryBlends) ? record.proprietaryBlends : [];
  const proprietaryBlends = blendsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = typeof (item as { name?: unknown }).name === "string" ? String((item as { name?: unknown }).name).trim() : "";
      if (!name) return null;
      const totalAmount = parseNumber((item as { totalAmount?: unknown }).totalAmount);
      const unit = typeof (item as { unit?: unknown }).unit === "string" ? String((item as { unit?: unknown }).unit).trim() : null;
      const ingredients = normalizeStringList((item as { ingredients?: unknown }).ingredients);
      return {
        name,
        totalAmount,
        unit,
        ingredients: ingredients.length ? ingredients : null,
      };
    })
    .filter((item): item is LabelFactsInput["proprietaryBlends"][number] => Boolean(item));

  return {
    actives,
    inactive,
    proprietaryBlends,
  };
};

const buildLnhpdLabelFacts = (factsJson: unknown): LabelFactsInput | null => {
  if (!factsJson || typeof factsJson !== "object") return null;
  const record = factsJson as Record<string, unknown>;
  const actives = extractLnhpdIngredients(record.medicinalIngredients, {
    nameKeys: LNHPD_MEDICINAL_NAME_KEYS,
    amountKeys: LNHPD_AMOUNT_KEYS,
    unitKeys: LNHPD_UNIT_KEYS,
  });
  const inactive = extractTextList(record.nonMedicinalIngredients, LNHPD_NON_MEDICINAL_NAME_KEYS);

  return {
    actives,
    inactive,
    proprietaryBlends: [],
  };
};

const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> => {
  const queue = [...items];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      await worker(item);
    }
  });
  await Promise.all(workers);
};

const upsertScoreBundle = async (params: {
  source: ScoreSource;
  sourceIdForWrite: string;
  canonicalSourceId: string | null;
  bundle: ScoreBundleV4;
  inputsHash: string;
}) => {
  const payload = {
    source: params.source,
    source_id: params.sourceIdForWrite,
    canonical_source_id: params.canonicalSourceId,
    score_version: V4_SCORE_VERSION,
    overall_score: params.bundle.overallScore,
    effectiveness_score: params.bundle.pillars.effectiveness,
    safety_score: params.bundle.pillars.safety,
    integrity_score: params.bundle.pillars.integrity,
    confidence: params.bundle.confidence,
    best_fit_goals: params.bundle.bestFitGoals,
    flags_json: params.bundle.flags,
    highlights_json: params.bundle.highlights,
    explain_json: params.bundle.explain,
    inputs_hash: params.inputsHash,
    computed_at: params.bundle.provenance.computedAt,
  };
  const { error } = await supabase
    .from("product_scores")
    .upsert(payload, { onConflict: "source,source_id" });
  if (error) {
    throw new Error(`product_scores upsert failed: ${error.message}`);
  }
};

const shouldSkipExistingScore = async (source: ScoreSource, sourceId: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from("product_scores")
    .select("id,score_version,inputs_hash")
    .eq("source", source)
    .eq("source_id", sourceId)
    .maybeSingle();
  if (error || !data) return false;
  if (data.score_version !== V4_SCORE_VERSION || !data.inputs_hash) return false;
  const currentHash = await computeV4InputsHash({ source, sourceId });
  if (!currentHash) return false;
  return data.inputs_hash === currentHash;
};

const batchSize = Math.max(1, Number(getArg("batch") ?? process.env.BACKFILL_BATCH_SIZE ?? "200"));
const limit = Math.max(0, Number(getArg("limit") ?? process.env.BACKFILL_LIMIT ?? "0"));
const concurrency = Math.max(1, Number(getArg("concurrency") ?? process.env.BACKFILL_CONCURRENCY ?? "4"));
const sourceArg = (getArg("source") ?? "all").toLowerCase();
const startId = Number(getArg("start-id") ?? "0");
const startDsldId = Number(getArg("start-dsld-id") ?? String(startId ?? 0));
const startLnhpdId = Number(getArg("start-lnhpd-id") ?? String(startId ?? 0));
const dryRun = hasFlag("dry-run");
const skipScores = hasFlag("skip-scores");
const skipIngredients = hasFlag("skip-ingredients");
const force = hasFlag("force");

const targetSources: ScoreSource[] = sourceArg === "all"
  ? ["dsld", "lnhpd"]
  : sourceArg === "dsld"
    ? ["dsld"]
    : sourceArg === "lnhpd"
      ? ["lnhpd"]
      : [];

if (targetSources.length === 0) {
  console.error(`[backfill] invalid source: ${sourceArg}`);
  process.exit(1);
}

const backfillDsld = async () => {
  let processed = 0;
  let writtenIngredients = 0;
  let writtenScores = 0;
  let skipped = 0;
  let skippedExisting = 0; // NEW: Track existing scores
  let lastId = startDsldId;
  let useGte = startDsldId > 0;
  let batch = 0;

  while (true) {
    let query = supabase
      .from("dsld_label_facts")
      .select("dsld_label_id,facts_json")
      .order("dsld_label_id", { ascending: true })
      .limit(batchSize);

    if (useGte) {
      query = query.gte("dsld_label_id", lastId);
    } else if (lastId > 0) {
      query = query.gt("dsld_label_id", lastId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`dsld_label_facts read failed: ${error.message}`);
    }

    const rows = (data ?? []) as DsldFactsRow[];
    if (rows.length === 0) break;

    batch += 1;
    processed += rows.length;
    lastId = parseNumber(rows[rows.length - 1]?.dsld_label_id) ?? lastId;
    useGte = false;

    await runWithConcurrency(rows, concurrency, async (row) => {
      const labelId = parseNumber(row.dsld_label_id);
      if (!labelId) {
        skipped += 1;
        return;
      }

      const labelFacts = buildDsldLabelFacts(row.facts_json);
      if (!labelFacts || (!labelFacts.actives.length && !labelFacts.inactive.length && !labelFacts.proprietaryBlends.length)) {
        skipped += 1;
        return;
      }

      const sourceId = String(labelId);
      if (!skipIngredients && !dryRun) {
        await upsertProductIngredientsFromLabelFacts({
          source: "dsld",
          sourceId,
          canonicalSourceId: sourceId,
          labelFacts,
          basis: "label_serving",
          parseConfidence: 0.9,
        });
        writtenIngredients += 1;
      }

      if (!skipScores) {
        if (!force && (await shouldSkipExistingScore("dsld", sourceId))) {
          skippedExisting += 1; // Count as existing
          return;
        }
        if (dryRun) {
          writtenScores += 1;
          return;
        }
        const computed = await computeScoreBundleV4({ source: "dsld", sourceId });
        if (!computed) {
          console.warn(`[Backfill] Score computation returned null for DSLD ID: ${sourceId} (Check data/logs)`);
          skipped += 1;
          return;
        }
        await upsertScoreBundle({
          source: "dsld",
          sourceIdForWrite: computed.sourceIdForWrite,
          canonicalSourceId: computed.canonicalSourceId,
          bundle: computed.bundle,
          inputsHash: computed.inputsHash,
        });
        writtenScores += 1;
      }
    });

    // Updated Log
    console.log(
      `[backfill:dsld] batch=${batch} processed=${processed} ingredients=${writtenIngredients} scores=${writtenScores} existing=${skippedExisting} skipped=${skipped}`,
    );

    if (limit > 0 && processed >= limit) break;
  }

  console.log(
    `[backfill:dsld] done processed=${processed} ingredients=${writtenIngredients} scores=${writtenScores} existing=${skippedExisting} skipped=${skipped}`,
  );
};

const resolveLnhpdTable = async (): Promise<string> => {
  const { data, error } = await supabase
    .from("lnhpd_facts_complete")
    .select("lnhpd_id")
    .limit(1);
  if (!error && data) return "lnhpd_facts_complete";
  return "lnhpd_facts";
};

const backfillLnhpd = async () => {
  let processed = 0;
  let writtenIngredients = 0;
  let writtenScores = 0;
  let skipped = 0;
  let skippedExisting = 0;
  let lastId = startLnhpdId;
  let useGte = startLnhpdId > 0;
  let batch = 0;
  const table = await resolveLnhpdTable();

  while (true) {
    let query = supabase
      .from(table)
      .select("lnhpd_id,npn,facts_json")
      .order("lnhpd_id", { ascending: true })
      .limit(batchSize);

    if (useGte) {
      query = query.gte("lnhpd_id", lastId);
    } else if (lastId > 0) {
      query = query.gt("lnhpd_id", lastId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`${table} read failed: ${error.message}`);
    }

    const rows = (data ?? []) as LnhpdFactsRow[];
    if (rows.length === 0) break;

    batch += 1;
    processed += rows.length;
    lastId = parseNumber(rows[rows.length - 1]?.lnhpd_id) ?? lastId;
    useGte = false;

    await runWithConcurrency(rows, concurrency, async (row) => {
      const lnhpdId = parseNumber(row.lnhpd_id);
      if (!lnhpdId) {
        skipped += 1;
        return;
      }
      const labelFacts = buildLnhpdLabelFacts(row.facts_json);
      if (!labelFacts || (!labelFacts.actives.length && !labelFacts.inactive.length)) {
        skipped += 1;
        return;
      }

      const sourceId = row.npn?.trim() || String(lnhpdId);
      const canonicalSourceId = String(lnhpdId);

      if (!skipIngredients && !dryRun) {
        await upsertProductIngredientsFromLabelFacts({
          source: "lnhpd",
          sourceId,
          canonicalSourceId,
          labelFacts,
          basis: "label_serving",
          parseConfidence: 0.95,
        });
        writtenIngredients += 1;
      }

      if (!skipScores) {
        if (!force && (await shouldSkipExistingScore("lnhpd", sourceId))) {
          skippedExisting += 1;
          return;
        }
        if (dryRun) {
          writtenScores += 1;
          return;
        }
        const computed = await computeScoreBundleV4({ source: "lnhpd", sourceId });
        if (!computed) {
          console.warn(`[Backfill] Score computation returned null for LNHPD ID: ${sourceId}`);
          skipped += 1;
          return;
        }
        await upsertScoreBundle({
          source: "lnhpd",
          sourceIdForWrite: computed.sourceIdForWrite,
          canonicalSourceId: computed.canonicalSourceId,
          bundle: computed.bundle,
          inputsHash: computed.inputsHash,
        });
        writtenScores += 1;
      }
    });

    console.log(
      `[backfill:lnhpd] batch=${batch} processed=${processed} ingredients=${writtenIngredients} scores=${writtenScores} existing=${skippedExisting} skipped=${skipped}`,
    );

    if (limit > 0 && processed >= limit) break;
  }

  console.log(
    `[backfill:lnhpd] done processed=${processed} ingredients=${writtenIngredients} scores=${writtenScores} existing=${skippedExisting} skipped=${skipped}`,
  );
};

const main = async () => {
  console.log(
    `[backfill] source=${sourceArg} batch=${batchSize} concurrency=${concurrency} limit=${limit || "none"} dryRun=${dryRun}`,
  );
  if (targetSources.includes("dsld")) {
    await backfillDsld();
  }
  if (targetSources.includes("lnhpd")) {
    await backfillLnhpd();
  }
};

main().catch((error) => {
  console.error("[backfill] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
