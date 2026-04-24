import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");

test("analysis-section returns terminal ingredients detail for web identities when digest is missing", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const missingDigestStart = source.indexOf("if (!digestRow) {");
  assert.ok(missingDigestStart >= 0, "missing digest fallback block");
  const block = source.slice(missingDigestStart, source.indexOf("const resolvedDigestRow", missingDigestStart));

  assert.match(block, /identity\.type === "webCanonicalId" \|\| identity\.type === "gtin14"/);
  assert.match(block, /dataStatus:\s*"not_provided"/);
  assert.match(block, /detail:\s*\{\s*items:\s*\[\],\s*overallSummary:\s*null,\s*overlapNotes:\s*null\s*\}/);

  const terminalIndex = block.indexOf("const terminalNoDigestIdentity");
  const pendingIndex = block.indexOf('dataStatus: "pending"');
  assert.ok(terminalIndex >= 0, "missing terminal web no-digest branch");
  assert.ok(pendingIndex >= 0, "missing authoritative pending fallback branch");
  assert.ok(terminalIndex < pendingIndex, "web no-digest terminal branch must run before pending fallback");
});
