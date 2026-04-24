import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  buildFamilyExpansionBacklog,
  buildFullFamilyProductizationManifest,
  buildFormTaxonomyStaging,
  buildP0ExpansionSectionPlanDrafts,
  buildP0ExpansionWave,
  buildPromptGroundingReviewQueue,
  buildScientificEvidenceCandidateRegistry,
  normalizeWorkbookPackage,
  reviewScientificEvidenceCandidateRegistry,
  type ExistingCandidateQuery,
  type RawWorkbookPackage,
  DEFAULT_SCIENTIFIC_LANE_CONFIG,
} from "../src/staging/nutriMinimalV4.js";
import { reviewScientificCandidateWithNcbiEntrez } from "./lib/lifeScienceResearchNcbiEntrez.js";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_INPUT =
  "/Users/howard07/Library/Mobile Documents/com~apple~CloudDocs/nutri_minimal_data_package_v4_0_en_only_review_excerpts.xlsx";
const DEFAULT_OUT_DIR = path.join(ROOT, "data", "staging", "nutri-minimal-v4");
const PYTHON_READER = path.join(
  ROOT,
  "scripts",
  "python",
  "read_nutri_minimal_v4_workbook.py",
);
const REVIEWED_EVIDENCE_PATH = path.join(
  ROOT,
  "data",
  "reviewed",
  "scientific-background-evidence.v1.json",
);

const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};
const hasFlag = (flag: string): boolean => args.includes(`--${flag}`);

const readExistingCandidateQueries = async (): Promise<
  ExistingCandidateQuery[]
> => {
  const raw = await fs.readFile(REVIEWED_EVIDENCE_PATH, "utf8");
  const parsed = JSON.parse(raw) as {
    candidate_pubmed_searches?: Array<Record<string, unknown>>;
  };
  return Array.isArray(parsed.candidate_pubmed_searches)
    ? parsed.candidate_pubmed_searches
        .map((row) => ({
          family: String(row.family ?? "").trim(),
          lane: String(row.lane ?? "").trim(),
          variant_key:
            typeof row.variant_key === "string" ? row.variant_key.trim() : null,
          query: typeof row.query === "string" ? row.query.trim() : null,
          priority: (["P0", "P1", "P2", "P3"].includes(
            String(row.priority ?? ""),
          )
            ? row.priority
            : "P2") as ExistingCandidateQuery["priority"],
          selection_notes: Array.isArray(row.selection_notes)
            ? row.selection_notes.map((item) => String(item))
            : [],
        }))
        .filter((row) => row.family && row.lane)
    : [];
};

