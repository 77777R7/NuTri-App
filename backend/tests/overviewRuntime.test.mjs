import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEnsureOverviewInflightKey,
  isRegulatoryMapMiss,
} from "../dist/overviewRuntime.js";

test("overview runtime: inflight key includes facts digest hash", () => {
  const keyA = buildEnsureOverviewInflightKey("supp-1", "hash-A");
  const keyB = buildEnsureOverviewInflightKey("supp-1", "hash-B");
  const keyA2 = buildEnsureOverviewInflightKey("supp-1", "hash-A");

  assert.notEqual(keyA, keyB);
  assert.equal(keyA, keyA2);
});

test("overview runtime: mapping miss classification", () => {
  assert.equal(isRegulatoryMapMiss("miss"), true);
  assert.equal(isRegulatoryMapMiss("timeout"), true);
  assert.equal(isRegulatoryMapMiss("hit"), false);
  assert.equal(isRegulatoryMapMiss("stale"), false);
});

