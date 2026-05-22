import assert from "node:assert/strict";
import test from "node:test";

import { buildStackSafetyProCardViewModel } from "../../components/screens/mySaved/stackSafetyPresentation.ts";
import type { StackDuplicateGroup, StackLevelSafetySummary } from "../../components/screens/mySaved/types.ts";

const zincGroup: StackDuplicateGroup = {
  ingredientCanonicalKey: "zinc",
  ingredientDisplayName: "Zinc",
  productCount: 2,
  products: [],
  estimatedTotalDoseText: "45 mg",
  ulValueText: "40 mg",
  scopeNote: "The adult UL applies to total zinc from food, beverages, and supplements.",
  status: "over",
  confidence: "high",
  surfaced: true,
};

test("Stack Safety Pro teaser explains value without revealing the detailed warning to free users", () => {
  const vm = buildStackSafetyProCardViewModel({
    isPremium: false,
    savedCount: 3,
    overlapCount: 1,
    summary: { headline: "Zinc may be above the adult upper limit.", detailLines: [], status: "over" },
    duplicateGroups: [zincGroup],
  });

  assert.equal(vm.tone, "locked");
  assert.equal(vm.badge, "Pro");
  assert.equal(vm.ctaLabel, "Unlock");
  assert.match(vm.body, /repeated ingredients/i);
  assert.doesNotMatch(`${vm.title} ${vm.body}`, /45 mg|40 mg|overdose|toxicity/i);
});

test("Stack Safety Pro card uses conservative wording for unlocked over-UL signals", () => {
  const summary: StackLevelSafetySummary = {
    headline: "Zinc may be above the adult upper limit across your saved stack.",
    detailLines: [],
    status: "over",
  };
  const vm = buildStackSafetyProCardViewModel({
    isPremium: true,
    savedCount: 3,
    overlapCount: 1,
    summary,
    duplicateGroups: [zincGroup],
  });

  assert.equal(vm.tone, "over");
  assert.match(vm.title, /may be above/i);
  assert.match(vm.body, /estimated/i);
  assert.match(vm.evidenceLine ?? "", /45 mg\/day estimated/i);
  assert.doesNotMatch(`${vm.title} ${vm.body}`, /\b(overdose|toxicity|toxic|unsafe|safe)\b/i);
});
