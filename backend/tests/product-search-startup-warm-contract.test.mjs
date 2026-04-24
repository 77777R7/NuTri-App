import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");

test("product search full-index warmup is opt-in at backend startup", async () => {
  const source = await readFile(SERVER_PATH, "utf8");

  assert.match(
    source,
    /const PRODUCT_SEARCH_WARM_ON_STARTUP = parseBooleanEnv\(process\.env\.PRODUCT_SEARCH_WARM_ON_STARTUP, false\);/,
    "startup warm should default off so scan/render regression traffic cannot be blocked by full-index CPU work",
  );

  const listenStart = source.indexOf('app.listen(PORT, "0.0.0.0"');
  assert.ok(listenStart >= 0, "missing app.listen block");
  const listenBlock = source.slice(listenStart, listenStart + 500);

  assert.match(
    listenBlock,
    /if \(PRODUCT_SEARCH_WARM_ON_STARTUP\) \{[\s\S]*warmProductSearchIndex\(\);/,
    "startup warm should be guarded by the explicit opt-in flag",
  );
  assert.match(
    listenBlock,
    /timer\.unref\?\.\(\);/,
    "startup warm timer should not keep the process alive",
  );
});
