import type {
  GoalKey,
  GoalNavigatorRequest,
  GoalNavigatorResponse,
  SupplementTypeKey,
} from "../../../types/personalization.js";
import catalogProductEvaluationModule from "../../../lib/personalization/core/catalogProductEvaluation.ts";
import goalNavigatorModule from "../../../lib/personalization/core/goalNavigator.ts";
import reasonCodesModule from "../../../lib/personalization/core/reasonCodes.ts";
import {
  readGoalNavigatorCandidateBundleArtifact,
  type GoalNavigatorCatalogBundleEntry,
} from "./goalNavigatorBundleArtifact.js";
import { downloadGoalNavigatorCandidateBundleArtifact } from "./goalNavigatorArtifactStorage.js";
import {
  getGoalNavigatorBundleObservabilitySnapshot,
  goalNavigatorBundleObservabilityInternals,
  recordGoalNavigatorBundleLoad,
  recordGoalNavigatorLiveBuild,
  recordGoalNavigatorPrecomputedMiss,
  updateGoalNavigatorBundleDiagnostics,
  type GoalNavigatorBundleSource,
} from "./goalNavigatorBundleObservability.js";
import { readActiveGoalNavigatorBundleRun } from "./goalNavigatorBundleRepository.js";
import { supabase } from "../supabase.js";
import { normalizeIherbSupplementFactsRowsWithTitleFallback } from "../iherbOverlayIngredients.js";

const { evaluatePreparedCatalogProduct, prepareCatalogProduct } = catalogProductEvaluationModule;
const { buildGoalNavigatorResponse } = goalNavigatorModule;
const { PERSONALIZATION_RULES_VERSION } = reasonCodesModule;

type GoalNavigatorOverlayRow = {
  id?: number | null;
  product_id?: string | null;
  barcode_gtin14?: string | null;
  brand_name?: string | null;
  title?: string | null;
  source_zip_path?: string | null;
  link?: string | null;
  product_catalog_image?: string | null;
  product_images?: unknown;
  supplement_facts?: unknown;
  description_sections?: unknown;
  updated_at?: string | null;
};

type OverlayFactRow = {
  substancy?: string | null;
  substance?: string | null;
  substance_name?: string | null;
  name?: string | null;
  amountPerServing?: string | null;
  amount_per_serving?: string | null;
  amount?: string | null;
  dailyValuePercent?: string | null;
  daily_value_percent?: string | null;
  dailyValue?: string | null;
};

const DEFAULT_GOAL_NAVIGATOR_LIMIT = 6;
const RUNTIME_LIVE_OVERLAY_FETCH_LIMIT = 180;
const BUNDLE_BUILD_OVERLAY_PAGE_SIZE = 1_000;
const DEFAULT_CATALOG_BUNDLE_TTL_MS = 5 * 60 * 1000;

export type GoalNavigatorCatalogBundle = {
  preparedAt: string;
  sourceRowCount: number;
  preparedCandidates: GoalNavigatorCatalogBundleEntry[];
  notEnoughStructuredDataCount: number;
  gatedOutOfScopeNonSupplementCount: number;
  source: GoalNavigatorBundleSource;
  activeRunId?: string | null;
  artifactPath?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
};

type GoalNavigatorCatalogEvaluationServiceOptions = {
  fetchOverlayCatalogRows?: () => Promise<GoalNavigatorOverlayRow[]>;
  now?: () => number;
  bundleTtlMs?: number;
  loadPrecomputedBundle?:
    | (() => Promise<GoalNavigatorCatalogBundle | null> | GoalNavigatorCatalogBundle | null)
    | null;
};

const safeTrim = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toObjectRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const normalizeSectionKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const readSectionText = (sections: Record<string, unknown>, aliases: string[]): string | null => {
  const aliasKeys = new Set(aliases.map(normalizeSectionKey));
  for (const [rawKey, rawValue] of Object.entries(sections)) {
    if (!aliasKeys.has(normalizeSectionKey(rawKey))) continue;
    if (typeof rawValue !== "string") continue;
    const trimmed = rawValue.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const readOverlayImageUrl = (row: Record<string, unknown>): string | null => {
  const directCandidates = [
    row.productCatalogImage,
    row.product_catalog_image,
    row.imageUrl,
    row.image_url,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }

  const imageCollections = [row.productImages, row.product_images];
  for (const collection of imageCollections) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (typeof item === "string" && item.trim()) {
        return item.trim();
      }
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        for (const nested of [record.url, record.src, record.imageUrl, record.image_url]) {
          if (typeof nested !== "string") continue;
          const trimmed = nested.trim();
          if (trimmed) return trimmed;
        }
      }
    }
  }

  return null;
};

