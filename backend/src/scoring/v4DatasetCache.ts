import { supabase } from "../supabase.js";

export type IngredientMeta = {
  id: string;
  unit: string | null;
  rda_adult: number | null;
  ul_adult: number | null;
  goals: string[] | null;
};

export type IngredientEvidenceRow = {
  id: string;
  ingredient_id: string;
  goal: string;
  min_effective_dose: number | null;
  optimal_dose_range: string | null;
  evidence_grade: string | null;
  audit_status: string | null;
};

export type IngredientFormRow = {
  id: string;
  ingredient_id: string;
  form_key: string;
  form_label: string;
  relative_factor: number | null;
  confidence: number | null;
  evidence_grade: string | null;
  audit_status: string | null;
};

export type IngredientFormAliasRow = {
  id: string;
  alias_text: string;
  alias_norm: string;
  form_key: string;
  ingredient_id: string | null;
  confidence: number | null;
  audit_status: string | null;
  source: string | null;
};

export type DatasetCache = {
  datasetVersion: string | null;
  ingredientMetaById: Map<string, IngredientMeta>;
  evidenceRows: IngredientEvidenceRow[];
  evidenceByIngredientId: Map<string, IngredientEvidenceRow[]>;
  formRows: IngredientFormRow[];
  formByIngredientId: Map<string, IngredientFormRow[]>;
  formAliases: IngredientFormAliasRow[];
  globalFormAliases: IngredientFormAliasRow[];
  aliasesByIngredientId: Map<string, IngredientFormAliasRow[]>;
  evidenceCitationsById: Map<string, string[]>;
  formCitationsById: Map<string, string[]>;
};

let cached: DatasetCache | null = null;
let inflight: Promise<DatasetCache> | null = null;

const PAGE_SIZE = 1000;

