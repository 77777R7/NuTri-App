import assert from "node:assert/strict";
import test from "node:test";

import {
  isLowQualityOdsBullet,
  isLowQualityOdsOverview,
  sanitizeOdsBullets,
  sanitizeOdsOverview,
} from "./ods-quality-gate.js";

test("ods quality gate: rejects covid advisory and heading question overview", () => {
  const covid = "For information on vitamin C and COVID-19, see Dietary Supplements in the Time of COVID-19.";
  const heading = "What are omega-3 fatty acids and what do they do?";

  assert.equal(isLowQualityOdsOverview(covid), true);
  assert.equal(isLowQualityOdsOverview(heading), true);
});

test("ods quality gate: sanitize overview falls back to curated text", () => {
  const result = sanitizeOdsOverview(
    "For information on vitamin D and COVID-19, see Dietary Supplements in the Time of COVID-19.",
    "Vitamin D supports calcium balance and bone health.",
  );

  assert.equal(result.rejected, true);
  assert.equal(result.source, "curated");
  assert.equal(result.text, "Vitamin D supports calcium balance and bone health.");
});

test("ods quality gate: bullets reject heading/navigation and normalize punctuation", () => {
  const bullets = sanitizeOdsBullets(
    [
      "What are omega-3 fatty acids and what do they do?",
      "See also: Dietary Supplements in the Time of COVID-19",
      "EPA and DHA can help lower triglyceride levels",
      "Omega-3s are important components of cell membranes",
    ],
    3,
  );

  assert.equal(isLowQualityOdsBullet("What are omega-3 fatty acids and what do they do?"), true);
  assert.equal(bullets.length, 2);
  assert.equal(bullets[0], "EPA and DHA can help lower triglyceride levels.");
  assert.equal(bullets[1], "Omega-3s are important components of cell membranes.");
});
