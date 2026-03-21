import { supabase } from "../supabase.js";
import type {
  GoalNavigatorCandidateGapRecord,
  PersonalizationCandidateGapCode,
} from "./goalNavigatorCandidateGaps.js";

const GOAL_NAVIGATOR_ARTIFACT_KIND = "goal_navigator_candidate_bundle";
const INSERT_CHUNK_SIZE = 250;

export type PersistGoalNavigatorBundleRunInput = {
  schemaVersion: string;
  rulesVersion: string;
  generatedAt: string;
  sourceTable: string;
  sourceRowCount: number;
  preparedCandidateCount: number;
  notEnoughStructuredDataCount: number;
  artifactPath?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
  artifactByteSize?: number | null;
  artifactChecksum?: string | null;
  activate?: boolean;
  buildMeta?: Record<string, unknown>;
  candidateGaps: GoalNavigatorCandidateGapRecord[];
};

export type GoalNavigatorBundleDebugRun = {
  id: string;
  artifactKind: string;
  schemaVersion: string;
  rulesVersion: string;
  sourceTable: string;
  sourceRowCount: number;
  preparedCandidateCount: number;
  notEnoughStructuredDataCount: number;
  artifactPath: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  artifactByteSize: number | null;
  artifactChecksum: string | null;
  isActive: boolean;
  activatedAt: string | null;
  generatedAt: string;
  createdAt: string;
  buildMeta: Record<string, unknown>;
};

export type GoalNavigatorBundleDebugGap = {
  id: string;
  productId: string;
  sourceProductId: string | null;
  title: string | null;
  brandName: string | null;
  factsStatus: string;
  gapCodes: PersonalizationCandidateGapCode[];
  details: Record<string, unknown>;
  createdAt: string;
};

type ActionableGapPriorityKey =
  | Exclude<PersonalizationCandidateGapCode, "low_disclosure">
  | "missing_dose";

export type GoalNavigatorGapPriority = {
  key: ActionableGapPriorityKey;
  affectedProducts: number;
  recommendedAction: string;
  sampleTitles: string[];
};

export type GoalNavigatorBundleDebugSnapshot = {
  run: GoalNavigatorBundleDebugRun | null;
  summary: {
    totalGapRows: number;
    returnedGapRows: number;
    gapCodeCounts: Record<string, number>;
    factsStatusCounts: Record<string, number>;
    priorities: GoalNavigatorGapPriority[];
  };
  gaps: GoalNavigatorBundleDebugGap[];
};

export type GoalNavigatorActiveBundleRun = Pick<
  GoalNavigatorBundleDebugRun,
  | "id"
  | "artifactKind"
  | "schemaVersion"
  | "rulesVersion"
  | "generatedAt"
  | "artifactPath"
  | "storageBucket"
  | "storagePath"
  | "artifactByteSize"
  | "artifactChecksum"
  | "isActive"
  | "activatedAt"
>;

const clampLimit = (value: number | undefined) => {
  if (!Number.isFinite(value)) return 25;
  return Math.min(100, Math.max(1, Math.round(value ?? 25)));
};

const sanitizeGapCodes = (value: unknown): PersonalizationCandidateGapCode[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is PersonalizationCandidateGapCode =>
          item === "missing_dose" ||
          item === "missing_unit" ||
          item === "unresolved_ingredient" ||
          item === "low_disclosure" ||
          item === "proprietary_blend" ||
          item === "no_structured_ingredients",
      )
    : [];

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const ACTIONABLE_PRIORITY_ORDER: ActionableGapPriorityKey[] = [
  "missing_unit",
  "unresolved_ingredient",
  "missing_dose",
  "no_structured_ingredients",
  "proprietary_blend",
];

const PRIORITY_ACTION_COPY: Record<ActionableGapPriorityKey, string> = {
  missing_unit:
    "Extend dose parsing for supported label units like SPU, IU, CFU, and ingredient-level mL disclosures.",
  unresolved_ingredient:
    "Split overlay blend rows into real ingredient members and expand alias cleanup for label-heavy ingredient names.",
  missing_dose:
    "Preserve ingredient identity but backfill per-ingredient dose disclosure before allowing these products into coverage-ready ranking.",
  no_structured_ingredients:
    "Backfill missing supplement facts rows from the overlay source before these products can enter Goal Navigator.",
  proprietary_blend:
    "Keep blend totals conservative and only promote rows where individual actives or a single clear ingredient are disclosed.",
};

