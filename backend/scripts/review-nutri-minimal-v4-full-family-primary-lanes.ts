import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  NUTRI_MINIMAL_FULL_FAMILY_DEFINITIONS,
  type NutriMinimalFullFamilyDefinition,
} from "../src/nutriMinimalFullFamilyProductization.js";
import {
  type ReviewReason,
  type ReviewStatus,
  type ScientificEvidenceCandidateRegistryArtifact,
  type ScientificEvidenceCandidateRegistryRow,
  type VerifiedPmid,
} from "../src/staging/nutriMinimalV4.js";
import { reviewScientificCandidateWithNcbiEntrez } from "./lib/lifeScienceResearchNcbiEntrez.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGED_PATH = path.join(
  ROOT,
  "data",
  "staging",
  "nutri-minimal-v4",
  "scientific-evidence-candidate-registry.json",
);
const MANIFEST_PATH = path.join(
  ROOT,
  "data",
  "staging",
  "nutri-minimal-v4",
  "full-family-productization-manifest.json",
);

const primaryLaneForDefinition = (
  definition: NutriMinimalFullFamilyDefinition,
): string => {
  if (definition.safetyBoundaryTier === "high") return "primary_use_context";
  if (definition.category === "enzyme") return "functional_context";
  if (definition.category === "mineral") return "intake_and_status_context";
  if (definition.category === "botanical") return "primary_use_context";
  return "primary_context";
};

const hasReviewLikeEvidence = (rows: VerifiedPmid[]): boolean =>
  rows.some((row) =>
    row.pubtype.some((value) => /review|meta-analysis|systematic/i.test(value)),
  );

const hasHumanComparisonLikeEvidence = (rows: VerifiedPmid[]): boolean =>
  rows.some((row) =>
    row.pubtype.some((value) =>
      /randomized|clinical trial|comparative study|journal article/i.test(value),
    ),
  );

const classifyReviewedPmids = (
  row: ScientificEvidenceCandidateRegistryRow,
  verifiedPmids: VerifiedPmid[],
): { status: ReviewStatus; reasons: ReviewReason[] } => {
  const reasons: ReviewReason[] = [];
  if (!row.seed_citations.length) {
    return { status: "rejected", reasons: ["no_seed_citations"] };
  }
  if (verifiedPmids.length === 0) {
    return row.seed_citations.every((citation) => citation.seed_kind === "search_url")
      ? {
          status: "rejected",
          reasons: ["only_search_url_without_resolved_source"],
        }
      : { status: "needs_edit", reasons: ["no_plugin_verified_pmids"] };
  }
  if (!hasReviewLikeEvidence(verifiedPmids) || !hasHumanComparisonLikeEvidence(verifiedPmids)) {
    reasons.push("needs_boundary_support");
    return { status: "needs_edit", reasons };
  }
  reasons.push("approved_with_verified_pmids");
  return { status: "approved", reasons };
};

const syncManifestReviewStatus = async (
  rows: ScientificEvidenceCandidateRegistryRow[],
  primaryLaneByFamily: Map<string, string>,
): Promise<void> => {
  let raw: string;
  try {
    raw = await fs.readFile(MANIFEST_PATH, "utf8");
  } catch {
    return;
  }
  const manifest = JSON.parse(raw) as {
    summary?: Record<string, unknown>;
    full_family_productization_manifest?: Array<Record<string, unknown>>;
  };
  const statusByFamily = new Map(
    rows
      .filter((row) => row.lane === primaryLaneByFamily.get(row.family))
      .map((row) => [row.family, row.review_status] as const),
  );
  const manifestRows = Array.isArray(
    manifest.full_family_productization_manifest,
  )
    ? manifest.full_family_productization_manifest
    : [];

  for (const manifestRow of manifestRows) {
    const family =
      typeof manifestRow.canonical_family === "string"
        ? manifestRow.canonical_family
        : null;
    const status = family ? statusByFamily.get(family) : null;
    if (status) manifestRow.evidence_review_status = status;
  }

  const summary = manifestRows.reduce(
    (acc, manifestRow) => {
      const status = manifestRow.evidence_review_status;
      if (status === "approved") acc.approved += 1;
      else if (status === "rejected") acc.rejected += 1;
      else acc.needs_edit += 1;
      return acc;
    },
    { approved: 0, needs_edit: 0, rejected: 0 },
  );
  manifest.summary = {
    ...(manifest.summary ?? {}),
    evidence_review_approved: summary.approved,
    evidence_review_needs_edit: summary.needs_edit,
    evidence_review_rejected: summary.rejected,
  };

  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
};

const main = async () => {
  const raw = await fs.readFile(STAGED_PATH, "utf8");
  const artifact = JSON.parse(raw) as ScientificEvidenceCandidateRegistryArtifact;
  const definitionsByFamily = new Map(
    NUTRI_MINIMAL_FULL_FAMILY_DEFINITIONS.map((definition) => [
      definition.canonicalFamily,
      definition,
    ] as const),
  );
  const primaryLaneByFamily = new Map(
    NUTRI_MINIMAL_FULL_FAMILY_DEFINITIONS.map((definition) => [
      definition.canonicalFamily,
      primaryLaneForDefinition(definition),
    ] as const),
  );

  const nextRows: ScientificEvidenceCandidateRegistryRow[] = [];
  let reviewed = 0;
  let approved = 0;
  let needsEdit = 0;
  let rejected = 0;

  for (const row of artifact.scientific_evidence_candidate_registry) {
    const definition = definitionsByFamily.get(row.family);
    const primaryLane = primaryLaneByFamily.get(row.family);
    if (!definition || row.lane !== primaryLane) {
      nextRows.push(row);
      continue;
    }

    try {
      const result = await reviewScientificCandidateWithNcbiEntrez({ row });
      const verifiedPmids = result.verified_pmids.slice(0, 5);
      const { status, reasons } = classifyReviewedPmids(row, verifiedPmids);
      if (status === "approved") approved += 1;
      else if (status === "needs_edit") needsEdit += 1;
      else rejected += 1;
      reviewed += 1;
      nextRows.push({
        ...row,
        query: result.query_used ?? row.query,
        plugin_verified_pmids: verifiedPmids,
        review_status: status,
        review_reasons: Array.from(new Set(reasons)),
        selection_notes: Array.from(
          new Set([...row.selection_notes, definition.hardBoundary]),
        ),
      });
    } catch {
      reviewed += 1;
      needsEdit += 1;
      nextRows.push({
        ...row,
        review_status: "needs_edit",
        review_reasons: ["no_plugin_verified_pmids"],
        selection_notes: Array.from(
          new Set([...row.selection_notes, definition.hardBoundary]),
        ),
      });
    }
  }

  const nextArtifact = {
    ...artifact,
    scientific_evidence_candidate_registry: nextRows,
  } satisfies ScientificEvidenceCandidateRegistryArtifact;
  await fs.writeFile(STAGED_PATH, `${JSON.stringify(nextArtifact, null, 2)}\n`, "utf8");
  await syncManifestReviewStatus(nextRows, primaryLaneByFamily);
  console.log(
    JSON.stringify(
      {
        ok: true,
        reviewed_primary_lanes: reviewed,
        approved,
        needs_edit: needsEdit,
        rejected,
        staged_path: STAGED_PATH,
        manifest_path: MANIFEST_PATH,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
