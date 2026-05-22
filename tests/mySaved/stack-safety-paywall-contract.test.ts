import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mySavedSource = readFileSync(
  new URL("../../components/screens/MySupplement.tsx", import.meta.url),
  "utf8",
);
const paywallRouteSource = readFileSync(
  new URL("../../app/paywall/official.tsx", import.meta.url),
  "utf8",
);
const paywallPageSource = readFileSync(
  new URL("../../components/paywall/OfficialPaywallPage.tsx", import.meta.url),
  "utf8",
);

test("Stack Safety Check routes free users to the dedicated stack_safety paywall source", () => {
  assert.match(mySavedSource, /source:\s*"stack_safety"/);
  assert.doesNotMatch(mySavedSource, /<StackSafetyProCard/);
  assert.match(mySavedSource, /Stack overlap found/);
  assert.match(mySavedSource, /sheetStackSafetyPill/);
  assert.match(mySavedSource, /stackSafetyLocked=\{!premiumAccess\.isPremium\}/);
  assert.match(paywallRouteSource, /case 'stack_safety':/);
  assert.match(paywallPageSource, /Saved Stack Safety/);
  assert.match(paywallPageSource, /repeated ingredients across your stack/);
});