const extractOverlayIngredients = (row: GoalNavigatorOverlayRow) => {
  const supplementFacts = toObjectRecord(row.supplement_facts);
  const descriptionSections = toObjectRecord(row.description_sections);
  const nutritionalFactsRaw = Array.isArray(supplementFacts.nutritionalFacts)
    ? (supplementFacts.nutritionalFacts as OverlayFactRow[])
    : Array.isArray(supplementFacts.nutritional_facts)
      ? (supplementFacts.nutritional_facts as OverlayFactRow[])
      : [];

  return normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: nutritionalFactsRaw
      .map((item) => ({
        substancy: String(
          item?.substancy ?? item?.substance ?? item?.substance_name ?? item?.name ?? "",
        ).trim(),
        amountPerServing: String(
          item?.amountPerServing ?? item?.amount_per_serving ?? item?.amount ?? "",
        ).trim(),
        dailyValuePercent:
          String(item?.dailyValuePercent ?? item?.daily_value_percent ?? item?.dailyValue ?? "").trim() ||
          null,
      }))
      .filter((item) => item.substancy || item.amountPerServing || item.dailyValuePercent),
    title: row.title,
    brandName: row.brand_name,
    sourceZipPath: row.source_zip_path,
    servingSize:
      typeof supplementFacts.servingSize === "string"
        ? supplementFacts.servingSize
        : typeof supplementFacts.serving_size === "string"
          ? supplementFacts.serving_size
          : null,
    servingsPerContainer:
      typeof supplementFacts.servingsPerContainer === "string"
        ? supplementFacts.servingsPerContainer
        : typeof supplementFacts.servings_per_container === "string"
          ? supplementFacts.servings_per_container
          : null,
    descriptionText: readSectionText(descriptionSections, ["description"]),
  });
};

const buildProductId = (row: GoalNavigatorOverlayRow, index: number) =>
  safeTrim(row.product_id) ??
  safeTrim(row.barcode_gtin14) ??
  `goal_nav_${index}_${safeTrim(row.title)?.toLowerCase().replace(/[^a-z0-9]+/g, "_") ?? "candidate"}`;

