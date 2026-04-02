import assert from "node:assert/strict";
import test from "node:test";

import { createGoalNavigatorDebugRouteHandlers } from "../src/personalization/goalNavigatorDebugRoutes";

const buildResponseDouble = () => {
  const response = {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(payload: unknown) {
      response.payload = payload;
    },
  };

  return response;
};

test("goal navigator debug route rejects invalid limits", async () => {
  const handlers = createGoalNavigatorDebugRouteHandlers({
    readLatestSnapshot: async () => {
      throw new Error("should not be called");
    },
    readRuntimeSnapshot: () => ({
      currentBundle: {
        source: null,
        activeRunId: null,
        generatedAt: null,
        loadedAt: null,
        storageBucket: null,
        storagePath: null,
        artifactPath: null,
      },
      counters: {
        storageHits: 0,
        diskHits: 0,
        liveHits: 0,
        liveBuildCount: 0,
        precomputedMissCount: 0,
        fallbackToLiveBuildCount: 0,
        totalLoads: 0,
        precomputedHitRate: 0,
      },
      lastErrors: {
        storage: null,
        disk: null,
      },
    }),
  });
  const response = buildResponseDouble();

  await handlers.bundleDebug(
    {
      query: {
        limit: "nope",
      },
    },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.payload, {
    error: "invalid_goal_navigator_debug_request",
  });
});

test("goal navigator debug route returns the injected snapshot", async () => {
  const handlers = createGoalNavigatorDebugRouteHandlers({
    readLatestSnapshot: async ({ limit } = {}) => ({
      run: {
        id: "run_123",
        artifactKind: "goal_navigator_candidate_bundle",
        schemaVersion: "goal_navigator_candidate_bundle.v1",
        rulesVersion: "personalization-rules/v1-phase7",
        sourceTable: "iherb_overlay_products",
        sourceRowCount: 180,
        preparedCandidateCount: 170,
        notEnoughStructuredDataCount: 10,
        artifactPath: "/tmp/bundle.json",
        storageBucket: "personalization-artifacts",
        storagePath: "goal-navigator/run_123.json",
        artifactByteSize: 12345,
        artifactChecksum: "abc123",
        isActive: true,
        activatedAt: "2026-03-21T12:00:30.000Z",
        generatedAt: "2026-03-21T12:00:00.000Z",
        createdAt: "2026-03-21T12:01:00.000Z",
        buildMeta: {
          requestedLimit: limit ?? null,
        },
      },
      summary: {
        totalGapRows: 10,
        returnedGapRows: 5,
        gapCodeCounts: {
          missing_dose: 7,
        },
        factsStatusCounts: {
          partial: 9,
          none: 1,
        },
        priorities: [],
      },
      gaps: [],
    }),
    readRuntimeSnapshot: () => ({
      currentBundle: {
        source: "storage",
        activeRunId: "run_123",
        generatedAt: "2026-03-21T12:00:00.000Z",
        loadedAt: "2026-03-21T12:03:00.000Z",
        storageBucket: "personalization-artifacts",
        storagePath: "goal-navigator/run_123.json",
        artifactPath: "/tmp/bundle.json",
      },
      counters: {
        storageHits: 4,
        diskHits: 0,
        liveHits: 1,
        liveBuildCount: 1,
        precomputedMissCount: 1,
        fallbackToLiveBuildCount: 1,
        totalLoads: 5,
        precomputedHitRate: 0.8,
      },
      lastErrors: {
        storage: null,
        disk: null,
      },
    }),
  });
  const response = buildResponseDouble();

  await handlers.bundleDebug(
    {
      query: {
        limit: "5",
      },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, {
    run: {
      id: "run_123",
      artifactKind: "goal_navigator_candidate_bundle",
      schemaVersion: "goal_navigator_candidate_bundle.v1",
      rulesVersion: "personalization-rules/v1-phase7",
      sourceTable: "iherb_overlay_products",
      sourceRowCount: 180,
      preparedCandidateCount: 170,
      notEnoughStructuredDataCount: 10,
      artifactPath: "/tmp/bundle.json",
      storageBucket: "personalization-artifacts",
      storagePath: "goal-navigator/run_123.json",
      artifactByteSize: 12345,
      artifactChecksum: "abc123",
      isActive: true,
      activatedAt: "2026-03-21T12:00:30.000Z",
      generatedAt: "2026-03-21T12:00:00.000Z",
      createdAt: "2026-03-21T12:01:00.000Z",
      buildMeta: {
        requestedLimit: 5,
      },
    },
    summary: {
      totalGapRows: 10,
      returnedGapRows: 5,
      gapCodeCounts: {
        missing_dose: 7,
      },
      factsStatusCounts: {
        partial: 9,
        none: 1,
      },
      priorities: [],
    },
    gaps: [],
    runtime: {
      currentBundle: {
        source: "storage",
        activeRunId: "run_123",
        generatedAt: "2026-03-21T12:00:00.000Z",
        loadedAt: "2026-03-21T12:03:00.000Z",
        storageBucket: "personalization-artifacts",
        storagePath: "goal-navigator/run_123.json",
        artifactPath: "/tmp/bundle.json",
      },
      counters: {
        storageHits: 4,
        diskHits: 0,
        liveHits: 1,
        liveBuildCount: 1,
        precomputedMissCount: 1,
        fallbackToLiveBuildCount: 1,
        totalLoads: 5,
        precomputedHitRate: 0.8,
      },
      lastErrors: {
        storage: null,
        disk: null,
      },
    },
  });
});
