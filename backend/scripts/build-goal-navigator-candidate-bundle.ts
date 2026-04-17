import fs from "node:fs";
import path from "node:path";

import { goalNavigatorCatalogEvaluationServiceInternals } from "../src/personalization/catalogEvaluationService.js";
import {
  DEFAULT_GOAL_NAVIGATOR_CANDIDATE_BUNDLE_PATH,
  GOAL_NAVIGATOR_CANDIDATE_BUNDLE_SCHEMA_VERSION,
} from "../src/personalization/goalNavigatorBundleArtifact.js";
import { uploadGoalNavigatorCandidateBundleArtifact } from "../src/personalization/goalNavigatorArtifactStorage.js";
import { buildGoalNavigatorCandidateGapRecord } from "../src/personalization/goalNavigatorCandidateGaps.js";
import { persistGoalNavigatorBundleRun } from "../src/personalization/goalNavigatorBundleRepository.js";
import reasonCodesModule from "../../lib/personalization/core/reasonCodes.ts";

const { PERSONALIZATION_RULES_VERSION } = reasonCodesModule;

const args = process.argv.slice(2);

const getArg = (flag: string): string | null => {
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};

const hasFlag = (flag: string) => args.includes(`--${flag}`);

const outPath = getArg("out") ?? DEFAULT_GOAL_NAVIGATOR_CANDIDATE_BUNDLE_PATH;
const dryRun = hasFlag("dry-run");
const skipPersist = hasFlag("skip-persist");
const skipStorageUpload = hasFlag("skip-storage-upload");

const ensureDir = async (dirPath: string) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const run = async () => {
  const bundle = await goalNavigatorCatalogEvaluationServiceInternals.buildCatalogCandidateBundle(
    goalNavigatorCatalogEvaluationServiceInternals.fetchAllOverlayCatalogRows,
  );
  const candidateGaps = bundle.preparedCandidates
    .map((candidate) => buildGoalNavigatorCandidateGapRecord(candidate.preparedProduct))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

  const artifact = {
    schemaVersion: GOAL_NAVIGATOR_CANDIDATE_BUNDLE_SCHEMA_VERSION,
    rulesVersion: PERSONALIZATION_RULES_VERSION,
    generatedAt: bundle.preparedAt,
    sourceTable: "iherb_overlay_products",
    sourceRowCount: bundle.sourceRowCount,
    notEnoughStructuredDataCount: bundle.notEnoughStructuredDataCount,
    gatedOutOfScopeNonSupplementCount: bundle.gatedOutOfScopeNonSupplementCount,
    preparedCandidates: bundle.preparedCandidates,
  };

  if (!dryRun) {
    await writeJson(outPath, artifact);
  }

  let bundleRunId: string | null = null;
  let storageBucket: string | null = null;
  let storagePath: string | null = null;
  let artifactByteSize: number | null = null;
  let artifactChecksum: string | null = null;
  if (!dryRun && !skipStorageUpload) {
    const uploadedArtifact = await uploadGoalNavigatorCandidateBundleArtifact(artifact);
    storageBucket = uploadedArtifact.bucket;
    storagePath = uploadedArtifact.path;
    artifactByteSize = uploadedArtifact.byteSize;
    artifactChecksum = uploadedArtifact.checksum;
  }

  if (!dryRun && !skipPersist) {
    const persisted = await persistGoalNavigatorBundleRun({
      schemaVersion: artifact.schemaVersion,
      rulesVersion: artifact.rulesVersion,
      generatedAt: artifact.generatedAt,
      sourceTable: artifact.sourceTable,
      sourceRowCount: artifact.sourceRowCount,
      preparedCandidateCount: artifact.preparedCandidates.length,
      notEnoughStructuredDataCount: artifact.notEnoughStructuredDataCount,
      artifactPath: outPath,
      storageBucket,
      storagePath,
      artifactByteSize,
      artifactChecksum,
      activate: !skipStorageUpload && Boolean(storageBucket && storagePath),
      buildMeta: {
        persistedFrom: "build-goal-navigator-candidate-bundle",
        storageUploadSkipped: skipStorageUpload,
        gatedOutOfScopeNonSupplementCount: bundle.gatedOutOfScopeNonSupplementCount,
      },
      candidateGaps,
    });
    bundleRunId = persisted.runId;
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        dryRun,
        skipPersist,
        skipStorageUpload,
        outPath,
        storageBucket,
        storagePath,
        artifactByteSize,
        artifactChecksum,
        generatedAt: artifact.generatedAt,
        preparedCandidateCount: artifact.preparedCandidates.length,
        notEnoughStructuredDataCount: artifact.notEnoughStructuredDataCount,
        gatedOutOfScopeNonSupplementCount: bundle.gatedOutOfScopeNonSupplementCount,
        candidateGapCount: candidateGaps.length,
        bundleRunId,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error("[goal-navigator-bundle] failed", error);
  process.exit(1);
});
