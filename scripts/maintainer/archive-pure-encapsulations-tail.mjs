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

const DEFAULT_FINAL_DIR = path.join(
  ROOT,
  "output",
  "pure_encapsulations_official_browser_executor_v3_final",
);
const DEFAULT_SOFT_DIR = path.join(
  ROOT,
  "output",
  "pure_encapsulations_soft_field_carry_forward_v1",
);
const DEFAULT_OUT_DIR = path.join(
  ROOT,
  "output",
  "pure_encapsulations_tail_archive_v1",
);

const FINAL_DIR = path.resolve(ROOT, getArg("final-dir", DEFAULT_FINAL_DIR));
const SOFT_DIR = path.resolve(ROOT, getArg("soft-dir", DEFAULT_SOFT_DIR));
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
  const summary = await readJson(path.join(FINAL_DIR, "summary.json"));
  const historicalCarryForwardRows = await readJson(path.join(FINAL_DIR, "historical_carry_forward_rows.json"));
  const priorFinalUnresolved = await readJson(path.join(FINAL_DIR, "final_unresolved_non_browser_queue.json"));
  const softFieldQueue = await readJson(path.join(FINAL_DIR, "soft_field_non_browser_queue.json"));
  const softValidation = await readJson(
    path.join(SOFT_DIR, "merge_validation", "scrapling_merge_validation_report.json"),
  );

  const softValidationByProductId = new Map(
    (softValidation?.rows ?? []).map((row) => [normalize(row?.productId), row]),
  );

  const softFieldsImprovedButNotFull = [];
  const softFieldsStillUnresolved = [];

  for (const row of softFieldQueue) {
    const validation = softValidationByProductId.get(normalize(row?.productId));
    if (validation?.improved) {
      softFieldsImprovedButNotFull.push({
        ...row,
        resolutionBucket: "soft_fields_improved_but_not_full",
        mergeValidation: validation,
      });
      continue;
    }
    softFieldsStillUnresolved.push({
      ...row,
      resolutionBucket: "final_unresolved_non_browser",
      holdReason: "soft_field_carry_forward_not_safe_or_not_available",
      mergeValidation: validation ?? null,
    });
  }

  const finalUnresolvedNonBrowser = [
    ...priorFinalUnresolved,
    ...softFieldsStillUnresolved,
  ];

  const archivedSummary = {
    generatedAt: new Date().toISOString(),
    inputBrowserQueueCount: summary.inputBrowserQueueCount,
    historicalCarryForwardCount: historicalCarryForwardRows.length,
    softFieldsImprovedButNotFullCount: softFieldsImprovedButNotFull.length,
    finalUnresolvedNonBrowserCount: finalUnresolvedNonBrowser.length,
    browserDiscoveryQueueCount: 0,
    archived: true,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await writeJson(path.join(OUT_DIR, "summary.json"), archivedSummary);
  await writeJson(path.join(OUT_DIR, "historical_carry_forward_rows.json"), historicalCarryForwardRows);
  await writeJson(
    path.join(OUT_DIR, "soft_fields_improved_but_not_full.json"),
    softFieldsImprovedButNotFull,
  );
  await writeJson(
    path.join(OUT_DIR, "final_unresolved_non_browser_queue.json"),
    finalUnresolvedNonBrowser,
  );
  await writeJson(path.join(OUT_DIR, "browser_discovery_queue_next.json"), []);

  const md = [
    "# Pure Encapsulations Tail Archive",
    "",
    `- inputBrowserQueueCount: ${archivedSummary.inputBrowserQueueCount}`,
    `- historicalCarryForwardCount: ${archivedSummary.historicalCarryForwardCount}`,
    `- softFieldsImprovedButNotFullCount: ${archivedSummary.softFieldsImprovedButNotFullCount}`,
    `- finalUnresolvedNonBrowserCount: ${archivedSummary.finalUnresolvedNonBrowserCount}`,
    `- browserDiscoveryQueueCount: ${archivedSummary.browserDiscoveryQueueCount}`,
    "",
    "## Soft Fields Improved But Not Full",
    ...softFieldsImprovedButNotFull.map(
      (row) =>
        `- ${row.productId} | ${row.title} | after=${row.mergeValidation?.afterStatus ?? "unknown"} | filled=${(row.mergeValidation?.filledFields ?? []).join(", ") || "none"}`,
    ),
    "",
    "## Final Unresolved Non-Browser",
    ...finalUnresolvedNonBrowser.map(
      (row) => `- ${row.productId} | ${row.title} | missing=${(row.missingCoreFields ?? []).join(", ") || "none"}`,
    ),
  ].join("\n");
  await writeText(path.join(OUT_DIR, "summary.md"), `${md}\n`);

  console.log(JSON.stringify(archivedSummary, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
