import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");

test("LNHPD second-chance timeout constant and helper are defined", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  assert.match(
    source,
    /const RESILIENCE_LNHPD_SECOND_CHANCE_TIMEOUT_MS = Number\(/,
    "missing RESILIENCE_LNHPD_SECOND_CHANCE_TIMEOUT_MS",
  );
  assert.match(
    source,
    /const fetchLnhpdFactsWithSecondChance = async \(/,
    "missing fetchLnhpdFactsWithSecondChance helper",
  );
  assert.match(source, /attempt1Status/);
  assert.match(source, /attempt2Status/);
  assert.match(source, /secondChanceUsed/);
});

test("stage0 authority candidate path uses LNHPD second-chance helper", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  assert.match(
    source,
    /fetchLnhpdFactsWithSecondChance\(candidate\.npn,\s*requestSignal,\s*\{[\s\S]*secondTimeoutMs:\s*RESILIENCE_LNHPD_SECOND_CHANCE_TIMEOUT_MS[\s\S]*\}\)/,
  );
  assert.match(source, /authorityLnhpdAttempt1Status = lnhpdLookup\.attempt1Status/);
  assert.match(source, /authorityLnhpdAttempt2Status = lnhpdLookup\.attempt2Status/);
});

test("stage1 web npn path uses LNHPD second-chance helper", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  assert.match(
    source,
    /fetchLnhpdFactsWithSecondChance\(npnCandidate,\s*requestSignal,\s*\{[\s\S]*secondTimeoutMs:\s*RESILIENCE_LNHPD_SECOND_CHANCE_TIMEOUT_MS[\s\S]*\}\)/,
  );
});
