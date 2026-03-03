import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STABLE_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-backend-gates-stable.mjs");
const VERIFY_SCRIPT_PATH = path.resolve(__dirname, "../../scripts/maintainer/verify-governance-policy.mjs");

test("stable gate runs governance verifier and captures baseline migration/write mode context", async () => {
  const stableSource = await readFile(STABLE_PATH, "utf8");
  const verifierSource = await readFile(VERIFY_SCRIPT_PATH, "utf8");

  assert.match(stableSource, /verify-governance-policy\.mjs/);
  assert.match(stableSource, /governancePolicyRun/);
  assert.match(stableSource, /governancePolicyReport/);
  assert.match(stableSource, /migrationBatchId/);
  assert.match(stableSource, /dbWriteMode/);
  assert.match(stableSource, /governance_policy_report_exit_/);

  assert.match(verifierSource, /governance_policy_report\.json/);
  assert.match(verifierSource, /flagsSnapshot/);
  assert.match(verifierSource, /blockingReasons/);
  assert.match(verifierSource, /migrationBatchId/);
  assert.match(verifierSource, /dbWriteMode/);
});
