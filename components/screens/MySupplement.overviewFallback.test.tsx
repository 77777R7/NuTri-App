import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { pickMeaningfulOverviewText } from "../../lib/knowledge/what-it-does";

test("overview fallback: non-meaningful text falls back to trusted placeholder", () => {
  const out = pickMeaningfulOverviewText({
    productName: "Triple Strength Astaxanthin",
    candidates: ["Triple Strength Astaxanthin (12...)", "", null],
  });

  assert.equal(out.usedPlaceholder, true);
  assert.match(out.text, /vetted summary/i);
});

test("overview fallback: meaningful sentence is preserved", () => {
  const out = pickMeaningfulOverviewText({
    productName: "Astaxanthin",
    candidates: [
      "Astaxanthin is a carotenoid antioxidant commonly used for skin and eye support routines.",
      "Fallback",
    ],
  });

  assert.equal(out.usedPlaceholder, false);
  assert.match(out.text, /carotenoid antioxidant/i);
});

test("my supplement source: no Label loading string regression", () => {
  const filePath = path.resolve(process.cwd(), "components/screens/MySupplement.tsx");
  const source = fs.readFileSync(filePath, "utf8");

  assert.equal(source.includes("Label: Loading"), false);
  assert.equal(source.includes("We'll update this when available."), false);
  assert.equal(source.includes("Retry AI insights"), false);

  // Save/Unsave pill guardrails (avoid wrapped "Unsav\ne" regressions).
  assert.match(source, /width:\s*savePillWidth/);
  assert.match(source, /numberOfLines=\{1\}[\s\S]{0,120}ellipsizeMode="clip"[\s\S]{0,120}Unsave/);

  // Personal Note should avoid being covered by the keyboard in the detail sheet.
  assert.match(source, /keyboardDismissMode=\{Platform\.OS === "ios" \? "interactive" : "on-drag"\}/);
});
