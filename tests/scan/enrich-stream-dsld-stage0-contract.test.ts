import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROUTE_FILE = path.join(process.cwd(), 'backend/src/routes/enrichStreamRoute.ts');

test('full-stream DSLD deterministic Stage0 bypasses cached fast before cover contract', () => {
  const source = fs.readFileSync(ROUTE_FILE, 'utf8');
  const blockMatch = source.match(
    /const skipCachedFastForBundleOnlyDeterministic =[\s\S]*?let cachedFast = skipCachedFastForDeterministicStage0/,
  );

  assert.ok(blockMatch, 'cached-fast lookup must use deterministic Stage0 skip flag');
  const block = blockMatch[0];
  assert.ok(block.includes('const skipCachedFastForFullDsldDeterministic ='));
  assert.ok(block.includes('STAGE0_DSLD_FULL_STREAM_DETERMINISTIC_REV1_ENABLED'));
  assert.ok(block.includes('!streamAnalysisBundleOnly'));
  assert.ok(block.includes('params.digest.sourceType === "dsld"'));
  assert.ok(block.includes('params.allowAi === false'));
  assert.ok(block.includes('dsld deterministic stage0 skipping cached fast'));
});

test('full-stream DSLD deterministic Stage0 is barcode-canary gated', () => {
  const source = fs.readFileSync(ROUTE_FILE, 'utf8');

  assert.ok(
    source.includes('STAGE0_DSLD_FULL_STREAM_DETERMINISTIC_REV1_CANARY_BARCODES'),
    'route must receive the barcode canary allowlist',
  );
  assert.ok(
    source.includes('STAGE0_DSLD_FULL_STREAM_DETERMINISTIC_REV1_ALLOW_ALL'),
    'route must require an explicit allow-all override for full rollout',
  );
  assert.ok(
    source.includes('return Boolean(STAGE0_DSLD_FULL_STREAM_DETERMINISTIC_REV1_ALLOW_ALL);'),
    'empty canary allowlist must not imply full rollout',
  );
  assert.ok(
    source.includes('isStage0DsldFullStreamDeterministicRev1EnabledForBarcode('),
    'full-stream fallback must call the barcode gate before starting deterministic rev1',
  );
});

test('full-stream DSLD deterministic Stage0 has a bounded no-AI rev1 path', () => {
  const source = fs.readFileSync(ROUTE_FILE, 'utf8');
  const blockMatch = source.match(
    /const deterministicNoAiFastPath =[\s\S]*?const emittedRev1 = emitRev1Once\([\s\S]*?deterministicFallbackReason,[\s\S]*?\);/,
  );

  assert.ok(blockMatch, 'full-stream DSLD must not fall through to the generic fast merge path');
  const block = blockMatch[0];
  assert.ok(block.includes('streamAnalysisBundleOnly || skipCachedFastForFullDsldDeterministic'));
  assert.ok(block.includes('dsld_full_stream_no_ai_fast_path'));
  assert.ok(block.includes('[analysis_bundle] cover_contract'));
  assert.ok(block.includes('emitRev1Once'));
});

test('iHerb overlay rows bridge to deterministic Stage0 before web negative-cache search', () => {
  const source = fs.readFileSync(ROUTE_FILE, 'utf8');
  const helperMatch = source.match(
    /const maybeRunIherbOverlayStage0 =[\s\S]*?return true;\n    };/,
  );

  assert.ok(helperMatch, 'enrich-stream must expose an overlay Stage0 bridge helper');
  const helper = helperMatch[0];
  assert.ok(helper.includes('buildIherbOverlayFactsDigest'));
  assert.ok(helper.includes('stage0Winner: "web_hint_unverified"'));
  assert.ok(helper.includes('allowAi: false'));
  assert.ok(helper.includes('clearNegative("iherb_overlay_stage0_bridge")'));
  assert.ok(helper.includes('iHerb overlay Stage0 bridge'));

  const bridgeIndex = source.indexOf('const overlayBridgeRecovered = await maybeRunIherbOverlayStage0("pre_stage1")');
  const negativeCacheIndex = source.indexOf('// Stage 1 negative short-circuit');
  assert.ok(bridgeIndex > 0, 'overlay bridge must be called in the route');
  assert.ok(negativeCacheIndex > 0, 'Stage 1 negative-cache block must still exist');
  assert.ok(
    bridgeIndex < negativeCacheIndex,
    'overlay facts must be allowed to recover the scan before web negative cache can emit Product not found',
  );

  const digestHelperMatch = source.match(
    /const buildIherbOverlayFactsDigestForBarcode =[\s\S]*?regionTags: \["us"\],[\s\S]*?}\);/,
  );
  assert.ok(digestHelperMatch, 'overlay bridge must build a bounded FactsDigest');
  const digestHelper = digestHelperMatch[0];
  assert.ok(digestHelper.includes('suggestedUse'));
  assert.ok(digestHelper.includes('warnings'));
  assert.ok(digestHelper.includes('servingSize'));
  assert.ok(digestHelper.includes('identityType: "gtin14"'));
  assert.ok(
    source.includes('Array.isArray(overlayClaims?.nutritionalFacts)'),
    'overlay bridge must preserve Supplement Facts rows as the ingredient source',
  );
});

test('admission pressure fallback uses iHerb overlay facts before provisional core fallback', () => {
  const source = fs.readFileSync(ROUTE_FILE, 'utf8');
  const fallbackMatch = source.match(
    /const emitAdmissionCoreFallbackAndFinalize =[\s\S]*?const quickDigest = await withAdmissionCoreFallbackBudget/,
  );

  assert.ok(fallbackMatch, 'admission fallback block must be present');
  const block = fallbackMatch[0];
  assert.ok(block.includes('fetchIherbOverlayClaimsByBarcode(barcodeGtin14)'));
  assert.ok(block.includes('buildIherbOverlayFactsDigestForBarcode(overlayClaims, barcodeGtin14)'));
  assert.ok(block.includes('factsSourceVersion: `iherb_overlay:${overlayClaims?.productId ?? barcodeGtin14}`'));
  assert.ok(block.includes('buildAnalysisBundleSkeleton'));
  assert.ok(block.includes('source: "iherb_overlay"'));
  assert.ok(
    block.indexOf('buildIherbOverlayFactsDigestForBarcode') < block.indexOf('const quickDigest = await withAdmissionCoreFallbackBudget'),
    'overlay facts must be attempted before the quickDigest/provisional admission fallback',
  );
});

test('iHerb overlay Stage0 has a deterministic no-AI rev1 path for full streams', () => {
  const source = fs.readFileSync(ROUTE_FILE, 'utf8');
  const blockMatch = source.match(
    /const overlayNoAiFullStreamFastPath =[\s\S]*?const deterministicNoAiFastPath =[\s\S]*?if \(deterministicNoAiFastPath && canWrite\(\)\)/,
  );

  assert.ok(blockMatch, 'overlay no-AI full streams must enter deterministic rev1 gating');
  const block = blockMatch[0];
  assert.ok(block.includes('params.digest.sourceType === "web"'));
  assert.ok(block.includes('Boolean(overlayClaimsByBarcode)'));
  assert.ok(block.includes('overlayNoAiFullStreamFastPath'));
  assert.ok(source.includes('iherb_overlay_full_stream_no_ai_fast_path'));
  assert.ok(source.includes('fallbackReason: deterministicFallbackReason'));
});
