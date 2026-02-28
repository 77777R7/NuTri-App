#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT_DIR = process.cwd();
const NOW_TAG = new Date().toISOString().replace(/[:.]/g, "-");

const DEFAULT_TARGET_SIZE = 400;
const DEFAULT_ROLE_QUOTAS = {
  ca_top_scan_30d: 50,
  ca_top_scan_90d: 30,
  ca_recent_fail_30d: 80,
  us_dsld_canonical_sample: 80,
  ca_mapped_lnhpd_sample: 60,
  canary_crash: 25,
  negative_cache_hit: 25,
  cover_detail_inconsistent_history: 20,
  web_fallback_warning_history: 20,
  score_pending_timeout_history: 10,
};

const REPEAT_BY_ROLE = {
  ca_top_scan_30d: 3,
  canary_crash: 5,
  negative_cache_hit: 3,
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const hasFlag = (flag) => args.includes(`--${flag}`);
  const getArg = (flag) => {
    const idx = args.indexOf(`--${flag}`);
    if (idx === -1) return null;
    return args[idx + 1] ?? null;
  };

  if (hasFlag("help")) {
    console.log(`Usage:
  node scripts/maintainer/build-cohort.mjs [options]

Options:
  --out-dir <path>             Output directory (default: output/cohorts/<timestamp>)
  --target-size <n>            Cohort target size (default: 400)
  --role-quotas <spec>         Role quotas "role=count,role2=count"
  --history-root <path>        History root for rounds_summary scan (default: output)
  --db-source <label>          Metadata label only (default: prod_readonly)
`);
    process.exit(0);
  }

  const outDirArg = getArg("out-dir") || path.join("output", "cohorts", NOW_TAG);
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
  const targetSizeRaw = Number(getArg("target-size") || DEFAULT_TARGET_SIZE);
  const targetSize = Number.isFinite(targetSizeRaw) && targetSizeRaw > 0
    ? Math.floor(targetSizeRaw)
    : DEFAULT_TARGET_SIZE;
  const historyRootArg = getArg("history-root") || "output";
  const historyRoot = path.isAbsolute(historyRootArg) ? historyRootArg : path.join(ROOT_DIR, historyRootArg);
  const dbSource = String(getArg("db-source") || "prod_readonly").trim() || "prod_readonly";
  const roleQuotas = parseRoleQuotas(getArg("role-quotas"), DEFAULT_ROLE_QUOTAS);

  return {
    outDir,
    targetSize,
    historyRoot,
    dbSource,
    roleQuotas,
  };
};

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  if (digits.length >= 8) return digits.padStart(14, "0");
  return null;
};

const parseRoleQuotas = (spec, defaults = {}) => {
  const out = { ...defaults };
  if (!spec || !String(spec).trim()) return out;
  const segments = String(spec)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const segment of segments) {
    const [roleRaw, countRaw] = segment.split("=");
    const role = String(roleRaw ?? "").trim();
    const count = Number(countRaw);
    if (!role) continue;
    if (!Number.isFinite(count) || count < 0) continue;
    out[role] = Math.floor(count);
  }
  return out;
};

const readJson = async (filePath) => {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const readJsonl = async (filePath) => {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const walkFiles = async (dirPath, matcher, results = []) => {
  let entries = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      await walkFiles(nextPath, matcher, results);
      continue;
    }
    if (!entry.isFile()) continue;
    if (matcher(entry.name, nextPath)) {
      results.push(nextPath);
    }
  }
  return results;
};

