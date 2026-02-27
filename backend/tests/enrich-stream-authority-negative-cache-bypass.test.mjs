import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");

test("high-confidence map candidate bypasses lnhpd_not_found negative cache", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  assert.match(source, /candidate\.source === "map" \|\| candidate\.source === "map_stale"/);
  assert.match(source, /Number\(candidate\.confidence \?\? 0\) >= 0\.9/);

  const marker = source.indexOf("const shouldBypassAuthorityNegativeCache");
  assert.ok(marker >= 0, "missing shouldBypassAuthorityNegativeCache guard");
  const slice = source.slice(marker, marker + 1200);

  assert.match(slice, /npnNegativeReasonCode === "lnhpd_not_found"/);
  assert.match(slice, /authorityNegativeCacheBypassed = shouldBypassAuthorityNegativeCache/);
  assert.match(slice, /!shouldBypassAuthorityNegativeCache/);
});
