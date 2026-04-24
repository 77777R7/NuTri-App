import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROUTE_REPLAY_PATH = path.resolve(
  "backend/data/staging/nutri-minimal-v4/search-detail-route-replay-pack.json",
);

type RouteReplayRow = {
  family: string;
  productId: string;
  route: { pass: boolean };
  familyInference: {
    pass: boolean;
    matchedFields: string[];
    defaultAnchorName: string | null;
    selectedLabel: string | null;
  };
  scientificBackground: {
    pass: boolean;
    sampleSummary: string | null;
    sampleEvidenceRead: string | null;
    sampleShopperMeaning: string | null;
  };
  evidenceGrounding: {
    pass: boolean;
    expectedLiveGroundingStatus:
      | "approved_reviewed_row"
      | "blocked_no_reviewed_row";
    reviewedReferenceIds: string[];
    routeEvidenceSignals: string[];
  };
  safetyClaimGate: { pass: boolean };
};

type RouteReplayArtifact = {
  summary: {
    total: number;
    route_ok: number;
    family_inference_pass: number;
    scientific_background_specific_pass: number;
    evidence_grounding_gate_pass: number;
    safety_claim_gate_pass: number;
    failures: number;
  };
  failures: RouteReplayRow[];
  rows: RouteReplayRow[];
};

const readRouteReplayArtifact = (): RouteReplayArtifact =>
  JSON.parse(fs.readFileSync(ROUTE_REPLAY_PATH, "utf8")) as RouteReplayArtifact;

test("search/detail route replay keeps priority families anchored and evidence-gated", () => {
  const artifact = readRouteReplayArtifact();

  assert.equal(artifact.summary.total, 10);
  assert.equal(artifact.summary.route_ok, 10);
  assert.equal(artifact.summary.family_inference_pass, 10);
  assert.equal(artifact.summary.scientific_background_specific_pass, 10);
  assert.equal(artifact.summary.evidence_grounding_gate_pass, 10);
  assert.equal(artifact.summary.safety_claim_gate_pass, 10);
  assert.equal(artifact.summary.failures, 0);
  assert.equal(artifact.failures.length, 0);

  const same = artifact.rows.find((row) => row.family === "same");
  assert.ok(same, "SAMe route replay row should exist");
  assert.equal(same.productId, "96277");
  assert.equal(same.route.pass, true);
  assert.equal(same.familyInference.pass, true);
  assert.ok(same.familyInference.matchedFields.includes("defaultAnchor.name"));
  assert.ok(
    same.familyInference.matchedFields.includes(
      "scientificBackground.selectedLabel",
    ),
  );
  const sameScience = [
    same.scientificBackground.sampleSummary,
    same.scientificBackground.sampleEvidenceRead,
    same.scientificBackground.sampleShopperMeaning,
  ].join(" ");
  assert.match(sameScience, /SAMe/i);
  assert.doesNotMatch(sameScience, /\bL[-\s]*methionine\b/i);

  const pygeum = artifact.rows.find((row) => row.family === "pygeum");
  assert.ok(pygeum, "pygeum route replay row should exist");
  assert.equal(pygeum.productId, "70044");
  assert.match(pygeum.familyInference.defaultAnchorName ?? "", /pygeum/i);
  assert.match(pygeum.familyInference.selectedLabel ?? "", /pygeum/i);

  for (const blockedFamily of ["chaga_mushroom", "nadh"]) {
    const row = artifact.rows.find((candidate) => candidate.family === blockedFamily);
    assert.ok(row, `${blockedFamily} route replay row should exist`);
    assert.equal(
      row.evidenceGrounding.expectedLiveGroundingStatus,
      "blocked_no_reviewed_row",
    );
    assert.deepEqual(row.evidenceGrounding.reviewedReferenceIds, []);
    assert.deepEqual(row.evidenceGrounding.routeEvidenceSignals, []);
    assert.equal(row.evidenceGrounding.pass, true);
  }
});
