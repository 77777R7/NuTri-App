import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { V4_SCORE_VERSION } from "../src/scoring/v4ScoreEngine.js";
import { canonicalizeLnhpdFormTokens } from "../src/formTaxonomy/lnhpdFormTokenMap.js";

type ScoreSource = "dsld" | "lnhpd";

type ProductScoreRow = {
  source_id: string;
};

type ProductIngredientRow = {
  source_id: string;
  ingredient_id: string | null;
  name_raw: string;
  form_raw: string | null;
  is_active: boolean;
};

type IngredientMetaRow = {
  id: string;
  name: string | null;
  canonical_key: string | null;
  category: string | null;
  unit: string | null;
};

type MissingFormEntry = {
  ingredientId: string;
  canonicalKey: string | null;
  ingredientName: string | null;
  category: string | null;
  unit: string | null;
  count: number;
  nameSamples: string[];
  formTokenSamples: Array<{ token: string; count: number }>;
  recommendedFormKey: string | null;
  recommendedFormLabel: string | null;
};

const args = process.argv.slice(2);
const getArg = (name: string): string | null => {
  const prefix = `--${name}=`;
  const arg = args.find((value) => value.startsWith(prefix));
  if (arg) return arg.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  if (index !== -1) {
    const next = args[index + 1];
    if (next && !next.startsWith("--")) return next;
  }
  return null;
};

const sourceArg = (getArg("source") ?? "lnhpd").toLowerCase();
const limit = Math.max(1, Number(getArg("limit") ?? "1000"));
const topN = Math.max(1, Number(getArg("top-n") ?? "20"));
const sourceIdsFile = getArg("source-ids-file");
const outPath =
  getArg("output") ??
  `output/ingredient-forms/missing-ingredient-forms-${sourceArg}.json`;
const planOutput =
  getArg("plan-output") ??
  `output/ingredient-forms/missing-ingredient-forms-plan-${sourceArg}.json`;

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const titleCase = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const readSourceIds = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.filter((item): item is string => typeof item === "string");
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as { sourceIds?: unknown };
    if (Array.isArray(record.sourceIds)) {
      return record.sourceIds.filter((item): item is string => typeof item === "string");
    }
  }
  return [];
};

const fetchScores = async (source: ScoreSource, sampleLimit: number): Promise<ProductScoreRow[]> => {
  const { data, error } = await supabase
    .from("product_scores")
    .select("source_id")
    .eq("source", source)
    .eq("score_version", V4_SCORE_VERSION)
    .order("computed_at", { ascending: false })
    .limit(sampleLimit);
  if (error) throw error;
  return (data ?? []) as ProductScoreRow[];
};

const fetchIngredients = async (
  source: ScoreSource,
  sourceIds: string[],
): Promise<ProductIngredientRow[]> => {
  const rows: ProductIngredientRow[] = [];
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("product_ingredients")
      .select("source_id,ingredient_id,name_raw,form_raw,is_active")
      .eq("source", source)
      .in("source_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as ProductIngredientRow[]));
  }
  return rows;
};

const fetchIngredientForms = async (ingredientIds: string[]) => {
  const idsWithForms = new Set<string>();
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_forms")
      .select("ingredient_id")
      .in("ingredient_id", chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      if (row?.ingredient_id) idsWithForms.add(row.ingredient_id);
    });
  }
  return idsWithForms;
};

const fetchIngredientMeta = async (ingredientIds: string[]) => {
  const metaMap = new Map<string, IngredientMetaRow>();
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredients")
      .select("id,name,canonical_key,category,unit")
      .in("id", chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      if (!row?.id) return;
      metaMap.set(row.id, row as IngredientMetaRow);
    });
  }
  return metaMap;
};

const normalizeFormToken = (source: ScoreSource, formRaw: string): string | null => {
  const base = normalizeText(formRaw);
  if (!base) return null;
  if (source === "lnhpd") {
    const tokens = canonicalizeLnhpdFormTokens(base.split(/\s+/));
    const filtered = tokens.filter(
      (token) => token.length > 1 && !/^\d+$/.test(token),
    );
    if (!filtered.length) return null;
    return filtered.join(" ");
  }
  return base;
};

