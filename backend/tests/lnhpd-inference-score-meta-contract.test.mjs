import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const ROOT_DIR = process.cwd().endsWith(`${path.sep}backend`)
  ? process.cwd()
  : path.join(process.cwd(), "backend");

test("server applies inference-only score metadata guard instead of treating inferred actives as fully verified", async () => {
  const serverPath = path.join(ROOT_DIR, "src", "server.ts");
  const source = await readFile(serverPath, "utf8");

  assert.match(source, /const resolveDigestScoreMeta = \(digest: FactsDigest\)/);
  assert.match(source, /scoreReasonCode:\s*INFERENCE_ONLY_SCORE_REASON_CODE/);
  assert.match(source, /inferenceOnly:\s*true/);
  assert.match(source, /const scoreMeta = resolveDigestScoreMeta\(digest\)/);
  assert.match(source, /scoreAvailable:\s*scoreMeta\.scoreAvailable/);
  assert.match(source, /scoreReasonCode:\s*scoreMeta\.scoreReasonCode/);
  assert.match(source, /inferenceOnly:\s*scoreMeta\.inferenceOnly/);
});