const buildGapPriorities = (gaps: GoalNavigatorBundleDebugGap[]): GoalNavigatorGapPriority[] => {
  const byKey = new Map<
    GoalNavigatorGapPriority["key"],
    { affectedProducts: number; sampleTitles: string[] }
  >();

  for (const gap of gaps) {
    const actionableKeys = new Set<GoalNavigatorGapPriority["key"]>();
    for (const gapCode of gap.gapCodes) {
      if (gapCode === "low_disclosure") continue;
      actionableKeys.add(gapCode);
    }
    if (
      !gap.gapCodes.includes("missing_dose") &&
      typeof gap.details.missingDoseCount === "number" &&
      gap.details.missingDoseCount > 0
    ) {
      actionableKeys.add("missing_dose");
    }

    for (const key of actionableKeys) {
      const current = byKey.get(key) ?? { affectedProducts: 0, sampleTitles: [] };
      current.affectedProducts += 1;
      if (
        typeof gap.title === "string" &&
        gap.title.trim() &&
        !current.sampleTitles.includes(gap.title) &&
        current.sampleTitles.length < 3
      ) {
        current.sampleTitles.push(gap.title);
      }
      byKey.set(key, current);
    }
  }

  return ACTIONABLE_PRIORITY_ORDER.map((key) => {
    const current = byKey.get(key);
    if (!current || current.affectedProducts <= 0) return null;
    return {
      key,
      affectedProducts: current.affectedProducts,
      recommendedAction: PRIORITY_ACTION_COPY[key],
      sampleTitles: current.sampleTitles,
    } satisfies GoalNavigatorGapPriority;
  })
    .filter((value): value is GoalNavigatorGapPriority => Boolean(value))
    .sort((left, right) => right.affectedProducts - left.affectedProducts);
};

export const persistGoalNavigatorBundleRun = async (
  input: PersistGoalNavigatorBundleRunInput,
): Promise<{ runId: string; gapCount: number }> => {
  if (input.activate) {
    const { error: deactivateError } = await supabase
      .from("personalization_bundle_runs")
      .update({
        is_active: false,
      })
      .eq("artifact_kind", GOAL_NAVIGATOR_ARTIFACT_KIND)
      .eq("is_active", true);

    if (deactivateError) {
      throw deactivateError;
    }
  }

  const { data: insertedRun, error: runError } = await supabase
    .from("personalization_bundle_runs")
    .insert({
      artifact_kind: GOAL_NAVIGATOR_ARTIFACT_KIND,
      schema_version: input.schemaVersion,
      rules_version: input.rulesVersion,
      source_table: input.sourceTable,
      source_row_count: input.sourceRowCount,
      prepared_candidate_count: input.preparedCandidateCount,
      not_enough_structured_data_count: input.notEnoughStructuredDataCount,
      artifact_path: input.artifactPath ?? null,
      storage_bucket: input.storageBucket ?? null,
      storage_path: input.storagePath ?? null,
      artifact_byte_size: input.artifactByteSize ?? null,
      artifact_checksum: input.artifactChecksum ?? null,
      is_active: input.activate ?? false,
      activated_at: input.activate ? new Date().toISOString() : null,
      generated_at: input.generatedAt,
      build_meta: input.buildMeta ?? {},
    })
    .select("id")
    .single();

  if (runError) {
    throw runError;
  }

  const runId = insertedRun.id as string;

  for (let index = 0; index < input.candidateGaps.length; index += INSERT_CHUNK_SIZE) {
    const chunk = input.candidateGaps.slice(index, index + INSERT_CHUNK_SIZE);
    if (chunk.length === 0) continue;

    const { error } = await supabase.from("personalization_candidate_gaps").insert(
      chunk.map((gap) => ({
        bundle_run_id: runId,
        product_id: gap.productId,
        source_product_id: gap.sourceProductId,
        title: gap.title,
        brand_name: gap.brandName,
        facts_status: gap.factsStatus,
        gap_codes: gap.gapCodes,
        details: gap.details,
      })),
    );

    if (error) {
      throw error;
    }
  }

  return {
    runId,
    gapCount: input.candidateGaps.length,
  };
};

export const readActiveGoalNavigatorBundleRun = async (): Promise<GoalNavigatorActiveBundleRun | null> => {
  const { data, error } = await supabase
    .from("personalization_bundle_runs")
    .select(
      "id,artifact_kind,schema_version,rules_version,artifact_path,storage_bucket,storage_path,artifact_byte_size,artifact_checksum,is_active,activated_at,generated_at",
    )
    .eq("artifact_kind", GOAL_NAVIGATOR_ARTIFACT_KIND)
    .eq("is_active", true)
    .order("activated_at", { ascending: false })
    .order("generated_at", { ascending: false })
    .limit(1);

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;

  return {
    id: row.id as string,
    artifactKind: row.artifact_kind as string,
    schemaVersion: row.schema_version as string,
    rulesVersion: row.rules_version as string,
    artifactPath: (row.artifact_path as string | null) ?? null,
    storageBucket: (row.storage_bucket as string | null) ?? null,
    storagePath: (row.storage_path as string | null) ?? null,
    artifactByteSize:
      typeof row.artifact_byte_size === "number" ? row.artifact_byte_size : null,
    artifactChecksum: (row.artifact_checksum as string | null) ?? null,
    isActive: Boolean(row.is_active),
    activatedAt: (row.activated_at as string | null) ?? null,
    generatedAt: row.generated_at as string,
  };
};

