import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { V4_SCORE_VERSION } from "../src/scoring/v4ScoreEngine.js";

type ScoreSource = "dsld" | "lnhpd";

type ProductScoreRow = {
  source_id: string;
};

type ProductIngredientRow = {
  source_id: string;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string;
  name_key: string | null;
  is_active: boolean;
};

type MissingIngredientEntry = {
  nameKey: string;
  count: number;
  sourceCount: number;
  nameRawSamples: string[];
  sourceIdSamples: string[];
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
const topN = Math.max(1, Number(getArg("top-n") ?? "200"));
const sourceIdsFile = getArg("source-ids-file");
const idColumn = (getArg("id-column") ?? "source_id").toLowerCase();
const outPath =
  getArg("output") ??
  `output/ingredient-identity/ingredient-id-missing-${sourceArg}.json`;

const normalizeNameKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const DSLD_EXCLUDED_NAME_KEYS = new Set([
  "calories",
  "calories from fat",
  "total calories",
  "total fat",
  "fat",
  "saturated fat",
  "trans fat",
  "cholesterol",
  "sodium",
  "total carbohydrates",
  "total carbohydrate",
  "carbohydrates",
  "net carbohydrates",
  "dietary fiber",
  "total sugars",
  "added sugars",
  "sugars",
  "sugar",
  "protein",
  "polyunsaturated fat",
  "monounsaturated fat",
  "monounsatured fat",
  "total omega 3 5 6 7 9 11",
  "proprietary blend",
  "proprietary herbal blend",
  "proprietary extract blend",
  "proprietary blend combination",
  "proprietary blend herb botanical",
  "active ingredients",
  "amino acid profile",
  "typical amino acid profile",
  "essential fatty acid blend",
  "antioxidant blend",
  "antioxidant complex",
  "energy blend",
  "explosive energy blend",
  "herbal blend",
  "herbal proprietary blend",
  "proprietary sports blend",
  "proprietary performance blend",
  "proprietary branched chain ethyl ester amino acid matrix",
  "advanced 3x nitric oxide booster",
  "energy rush",
  "focus enhancer",
  "rapid hydration surge",
  "muscle glucose primer",
  "strength blend",
  "digestive enzyme blend",
  "enzyme blend",
  "norepiphex alpha2 andregenic blockade complex",
  "norepiphex m maoxidizor i",
  "thyromimetic activity stimulator",
  "ultra concentrated fat destroying complex",
  "designer whey full spectrum whey peptides delivery proprietary blend",
  "cerecalase proprietary blend",
  "multi enzyme blend",
  "hydroxycut shape blend",
  "typical branched chain amino acid profile",
  "trace elements",
  "fatty acid composition",
  "novel high molecular weight carb blend",
  "normaglan concentrate proprietary blend",
  "processed by the method of siddha ghruta in",
  "dna",
  "edta",
  "water",
  "mass peak",
  "nitro peak",
]);

const isDsldExcludedKey = (key: string): boolean => DSLD_EXCLUDED_NAME_KEYS.has(key);

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
  column: "source_id" | "canonical_source_id",
  sourceIds: string[],
): Promise<ProductIngredientRow[]> => {
  const rows: ProductIngredientRow[] = [];
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("product_ingredients")
      .select(
        "source_id,canonical_source_id,ingredient_id,name_raw,name_key,is_active",
      )
      .eq("source", source)
      .in(column, chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as ProductIngredientRow[]));
  }
  return rows;
};

const pickTopSamples = (map: Map<string, number>, limitSamples = 3): string[] =>
  Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limitSamples)
    .map(([name]) => name);

const run = async () => {
  const source = sourceArg === "dsld" ? "dsld" : "lnhpd";
  const column = idColumn === "canonical_source_id" ? "canonical_source_id" : "source_id";
  const sourceIds = sourceIdsFile
    ? await readSourceIds(sourceIdsFile)
    : (await fetchScores(source, limit)).map((row) => row.source_id);

  if (!sourceIds.length) {
    throw new Error(`[ingredient-missing] no source IDs found for ${source}`);
  }

  const ingredients = await fetchIngredients(source, column, sourceIds);
  let excludedRows = 0;
  const activeMissing = ingredients.filter((row) => {
    if (!row.is_active || row.ingredient_id) return false;
    if (source === "dsld") {
      const key = row.name_key ?? normalizeNameKey(row.name_raw);
      if (key && isDsldExcludedKey(key)) {
        excludedRows += 1;
        return false;
      }
    }
    return true;
  });

  const countsByNameKey = new Map<string, number>();
  const nameSamples = new Map<string, Map<string, number>>();
  const sourceSamples = new Map<string, Map<string, number>>();
  const sourceKey = (row: ProductIngredientRow) =>
    column === "canonical_source_id"
      ? row.canonical_source_id ?? row.source_id
      : row.source_id;

  activeMissing.forEach((row) => {
    const key = row.name_key ?? normalizeNameKey(row.name_raw);
    if (!key) return;
    countsByNameKey.set(key, (countsByNameKey.get(key) ?? 0) + 1);

    const nameMap = nameSamples.get(key) ?? new Map<string, number>();
    nameMap.set(row.name_raw, (nameMap.get(row.name_raw) ?? 0) + 1);
    nameSamples.set(key, nameMap);

    const id = sourceKey(row);
    if (id) {
      const sourceMap = sourceSamples.get(key) ?? new Map<string, number>();
      sourceMap.set(id, (sourceMap.get(id) ?? 0) + 1);
      sourceSamples.set(key, sourceMap);
    }
  });

  const entries: MissingIngredientEntry[] = Array.from(countsByNameKey.entries())
    .map(([nameKey, count]) => {
      const nameMap = nameSamples.get(nameKey) ?? new Map<string, number>();
      const sourceMap = sourceSamples.get(nameKey) ?? new Map<string, number>();
      return {
        nameKey,
        count,
        sourceCount: sourceMap.size,
        nameRawSamples: pickTopSamples(nameMap),
        sourceIdSamples: pickTopSamples(sourceMap),
      };
    })
    .sort((a, b) => b.count - a.count);

  const summary = {
    source,
    idColumn: column,
    sampleSize: sourceIds.length,
    activeMissingRows: activeMissing.length,
    uniqueMissingKeys: entries.length,
    excludedRows: source === "dsld" ? excludedRows : 0,
    generatedAt: new Date().toISOString(),
  };

  const output = {
    summary,
    topMissing: entries.slice(0, topN),
  };

  await ensureDir(outPath);
  await writeFile(outPath, JSON.stringify(output, null, 2), "utf8");

  console.log(
    `[ingredient-missing] source=${source} sample=${sourceIds.length} missing=${entries.length} output=${outPath}`,
  );
};

run().catch((error) => {
  console.error("[ingredient-missing] failed:", error);
  process.exit(1);
});
