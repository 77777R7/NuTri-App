import fs from "node:fs";
import path from "node:path";

import { goalNavigatorCatalogEvaluationServiceInternals } from "../src/personalization/catalogEvaluationService.js";
import {
  DEFAULT_GOAL_NAVIGATOR_CANDIDATE_BUNDLE_PATH,
  GOAL_NAVIGATOR_CANDIDATE_BUNDLE_SCHEMA_VERSION,
} from "../src/personalization/goalNavigatorBundleArtifact.js";
import { PERSONALIZATION_RULES_VERSION } from "../../lib/personalization/core/reasonCodes";

const args = process.argv.slice(2);

const getArg = (flag: string): string | null => {
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};

const hasFlag = (flag: string) => args.includes(`--${flag}`);

const outPath = getArg("out") ?? DEFAULT_GOAL_NAVIGATOR_CANDIDATE_BUNDLE_PATH;
const dryRun = hasFlag("dry-run");

const ensureDir = async (dirPath: string) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const run = async () => {
  const bundle = await goalNavigatorCatalogEvaluationServiceInternals.buildCatalogCandidateBundle(
    goalNavigatorCatalogEvaluationServiceInternals.fetchOverlayCatalogRows,
  );

  const artifact = {
    schemaVersion: GOAL_NAVIGATOR_CANDIDATE_BUNDLE_SCHEMA_VERSION,
    rulesVersion: PERSONALIZATION_RULES_VERSION,
    generatedAt: bundle.preparedAt,
    sourceTable: "iherb_overlay_products",
    sourceRowCount: bundle.preparedCandidates.length,
    notEnoughStructuredDataCount: bundle.notEnoughStructuredDataCount,
    preparedCandidates: bundle.preparedCandidates,
  };

  if (!dryRun) {
    await writeJson(outPath, artifact);
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        dryRun,
        outPath,
        generatedAt: artifact.generatedAt,
        preparedCandidateCount: artifact.preparedCandidates.length,
        notEnoughStructuredDataCount: artifact.notEnoughStructuredDataCount,
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
