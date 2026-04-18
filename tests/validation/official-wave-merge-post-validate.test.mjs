import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { ROOT_DIR } from "../../scripts/maintainer/lib/science-validation-reporting.mjs";
import {
  chooseValidationTargets,
  inferDynamicPassAnchors,
} from "../../scripts/maintainer/run-official-wave-merge-post-validate.mjs";

const execFileAsync = promisify(execFile);

test("run-official-wave-merge-post-validate skips merge when admission finds zero yield", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "official-wave-merge-skip-"));
  const runDir = path.join(tempDir, "runs", "wave_lane_b_official_top_99");
  const brandDir = path.join(runDir, "pure-synergy");
  const outDir = path.join(tempDir, "out");
  await fs.mkdir(brandDir, { recursive: true });

  await fs.writeFile(
    path.join(brandDir, "official_fallback_report.json"),
    JSON.stringify({
      summary: {
        queued: 22,
        processed: 22,
        improvedRows: 0,
        becameFullOverlayReady: 0,
      },
      rows: [{ productId: "105654", brandName: "Pure Synergy", improved: false }],
    }),
  );
  await fs.writeFile(
    path.join(brandDir, "staging_products.official_refreshed.json"),
    JSON.stringify({
      products: [{ productId: "105654", brandName: "Pure Synergy", title: "Zero Yield Example" }],
    }),
  );

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      path.join(ROOT_DIR, "scripts", "maintainer", "run-official-wave-merge-post-validate.mjs"),
      "--run-dirs",
      path.relative(ROOT_DIR, runDir),
      "--out-dir",
      path.relative(ROOT_DIR, outDir),
      "--api-base-url",
      "http://127.0.0.1:3001",
    ],
    { cwd: ROOT_DIR, env: process.env, maxBuffer: 1024 * 1024 * 8 },
  );

  const result = JSON.parse(stdout);
  assert.equal(result.mergeSkipped, true);
  assert.equal(result.yieldFirstAdmission, true);
  assert.equal(result.admissionSummary.admittedBrandRuns, 0);
  assert.equal(result.admissionSummary.discoveryOnlyBrandRuns, 1);

  const reportPath = path.join(ROOT_DIR, result.reportJsonPath);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.merge.skipped, true);
  assert.equal(report.merge.skipReason, "no_admitted_improved_rows");
  assert.equal(report.admission.discoveryOnlyBrandRuns[0].brandName, "Pure Synergy");
});

test("post-merge validation falls back to dynamic title-led targets for new positive-yield waves", () => {
  const anchors = inferDynamicPassAnchors({
    title: "HealthForce Superfoods, Spirulina Manna™, 150 VeganCaps™",
    supplementFacts: {
      nutritionalFacts: [
        {
          substancy: "Organic Spirulina",
          amountPerServing: "3 g",
        },
      ],
    },
  });

  assert.ok(anchors.includes("Spirulina"));

  const targets = chooseValidationTargets({
    limit: 2,
    mergedRows: [
      {
        productId: "121768",
        brandName: "HealthForce Superfoods",
        title: "HealthForce Superfoods, Spirulina Manna™, 150 VeganCaps™",
        barcodeGtin14: "00650786000055",
        mergeDecision: "merged",
      },
      {
        productId: "147021",
        brandName: "NB Pure",
        title: "NB Pure, Performance Glutamine+, 7.05 oz (200 g)",
        barcodeGtin14: "00679234147021",
        mergeDecision: "merged",
      },
    ],
    combinedProducts: [
      {
        productId: "121768",
        title: "HealthForce Superfoods, Spirulina Manna™, 150 VeganCaps™",
        supplementFacts: {
          nutritionalFacts: [
            {
              substancy: "Organic Spirulina",
              amountPerServing: "3 g",
            },
          ],
        },
      },
      {
        productId: "147021",
        title: "NB Pure, Performance Glutamine+, 7.05 oz (200 g)",
        supplementFacts: {
          nutritionalFacts: [
            {
              substancy: "L-Glutamine",
              amountPerServing: "5 g",
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual(
    targets.map((row) => ({
      productId: row.productId,
      category: row.category,
      passAnchors: row.passAnchors.slice(0, 2),
      failAnchorsIncludesServing: row.failAnchors.includes("Serving Size"),
    })),
    [
      {
        productId: "121768",
        category: "dynamic_post_merge",
        passAnchors: ["Spirulina"],
        failAnchorsIncludesServing: true,
      },
      {
        productId: "147021",
        category: "dynamic_post_merge",
        passAnchors: ["Glutamine"],
        failAnchorsIncludesServing: true,
      },
    ],
  );
});

test("post-merge validation treats Udo's Oil 3-6-9 as an omega title-led target", () => {
  const anchors = inferDynamicPassAnchors({
    title: "Flora, Udo's Choice, Udo's Oil DHA 3-6-9 Blend, 17 fl oz (500 ml)",
    supplementFacts: {
      nutritionalFacts: [
        { substancy: "Saturated Fat", amountPerServing: "2 g" },
        { substancy: "Omega-3 ALA", amountPerServing: "6 g" },
        { substancy: "DHA", amountPerServing: "100 mg" },
      ],
    },
  });

  assert.deepEqual(anchors.slice(0, 4), ["Omega 3-6-9", "Omega-3", "DHA", "ALA"]);
});
