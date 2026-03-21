import fs from "node:fs";
import { fileURLToPath } from "node:url";

import type { CatalogPreparedProduct } from "../../../lib/personalization/core/catalogProductEvaluation.ts";
import reasonCodesModule from "../../../lib/personalization/core/reasonCodes.ts";

const { PERSONALIZATION_RULES_VERSION } = reasonCodesModule;

export const GOAL_NAVIGATOR_CANDIDATE_BUNDLE_SCHEMA_VERSION =
  "goal_navigator_candidate_bundle.v1";
export const DEFAULT_GOAL_NAVIGATOR_CANDIDATE_BUNDLE_PATH = fileURLToPath(
  new URL("../../data/personalization/goal_navigator_candidate_bundle.v1.json", import.meta.url),
);

export type GoalNavigatorCatalogBundleEntry = {
  preparedProduct: CatalogPreparedProduct;
};

export type GoalNavigatorCatalogBundleArtifact = {
  schemaVersion: typeof GOAL_NAVIGATOR_CANDIDATE_BUNDLE_SCHEMA_VERSION;
  rulesVersion: string;
  generatedAt: string;
  sourceTable: string;
  sourceRowCount: number;
  notEnoughStructuredDataCount: number;
  preparedCandidates: GoalNavigatorCatalogBundleEntry[];
};

type ArtifactCache = {
  path: string | null;
  mtimeMs: number;
  loadedAt: string | null;
  artifact: GoalNavigatorCatalogBundleArtifact | null;
  error: string | null;
};

const DEFAULT_CACHE: ArtifactCache = {
  path: null,
  mtimeMs: 0,
  loadedAt: null,
  artifact: null,
  error: null,
};

let CACHE: ArtifactCache = { ...DEFAULT_CACHE };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isCatalogPreparedProduct = (value: unknown): value is CatalogPreparedProduct => {
  if (!isRecord(value)) return false;
  return (
    typeof value.productId === "string" &&
    isStringArray(value.typeKeys) &&
    Array.isArray(value.ingredientInputs) &&
    isRecord(value.savedProductSeed)
  );
};

const isBundleEntry = (value: unknown): value is GoalNavigatorCatalogBundleEntry =>
  isRecord(value) && isCatalogPreparedProduct(value.preparedProduct);

const parseArtifact = (value: unknown): GoalNavigatorCatalogBundleArtifact | null => {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== GOAL_NAVIGATOR_CANDIDATE_BUNDLE_SCHEMA_VERSION) return null;
  if (typeof value.generatedAt !== "string" || typeof value.sourceTable !== "string") return null;
  if (
    typeof value.sourceRowCount !== "number" ||
    typeof value.notEnoughStructuredDataCount !== "number" ||
    !Array.isArray(value.preparedCandidates)
  ) {
    return null;
  }
  if (!value.preparedCandidates.every(isBundleEntry)) return null;

  return {
    schemaVersion: GOAL_NAVIGATOR_CANDIDATE_BUNDLE_SCHEMA_VERSION,
    rulesVersion:
      typeof value.rulesVersion === "string" && value.rulesVersion.trim()
        ? value.rulesVersion
        : PERSONALIZATION_RULES_VERSION,
    generatedAt: value.generatedAt,
    sourceTable: value.sourceTable,
    sourceRowCount: value.sourceRowCount,
    notEnoughStructuredDataCount: value.notEnoughStructuredDataCount,
    preparedCandidates: value.preparedCandidates,
  };
};

export const resolveGoalNavigatorCandidateBundlePath = () =>
  process.env.GOAL_NAVIGATOR_CANDIDATE_BUNDLE_PATH?.trim() ||
  DEFAULT_GOAL_NAVIGATOR_CANDIDATE_BUNDLE_PATH;

export const readGoalNavigatorCandidateBundleArtifact = (
  filePath = resolveGoalNavigatorCandidateBundlePath(),
): {
  artifact: GoalNavigatorCatalogBundleArtifact | null;
  path: string;
  loadedAt: string | null;
  error: string | null;
} => {
  try {
    const stat = fs.statSync(filePath);
    const mtimeMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : Date.now();

    if (CACHE.path === filePath && CACHE.mtimeMs === mtimeMs) {
      return {
        artifact: CACHE.artifact,
        path: filePath,
        loadedAt: CACHE.loadedAt,
        error: CACHE.error,
      };
    }

    const body = fs.readFileSync(filePath, "utf8");
    const parsed = parseArtifact(JSON.parse(body));
    CACHE = {
      path: filePath,
      mtimeMs,
      loadedAt: new Date().toISOString(),
      artifact: parsed,
      error: parsed ? null : "invalid_goal_navigator_candidate_bundle",
    };

    return {
      artifact: CACHE.artifact,
      path: filePath,
      loadedAt: CACHE.loadedAt,
      error: CACHE.error,
    };
  } catch (error) {
    CACHE = {
      ...DEFAULT_CACHE,
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    };

    return {
      artifact: null,
      path: filePath,
      loadedAt: null,
      error: CACHE.error,
    };
  }
};

export const goalNavigatorBundleArtifactInternals = {
  parseArtifact,
};
