import assert from "node:assert/strict";
import test from "node:test";

import { mergeByQuotaAndPriority, parseRoleQuotas } from "../../scripts/maintainer/build-cohort.mjs";

test("parseRoleQuotas overrides defaults with cli spec", () => {
  const quotas = parseRoleQuotas("ca_top_scan_30d=10,canary_crash=6", {
    ca_top_scan_30d: 50,
    canary_crash: 5,
  }) as any;
  assert.equal(quotas.ca_top_scan_30d, 10);
  assert.equal(quotas.canary_crash, 6);
});

test("mergeByQuotaAndPriority satisfies quotas before global fill", () => {
  const candidates = [
    { role: "ca_top_scan_30d", barcode: "00000000000001", priority: 2 },
    { role: "ca_top_scan_30d", barcode: "00000000000002", priority: 1 },
    { role: "canary_crash", barcode: "00000000000003", priority: 1 },
    { role: "canary_crash", barcode: "00000000000004", priority: 2 },
    { role: "us_dsld_canonical_sample", barcode: "00000000000005", priority: 1 },
  ];
  const selected = mergeByQuotaAndPriority({
    candidates,
    roleQuotas: {
      ca_top_scan_30d: 1,
      canary_crash: 1,
    },
    targetSize: 3,
  });
  assert.equal(selected.length, 3);
  assert.equal(selected.some((row) => row.role === "ca_top_scan_30d"), true);
  assert.equal(selected.some((row) => row.role === "canary_crash"), true);
});
