import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DB_PATH = path.resolve(__dirname, "../src/barcodeResolutionDbCache.ts");
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");
const ENRICH_STREAM_ROUTE_PATH = path.resolve(__dirname, "../src/routes/enrichStreamRoute.ts");
const STABLE_GATES_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-backend-gates-stable.mjs");
const RELEASE_DB_GATES_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-release-db-gates.mjs");

const readEnrichStreamSource = async () =>
  `${await readFile(SERVER_PATH, "utf8")}\n${await readFile(ENRICH_STREAM_ROUTE_PATH, "utf8")}`;

test("key contract and write guard support off/shadow/enforce modes", async () => {
  const source = await readFile(CACHE_DB_PATH, "utf8");
  assert.match(source, /type ContractMode = "off" \| "shadow" \| "enforce";/);
  assert.match(source, /process\.env\.KEY_CONTRACT_V2/);
  assert.match(source, /process\.env\.WRITE_GUARD_V2/);
  assert.match(source, /if \(mode === "enforce"\)/);
});

test("stage0 protocol unified flag defaults on and gates awaitStage0Bundle", async () => {
  const source = await readEnrichStreamSource();
  assert.match(source, /const STAGE0_PROTOCOL_UNIFIED = parseBooleanEnv\(process\.env\.STAGE0_PROTOCOL_UNIFIED, true\);/);
  assert.match(source, /if \(STAGE0_PROTOCOL_UNIFIED\) \{\s*await awaitStage0Bundle\(\);/);
});

test("stable gates includes shadow observation reports and enforcement hooks", async () => {
  const source = await readFile(STABLE_GATES_PATH, "utf8");
  assert.match(source, /write_policy_shadow_report\.json/);
  assert.match(source, /candidates_quality_report\.json/);
  assert.match(source, /negative_cache_residual_report\.json/);
  assert.match(source, /surface_consistency_report\.json/);
  assert.match(source, /MAINTAINER_GATES_SHADOW_REPORTS_ENFORCE/);
});

test("release db gates runner captures before\/after artifacts and diff", async () => {
  const source = await readFile(RELEASE_DB_GATES_PATH, "utf8");
  assert.match(source, /run-release-db-gates/);
  assert.match(source, /migration_list\.before\.txt/);
  assert.match(source, /run-backend-gates-stable\.mjs/);
  assert.match(source, /gate-report-diff\.mjs/);
});