export const readLatestGoalNavigatorBundleDebugSnapshot = async (
  input: { limit?: number } = {},
): Promise<GoalNavigatorBundleDebugSnapshot> => {
  const limit = clampLimit(input.limit);

  const { data: runRows, error: runError } = await supabase
    .from("personalization_bundle_runs")
    .select(
      "id,artifact_kind,schema_version,rules_version,source_table,source_row_count,prepared_candidate_count,not_enough_structured_data_count,artifact_path,storage_bucket,storage_path,artifact_byte_size,artifact_checksum,is_active,activated_at,generated_at,created_at,build_meta",
    )
    .eq("artifact_kind", GOAL_NAVIGATOR_ARTIFACT_KIND)
    .order("is_active", { ascending: false })
    .order("activated_at", { ascending: false })
    .order("generated_at", { ascending: false })
    .limit(1);

  if (runError) {
    throw runError;
  }

  const latestRun = Array.isArray(runRows) ? runRows[0] : null;
  if (!latestRun) {
    return {
      run: null,
      summary: {
        totalGapRows: 0,
        returnedGapRows: 0,
        gapCodeCounts: {},
        factsStatusCounts: {},
        priorities: [],
      },
      gaps: [],
    };
  }

  const { data: gapRows, error: gapError } = await supabase
    .from("personalization_candidate_gaps")
    .select("id,product_id,source_product_id,title,brand_name,facts_status,gap_codes,details,created_at")
    .eq("bundle_run_id", latestRun.id)
    .order("created_at", { ascending: false });

  if (gapError) {
    throw gapError;
  }

  const allGaps = (Array.isArray(gapRows) ? gapRows : []).map(
    (row): GoalNavigatorBundleDebugGap => ({
      id: row.id as string,
      productId: row.product_id as string,
      sourceProductId: (row.source_product_id as string | null) ?? null,
      title: (row.title as string | null) ?? null,
      brandName: (row.brand_name as string | null) ?? null,
      factsStatus: (row.facts_status as string) ?? "partial",
      gapCodes: sanitizeGapCodes(row.gap_codes),
      details: toRecord(row.details),
      createdAt: row.created_at as string,
    }),
  );

  const gapCodeCounts = allGaps.reduce<Record<string, number>>((accumulator, gap) => {
    for (const gapCode of gap.gapCodes) {
      accumulator[gapCode] = (accumulator[gapCode] ?? 0) + 1;
    }
    return accumulator;
  }, {});

  const factsStatusCounts = allGaps.reduce<Record<string, number>>((accumulator, gap) => {
    accumulator[gap.factsStatus] = (accumulator[gap.factsStatus] ?? 0) + 1;
    return accumulator;
  }, {});
  const priorities = buildGapPriorities(allGaps);

  return {
    run: {
      id: latestRun.id as string,
      artifactKind: latestRun.artifact_kind as string,
      schemaVersion: latestRun.schema_version as string,
      rulesVersion: latestRun.rules_version as string,
      sourceTable: latestRun.source_table as string,
      sourceRowCount: Number(latestRun.source_row_count ?? 0),
      preparedCandidateCount: Number(latestRun.prepared_candidate_count ?? 0),
      notEnoughStructuredDataCount: Number(latestRun.not_enough_structured_data_count ?? 0),
      artifactPath: (latestRun.artifact_path as string | null) ?? null,
      storageBucket: (latestRun.storage_bucket as string | null) ?? null,
      storagePath: (latestRun.storage_path as string | null) ?? null,
      artifactByteSize:
        typeof latestRun.artifact_byte_size === "number" ? latestRun.artifact_byte_size : null,
      artifactChecksum: (latestRun.artifact_checksum as string | null) ?? null,
      isActive: Boolean(latestRun.is_active),
      activatedAt: (latestRun.activated_at as string | null) ?? null,
      generatedAt: latestRun.generated_at as string,
      createdAt: latestRun.created_at as string,
      buildMeta: toRecord(latestRun.build_meta),
    },
    summary: {
      totalGapRows: allGaps.length,
      returnedGapRows: Math.min(limit, allGaps.length),
      gapCodeCounts,
      factsStatusCounts,
      priorities,
    },
    gaps: allGaps.slice(0, limit),
  };
};

export const goalNavigatorBundleRepositoryInternals = {
  buildGapPriorities,
};
