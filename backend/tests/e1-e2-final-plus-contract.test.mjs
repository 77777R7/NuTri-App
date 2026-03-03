import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PACKAGE_JSON_PATH = path.resolve(__dirname, "../../package.json");
const E1_EVAL_PATH = path.resolve(__dirname, "../../scripts/maintainer/evaluate-stage-e1-shadow.mjs");

test("package scripts expose e1/e2 final-plus commands", async () => {
  const pkgRaw = await readFile(PACKAGE_JSON_PATH, "utf8");
  const pkg = JSON.parse(pkgRaw);
  const scripts = pkg?.scripts || {};

  assert.equal(typeof scripts["gates:e1-owner-closure"], "string");
  assert.equal(typeof scripts["gates:e1-staging-repeat-compare"], "string");
  assert.equal(typeof scripts["gates:e2-select-top10"], "string");
  assert.equal(typeof scripts["gates:e2-watch-window"], "string");
});

test("e1 evaluator writes release readiness decision with dual readiness", async () => {
  const source = await readFile(E1_EVAL_PATH, "utf8");
  assert.match(source, /e1_release_readiness_decision\.json/);
  assert.match(source, /full_preview_readiness/);
  assert.match(source, /pilot_readiness/);
  assert.match(source, /go_to_e2_pilot/);
  assert.match(source, /blockingReasons/);
});

