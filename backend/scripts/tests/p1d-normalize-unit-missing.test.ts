import assert from "node:assert/strict";
import { test } from "node:test";

import {
  inferUnitKind,
  resolveUnitFromRaw,
  shouldBypassMetaUnitMismatch,
} from "../p1d-normalize-unit-missing.ts";

const mustResolve = (raw: string) => {
  const resolved = resolveUnitFromRaw(raw);
  assert.ok(resolved, `expected unit to resolve: ${raw}`);
  return resolved;
};

test("mass mismatch mg <-> g bypasses by dimension", () => {
  const decision = shouldBypassMetaUnitMismatch(mustResolve("mg"), mustResolve("g"));
  assert.equal(decision.bypass, true);
  assert.equal(decision.reason, "mass_dimension_match");
});

test("mass mismatch mcg <-> mg bypasses by dimension", () => {
  const decision = shouldBypassMetaUnitMismatch(mustResolve("mcg"), mustResolve("mg"));
  assert.equal(decision.bypass, true);
  assert.equal(decision.reason, "mass_dimension_match");
});

test("kg resolves as mass and bypasses against g/mg/mcg", () => {
  assert.equal(inferUnitKind("kg"), "mass");
  const kg = mustResolve("kilograms");
  assert.equal(kg.unitNormalized, "kg");
  assert.equal(kg.unitKind, "mass");

  for (const unit of ["g", "mg", "mcg"]) {
    const decision = shouldBypassMetaUnitMismatch(kg, mustResolve(unit));
    assert.equal(decision.bypass, true);
    assert.equal(decision.reason, "mass_dimension_match");
  }
});

test("cross-dimension ml -> mg is blocked", () => {
  const decision = shouldBypassMetaUnitMismatch(mustResolve("ml"), mustResolve("mg"));
  assert.equal(decision.bypass, false);
  assert.equal(decision.reason, "cross_dimension_mismatch");
});

test("cross-dimension each -> mg is blocked", () => {
  const decision = shouldBypassMetaUnitMismatch(mustResolve("each"), mustResolve("mg"));
  assert.equal(decision.bypass, false);
  assert.equal(decision.reason, "cross_dimension_mismatch");
});

test("homeopathic/percent/fcc stay on whitelist bypass", () => {
  const homeopathicDecision = shouldBypassMetaUnitMismatch(mustResolve("10 ch"), mustResolve("mg"));
  assert.equal(homeopathicDecision.bypass, true);
  assert.equal(homeopathicDecision.reason, "whitelist");

  const percentDecision = shouldBypassMetaUnitMismatch(mustResolve("percent"), mustResolve("mg"));
  assert.equal(percentDecision.bypass, true);
  assert.equal(percentDecision.reason, "whitelist");

  const fccDecision = shouldBypassMetaUnitMismatch(mustResolve("fcc lu"), mustResolve("mg"));
  assert.equal(fccDecision.bypass, true);
  assert.equal(fccDecision.reason, "whitelist");
});

test("bypass summary math is consistent", () => {
  const decisions = [
    shouldBypassMetaUnitMismatch(mustResolve("mg"), mustResolve("g")),
    shouldBypassMetaUnitMismatch(mustResolve("percent"), mustResolve("mg")),
    shouldBypassMetaUnitMismatch(mustResolve("ml"), mustResolve("mg")),
    shouldBypassMetaUnitMismatch(mustResolve("each"), mustResolve("mg")),
  ];

  const bypassedWhitelist = decisions.filter((item) => item.reason === "whitelist").length;
  const bypassedMass = decisions.filter((item) => item.reason === "mass_dimension_match").length;
  const blockedCrossDim = decisions.filter(
    (item) => !item.bypass && item.reason === "cross_dimension_mismatch",
  ).length;
  const bypassedTotal = decisions.filter((item) => item.bypass).length;

  assert.equal(bypassedTotal, bypassedWhitelist + bypassedMass);
  assert.equal(decisions.length, bypassedWhitelist + bypassedMass + blockedCrossDim);
});
