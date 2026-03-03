import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MOBILE_SOAK_PATH = path.resolve(__dirname, "../../scripts/maintainer/mobile-soak-run.mjs");

const readScriptSource = async () => readFile(MOBILE_SOAK_PATH, "utf8");

test("mobile soak collects decision support verdict and top blockers per attempt", async () => {
  const source = await readScriptSource();
  assert.match(source, /fetchDecisionSupportInfo/);
  assert.match(source, /decisionSupportVerdict/);
  assert.match(source, /decisionSupportTopBlockerCodes/);
  assert.match(source, /decisionSupportFetchStatus/);
});

test("mobile soak summary emits decision support distributions for Stage B compare", async () => {
  const source = await readScriptSource();
  assert.match(source, /decisionSupportVerdictDistribution/);
  assert.match(source, /decisionSupportVerdictDistributionByRole/);
  assert.match(source, /decisionSupportTopBlockerDistribution/);
  assert.match(source, /roleDefinitionVersion/);
});

