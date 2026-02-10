import assert from "node:assert/strict";
import { test } from "node:test";

import { getMySupplementOverviewV2GateReason } from "../dist/mySupplementOverviewGate.js";

test("Overview gate: rejects generic output that doesn't mention actives/dose", () => {
  const reason = getMySupplementOverviewV2GateReason({
    actives: [{ name: "Vitamin C" }],
    oneLiner: "Designed to support overall wellness.",
    whatItIs: "Supports a healthy lifestyle.",
    tips: ["Follow the product label."],
    whatYouMayNotice: [],
    watchOuts: [],
  });
  assert.ok(reason, "expected a gate reject reason");
});

test("Overview gate: rejects medical claim language", () => {
  const reason = getMySupplementOverviewV2GateReason({
    actives: [{ name: "Vitamin C" }],
    oneLiner: "This supplement can treat disease.",
    whatItIs: "Use it to cure illness quickly.",
    tips: [],
    whatYouMayNotice: [],
    watchOuts: [],
  });
  assert.equal(reason, "medical_claim_language");
});

test("Overview gate: allows output that mentions an active or a dose", () => {
  const reason = getMySupplementOverviewV2GateReason({
    actives: [{ name: "Vitamin C" }],
    oneLiner: "Vitamin C supplement providing 1000 mg per tablet.",
    whatItIs: "A daily vitamin C supplement intended to support antioxidant intake and immune function.",
    tips: [],
    whatYouMayNotice: [],
    watchOuts: [],
  });
  assert.equal(reason, null);
});