const sortByNewestMtime = async (paths) => {
  const stats = await Promise.all(
    paths.map(async (filePath) => {
      try {
        const stat = await fs.stat(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      } catch {
        return { filePath, mtimeMs: 0 };
      }
    }),
  );
  return stats.sort((a, b) => b.mtimeMs - a.mtimeMs).map((item) => item.filePath);
};

const pushCandidate = (rows, {
  role,
  barcode,
  priority = 5,
  country = null,
  source = "unknown",
  lookbackDays = null,
  notes = null,
  expected = null,
  repeat = null,
}) => {
  const normalized = normalizeBarcode(barcode);
  if (!normalized) return;
  rows.push({
    role,
    barcode: normalized,
    priority: Number.isFinite(Number(priority)) ? Number(priority) : 5,
    country: country ? String(country) : null,
    source,
    lookbackDays: Number.isFinite(Number(lookbackDays)) ? Number(lookbackDays) : null,
    notes: notes ? String(notes) : null,
    expected: expected && typeof expected === "object" ? expected : null,
    repeat: Number.isFinite(Number(repeat)) && Number(repeat) > 0 ? Number(repeat) : null,
  });
};

const fixturePath = (...parts) => path.join(ROOT_DIR, "scripts", "maintainer", "fixtures", ...parts);

const buildFixtureCandidates = async () => {
  const rows = [];

  const crashFixture = await readJson(fixturePath("crash_canary_barcodes.v1.json"));
  for (const row of Array.isArray(crashFixture?.canaries) ? crashFixture.canaries : []) {
    pushCandidate(rows, {
      role: "canary_crash",
      barcode: row?.barcode,
      priority: 1,
      source: "fixture:crash_canary",
      notes: row?.role ?? null,
      repeat: REPEAT_BY_ROLE.canary_crash,
    });
  }
  for (const row of Array.isArray(crashFixture?.knownGood) ? crashFixture.knownGood : []) {
    pushCandidate(rows, {
      role: "ca_mapped_lnhpd_sample",
      barcode: row?.barcode,
      priority: 3,
      country: String(row?.role ?? "").includes("lnhpd") ? "CA" : "US",
      source: "fixture:crash_canary_known_good",
      notes: row?.role ?? null,
      expected: String(row?.role ?? "").includes("lnhpd")
        ? { datasetHint: "lnhpd" }
        : { datasetHint: "dsld" },
    });
  }

  const caCommon = await readJson(fixturePath("ca_common_test_barcodes.v1.json"));
  const caCommonBarcodes = Array.isArray(caCommon?.barcodes) ? caCommon.barcodes : [];
  for (const barcode of caCommonBarcodes) {
    pushCandidate(rows, {
      role: "ca_top_scan_30d",
      barcode,
      priority: 1,
      country: "CA",
      source: "fixture:ca_common_test",
      lookbackDays: 30,
      expected: { datasetHint: "lnhpd" },
      repeat: REPEAT_BY_ROLE.ca_top_scan_30d,
    });
    pushCandidate(rows, {
      role: "ca_top_scan_90d",
      barcode,
      priority: 2,
      country: "CA",
      source: "fixture:ca_common_test",
      lookbackDays: 90,
      expected: { datasetHint: "lnhpd" },
    });
  }

  const inferredFixture = await readJson(fixturePath("inferred_only_consistency_barcodes.v1.json"));
  for (const row of Array.isArray(inferredFixture?.barcodes) ? inferredFixture.barcodes : []) {
    pushCandidate(rows, {
      role: "cover_detail_inconsistent_history",
      barcode: row?.barcode ?? row,
      priority: 2,
      source: "fixture:inferred_only_consistency",
      notes: row?.note ?? null,
    });
  }

  const surfaceFixture = await readJson(fixturePath("surface_consistency_barcodes.v1.json"));
  for (const row of Array.isArray(surfaceFixture?.barcodes) ? surfaceFixture.barcodes : []) {
    pushCandidate(rows, {
      role: "cover_detail_inconsistent_history",
      barcode: row?.barcode ?? row,
      priority: 2,
      source: "fixture:surface_consistency",
      notes: row?.note ?? null,
    });
  }

  const seedMap = [
    {
      file: "negative_cache_residual.seeds.jsonl",
      role: "negative_cache_hit",
      repeat: REPEAT_BY_ROLE.negative_cache_hit,
    },
    {
      file: "web_fallback_history.seeds.jsonl",
      role: "web_fallback_warning_history",
      repeat: 1,
    },
    {
      file: "score_pending_timeout.seeds.jsonl",
      role: "score_pending_timeout_history",
      repeat: 1,
    },
  ];
  for (const item of seedMap) {
    const rowsJsonl = await readJsonl(fixturePath("cohort_seeds", item.file));
    for (const row of rowsJsonl) {
      pushCandidate(rows, {
        role: item.role,
        barcode: row?.barcode,
        priority: row?.priority ?? 3,
        country: row?.country ?? null,
        source: `seed:${item.file}`,
        notes: row?.notes ?? null,
        expected: row?.expected ?? null,
        repeat: item.repeat,
      });
    }
  }

  return rows;
};

const buildHistoryCandidates = async (historyRoot) => {
  const rows = [];
  const roundsPaths = await sortByNewestMtime(
    await walkFiles(historyRoot, (name) => name === "rounds_summary.json"),
  );
  const latest = roundsPaths.slice(0, 12);
  for (const filePath of latest) {
    const payload = await readJson(filePath);
    const attempts = Array.isArray(payload?.attempts) ? payload.attempts : [];
    for (const attempt of attempts) {
      const barcode = normalizeBarcode(attempt?.barcode);
      if (!barcode) continue;
      const role = String(attempt?.role ?? "").trim().toLowerCase();
      const terminalReason = String(attempt?.terminalReason ?? "").trim().toUpperCase();
      const sourceTypeFinal = attempt?.sourceTypeFinal === true;

      if (role === "dsld" && sourceTypeFinal) {
        pushCandidate(rows, {
          role: "us_dsld_canonical_sample",
          barcode,
          priority: 3,
          country: "US",
          source: `history:${path.relative(ROOT_DIR, filePath)}`,
          expected: { datasetHint: "dsld" },
        });
      }
      if (role === "lnhpd" && sourceTypeFinal) {
        pushCandidate(rows, {
          role: "ca_mapped_lnhpd_sample",
          barcode,
          priority: 3,
          country: "CA",
          source: `history:${path.relative(ROOT_DIR, filePath)}`,
          expected: { datasetHint: "lnhpd" },
        });
      }
      if (
        attempt?.status === "error"
        || terminalReason.includes("TIMEOUT")
        || terminalReason.includes("REQUEST_ERROR")
      ) {
        pushCandidate(rows, {
          role: "ca_recent_fail_30d",
          barcode,
          priority: 1,
          country: "CA",
          source: `history:${path.relative(ROOT_DIR, filePath)}`,
          lookbackDays: 30,
          notes: `status=${attempt?.status ?? "unknown"} terminal=${attempt?.terminalReason ?? "unknown"}`,
        });
      }
    }
  }
  return rows;
};

const mergeByQuotaAndPriority = ({ candidates, roleQuotas, targetSize }) => {
  const grouped = new Map();
  for (const row of candidates) {
    if (!grouped.has(row.role)) grouped.set(row.role, []);
    grouped.get(row.role).push(row);
  }

  for (const rows of grouped.values()) {
    rows.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return String(a.barcode).localeCompare(String(b.barcode));
    });
  }

  const selected = [];
  const selectedFingerprint = new Set();
  const takeRow = (row) => {
    const fingerprint = `${row.role}::${row.barcode}`;
    if (selectedFingerprint.has(fingerprint)) return false;
    selectedFingerprint.add(fingerprint);
    selected.push(row);
    return true;
  };

  for (const [role, quota] of Object.entries(roleQuotas)) {
    const pool = grouped.get(role) ?? [];
    let picked = 0;
    for (const row of pool) {
      if (selected.length >= targetSize) break;
      if (!takeRow(row)) continue;
      picked += 1;
      if (picked >= quota) break;
    }
  }

  const leftovers = [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.role !== b.role) return a.role.localeCompare(b.role);
    return String(a.barcode).localeCompare(String(b.barcode));
  });
  for (const row of leftovers) {
    if (selected.length >= targetSize) break;
    takeRow(row);
  }

  return selected;
};

