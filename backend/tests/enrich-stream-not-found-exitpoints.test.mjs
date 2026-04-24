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

test("server.ts no longer has scattered Product not found sendSSE exits", async () => {
  const source = await readEnrichStreamSource();

  const legacyMatches = source.match(/sendSSE\(res,\s*"error",\s*\{\s*message:\s*"Product not found"\s*\}\)/g) ?? [];
  assert.equal(
    legacyMatches.length,
    0,
    "legacy sendSSE(error,{message:\"Product not found\"}) must be removed",
  );

  const helperCalls = source.match(/emitProductNotFoundAndFinalize\(/g) ?? [];
  assert.equal(helperCalls.length, 6, "expected 6 not_found exits routed through helper");
});
