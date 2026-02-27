import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DB_PATH = path.resolve(__dirname, "../src/barcodeResolutionDbCache.ts");

test("regulatory map writes go through policy evaluator and blocked writes are audited", async () => {
  const source = await readFile(CACHE_DB_PATH, "utf8");
  assert.match(source, /export const evaluateRegulatoryMapWritePolicy = \(params:/);
  assert.match(source, /const resolveWriteGuardMode = \(override\?: ContractMode\): ContractMode =>/);
  assert.match(source, /if \(incomingIsNegativeSignal && existingIsPositive\) \{/);
  assert.match(source, /if \(incomingRank > existingRank\) \{/);
  assert.match(source, /if \(incomingRank < existingRank\) \{/);
  assert.match(source, /recordWriteGuardObservation\(/);
  assert.match(source, /if \(writeGuardMode === "enforce"\) \{/);
  assert.match(source, /await insertBlockedRegulatoryCandidate\(/);
  assert.match(source, /await upsertRegulatoryMapWithPolicy\(input, options\);/);
});

test("negative cache clear removes both gtin14 and raw variant keys", async () => {
  const source = await readFile(CACHE_DB_PATH, "utf8");
  assert.match(source, /const keys = buildBarcodeKeyList\(\s*barcodeGtin14,\s*barcodeRaw,\s*resolveKeyContractMode\(/);
  assert.match(source, /const deleteBy = async \(column: "barcode_gtin14" \| "barcode_raw"\) => \{/);
  assert.match(source, /const primaryError = await deleteBy\("barcode_gtin14"\);/);
  assert.match(source, /const secondaryError = await deleteBy\("barcode_raw"\);/);
});