const enrichCohortRow = (row, idx) => ({
  role: row.role,
  country: row.country ?? null,
  identity: { type: "gtin14", value: row.barcode },
  barcode: row.barcode,
  priority: row.priority,
  source: row.source,
  lookbackDays: row.lookbackDays ?? null,
  notes: row.notes ?? null,
  expected: row.expected ?? null,
  repeat: Number.isFinite(Number(row.repeat)) && Number(row.repeat) > 0
    ? Number(row.repeat)
    : (REPEAT_BY_ROLE[row.role] ?? 1),
  index: idx,
});

const buildCohortStats = ({ rows, targetSize, roleQuotas, dbSource }) => {
  const roleCounts = rows.reduce((acc, row) => {
    const key = row.role;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return {
    generatedAt: new Date().toISOString(),
    targetSize,
    actualSize: rows.length,
    dbSource,
    roleQuotas,
    roleCounts,
    quotaDeficitByRole: Object.fromEntries(
      Object.entries(roleQuotas).map(([role, quota]) => [
        role,
        Math.max(0, Number(quota) - Number(roleCounts[role] ?? 0)),
      ]),
    ),
  };
};

export const buildCohort = async ({
  targetSize = DEFAULT_TARGET_SIZE,
  roleQuotas = DEFAULT_ROLE_QUOTAS,
  historyRoot = path.join(ROOT_DIR, "output"),
  dbSource = "prod_readonly",
}) => {
  const fixtureCandidates = await buildFixtureCandidates();
  const historyCandidates = await buildHistoryCandidates(historyRoot);
  const selected = mergeByQuotaAndPriority({
    candidates: [...fixtureCandidates, ...historyCandidates],
    roleQuotas,
    targetSize,
  }).map(enrichCohortRow);
  return {
    rows: selected,
    stats: buildCohortStats({ rows: selected, targetSize, roleQuotas, dbSource }),
  };
};

const writeOutputs = async ({ outDir, rows, stats }) => {
  await fs.mkdir(outDir, { recursive: true });
  const cohortJsonlPath = path.join(outDir, "cohort.jsonl");
  const cohortStatsPath = path.join(outDir, "cohort_stats.json");
  const cohortJsonPath = path.join(outDir, "cohort.json");
  const jsonl = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await fs.writeFile(cohortJsonlPath, jsonl, "utf8");
  await fs.writeFile(cohortJsonPath, JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(cohortStatsPath, JSON.stringify(stats, null, 2), "utf8");
  return { cohortJsonlPath, cohortJsonPath, cohortStatsPath };
};

const main = async () => {
  const opts = parseArgs();
  const { rows, stats } = await buildCohort({
    targetSize: opts.targetSize,
    roleQuotas: opts.roleQuotas,
    historyRoot: opts.historyRoot,
    dbSource: opts.dbSource,
  });
  const outputs = await writeOutputs({ outDir: opts.outDir, rows, stats });
  console.log(`[build-cohort] wrote ${outputs.cohortJsonlPath}`);
  console.log(`[build-cohort] wrote ${outputs.cohortStatsPath}`);
  console.log(`[build-cohort] rows=${rows.length}`);
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(
      "[build-cohort] failed",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}

export {
  DEFAULT_ROLE_QUOTAS,
  parseRoleQuotas,
  mergeByQuotaAndPriority,
};
