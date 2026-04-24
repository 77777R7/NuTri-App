import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");
const ROUTE_PATH = path.resolve(__dirname, "../src/routes/enrichStreamRoute.ts");

const readEnrichStreamSource = async () =>
  `${await readFile(SERVER_PATH, "utf8")}\n${await readFile(ROUTE_PATH, "utf8")}`;

test("cache-hit web-only with empty core facts short-circuits to NOT_FOUND", async () => {
  const source = await readEnrichStreamSource();
  const branchStart = source.indexOf("if (cachedFast && !bypassCachedFastPathForAuthority)");
  assert.ok(branchStart >= 0, "missing cachedFast branch");
  const branchSlice = source.slice(branchStart, branchStart + 1400);

  assert.match(branchSlice, /cachedLooksWebOnly && !hasCoreFacts\(cachedFast\.snapshot, cachedFast\.analysisPayload\)/);
  assert.match(branchSlice, /emitProductNotFoundAndFinalize\(\{/);
  assert.match(branchSlice, /stage:\s*"facts"/);
  assert.match(branchSlice, /reasonCode:\s*"WEB_CACHE_EMPTY_CORE_FACTS"/);
});

test("web-only unknown short-circuit runs before cached snapshot emit", async () => {
  const source = await readEnrichStreamSource();
  const branchStart = source.indexOf("if (cachedFast && !bypassCachedFastPathForAuthority)");
  assert.ok(branchStart >= 0, "missing cachedFast branch");

  const guardIndex = source.indexOf('reasonCode: "WEB_CACHE_EMPTY_CORE_FACTS"', branchStart);
  const emitCachedIndex = source.indexOf("emitCachedSnapshot(", branchStart);

  assert.ok(guardIndex >= 0, "missing WEB_CACHE_EMPTY_CORE_FACTS guard");
  assert.ok(emitCachedIndex >= 0, "missing emitCachedSnapshot in cachedFast branch");
  assert.ok(
    guardIndex < emitCachedIndex,
    "NOT_FOUND short-circuit must happen before emitting cached snapshot/deep chain",
  );
});
