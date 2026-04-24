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

test("non-web fresh fast bundle path sanitizes covers after mergeFastAnalysisBundle", async () => {
  const source = await readEnrichStreamSource();
  const mergeMatch = source.match(
    /let fastCandidate = mergeFastAnalysisBundle\(\{[\s\S]{0,300}?skeleton,\s*[\s\S]{0,300}?digest:\s*params\.digest,\s*[\s\S]{0,300}?fastOutput:\s*fastRaw[\s\S]{0,300}?\}\);/,
  );
  assert.ok(mergeMatch, "missing mergeFastAnalysisBundle call in fresh path");
  const anchor = mergeMatch.index ?? -1;
  assert.ok(anchor >= 0, "missing mergeFastAnalysisBundle call anchor in fresh path");
  const slice = source.slice(anchor, anchor + 480);

  assert.match(
    slice,
    /sanitizeAnalysisBundleCoverFields\(\{ bundle: fastCandidate, digest: params\.digest \}\)/,
    "fresh non-web path must sanitize merged covers before parse",
  );
});
