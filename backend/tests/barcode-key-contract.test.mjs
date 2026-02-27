import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BARCODE_KEY_PATH = path.resolve(__dirname, "../src/barcodeKey.ts");

test("normalizeBarcodeKey exposes canonical contract fields", async () => {
  const source = await readFile(BARCODE_KEY_PATH, "utf8");
  assert.match(source, /export type BarcodeKeyNormalized = \{/);
  assert.match(source, /gtin14: string \| null;/);
  assert.match(source, /rawNormalized: string;/);
  assert.match(source, /isValidChecksum: boolean \| null;/);
  assert.match(source, /variants: string\[\];/);
  assert.match(source, /checksumFixed: boolean;/);
  assert.match(source, /export const normalizeBarcodeKey = \(raw: string\): BarcodeKeyNormalized => \{/);
});

test("barcode key variants include gtin14 and raw fallback keys", async () => {
  const source = await readFile(BARCODE_KEY_PATH, "utf8");
  assert.match(source, /export const buildBarcodeVariantKeys = \(params: \{/);
  assert.match(source, /add\(params\.gtin14\);/);
  assert.match(source, /add\(params\.raw\);/);
  assert.match(source, /if \(normalized\.gtin14\) \{/);
});
