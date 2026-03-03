import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");
const OVERLAY_PATH = path.resolve(__dirname, "../src/patchShadowOverlay.ts");

const readSource = async (filePath) => readFile(filePath, "utf8");

test("patch-shadow status endpoint is exposed and maintainer-gated", async () => {
  const source = await readSource(SERVER_PATH);
  assert.match(source, /app\.get\("\/api\/patch-shadow\/status"/);
  assert.match(source, /MAINTAINER_ONLY_PATCH_SHADOW_STATUS|patch-shadow status is (internal )?maintainer-only/);
  assert.match(source, /regressionAuthRoutes[\s\S]*"\/api\/patch-shadow\/status"/);
});

test("patch-shadow overlay honors env toggles and scanned_label source tier only", async () => {
  const source = await readSource(OVERLAY_PATH);
  assert.match(source, /PATCH_SHADOW_ENABLE/);
  assert.match(source, /PATCH_SHADOW_CANDIDATES_PATH/);
  assert.match(source, /PATCH_SHADOW_STAGE_C_DIR/);
  assert.match(source, /sourceTier[^\n]*scanned_label|sourceTier === "scanned_label"/);
  assert.match(source, /runtimePatchHitCountByLane/);
  assert.match(source, /runtimePatchHitSampleCount/);
  assert.match(source, /runtimePatchLastMatchedIdentity/);
  assert.match(source, /candidateScopeId/);
  assert.match(source, /retrySuccessRateNullable/);
  assert.match(source, /getPatchShadowStatus/);
  assert.match(source, /applyPatchShadowToFactsDigest/);
});
