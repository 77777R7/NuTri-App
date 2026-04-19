import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildFoodLikeRouteHonestyReport,
  classifyFoodLikeRouteHonestyRow,
  findLatestFoodLikeQueuePath,
} from "../../scripts/maintainer/lib/food-like-route-honesty-report.mjs";

const foodRow = (overrides = {}) => ({
  lane: "lane_c_food_like_route_honesty",
  productId: overrides.productId ?? "fixture",
  brandName: overrides.brandName ?? "Fixture Brand",
  title: overrides.title ?? "Fixture Product",
  barcode: overrides.barcode ?? "00012345678905",
  barcode_gtin14: overrides.barcode_gtin14 ?? overrides.barcode ?? "00012345678905",
  coreMissingFields: overrides.coreMissingFields ?? ["warnings"],
  classification: overrides.classification ?? {
    productKind: "food_like",
    reasonCodes: ["title_food_like", "explicit_food_form"],
  },
});

test("food-like route honesty classifier promotes source-sensitive supplement-overlap rows", () => {
  const classified = classifyFoodLikeRouteHonestyRow(
    foodRow({
      productId: "130127",
      brandName: "APS",
      title: "APS, Isomorph 28, Pure Whey Isolate, Chocolate Milkshake, 5 lb",
      classification: {
        productKind: "food_like",
        reasonCodes: ["title_food_like", "explicit_food_form", "title_supplement_signal"],
      },
    }),
  );

  assert.equal(classified.routeHonesty.bucket, "source_protein_boundary");
  assert.equal(classified.routeHonesty.tier, "stable_gate_candidate");
  assert.ok(classified.routeHonesty.riskTags.includes("source_sensitive"));
  assert.ok(classified.routeHonesty.riskTags.includes("supplement_signal_overlap"));
});

test("food-like route honesty report keeps condiment food boundaries as nightly discovery", () => {
  const report = buildFoodLikeRouteHonestyReport({
    queueRows: [
      foodRow({
        productId: "bb-aminos",
        brandName: "BetterBody Foods",
        title: "BetterBody Foods, Coconut Aminos Soy Sauce Replacement",
        classification: {
          productKind: "food_like",
          reasonCodes: ["title_food_like", "explicit_food_form"],
        },
      }),
      foodRow({
        productId: "bpn-gel",
        brandName: "BPN",
        title: "BPN, Go Gel, Fruit Punch, 24 Packets",
      }),
      foodRow({
        productId: "protein-bar",
        brandName: "BNRG",
        title: "BNRG, Power Crunch Protein Energy Bar, French Vanilla",
      }),
      foodRow({
        productId: "plain-granola",
        brandName: "California Gold Nutrition",
        title: "California Gold Nutrition, Foods, Coconut Almond Chewy Granola Bars",
        classification: {
          productKind: "food_like",
          reasonCodes: ["title_food_like", "explicit_food_form", "title_supplement_signal"],
        },
      }),
      foodRow({
        productId: "balm",
        brandName: "Badger",
        title: "Badger, Therapeutic Balm, 2 oz",
      }),
    ],
    maxStableCandidates: 10,
    maxNightlySeeds: 10,
  });

  assert.equal(report.summary.totalLaneRows, 5);
  assert.equal(report.summary.tierCounts.stable_gate_candidate, 2);
  assert.equal(report.summary.tierCounts.nightly_discovery, 2);
  assert.equal(report.summary.tierCounts.residual_discovery, 1);
  assert.ok(report.stableGateScenarioSeeds.some((row) => row.productId === "bpn-gel"));
  assert.ok(report.stableGateScenarioSeeds.some((row) => row.productId === "protein-bar"));
  assert.equal(report.stableGateScenarioSeeds.some((row) => row.productId === "plain-granola"), false);
  assert.ok(report.nightlyScenarioSeeds.some((row) => row.productId === "bb-aminos"));
  assert.equal(report.stableGateScenarioSeeds.some((row) => row.productId === "balm"), false);
});

test("food-like route honesty stable candidates are diversified by brand inside each bucket", () => {
  const report = buildFoodLikeRouteHonestyReport({
    queueRows: [
      foodRow({ productId: "alani-1", brandName: "Alani Nu", title: "Alani Nu, Protein Bar, Caramel Crunch" }),
      foodRow({ productId: "alani-2", brandName: "Alani Nu", title: "Alani Nu, Protein Bar, Rocky Road" }),
      foodRow({ productId: "aps-1", brandName: "APS", title: "APS, Isomorph 28, Pure Whey Isolate" }),
      foodRow({ productId: "allmax-1", brandName: "ALLMAX", title: "ALLMAX, Hexapro Protein Bar" }),
    ],
    maxStableCandidates: 10,
    stablePerBucket: 4,
  });

  const proteinCandidates = report.stableGateScenarioSeeds.filter((row) => row.bucket === "source_protein_boundary");
  assert.equal(proteinCandidates.filter((row) => row.brandName === "Alani Nu").length, 1);
  assert.ok(proteinCandidates.some((row) => row.brandName === "APS"));
  assert.ok(proteinCandidates.some((row) => row.brandName === "ALLMAX"));
});

test("findLatestFoodLikeQueuePath finds nested full-db queue outputs", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "food-like-queue-"));
  const older = path.join(tempDir, "100", "1001");
  const newer = path.join(tempDir, "200", "2001");
  await fs.mkdir(older, { recursive: true });
  await fs.mkdir(newer, { recursive: true });
  await fs.writeFile(path.join(older, "api_fill_queue.food_like_route_honesty.json"), "[]");
  await fs.writeFile(path.join(newer, "api_fill_queue.food_like_route_honesty.json"), "[]");

  const latest = await findLatestFoodLikeQueuePath(tempDir);
  assert.equal(latest, path.join(newer, "api_fill_queue.food_like_route_honesty.json"));
});
