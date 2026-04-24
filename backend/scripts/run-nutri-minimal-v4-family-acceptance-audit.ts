import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FactsDigest } from "../src/factsDigest.js";
import { buildIngredientScienceContext } from "../src/ingredientScienceContext.js";
import {
  NUTRI_MINIMAL_FULL_FAMILY_DEFINITIONS,
  type NutriMinimalFullFamilyDefinition,
} from "../src/nutriMinimalFullFamilyProductization.js";
import { getScientificBackgroundEvidence } from "../src/insights/scientificBackgroundEvidencePackage.js";
import { planScientificBackgroundSections } from "../src/insights/scientificBackgroundCompiler.js";

type ReviewStatus = "approved" | "needs_edit" | "rejected";

type RegistryRow = {
  family: string;
  lane: string;
  review_status: ReviewStatus;
  review_reasons?: string[];
  plugin_verified_pmids?: Array<{ pmid?: string | null; title?: string | null }>;
  selection_notes?: string[];
};

type ManifestRow = {
  source_ingredient_id: string;
  canonical_family: string;
  display_name: string;
  closure_decision: string;
  productization_class: string;
  safety_boundary_tier: string;
  category: string;
  evidence_review_status: ReviewStatus;
};

type ProductCandidate = {
  sourceFile: string;
  productId: string | null;
  barcode: string | null;
  brand: string | null;
  title: string;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(ROOT, "..");
const STAGING_DIR = path.join(ROOT, "data", "staging", "nutri-minimal-v4");
const REGISTRY_PATH = path.join(
  STAGING_DIR,
  "scientific-evidence-candidate-registry.json",
);
const MANIFEST_PATH = path.join(
  STAGING_DIR,
  "full-family-productization-manifest.json",
);
const REPLAY_AUDIT_PATH = path.join(
  STAGING_DIR,
  "family-productization-replay-audit.json",
);
const EVIDENCE_BACKLOG_PATH = path.join(
  STAGING_DIR,
  "evidence-review-backlog.json",
);

const readJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await fs.readFile(filePath, "utf8")) as T;

const primaryLaneForDefinition = (
  definition: NutriMinimalFullFamilyDefinition | ManifestRow,
): string => {
  if (definition.safetyBoundaryTier === "high") return "primary_use_context";
  if (definition.category === "enzyme") return "functional_context";
  if (definition.category === "mineral") return "intake_and_status_context";
  if (definition.category === "botanical") return "primary_use_context";
  return "primary_context";
};

const expectedFirstHeadingForDefinition = (
  definition: NutriMinimalFullFamilyDefinition,
): string => {
  if (definition.safetyBoundaryTier === "high") return "Primary use context";
  if (definition.category === "enzyme") return "Functional context";
  if (definition.category === "mineral") return "Intake and status context";
  if (definition.category === "botanical") return "Primary use context";
  return "Primary context";
};

const normalize = (value: string | null | undefined): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const collectProductCandidatesFromValue = (
  value: unknown,
  sourceFile: string,
  output: ProductCandidate[],
): void => {
  if (Array.isArray(value)) {
    for (const item of value) collectProductCandidatesFromValue(item, sourceFile, output);
    return;
  }
  if (!isRecord(value)) return;

  const title =
    typeof value.title === "string"
      ? value.title
      : typeof value.productName === "string"
        ? value.productName
        : typeof value.name === "string" && typeof value.brand === "string"
          ? value.name
          : null;
  if (title && title.length >= 8) {
    const productId =
      typeof value.productId === "string"
        ? value.productId
        : typeof value.id === "string"
          ? value.id
          : null;
    const barcode = typeof value.barcode === "string" ? value.barcode : null;
    if (!productId && !barcode) {
      // Keep this replay on product packs, not PubMed titles embedded in evidence artifacts.
      return;
    }
    output.push({
      sourceFile,
      productId,
      barcode,
      brand:
        typeof value.brand === "string"
          ? value.brand
          : typeof value.brandName === "string"
            ? value.brandName
            : null,
      title,
    });
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      collectProductCandidatesFromValue(child, sourceFile, output);
    }
  }
};

