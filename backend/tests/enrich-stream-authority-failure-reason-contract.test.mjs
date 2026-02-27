import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");

const ALLOWED_REASONS = new Set([
  "negative_cache_blocked",
  "lnhpd_timeout_first",
  "lnhpd_timeout_second",
  "lnhpd_not_found",
  "guardrail_failed",
  "lnhpd_query_error",
]);

test("authority failure reason type uses controlled reason code set", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const typeStart = source.indexOf("type AuthorityFailureReason =");
  assert.ok(typeStart >= 0, "missing AuthorityFailureReason type");
  const typeSlice = source.slice(typeStart, typeStart + 600);

  for (const reason of ALLOWED_REASONS) {
    assert.match(typeSlice, new RegExp(`"${reason}"`), `missing reason code in type: ${reason}`);
  }
});

test("authority failure reason writes only controlled values", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const matches = [...source.matchAll(/authorityFailureReason\s*=\s*"([^"]+)"/g)];
  assert.ok(matches.length > 0, "expected authorityFailureReason assignments");

  const observed = new Set(matches.map((match) => match[1]));
  for (const code of observed) {
    assert.ok(ALLOWED_REASONS.has(code), `unexpected authorityFailureReason code: ${code}`);
  }
});

test("authority diagnostics fields are exposed in scan metadata", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const metaStart = source.indexOf("const buildAuthorityMeta =");
  assert.ok(metaStart >= 0, "missing buildAuthorityMeta");
  const metaSlice = source.slice(metaStart, metaStart + 2200);

  assert.match(metaSlice, /authorityCandidateSource/);
  assert.match(metaSlice, /authorityLnhpdAttempt1Status/);
  assert.match(metaSlice, /authorityLnhpdAttempt2Status/);
  assert.match(metaSlice, /authorityFailureReason/);
  assert.match(metaSlice, /authorityNegativeCacheBypassed/);
});
