import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareCatalogProduct } from "../../lib/personalization/core/catalogProductEvaluation";
import {
  GOAL_NAVIGATOR_CANDIDATE_BUNDLE_SCHEMA_VERSION,
  readGoalNavigatorCandidateBundleArtifact,
} from "../src/personalization/goalNavigatorBundleArtifact";

test("goal navigator bundle artifact loader reads a prebuilt bundle from disk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-nav-bundle-"));
  const filePath = path.join(dir, "goal_navigator_candidate_bundle.v1.json");

  const artifact = {
    schemaVersion: GOAL_NAVIGATOR_CANDIDATE_BUNDLE_SCHEMA_VERSION,
    rulesVersion: "personalization-rules/v1-phase7",
    generatedAt: "2026-03-19T00:00:00.000Z",
    sourceTable: "iherb_overlay_products",
    sourceRowCount: 1,
    notEnoughStructuredDataCount: 0,
    preparedCandidates: [
      {
        preparedProduct: prepareCatalogProduct({
          productId: "immune_c",
          title: "Vitamin C 500",
          brandName: "Trusted Brand",
          description: "Buffered vitamin C support.",
          suggestedUse: "Take 1 capsule daily.",
          ingredients: [{ name: "Vitamin C", dose: "500 mg" }],
        }),
      },
    ],
  };

  fs.writeFileSync(filePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const loaded = readGoalNavigatorCandidateBundleArtifact(filePath);

  assert.equal(loaded.error, null);
  assert.equal(loaded.artifact?.preparedCandidates[0]?.preparedProduct.productId, "immune_c");
  assert.equal(loaded.artifact?.notEnoughStructuredDataCount, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});