const pickTopSamples = (map: Map<string, number>, limitSamples = 3): string[] =>
  Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limitSamples)
    .map(([name]) => name);

const run = async () => {
  const source = sourceArg === "dsld" ? "dsld" : "lnhpd";
  const sourceIds = sourceIdsFile
    ? await readSourceIds(sourceIdsFile)
    : (await fetchScores(source, limit)).map((row) => row.source_id);

  if (!sourceIds.length) {
    throw new Error(`[diagnose-forms] no source IDs found for ${source}`);
  }

  const ingredients = await fetchIngredients(source, sourceIds);
  const activeRows = ingredients.filter((row) => row.is_active && row.ingredient_id);

  const countsByIngredient = new Map<string, number>();
  const nameCounts = new Map<string, Map<string, number>>();
  const tokenCounts = new Map<string, Map<string, number>>();

  activeRows.forEach((row) => {
    const ingredientId = row.ingredient_id;
    if (!ingredientId) return;
    countsByIngredient.set(ingredientId, (countsByIngredient.get(ingredientId) ?? 0) + 1);

    const nameMap = nameCounts.get(ingredientId) ?? new Map<string, number>();
    nameMap.set(row.name_raw, (nameMap.get(row.name_raw) ?? 0) + 1);
    nameCounts.set(ingredientId, nameMap);

    if (row.form_raw) {
      const token = normalizeFormToken(source, row.form_raw);
      if (token) {
        const tokenMap = tokenCounts.get(ingredientId) ?? new Map<string, number>();
        tokenMap.set(token, (tokenMap.get(token) ?? 0) + 1);
        tokenCounts.set(ingredientId, tokenMap);
      }
    }
  });

  const ingredientIds = Array.from(countsByIngredient.keys());
  const formsSet = await fetchIngredientForms(ingredientIds);
  const missingIds = ingredientIds.filter((id) => !formsSet.has(id));
  const metaMap = await fetchIngredientMeta(missingIds);

  const missingEntries: MissingFormEntry[] = missingIds
    .map((id) => {
      const count = countsByIngredient.get(id) ?? 0;
      const meta = metaMap.get(id);
      const nameMap = nameCounts.get(id) ?? new Map<string, number>();
      const tokenMap = tokenCounts.get(id) ?? new Map<string, number>();
      const tokenSamples = Array.from(tokenMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([token, tokenCount]) => ({ token, count: tokenCount }));

      const topToken = tokenSamples[0]?.token ?? null;
      const recommendedFormKey = topToken ? topToken.replace(/\s+/g, "_") : null;
      const recommendedFormLabel = topToken ? titleCase(topToken) : null;

      return {
        ingredientId: id,
        canonicalKey: meta?.canonical_key ?? null,
        ingredientName: meta?.name ?? null,
        category: meta?.category ?? null,
        unit: meta?.unit ?? null,
        count,
        nameSamples: pickTopSamples(nameMap),
        formTokenSamples: tokenSamples,
        recommendedFormKey,
        recommendedFormLabel,
      };
    })
    .sort((a, b) => b.count - a.count);

  const summary = {
    source,
    sampleSize: sourceIds.length,
    activeRows: activeRows.length,
    missingIngredientFormsCount: missingEntries.length,
    missingIngredientFormsRatio: Number(
      (missingEntries.length / (countsByIngredient.size || 1)).toFixed(4),
    ),
    generatedAt: new Date().toISOString(),
  };

  const output = {
    summary,
    topMissing: missingEntries.slice(0, topN),
  };

  await ensureDir(outPath);
  await writeFile(outPath, JSON.stringify(output, null, 2), "utf8");

  const plan = {
    source,
    generatedAt: summary.generatedAt,
    topN,
    candidates: missingEntries.slice(0, topN),
  };

  await ensureDir(planOutput);
  await writeFile(planOutput, JSON.stringify(plan, null, 2), "utf8");

  console.log(
    `[diagnose-forms] source=${source} sample=${sourceIds.length} missing=${missingEntries.length} output=${outPath}`,
  );
  console.log(`[diagnose-forms] plan=${planOutput} topN=${topN}`);
};

run().catch((error) => {
  console.error("[diagnose-forms] failed:", error);
  process.exit(1);
});
