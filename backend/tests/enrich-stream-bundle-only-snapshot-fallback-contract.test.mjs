import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");

test("bundle_only snapshot skip-stage0 hydrates a snapshot-backed skeleton before degraded rev1", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  assert.match(source, /normalizeIherbSupplementFactsRowsWithTitleFallback,/);
  assert.match(source, /const buildSnapshotWebIngredientsText = \(snapshot: SupplementSnapshot\): string \| null => \{/);
  assert.match(source, /const hydrateBundleOnlyOverlayFallbackSkeleton = async \(\): Promise<boolean> => \{/);
  assert.match(source, /normalizeIherbSupplementFactsRowsWithTitleFallback\(\{/);
  assert.match(source, /const alignedQuickDigest = await buildMySupplementDigestQuick\(\{/);
  assert.match(source, /decisionSupportInline: toDecisionSupportInline\(alignedDecisionSupport\),/);
  assert.match(source, /const hydrateCachedSnapshotBundleOnlySkeleton = \(\) => \{/);
  assert.match(source, /const buildSnapshotStage0Seed = \(\): \{/);
  assert.match(source, /ingredientsText = buildSnapshotWebIngredientsText\(cachedFast\.snapshot\)/);

  const branchStart = source.indexOf("if (streamAnalysisBundleOnly && !snapshotIsAuthoritativeForBundleOnly)");
  assert.ok(branchStart >= 0, "missing bundle_only snapshot skip-stage0 branch");
  const slice = source.slice(branchStart, branchStart + 3200);

  assert.match(slice, /const snapshotStage0Seed = buildSnapshotStage0Seed\(\);/);
  assert.match(slice, /rememberStreamProductIdentity\(digestProductIdentity\);/);
  assert.match(slice, /latestSkeletonBundle = attachProductIdentityMeta\(\{/);
  assert.match(slice, /emitDegradedLimitedRev1AndFinalize\("BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH"\);/);

  const shortCircuitStart = source.indexOf("if (streamAnalysisBundleOnly && !forceStage1 && !snapshotIsAuthoritativeFastPath)");
  assert.ok(shortCircuitStart >= 0, "missing cachedFast bundle_only short-circuit");
  const shortCircuitSlice = source.slice(shortCircuitStart, shortCircuitStart + 1200);
  assert.match(shortCircuitSlice, /hydrateCachedSnapshotBundleOnlySkeleton\(\);/);

  const bundleOnlySkipWebSearchStart = source.indexOf("if (streamAnalysisBundleOnly && BUNDLE_ONLY_SKIP_WEB_SEARCH)");
  assert.ok(bundleOnlySkipWebSearchStart >= 0, "missing bundle_only skip-web-search gate");
  const bundleOnlySkipWebSearchSlice = source.slice(bundleOnlySkipWebSearchStart, bundleOnlySkipWebSearchStart + 2400);
  assert.match(bundleOnlySkipWebSearchSlice, /await hydrateBundleOnlyOverlayFallbackSkeleton\(\);/);
  assert.match(bundleOnlySkipWebSearchSlice, /emitDegradedLimitedRev1AndFinalize\("BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH"\);/);
});

test("analysis-section ingredients detail exposes a fallback reason when no actives are available", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const branchStart = source.indexOf("if (totalActives === 0)");
  assert.ok(branchStart >= 0, "missing no-active ingredients_detail branch");
  const slice = source.slice(branchStart, branchStart + 900);

  assert.match(slice, /dataStatus: "not_provided"/);
  assert.match(slice, /fallbackUsed: "skeleton"/);
  assert.match(slice, /fallback: \{ code: "ingredients_not_provided" \}/);
  assert.match(slice, /fallbackReason: "ingredients_not_provided"/);
});
