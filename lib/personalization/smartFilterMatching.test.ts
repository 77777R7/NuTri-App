import assert from "node:assert/strict";
import test from "node:test";

import type { SmartFilterProductMembership } from "@/types/personalization";
import type { SavedSupplement } from "@/types/saved-supplements";

import {
  buildGoalTagToKeyMap,
  buildTypeTagToKeyMap,
  filterSupplementsByActiveTags,
  matchesEvaluatedSmartFilterTag,
} from "./smartFilterMatching";

const buildMembership = (
  overrides: Partial<SmartFilterProductMembership> = {},
): SmartFilterProductMembership => ({
  productId: "product-1",
  factsStatus: "full",
  coverageStatus: "coverage_ready",
  bucket: "related",
  typeKeys: ["vitamin"],
  highlightedGoal: "immunity",
  goalTiers: { immunity: "related" },
  eligibility: { eligible: true, rankEligible: true, caps: [] },
  reasons: [],
  ...overrides,
});

test("matches evaluated Smart Filter type tags only when coverage-ready and rank-eligible", () => {
  const goalTagToKey = buildGoalTagToKeyMap(["immunity"]);
  const typeTagToKey = buildTypeTagToKeyMap();

  assert.equal(
    matchesEvaluatedSmartFilterTag({
      tag: "Vitamin",
      membership: buildMembership(),
      goalTagToKey,
      typeTagToKey,
    }),
    true,
  );

  assert.equal(
    matchesEvaluatedSmartFilterTag({
      tag: "Vitamin",
      membership: buildMembership({ coverageStatus: "not_enough_structured_data" }),
      goalTagToKey,
      typeTagToKey,
    }),
    false,
  );

  assert.equal(
    matchesEvaluatedSmartFilterTag({
      tag: "Vitamin",
      membership: buildMembership({ eligibility: { eligible: true, rankEligible: false, caps: [] } }),
      goalTagToKey,
      typeTagToKey,
    }),
    false,
  );
});

test("filterSupplementsByActiveTags keeps local tags and evaluated membership in the same pass", () => {
  const items: SavedSupplement[] = [
    {
      id: "saved-1",
      productName: "Vitamin C",
      brandName: "Brand",
      dosageText: "1000 mg",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      syncedToCheckIn: false,
      tags: ["Morning"],
    },
    {
      id: "saved-2",
      productName: "Magnesium",
      brandName: "Brand",
      dosageText: "200 mg",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      syncedToCheckIn: false,
    },
  ];

  const goalTagToKey = buildGoalTagToKeyMap(["immunity"]);
  const typeTagToKey = buildTypeTagToKeyMap();

  const filtered = filterSupplementsByActiveTags({
    items,
    activeTags: new Set(["Morning", "Vitamin"]),
    membershipById: {
      "saved-1": buildMembership(),
      "saved-2": buildMembership({ productId: "saved-2", typeKeys: ["mineral"], highlightedGoal: "sleep", goalTiers: {} }),
    },
    goalTagToKey,
    typeTagToKey,
  });

  assert.deepEqual(
    filtered.map((item) => item.id),
    ["saved-1"],
  );
});