const runWorkbookReader = async (
  inputPath: string,
): Promise<RawWorkbookPackage> => {
  const pythonExecutable =
    process.env.LIFE_SCIENCE_RESEARCH_PYTHON ?? "python3";
  const { stdout } = await execFileAsync(
    pythonExecutable,
    [PYTHON_READER, "--file", inputPath],
    {
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout) as RawWorkbookPackage;
};

const writeJson = async (targetPath: string, payload: unknown) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(
    targetPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
};

const main = async () => {
  const inputPath = getArg("file") ?? DEFAULT_INPUT;
  const outDir = getArg("out-dir") ?? DEFAULT_OUT_DIR;
  const skipReview = hasFlag("skip-review");

  const rawWorkbook = await runWorkbookReader(inputPath);
  const normalizedPackage = normalizeWorkbookPackage(rawWorkbook);
  const familyBacklog = buildFamilyExpansionBacklog(normalizedPackage);
  const formTaxonomyStaging = buildFormTaxonomyStaging(normalizedPackage);
  const existingQueries = await readExistingCandidateQueries();
  const candidateRegistry = buildScientificEvidenceCandidateRegistry(
    normalizedPackage,
    familyBacklog,
    DEFAULT_SCIENTIFIC_LANE_CONFIG,
    existingQueries,
  );
  const reviewedCandidateRegistry = skipReview
    ? candidateRegistry
    : await reviewScientificEvidenceCandidateRegistry(
        candidateRegistry,
        reviewScientificCandidateWithNcbiEntrez,
      );
  const promptGroundingQueue = buildPromptGroundingReviewQueue(
    normalizedPackage,
    familyBacklog,
    DEFAULT_SCIENTIFIC_LANE_CONFIG,
  );
  const fullFamilyProductizationManifest =
    buildFullFamilyProductizationManifest(normalizedPackage, familyBacklog);
  const p0ExpansionWave = buildP0ExpansionWave(
    normalizedPackage,
    familyBacklog,
  );
  const p0SectionPlanDrafts = buildP0ExpansionSectionPlanDrafts(
    normalizedPackage,
    familyBacklog,
  );

  const normalizedPackageWithDerivedSheets = {
    ...normalizedPackage,
    meta: {
      ...normalizedPackage.meta,
      derived_sheets: ["token_aliases", "generic_form_tokens"],
    },
    sheets: {
      ...normalizedPackage.sheets,
      token_aliases: formTaxonomyStaging.sheets.token_aliases,
      generic_form_tokens: formTaxonomyStaging.sheets.generic_form_tokens,
    },
  };

  const formTaxonomyDatasetPackage = {
    version: formTaxonomyStaging.version,
    generated_at: formTaxonomyStaging.generated_at,
    meta: {
      ...formTaxonomyStaging.meta,
      purpose: "form-taxonomy-staging",
    },
    sheets: formTaxonomyStaging.sheets,
    summary: formTaxonomyStaging.summary,
    rejected_aliases: formTaxonomyStaging.rejected_aliases,
  };

  await Promise.all([
    writeJson(
      path.join(outDir, "normalized-package.json"),
      normalizedPackageWithDerivedSheets,
    ),
    writeJson(path.join(outDir, "family-expansion-backlog.json"), {
      version: normalizedPackage.version,
      generated_at: normalizedPackage.generated_at,
      meta: normalizedPackage.meta,
      family_expansion_backlog: familyBacklog,
    }),
    writeJson(
      path.join(outDir, "form-taxonomy-staging.json"),
      formTaxonomyDatasetPackage,
    ),
    writeJson(
      path.join(outDir, "scientific-evidence-candidate-registry.json"),
      reviewedCandidateRegistry,
    ),
    writeJson(
      path.join(outDir, "prompt-grounding-review-queue.json"),
      promptGroundingQueue,
    ),
    writeJson(
      path.join(outDir, "full-family-productization-manifest.json"),
      fullFamilyProductizationManifest,
    ),
    writeJson(path.join(outDir, "p0-expansion-wave.json"), p0ExpansionWave),
    writeJson(
      path.join(outDir, "p0-expansion-section-plan-drafts.json"),
      p0SectionPlanDrafts,
    ),
  ]);

  const approvedScientific =
    reviewedCandidateRegistry.scientific_evidence_candidate_registry.filter(
      (row) => row.review_status === "approved",
    ).length;
  const needsEditScientific =
    reviewedCandidateRegistry.scientific_evidence_candidate_registry.filter(
      (row) => row.review_status === "needs_edit",
    ).length;
  const rejectedScientific =
    reviewedCandidateRegistry.scientific_evidence_candidate_registry.filter(
      (row) => row.review_status === "rejected",
    ).length;

  console.log(
    JSON.stringify(
      {
        ok: true,
        input: inputPath,
        out_dir: outDir,
        skip_review: skipReview,
        counts: {
          normalized_ingredients:
            normalizedPackage.sheets.ingredients?.length ?? 0,
          family_backlog: familyBacklog.length,
          form_aliases: formTaxonomyStaging.summary.form_alias_count,
          token_aliases: formTaxonomyStaging.summary.token_alias_count,
          generic_form_tokens:
            formTaxonomyStaging.summary.generic_form_token_count,
          scientific_candidate_rows:
            reviewedCandidateRegistry.scientific_evidence_candidate_registry
              .length,
          scientific_review_approved: approvedScientific,
          scientific_review_needs_edit: needsEditScientific,
          scientific_review_rejected: rejectedScientific,
          prompt_grounding_rows:
            promptGroundingQueue.prompt_grounding_review_queue.length,
          full_family_productization_manifest_rows:
            fullFamilyProductizationManifest.summary.input_rows,
          full_family_productized_runtime_families:
            fullFamilyProductizationManifest.summary
              .productized_runtime_families,
          p0_expansion_rows: p0ExpansionWave.p0_expansion_wave.length,
          p0_section_plan_draft_rows:
            p0SectionPlanDrafts.p0_expansion_section_plan_drafts.length,
        },
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