const fetchOverlayCatalogRows = async (): Promise<GoalNavigatorOverlayRow[]> => {
  const { data, error } = await supabase
    .from("iherb_overlay_products")
    .select(
      "product_id,barcode_gtin14,brand_name,title,source_zip_path,link,product_catalog_image,product_images,supplement_facts,description_sections,updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(RUNTIME_LIVE_OVERLAY_FETCH_LIMIT);

  if (error) {
    if (/relation .*iherb_overlay_products.* does not exist/i.test(String(error.message ?? ""))) {
      console.warn("[goal-navigator] overlay table unavailable");
      return [];
    }
    throw error;
  }

  return Array.isArray(data) ? (data as GoalNavigatorOverlayRow[]) : [];
};

const fetchAllOverlayCatalogRows = async (): Promise<GoalNavigatorOverlayRow[]> => {
  const rows: GoalNavigatorOverlayRow[] = [];
  let lastSeenId = 0;

  while (true) {
    let query = supabase
      .from("iherb_overlay_products")
      .select(
        "id,product_id,barcode_gtin14,brand_name,title,source_zip_path,link,product_catalog_image,product_images,supplement_facts,description_sections,updated_at",
      )
      .order("id", { ascending: true })
      .limit(BUNDLE_BUILD_OVERLAY_PAGE_SIZE);

    if (lastSeenId > 0) {
      query = query.gt("id", lastSeenId);
    }

    const { data, error } = await query;

    if (error) {
      if (/relation .*iherb_overlay_products.* does not exist/i.test(String(error.message ?? ""))) {
        console.warn("[goal-navigator] overlay table unavailable");
        return [];
      }
      throw error;
    }

    const batch = Array.isArray(data) ? (data as GoalNavigatorOverlayRow[]) : [];
    if (batch.length === 0) {
      break;
    }

    rows.push(...batch);
    const lastRowId = Number(batch[batch.length - 1]?.id ?? 0);
    if (!Number.isFinite(lastRowId) || lastRowId <= lastSeenId) {
      break;
    }
    lastSeenId = lastRowId;
  }

  return rows;
};

const buildCatalogBundleEntry = (
  row: GoalNavigatorOverlayRow,
  index: number,
): GoalNavigatorCatalogBundleEntry => {
  const descriptionSections = toObjectRecord(row.description_sections);
  const description = readSectionText(descriptionSections, ["Description"]);
  const suggestedUse = readSectionText(descriptionSections, [
    "Suggested use",
    "Suggested Use",
    "Suggested usage",
  ]);

  return {
    preparedProduct: prepareCatalogProduct({
      productId: buildProductId(row, index),
      sourceProductId: safeTrim(row.product_id),
      barcode: safeTrim(row.barcode_gtin14),
      sourceZipPath: safeTrim(row.source_zip_path),
      externalUrl: safeTrim(row.link),
      title: safeTrim(row.title),
      brandName: safeTrim(row.brand_name),
      dosageText: null,
      imageUrl: readOverlayImageUrl(row as Record<string, unknown>),
      description,
      suggestedUse,
      ingredients: extractOverlayIngredients(row),
    }),
  };
};

const buildCatalogCandidateBundle = async (
  fetchRows: () => Promise<GoalNavigatorOverlayRow[]>,
): Promise<GoalNavigatorCatalogBundle> => {
  const overlayRows = await fetchRows();
  const allPreparedCandidates = overlayRows.map(buildCatalogBundleEntry);
  const preparedCandidates = allPreparedCandidates.filter(
    (candidate) => candidate.preparedProduct.goalScoringBlockedReason !== "out_of_scope_non_supplement",
  );
  const gatedOutOfScopeNonSupplementCount = allPreparedCandidates.length - preparedCandidates.length;

  return {
    preparedAt: new Date().toISOString(),
    sourceRowCount: overlayRows.length,
    preparedCandidates,
    notEnoughStructuredDataCount: preparedCandidates.filter(
      (candidate) => candidate.preparedProduct.factsStatus !== "full",
    ).length,
    gatedOutOfScopeNonSupplementCount,
    source: "live",
  };
};

const loadPrecomputedCatalogBundle = async (): Promise<GoalNavigatorCatalogBundle | null> => {
  let storageError: string | null = null;
  let diskError: string | null = null;

  const activeRun = await readActiveGoalNavigatorBundleRun();
  if (activeRun?.storageBucket && activeRun.storagePath) {
    const storedArtifact = await downloadGoalNavigatorCandidateBundleArtifact({
      bucket: activeRun.storageBucket,
      path: activeRun.storagePath,
    });
    storageError = storedArtifact.error;
    if (storedArtifact.artifact) {
      updateGoalNavigatorBundleDiagnostics({
        storageError: null,
        diskError: null,
      });
      return {
        preparedAt: storedArtifact.artifact.generatedAt,
        sourceRowCount: storedArtifact.artifact.sourceRowCount,
        preparedCandidates: storedArtifact.artifact.preparedCandidates,
        notEnoughStructuredDataCount: storedArtifact.artifact.notEnoughStructuredDataCount,
        gatedOutOfScopeNonSupplementCount:
          typeof storedArtifact.artifact.gatedOutOfScopeNonSupplementCount === "number"
            ? storedArtifact.artifact.gatedOutOfScopeNonSupplementCount
            : 0,
        source: "storage",
        activeRunId: activeRun.id,
        storageBucket: activeRun.storageBucket,
        storagePath: activeRun.storagePath,
        artifactPath: activeRun.artifactPath,
      };
    }
  } else if (activeRun && (!activeRun.storageBucket || !activeRun.storagePath)) {
    storageError = "active_goal_navigator_bundle_missing_storage_location";
  }

  const diskArtifact = readGoalNavigatorCandidateBundleArtifact();
  diskError = diskArtifact.error;
  updateGoalNavigatorBundleDiagnostics({
    storageError,
    diskError,
  });
  if (!diskArtifact.artifact) return null;

  return {
    preparedAt: diskArtifact.artifact.generatedAt,
    sourceRowCount: diskArtifact.artifact.sourceRowCount,
    preparedCandidates: diskArtifact.artifact.preparedCandidates,
    notEnoughStructuredDataCount: diskArtifact.artifact.notEnoughStructuredDataCount,
    gatedOutOfScopeNonSupplementCount:
      typeof diskArtifact.artifact.gatedOutOfScopeNonSupplementCount === "number"
        ? diskArtifact.artifact.gatedOutOfScopeNonSupplementCount
        : 0,
    source: "disk",
    artifactPath: diskArtifact.path,
  };
};

export type GoalNavigatorCatalogEvaluationService = {
  evaluateGoal(request: GoalNavigatorRequest): Promise<GoalNavigatorResponse>;
};

export const createGoalNavigatorCatalogEvaluationService =
  (
    options: GoalNavigatorCatalogEvaluationServiceOptions = {},
  ): GoalNavigatorCatalogEvaluationService => {
    const fetchRows = options.fetchOverlayCatalogRows ?? fetchOverlayCatalogRows;
    const now = options.now ?? Date.now;
    const bundleTtlMs = Math.max(1_000, options.bundleTtlMs ?? DEFAULT_CATALOG_BUNDLE_TTL_MS);
    const loadPrecomputedBundle = options.loadPrecomputedBundle ?? loadPrecomputedCatalogBundle;

    let cachedBundle:
      | {
          expiresAt: number;
          value: GoalNavigatorCatalogBundle;
        }
      | null = null;
    let inflightBundle: Promise<GoalNavigatorCatalogBundle> | null = null;
    let cachedPrecomputedBundle:
      | {
          expiresAt: number;
          value: GoalNavigatorCatalogBundle | null;
        }
      | null = null;
    let inflightPrecomputedBundle: Promise<GoalNavigatorCatalogBundle | null> | null = null;

    const getCatalogCandidateBundle = async (): Promise<GoalNavigatorCatalogBundle> => {
      const currentTime = now();
      if (cachedBundle && cachedBundle.expiresAt > currentTime) {
        return cachedBundle.value;
      }

      if (inflightBundle) {
        return inflightBundle;
      }

      inflightBundle = buildCatalogCandidateBundle(fetchRows)
        .then((bundle) => {
          recordGoalNavigatorLiveBuild({
            generatedAt: bundle.preparedAt,
          });
          cachedBundle = {
            value: bundle,
            expiresAt: Math.max(currentTime, now()) + bundleTtlMs,
          };
          return bundle;
        })
        .finally(() => {
          inflightBundle = null;
        });

      return inflightBundle;
    };

    const getPrecomputedCatalogBundle = async (): Promise<GoalNavigatorCatalogBundle | null> => {
      const currentTime = now();
      if (cachedPrecomputedBundle && cachedPrecomputedBundle.expiresAt > currentTime) {
        return cachedPrecomputedBundle.value;
      }

      if (inflightPrecomputedBundle) {
        return inflightPrecomputedBundle;
      }

      inflightPrecomputedBundle = Promise.resolve(loadPrecomputedBundle?.() ?? null)
        .then((bundle) => {
          cachedPrecomputedBundle = {
            value: bundle,
            expiresAt: Math.max(currentTime, now()) + bundleTtlMs,
          };
          return bundle;
        })
        .finally(() => {
          inflightPrecomputedBundle = null;
        });

      return inflightPrecomputedBundle;
    };

    return {
      async evaluateGoal(request) {
        const precomputedBundle = await getPrecomputedCatalogBundle();
        const catalogBundle = precomputedBundle ?? (await getCatalogCandidateBundle());

        if (precomputedBundle) {
          recordGoalNavigatorBundleLoad({
            source: precomputedBundle.source,
            generatedAt: precomputedBundle.preparedAt,
            activeRunId: precomputedBundle.activeRunId,
            storageBucket: precomputedBundle.storageBucket,
            storagePath: precomputedBundle.storagePath,
            artifactPath: precomputedBundle.artifactPath,
          });
        } else {
          recordGoalNavigatorPrecomputedMiss();
          recordGoalNavigatorBundleLoad({
            source: catalogBundle.source,
            generatedAt: catalogBundle.preparedAt,
            activeRunId: catalogBundle.activeRunId,
            storageBucket: catalogBundle.storageBucket,
            storagePath: catalogBundle.storagePath,
            artifactPath: catalogBundle.artifactPath,
          });
        }

        const preferredTypes = [...(request.preferredTypes ?? [])].filter(
          (value): value is SupplementTypeKey =>
            value === "vitamin" ||
            value === "mineral" ||
            value === "herb" ||
            value === "probiotic" ||
            value === "protein",
        );

        const results = catalogBundle.preparedCandidates.map((candidate) =>
          evaluatePreparedCatalogProduct({
            preparedProduct: candidate.preparedProduct,
            goalKey: request.goalKey,
            preferredTypes,
            duplicateRisk: request.userContext?.duplicateRisk,
            supplementExperience: request.userContext?.supplementExperience,
            ageRange: request.userContext?.ageRange ?? null,
            adherenceBlocker: request.userContext?.adherenceBlocker ?? null,
          }),
        );

        return buildGoalNavigatorResponse({
          goalKey: request.goalKey,
          rulesVersion: PERSONALIZATION_RULES_VERSION,
          preferredTypes,
          preferenceVector: request.preferenceVector,
          snapshotId: request.snapshotId,
          candidates: results.flatMap((result) => (result.candidate ? [result.candidate] : [])),
          notEnoughStructuredDataCount: catalogBundle.notEnoughStructuredDataCount,
          limit: request.limit ?? DEFAULT_GOAL_NAVIGATOR_LIMIT,
        });
      },
    };
  };

export const goalNavigatorCatalogEvaluationServiceInternals = {
  buildCatalogBundleEntry,
  buildCatalogCandidateBundle,
  buildProductId,
  DEFAULT_CATALOG_BUNDLE_TTL_MS,
  extractOverlayIngredients,
  fetchAllOverlayCatalogRows,
  fetchOverlayCatalogRows,
  getGoalNavigatorBundleObservabilitySnapshot,
  goalNavigatorBundleObservabilityInternals,
  loadPrecomputedCatalogBundle,
  readOverlayImageUrl,
  readSectionText,
  toObjectRecord,
};
