#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const DEFAULT_BROWSER_QUEUE_JSON = path.join(
  ROOT,
  "output",
  "pure_encapsulations_official_browser_executor_v1",
  "browser_discovery_queue_next.json",
);
const DEFAULT_MATCHED_ROWS_JSON = path.join(
  ROOT,
  "output",
  "pure_encapsulations_historical_carry_forward_v4",
  "matched_rows.json",
);
const DEFAULT_MERGE_VALIDATION_JSON = path.join(
  ROOT,
  "output",
  "pure_encapsulations_historical_carry_forward_v4",
  "merge_validation",
  "scrapling_merge_validation_report.json",
);
const DEFAULT_STAGING_JSON = path.join(
  ROOT,
  "output",
  "p0_p3_codeage_remaining_six_closure_20260317",
  "unified_wave",
  "staging_products.official_refreshed.sanitized.json",
);
const DEFAULT_OUT_DIR = path.join(
  ROOT,
  "output",
  "pure_encapsulations_official_browser_executor_v2",
);

const BROWSER_QUEUE_JSON = path.resolve(ROOT, getArg("browser-queue-json", DEFAULT_BROWSER_QUEUE_JSON));
const MATCHED_ROWS_JSON = path.resolve(ROOT, getArg("matched-rows-json", DEFAULT_MATCHED_ROWS_JSON));
const MERGE_VALIDATION_JSON = path.resolve(ROOT, getArg("merge-validation-json", DEFAULT_MERGE_VALIDATION_JSON));
const STAGING_JSON = path.resolve(ROOT, getArg("staging-json", DEFAULT_STAGING_JSON));
const OUT_DIR = path.resolve(ROOT, getArg("out-dir", DEFAULT_OUT_DIR));

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};

const normalize = (value) => String(value ?? "").trim();

const main = async () => {
  const browserQueue = await readJson(BROWSER_QUEUE_JSON);
  const matchedRows = await readJson(MATCHED_ROWS_JSON);
  const mergeValidation = await readJson(MERGE_VALIDATION_JSON);
  const stagingRaw = await readJson(STAGING_JSON);
  const stagingRows = Array.isArray(stagingRaw) ? stagingRaw : (stagingRaw.products ?? []);
  const stagingByProductId = new Map(stagingRows.map((row) => [normalize(row?.productId), row]));

  const validationByProductId = new Map(
    (mergeValidation?.rows ?? []).map((row) => [normalize(row?.productId), row]),
  );
  const historicalHandledByProductId = new Map(
    matchedRows.map((row) => [normalize(row?.unresolvedProductId), row]),
  );

  const historicalCarryForwardRows = [];
  const softFieldNonBrowserRows = [];
  const finalUnresolvedNonBrowserRows = [];

  for (const row of browserQueue) {
    const productId = normalize(row?.productId);
    const handled = historicalHandledByProductId.get(productId);
    if (handled) {
      historicalCarryForwardRows.push({
        ...row,
        resolutionBucket: "historical_carry_forward",
        matchedHistoryProductId: handled.matchedHistoryProductId ?? null,
        matchedHistoryTitle: handled.matchedHistoryTitle ?? null,
        mergeValidation: validationByProductId.get(productId) ?? null,
      });
      continue;
    }

    const stagingRow = stagingByProductId.get(productId);
    const completeness = stagingRow?.completeness ?? {};
    const resolved = new Set(completeness.coreResolvedFields ?? []);
    const missing = completeness.coreMissingFields ?? [];
    const softFieldOnly =
      resolved.has("ingredient") &&
      resolved.has("dosage") &&
      missing.every((field) => ["suggested_use", "warnings", "product_image"].includes(field));

    if (softFieldOnly) {
      softFieldNonBrowserRows.push({
        ...row,
        resolutionBucket: "soft_field_non_browser",
        currentStatus: completeness.status ?? null,
        missingCoreFields: missing,
      });
      continue;
    }

    finalUnresolvedNonBrowserRows.push({
      ...row,
      resolutionBucket: "final_unresolved_non_browser",
      holdReason: "no_safe_local_history_match_for_browser_queue",
      currentStatus: completeness.status ?? null,
      missingCoreFields: missing,
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    inputBrowserQueueCount: browserQueue.length,
    historicalCarryForwardCount: historicalCarryForwardRows.length,
    softFieldNonBrowserCount: softFieldNonBrowserRows.length,
    finalUnresolvedNonBrowserCount: finalUnresolvedNonBrowserRows.length,
    browserDiscoveryQueueCount: 0,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await writeJson(path.join(OUT_DIR, "summary.json"), summary);
  await writeJson(path.join(OUT_DIR, "historical_carry_forward_rows.json"), historicalCarryForwardRows);
  await writeJson(path.join(OUT_DIR, "soft_field_non_browser_queue.json"), softFieldNonBrowserRows);
  await writeJson(path.join(OUT_DIR, "non_browser_hold_queue.json"), finalUnresolvedNonBrowserRows);
  await writeJson(
    path.join(OUT_DIR, "final_unresolved_non_browser_queue.json"),
    finalUnresolvedNonBrowserRows,
  );
  await writeJson(path.join(OUT_DIR, "browser_discovery_queue_next.json"), []);

  const md = [
    "# Pure Encapsulations Browser Discovery Reclassification",
    "",
    `- inputBrowserQueueCount: ${summary.inputBrowserQueueCount}`,
    `- historicalCarryForwardCount: ${summary.historicalCarryForwardCount}`,
    `- softFieldNonBrowserCount: ${summary.softFieldNonBrowserCount}`,
    `- finalUnresolvedNonBrowserCount: ${summary.finalUnresolvedNonBrowserCount}`,
    `- browserDiscoveryQueueCount: ${summary.browserDiscoveryQueueCount}`,
    "",
    "## Historical Carry Forward",
    ...historicalCarryForwardRows.map(
      (row) =>
        `- ${row.productId} | ${row.title} | matched=${row.matchedHistoryTitle ?? "none"} | after=${row.mergeValidation?.afterStatus ?? "n/a"}`,
    ),
    "",
    "## Soft Field Non-Browser",
    ...softFieldNonBrowserRows.map(
      (row) => `- ${row.productId} | ${row.title} | missing=${(row.missingCoreFields ?? []).join(", ") || "none"}`,
    ),
    "",
    "## Final Unresolved Non-Browser",
    ...finalUnresolvedNonBrowserRows.map(
      (row) => `- ${row.productId} | ${row.title} | missing=${(row.missingCoreFields ?? []).join(", ") || "none"}`,
    ),
  ].join("\n");
  await writeText(path.join(OUT_DIR, "summary.md"), `${md}\n`);

  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