const collectLocalValidationProducts = async (): Promise<ProductCandidate[]> => {
  const roots = [path.join(REPO_ROOT, "data", "validation")];
  const candidates: ProductCandidate[] = [];
  const seen = new Set<string>();

  const visit = async (currentPath: string): Promise<void> => {
    let entries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const nextPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await visit(nextPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(await fs.readFile(nextPath, "utf8")) as unknown;
        collectProductCandidatesFromValue(
          parsed,
          path.relative(REPO_ROOT, nextPath),
          candidates,
        );
      } catch {
        continue;
      }
    }
  };

  for (const root of roots) await visit(root);
  return candidates.filter((candidate) => {
    const key = `${normalize(candidate.brand)}|${normalize(candidate.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const findProductForDefinition = (
  definition: NutriMinimalFullFamilyDefinition,
  candidates: ProductCandidate[],
): ProductCandidate[] =>
  candidates
    .filter((candidate) => {
      if (
        definition.canonicalFamily === "caffeine" &&
        /caffeine\s*free|decaf/i.test(candidate.title)
      ) {
        return false;
      }
      if (definition.pattern.test(candidate.title)) return true;

      const title = normalize(candidate.title);
      return definition.patternKeywords.some((keyword) => {
        const normalizedKeyword = normalize(keyword);
        return normalizedKeyword.length >= 4 && title.includes(normalizedKeyword);
      });
    })
    .slice(0, 8);

const inferDosageForm = (title: string): string => {
  if (/softgel/i.test(title)) return "Softgel";
  if (/capsule/i.test(title)) return "Capsule";
  if (/tablet/i.test(title)) return "Tablet";
  if (/powder/i.test(title)) return "Powder";
  if (/liquid|drop/i.test(title)) return "Liquid";
  return "Capsule";
};

const amountUnitForDefinition = (
  definition: NutriMinimalFullFamilyDefinition,
): { amount: number; unit: string } => {
  if (definition.category === "mineral") return { amount: 100, unit: "mcg" };
  if (definition.category === "enzyme") return { amount: 100, unit: "mg" };
  if (definition.category === "vitamin") return { amount: 100, unit: "mcg" };
  return { amount: 500, unit: "mg" };
};

const buildReplayDigest = (
  definition: NutriMinimalFullFamilyDefinition,
  product: ProductCandidate | null,
): FactsDigest => {
  const title = product?.title ?? "Replay supplement fixture";
  const amount = amountUnitForDefinition(definition);
  return {
    sourceType: "dsld",
    identity: {
      type: "dsldLabelId",
      value: product?.barcode ?? `fixture-${definition.sourceIngredientId}`,
      regionTags: ["US"],
      verifiedStatus: product ? "local_validation_replay" : "manifest_fixture",
    },
    product: {
      brandDisplay: product?.brand ?? "Replay Fixture",
      brandLegal: null,
      name: title,
      dosageForm: inferDosageForm(title),
      route: "oral",
    },
    actives: [
      {
        name: definition.displayName,
        amount: amount.amount,
        unit: amount.unit,
        amountText: `${amount.amount} ${amount.unit}`,
        source: "dsld",
        confidence: 0.92,
      },
    ],
    inactives: [],
    serving: {
      servingSize: "1 serving",
      servingsPerContainer: null,
    },
    labelDosing: [],
    warnings: {
      warnings: [],
      consultDoctorIf: [],
      redFlags: [],
      missingFlag: true,
    },
    claims: {
      labelPurposes: [],
      webClaims: [],
    },
    quality: {
      isComplete: true,
      missingFields: [],
      completenessScore: 0.86,
    },
  };
};

const backlogActionForRow = (
  row: RegistryRow,
  definition: NutriMinimalFullFamilyDefinition,
): string => {
  const reasons = row.review_reasons ?? [];
  if (row.review_status === "needs_edit") {
    if (reasons.includes("needs_boundary_support")) {
      return "rerun_lsr_with_lane_specific_boundary_query";
    }
    if (reasons.includes("no_plugin_verified_pmids")) {
      return "add_manual_seed_pmids_or_keep_unapproved";
    }
    return "manual_evidence_editor_review";
  }
  if (definition.safetyBoundaryTier === "high") {
    return "keep_blocked_until_resolved_human_or_review_pmid";
  }
  return "keep_blocked_until_resolved_pmid_seed_exists";
};

const main = async () => {
  const registryArtifact = await readJson<{
    scientific_evidence_candidate_registry: RegistryRow[];
  }>(REGISTRY_PATH);
  const manifestArtifact = await readJson<{
    full_family_productization_manifest: ManifestRow[];
  }>(MANIFEST_PATH);
  const localProducts = await collectLocalValidationProducts();
  const registryByKey = new Map(
    registryArtifact.scientific_evidence_candidate_registry.map((row) => [
      `${row.family}|${row.lane}`,
      row,
    ]),
  );
  const manifestByFamily = new Map(
    manifestArtifact.full_family_productization_manifest.map((row) => [
      row.canonical_family,
      row,
    ]),
  );

  const replayRows = NUTRI_MINIMAL_FULL_FAMILY_DEFINITIONS.map((definition) => {
    const primaryLane = primaryLaneForDefinition(definition);
    const registryRow = registryByKey.get(
      `${definition.canonicalFamily}|${primaryLane}`,
    );
    const manifestRow = manifestByFamily.get(definition.canonicalFamily);
    const expectedFirstHeading = expectedFirstHeadingForDefinition(definition);
    const productCandidates = findProductForDefinition(definition, localProducts);
    let product: ProductCandidate | null = null;
    let digest = buildReplayDigest(definition, null);
    let context = buildIngredientScienceContext({
      digest,
      overlayClaims: {
        title: digest.product.name,
        brandName: digest.product.brandDisplay,
      },
    });
    let plan = planScientificBackgroundSections({
      context,
      selectedIngredientName: definition.displayName,
    });

    for (const candidate of productCandidates) {
      const candidateDigest = buildReplayDigest(definition, candidate);
      const candidateContext = buildIngredientScienceContext({
        digest: candidateDigest,
        overlayClaims: {
          title: candidateDigest.product.name,
          brandName: candidateDigest.product.brandDisplay,
        },
      });
      const candidatePlan = planScientificBackgroundSections({
        context: candidateContext,
        selectedIngredientName: definition.displayName,
      });
      if (
        candidateContext.anchorIngredient?.ingredientFamily ===
          definition.canonicalFamily &&
        candidateContext.ingredientFamily === definition.canonicalFamily &&
        candidatePlan.family === definition.canonicalFamily &&
        candidatePlan.sections[0]?.heading === expectedFirstHeading
      ) {
        product = candidate;
        digest = candidateDigest;
        context = candidateContext;
        plan = candidatePlan;
        break;
      }
    }
    const evidence = getScientificBackgroundEvidence(
      definition.canonicalFamily,
      primaryLane,
      "en",
    );
    const expectedApproved =
      registryRow?.review_status === "approved" &&
      manifestRow?.evidence_review_status === "approved";
    const inferencePass =
      context.anchorIngredient?.ingredientFamily === definition.canonicalFamily &&
      context.ingredientFamily === definition.canonicalFamily;
    const sectionPass =
      plan.family === definition.canonicalFamily &&
      plan.sections[0]?.heading === expectedFirstHeading &&
      !plan.sections.some((section) =>
        /clearest comparison lane|this product|ingredient line/i.test(
          section.summary,
        ),
      );
    const groundingGatePass = expectedApproved ? Boolean(evidence) : !evidence;

    return {
      source_ingredient_id: definition.sourceIngredientId,
      family: definition.canonicalFamily,
      display_name: definition.displayName,
      productization_class: definition.productizationClass,
      safety_boundary_tier: definition.safetyBoundaryTier,
      category: definition.category,
      replay_product: {
        source: product ? "local_validation_title" : "manifest_fixture",
        source_file: product?.sourceFile ?? null,
        product_id: product?.productId ?? null,
        barcode: product?.barcode ?? null,
        brand: digest.product.brandDisplay,
        title: digest.product.name,
      },
      inference: {
        pass: inferencePass,
        expected_family: definition.canonicalFamily,
        anchor_family: context.anchorIngredient?.ingredientFamily ?? null,
        context_family: context.ingredientFamily,
        anchor_name: context.anchorIngredient?.name ?? null,
      },
      scientific_background: {
        pass: sectionPass,
        mode: plan.mode,
        family: plan.family,
        headings: plan.sections.map((section) => section.heading),
        expected_first_heading: expectedFirstHeading,
      },
      evidence_grounding: {
        pass: groundingGatePass,
        review_status: registryRow?.review_status ?? "needs_edit",
        expected_reviewed_evidence: expectedApproved,
        reviewed_evidence_found: Boolean(evidence),
        first_reference_id: evidence?.supportingReferences[0]?.id ?? null,
        review_reasons: registryRow?.review_reasons ?? [],
      },
    };
  });

  const failures = replayRows.filter(
    (row) =>
      !row.inference.pass ||
      !row.scientific_background.pass ||
      !row.evidence_grounding.pass,
  );
  const evidenceBacklogRows = replayRows
    .filter((row) => row.evidence_grounding.review_status !== "approved")
    .map((row) => {
      const definition = NUTRI_MINIMAL_FULL_FAMILY_DEFINITIONS.find(
        (candidate) => candidate.canonicalFamily === row.family,
      )!;
      const primaryLane = primaryLaneForDefinition(definition);
      const registryRow = registryByKey.get(`${row.family}|${primaryLane}`);
      return {
        family: row.family,
        source_ingredient_id: row.source_ingredient_id,
        display_name: row.display_name,
        lane: primaryLane,
        review_status: row.evidence_grounding.review_status,
        review_reasons: row.evidence_grounding.review_reasons,
        safety_boundary_tier: row.safety_boundary_tier,
        productization_class: row.productization_class,
        next_action: registryRow
          ? backlogActionForRow(registryRow, definition)
          : "manual_evidence_editor_review",
        live_grounding_blocked: true,
        hard_boundary: definition.hardBoundary,
        selection_notes: registryRow?.selection_notes ?? [],
      };
    });

  const summary = {
    manifest_rows: replayRows.length,
    local_validation_title_replays: replayRows.filter(
      (row) => row.replay_product.source === "local_validation_title",
    ).length,
    manifest_fixture_replays: replayRows.filter(
      (row) => row.replay_product.source === "manifest_fixture",
    ).length,
    inference_pass: replayRows.filter((row) => row.inference.pass).length,
    scientific_background_section_pass: replayRows.filter(
      (row) => row.scientific_background.pass,
    ).length,
    evidence_grounding_gate_pass: replayRows.filter(
      (row) => row.evidence_grounding.pass,
    ).length,
    approved_primary_lanes: replayRows.filter(
      (row) => row.evidence_grounding.review_status === "approved",
    ).length,
    needs_edit_primary_lanes: replayRows.filter(
      (row) => row.evidence_grounding.review_status === "needs_edit",
    ).length,
    rejected_primary_lanes: replayRows.filter(
      (row) => row.evidence_grounding.review_status === "rejected",
    ).length,
    failures: failures.length,
  };

  const replayArtifact = {
    version: "nutri_minimal_v4_family_replay_audit.v1",
    generated_at: new Date().toISOString(),
    summary,
    failures,
    replay_rows: replayRows,
  };
  const backlogArtifact = {
    version: "nutri_minimal_v4_evidence_review_backlog.v1",
    generated_at: replayArtifact.generated_at,
    summary: evidenceBacklogRows.reduce(
      (acc, row) => {
        acc.total += 1;
        if (row.review_status === "needs_edit") acc.needs_edit += 1;
        if (row.review_status === "rejected") acc.rejected += 1;
        if (row.next_action.includes("blocked")) acc.keep_blocked += 1;
        return acc;
      },
      { total: 0, needs_edit: 0, rejected: 0, keep_blocked: 0 },
    ),
    backlog_rows: evidenceBacklogRows,
  };

  await fs.writeFile(REPLAY_AUDIT_PATH, `${JSON.stringify(replayArtifact, null, 2)}\n`);
  await fs.writeFile(EVIDENCE_BACKLOG_PATH, `${JSON.stringify(backlogArtifact, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        replay_audit_path: REPLAY_AUDIT_PATH,
        evidence_backlog_path: EVIDENCE_BACKLOG_PATH,
        summary,
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
