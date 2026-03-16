#!/usr/bin/env node
/* eslint-disable no-console */
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const PROMOTION_SEED_PATH = getArg(
  "promotion-seed",
  path.join(ROOT, "output", "quality_marks", "nutrasource_catalog_closure_full_v2_20260315", "promotion_ready_seed.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `nutrasource_promotion_wave_${TODAY}`),
);
const CONCURRENCY = Math.max(1, Number(getArg("concurrency", "6")) || 6);

const SELECTION_DIR = path.join(OUT_DIR, "selection");
const REFRESH_DIR = path.join(OUT_DIR, "refresh");
const THIRD_PARTY_CENSUS_DIR = path.join(OUT_DIR, "third_party_census");
const IGEN_SIGNAL_DIR = path.join(OUT_DIR, "igen_official_signal");
const IGEN_SIGNAL_CENSUS_DIR = path.join(OUT_DIR, "igen_official_signal_census");
const SUMMARY_JSON = path.join(OUT_DIR, "summary.json");
const SUMMARY_MD = path.join(OUT_DIR, "summary.md");

const nowIso = () => new Date().toISOString();

const readJson = async (targetPath) => JSON.parse(await fs.readFile(targetPath, "utf8"));

const runNode = async (argsList) => {
  const { stdout, stderr } = await execFile(process.execPath, argsList, {
    cwd: ROOT,
    env: process.env,
    maxBuffer: 1024 * 1024 * 32,
  });
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# Nutrasource Promotion Refresh Wave");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Promotion seed: ${report.inputs.promotionSeedPath}`);
  lines.push("");
  lines.push("## Selection");
  lines.push("");
  lines.push(`- selected rows: ${report.selection.selectedCount}`);
  lines.push(`- IFOS rows: ${report.selection.programCounts.IFOS ?? 0}`);
  lines.push(`- iGEN rows: ${report.selection.programCounts.IGEN ?? 0}`);
  lines.push("");
  lines.push("## Refresh");
  lines.push("");
  for (const [status, count] of Object.entries(report.refresh.summaryStatusCounts)) {
    lines.push(`- ${status}: ${count}`);
  }
  lines.push("");
  lines.push("## third_party_tested_claim Census");
  lines.push("");
  lines.push(`- verified: ${report.thirdPartyCensus.bucketCounts.verified ?? 0}`);
  lines.push(`- claimed: ${report.thirdPartyCensus.bucketCounts.claimed ?? 0}`);
  lines.push(`- officialRegistryChecked: ${report.thirdPartyCensus.summary.officialRegistryChecked ?? 0}`);
  lines.push("");
  lines.push("## iGEN Official Signal");
  lines.push("");
  lines.push(`- product-level official signals: ${report.igenSignalReport.summary.productLevelOfficialSignalCount}`);
  lines.push(`- brand-level only: ${report.igenSignalReport.summary.brandLevelOnlyCount}`);
  lines.push(`- official signal seed rows: ${report.igenSignalReport.summary.seedRowCount}`);
  lines.push(`- corpus checked rows: ${report.igenSignalCensus.summary.igenSignalChecked}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  await runNode([
    "--import",
    "tsx",
    "scripts/maintainer/build-nutrasource-promotion-refresh-selection.mjs",
    "--promotion-seed",
    PROMOTION_SEED_PATH,
    "--out-dir",
    SELECTION_DIR,
  ]);

  await runNode([
    "--import",
    "tsx",
    "scripts/maintainer/refresh-quality-marks-week2-iherb.mjs",
    "--selection-input",
    path.join(SELECTION_DIR, "selection.json"),
    "--out-dir",
    REFRESH_DIR,
    "--concurrency",
    String(CONCURRENCY),
  ]);

  await runNode([
    "--import",
    "tsx",
    "scripts/maintainer/build-week2-third-party-tested-claim-census.mjs",
    "--out-dir",
    THIRD_PARTY_CENSUS_DIR,
  ]);

  await runNode([
    "scripts/maintainer/build-igen-official-signal-report.mjs",
    "--refresh-report",
    path.join(REFRESH_DIR, "week2_iherb_quality_mark_refresh_report.json"),
    "--out-dir",
    IGEN_SIGNAL_DIR,
  ]);

  await runNode([
    "--import",
    "tsx",
    "scripts/maintainer/build-week2-igen-official-signal-census.mjs",
    "--out-dir",
    IGEN_SIGNAL_CENSUS_DIR,
  ]);

  const [selection, refresh, thirdPartyCensus, igenSignalReport, igenSignalCensus] = await Promise.all([
    readJson(path.join(SELECTION_DIR, "selection.json")),
    readJson(path.join(REFRESH_DIR, "week2_iherb_quality_mark_refresh_report.json")),
    readJson(path.join(THIRD_PARTY_CENSUS_DIR, "third_party_tested_claim_census.json")),
    readJson(path.join(IGEN_SIGNAL_DIR, "igen_official_signal_report.json")),
    readJson(path.join(IGEN_SIGNAL_CENSUS_DIR, "igen_official_signal_census.json")),
  ]);

  const summary = {
    schemaVersion: "nutrasource_promotion_wave.v1",
    generatedAt: nowIso(),
    inputs: {
      promotionSeedPath: PROMOTION_SEED_PATH,
      concurrency: CONCURRENCY,
    },
    selection: {
      selectedCount: selection.selectedCount ?? 0,
      programCounts: selection.programCounts ?? {},
      path: path.join(SELECTION_DIR, "selection.json"),
    },
    refresh: {
      refreshedCount: refresh.refreshedCount ?? 0,
      summaryStatusCounts: refresh.summaryStatusCounts ?? {},
      path: path.join(REFRESH_DIR, "week2_iherb_quality_mark_refresh_report.json"),
    },
    thirdPartyCensus: {
      summary: thirdPartyCensus.summary ?? {},
      bucketCounts: thirdPartyCensus.bucketCounts ?? {},
      path: path.join(THIRD_PARTY_CENSUS_DIR, "third_party_tested_claim_census.json"),
    },
    igenSignalReport: {
      summary: igenSignalReport.summary ?? {},
      signalStateCounts: igenSignalReport.signalStateCounts ?? {},
      path: path.join(IGEN_SIGNAL_DIR, "igen_official_signal_report.json"),
      seedPath: path.join(IGEN_SIGNAL_DIR, "igen_official_signal_seed.json"),
    },
    igenSignalCensus: {
      summary: igenSignalCensus.summary ?? {},
      bucketCounts: igenSignalCensus.bucketCounts ?? {},
      path: path.join(IGEN_SIGNAL_CENSUS_DIR, "igen_official_signal_census.json"),
    },
  };

  await fs.writeFile(SUMMARY_JSON, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await fs.writeFile(SUMMARY_MD, toMarkdown(summary), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        summaryJson: SUMMARY_JSON,
        summaryMd: SUMMARY_MD,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
