import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DECISION_SUPPORT_PATH = path.resolve(__dirname, "../src/decisionSupport.ts");
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");

const readDecisionSupportSource = async () => readFile(DECISION_SUPPORT_PATH, "utf8");
const readServerSource = async () => readFile(SERVER_PATH, "utf8");

test("decision support digest is canonicalized with delimiter and category id", async () => {
  const source = await readDecisionSupportSource();
  assert.match(source, /const DECISION_SUPPORT_DIGEST_DELIMITER = "\\n\|\\n"/);
  assert.match(source, /const flagsSnapshotCanonical = canonicalizeFlagsSnapshot\(params\.flagsSnapshot\)/);
  assert.match(source, /params\.factsDigestHash/);
  assert.match(source, /categoryId/);
  assert.match(source, /categoryProfileVersion/);
  assert.match(source, /sourceIdentityCanonical/);
  assert.match(source, /const decisionInputsHash = hashCanonicalString\(digestInput\)/);
});

test("quality mark unknown stays out of core blockers and warnings ceiling is non-core", async () => {
  const source = await readDecisionSupportSource();
  assert.match(source, /code:\s*"warnings_missing_ceiling"[\s\S]*affectsCoreVerdict:\s*false/);
  assert.match(source, /const topBlockers = blockers[\s\S]*\.filter\(\(item\) => item\.affectsCoreVerdict\)/);
  assert.match(source, /code:\s*"quality_mark_status"/);
  assert.match(source, /code:\s*"brand_level_official_program"/);
  assert.doesNotMatch(source, /code:\s*"quality_mark_unknown"/);
});

test("quality mark signal is cache-driven and forces unknown for search-only evidence", async () => {
  const source = await readDecisionSupportSource();
  assert.match(source, /const deriveQualityMarkSignal = \(digest: FactsDigest\)/);
  assert.match(source, /lookupQualityMarkAudit/);
  assert.match(source, /cached\.entry\.checkedMode === "search_only"/);
  assert.match(source, /cached\.entry\.evidenceType === "search"/);
  assert.match(source, /status:\s*"unknown"/);
  assert.doesNotMatch(source, /const QUALITY_MARK_PATTERNS/);
  assert.doesNotMatch(source, /QUALITY_MARK_CONFIDENCE_THRESHOLD/);
});

test("decision support payload exposes safe science source metadata for explanation tracing", async () => {
  const source = await readDecisionSupportSource();
  assert.match(source, /safeScienceSignalSource\?: "subset" \| "fallback" \| "none"/);
  assert.match(source, /safeScienceFallbackType\?: "best_for" \| "comparison" \| null/);
  assert.match(source, /safeScienceSignalSource:\s*safeScienceSignals\?\.signalSource \?\? "none"/);
  assert.match(source, /safeScienceFallbackType:\s*safeScienceSignals\?\.fallbackType \?\? null/);
});

test("decision support includes personalized result lane v1 contract and inline wiring", async () => {
  const source = await readDecisionSupportSource();
  assert.match(source, /export type DecisionSupportPersonalizedResultLane = \{/);
  assert.match(source, /recommendedSectionOrder: DecisionSupportPersonalizedResultLaneSectionKey\[\]/);
  assert.match(source, /personalizedResultLane: DecisionSupportPersonalizedResultLane;/);
  assert.match(source, /const personalizedResultLane = buildPersonalizedResultLane\(/);
  assert.match(source, /personalizedResultLane,\s*qualityMark/);
  assert.match(source, /personalizedResultLane: payload\.personalizedResultLane/);
});

test("decision support route exposes 409 digest mismatch contract", async () => {
  const source = await readServerSource();
  const routeStart = source.indexOf('app.get("/api/decision-support/v1"');
  assert.ok(routeStart >= 0, "missing /api/decision-support/v1 route");
  const routeSlice = source.slice(routeStart, routeStart + 12000);

  assert.match(routeSlice, /verifySupabaseToken/);
  assert.match(routeSlice, /requestedDigest/);
  assert.match(routeSlice, /res\.status\(409\)\.json\(/);
  assert.match(routeSlice, /DECISION_SUPPORT_DIGEST_MISMATCH/);
  assert.match(routeSlice, /latestDigest:\s*decisionSupport\.digest/);
  assert.match(routeSlice, /latestDecisionInputsHash:\s*decisionSupport\.decisionInputsHash/);
  assert.match(routeSlice, /latestPersonalizationScopeHash:\s*personalizationScopeHash/);
  assert.match(routeSlice, /personalizationScopeHash,/);
  assert.match(routeSlice, /personalizedResultLane:\s*decisionSupport(?:WithComparison)?\.personalizedResultLane/);
});