const fetchAllPages = async <T>(
  fetchPage: (
    from: number,
    to: number,
  ) => Promise<{ data: T[] | null; error: { message?: string } | null }>,
  label: string,
): Promise<T[]> => {
  const rows: T[] = [];
  let offset = 0;
  let warned = false;

  while (true) {
    const { data, error } = await fetchPage(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.error(`[v4DatasetCache] failed loading ${label}`, error);
      throw error;
    }

    const page = (data ?? []) as T[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
    if (!warned) {
      warned = true;
      console.warn(`[v4DatasetCache] pageSize hit; continuing pagination label=${label} pageSize=${PAGE_SIZE}`);
    }
    offset += PAGE_SIZE;
  }

  return rows;
};

const mapCitations = (rows: Array<{ evidence_id?: string | null; form_id?: string | null; citation_id?: string | null }>, key: "evidence_id" | "form_id") => {
  const map = new Map<string, Set<string>>();
  rows.forEach((row) => {
    const id = row[key];
    const citationId = row.citation_id ?? null;
    if (!id || !citationId) return;
    const bucket = map.get(id) ?? new Set<string>();
    bucket.add(citationId);
    map.set(id, bucket);
  });
  const output = new Map<string, string[]>();
  map.forEach((value, id) => output.set(id, Array.from(value)));
  return output;
};

export const loadDatasetCache = async (): Promise<DatasetCache> => {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    const datasetVersionResultPromise = supabase
      .from("scoring_dataset_state")
      .select("version")
      .eq("key", "ingredient_dataset")
      .maybeSingle();

    const ingredientRowsPromise = fetchAllPages<IngredientMeta>(
      async (from, to) =>
        await supabase
          .from("ingredients")
          .select("id,unit,rda_adult,ul_adult,goals")
          .order("id", { ascending: true })
          .range(from, to),
      "ingredients",
    );

    const evidenceRowsPromise = fetchAllPages<IngredientEvidenceRow>(
      async (from, to) =>
        await supabase
          .from("ingredient_evidence")
          .select("id,ingredient_id,goal,min_effective_dose,optimal_dose_range,evidence_grade,audit_status")
          .order("id", { ascending: true })
          .range(from, to),
      "ingredient_evidence",
    );

    const formRowsPromise = fetchAllPages<IngredientFormRow>(
      async (from, to) =>
        await supabase
          .from("ingredient_forms")
          .select("id,ingredient_id,form_key,form_label,relative_factor,confidence,evidence_grade,audit_status")
          .order("id", { ascending: true })
          .range(from, to),
      "ingredient_forms",
    );

    const aliasRowsPromise = fetchAllPages<IngredientFormAliasRow>(
      async (from, to) =>
        await supabase
          .from("ingredient_form_aliases")
          .select("id,alias_text,alias_norm,form_key,ingredient_id,confidence,audit_status,source")
          .order("id", { ascending: true })
          .range(from, to),
      "ingredient_form_aliases",
    );

    const evidenceCitationRowsPromise = fetchAllPages<{ evidence_id?: string | null; citation_id?: string | null }>(
      async (from, to) =>
        await supabase
          .from("ingredient_evidence_citations")
          .select("evidence_id,citation_id")
          .order("evidence_id", { ascending: true })
          .order("citation_id", { ascending: true })
          .range(from, to),
      "ingredient_evidence_citations",
    );

    const formCitationRowsPromise = fetchAllPages<{ form_id?: string | null; citation_id?: string | null }>(
      async (from, to) =>
        await supabase
          .from("ingredient_form_citations")
          .select("form_id,citation_id")
          .order("form_id", { ascending: true })
          .order("citation_id", { ascending: true })
          .range(from, to),
      "ingredient_form_citations",
    );

    const [
      datasetVersionResult,
      ingredientRows,
      evidenceRows,
      formRows,
      aliasRows,
      evidenceCitationRows,
      formCitationRows,
    ] = await Promise.all([
      datasetVersionResultPromise,
      ingredientRowsPromise,
      evidenceRowsPromise,
      formRowsPromise,
      aliasRowsPromise,
      evidenceCitationRowsPromise,
      formCitationRowsPromise,
    ]);

    if (datasetVersionResult.error) {
      throw datasetVersionResult.error;
    }

    const datasetVersion =
      typeof datasetVersionResult.data?.version === "string" &&
      datasetVersionResult.data.version.trim().length > 0
        ? datasetVersionResult.data.version.trim()
        : null;

    const ingredientMetaById = new Map<string, IngredientMeta>();
    ingredientRows.forEach((row) => {
      if (!row?.id) return;
      ingredientMetaById.set(row.id as string, {
        id: row.id as string,
        unit: row.unit ?? null,
        rda_adult: row.rda_adult ?? null,
        ul_adult: row.ul_adult ?? null,
        goals: Array.isArray(row.goals) ? (row.goals as string[]) : null,
      });
    });

    const typedEvidenceRows = evidenceRows;
    const evidenceByIngredientId = new Map<string, IngredientEvidenceRow[]>();
    typedEvidenceRows.forEach((row) => {
      if (!row?.ingredient_id) return;
      const bucket = evidenceByIngredientId.get(row.ingredient_id) ?? [];
      bucket.push(row);
      evidenceByIngredientId.set(row.ingredient_id, bucket);
    });

    const typedFormRows = formRows;
    const formByIngredientId = new Map<string, IngredientFormRow[]>();
    typedFormRows.forEach((row) => {
      if (!row?.ingredient_id) return;
      const bucket = formByIngredientId.get(row.ingredient_id) ?? [];
      bucket.push(row);
      formByIngredientId.set(row.ingredient_id, bucket);
    });

    const formAliases = aliasRows;
    const globalFormAliases = formAliases.filter((alias) => !alias.ingredient_id);
    const aliasesByIngredientId = new Map<string, IngredientFormAliasRow[]>();
    formAliases.forEach((alias) => {
      if (!alias.ingredient_id) return;
      const bucket = aliasesByIngredientId.get(alias.ingredient_id) ?? [];
      bucket.push(alias);
      aliasesByIngredientId.set(alias.ingredient_id, bucket);
    });

    const evidenceCitationsById = mapCitations(
      evidenceCitationRows,
      "evidence_id",
    );
    const formCitationsById = mapCitations(
      formCitationRows,
      "form_id",
    );

    return {
      datasetVersion,
      ingredientMetaById,
      evidenceRows: typedEvidenceRows,
      evidenceByIngredientId,
      formRows: typedFormRows,
      formByIngredientId,
      formAliases,
      globalFormAliases,
      aliasesByIngredientId,
      evidenceCitationsById,
      formCitationsById,
    };
  })();

  cached = await inflight;
  inflight = null;
  return cached;
};

export const getIngredientMeta = (
  cache: DatasetCache,
  ingredientId: string,
): IngredientMeta | null => cache.ingredientMetaById.get(ingredientId) ?? null;

export const getEvidenceRowsForIngredient = (
  cache: DatasetCache,
  ingredientId: string,
): IngredientEvidenceRow[] => cache.evidenceByIngredientId.get(ingredientId) ?? [];

export const getFormRowsForIngredient = (
  cache: DatasetCache,
  ingredientId: string,
): IngredientFormRow[] => cache.formByIngredientId.get(ingredientId) ?? [];

export const getAliasesForIngredient = (
  cache: DatasetCache,
  ingredientId: string,
): IngredientFormAliasRow[] => [
  ...cache.globalFormAliases,
  ...(cache.aliasesByIngredientId.get(ingredientId) ?? []),
];
