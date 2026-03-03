import assert from "node:assert/strict";
import test from "node:test";

import { classifyWebFallbackTriage } from "../../scripts/maintainer/triage-web-fallback-violations.mjs";

test("web fallback triage returns authoritative_possible when any probe reaches authoritative final", () => {
  const classification = classifyWebFallbackTriage([
    { sourceType: "web", sourceTypeFinal: false },
    { sourceType: "dsld", sourceTypeFinal: true },
    { sourceType: "web", sourceTypeFinal: false },
  ]);
  assert.equal(classification, "A_authoritative_possible");
});

test("web fallback triage returns expected_web_only when all probes stay web/non-final", () => {
  const classification = classifyWebFallbackTriage([
    { sourceType: "web", sourceTypeFinal: false },
    { sourceType: "web", sourceTypeFinal: false },
    { sourceType: "web", sourceTypeFinal: false },
  ]);
  assert.equal(classification, "B_expected_web_only");
});

test("web fallback triage returns unknown for mixed/partial signals", () => {
  const classification = classifyWebFallbackTriage([
    { sourceType: "web", sourceTypeFinal: false },
    { sourceType: "lnhpd", sourceTypeFinal: false },
  ]);
  assert.equal(classification, "unknown");
});

