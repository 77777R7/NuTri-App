import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");
const MY_SUPPLEMENT_FACTS_PATH = path.resolve(__dirname, "../src/mySupplementFacts.ts");

test("ensure-overview overlay fetch keeps image fields in the transport select", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  assert.match(
    source,
    /\.select\(\s*"product_id,upc_code,barcode_gtin14,brand_name,title,link,product_catalog_image,product_images,categories,supplement_facts,serving,description_sections,source_zip_path,updated_at"/,
  );
  assert.match(source, /readOverlayNutritionalFacts\(rawSupplementFacts, supplementFacts\)/);
  assert.match(source, /upc_code\.eq/);
});

test("MySupplementFacts merges overlay warnings and image into the facts payload", async () => {
  const source = await readFile(MY_SUPPLEMENT_FACTS_PATH, "utf8");
  assert.match(source, /const overlayImageUrl = safeTrim\(params\.overlayClaims\?\.imageUrl\);/);
  assert.match(source, /const overlayWarningsText = normalizeWarningLine\(params\.overlayClaims\?\.warnings \?\? null\);/);
  assert.match(source, /imageUrl: overlayImageUrl,/);
  assert.match(source, /warningsText: overlayWarningsText,/);
  assert.match(source, /overlayWarningsText,/);
});
