#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLower = (value) => normalizeText(value).toLowerCase();
const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";

const readJson = async (filePath, fallback) => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (fallback !== undefined && error?.code === "ENOENT") return fallback;
    throw error;
  }
};

const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
};

const pct = (value, total) => (total > 0 ? Number(((value / total) * 100).toFixed(1)) : 0);
const comboKey = (fields) => [...fields].map(normalizeLower).sort().join(" + ");

const QUEUE_JSON = getArg(
  "queue-json",
  path.join(
    ROOT,
    "output",
    "iherb_overlay_execution_plan_week2_final_unified_20260313",
    "api_fill_priority_queue.json",
  ),
);
const STAGING_JSON = getArg(
  "staging-json",
  path.join(
    ROOT,
    "output",
    "iherb_header_facts_week2_closure_v2_20260313",
    "staging_products.parser_enriched.json",
  ),
);
const CONFIG_DIR = getArg(
  "config-dir",
  path.join(ROOT, "data", "iherb_official_fallback_configs"),
);
const OUT_ROOT = getArg(
  "out-root",
  path.join(ROOT, "output", "week2_p0_rescue_executor"),
);
const STATE_PATH = getArg("state-json", path.join(OUT_ROOT, "state.json"));
const LOCK_PATH_OVERRIDE = getArg("lock-json", null);
const LEGACY_LOCK_PATH = path.join(OUT_ROOT, "current_wave.lock.json");
const RUN_LOCK_PATH = getArg("run-lock-json", path.join(OUT_ROOT, "current_executor_run.lock.json"));
const LATEST_JSON = getArg("latest-json", path.join(OUT_ROOT, "latest.json"));
const LATEST_MD = getArg("latest-md", path.join(OUT_ROOT, "latest.md"));
const FORCE = getArg("force", "false") === "true";
const DRY_RUN = getArg("dry-run", "false") === "true";
const MAX_LOCK_AGE_HOURS = Math.max(0.25, Number(getArg("max-lock-age-hours", 1)) || 1);
const MAX_RUN_LOCK_AGE_HOURS = Math.max(0.25, Number(getArg("max-run-lock-age-hours", 0.5)) || 0.5);
const RUN_OWNER = normalizeText(getArg("run-owner", process.env.AUTOMATION_ID || "manual")) || "manual";
const BRAND_OVERRIDE = getArg("brand", null);
const LANE_OVERRIDE = getArg("lane", null);

const LANES = [
  {
    id: "warnings_only",
    label: "warnings-only",
    fields: ["warnings"],
    batchSize: 64,
    concurrency: 6,
    shards: 6,
    delayMs: 125,
  },
  {
    id: "suggested_use_only",
    label: "suggested_use-only",
    fields: ["suggested_use"],
    batchSize: 64,
    concurrency: 6,
    shards: 6,
    delayMs: 125,
  },
  {
    id: "ingredient_and_dosage",
    label: "ingredient+dosage",
    fields: ["ingredient", "dosage"],
    batchSize: 48,
    concurrency: 4,
    shards: 4,
    delayMs: 200,
  },
  {
    id: "suggested_use_and_warnings",
    label: "suggested_use+warnings",
    fields: ["suggested_use", "warnings"],
    batchSize: 48,
    concurrency: 4,
    shards: 4,
    delayMs: 200,
  },
];

const laneById = new Map(LANES.map((lane) => [lane.id, lane]));
const formatLocalStamp = (value) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(value)
    .replace(/[/: ]/g, "")
    .replace(",", "-");

const readConfigRegistry = async () => {
  const entries = await fs.readdir(CONFIG_DIR, { withFileTypes: true });
  const registry = new Map();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "template.brand.json") continue;
    const configPath = path.join(CONFIG_DIR, entry.name);
    const config = await readJson(configPath);
    if (normalizeText(config?.priorityLane) !== "P0_api_fill_us_strong_identity") continue;
    const brandName = normalizeText(config?.brandName);
    if (!brandName) continue;
    registry.set(normalizeLower(brandName), {
      brandName,
      configPath,
      configFile: entry.name,
      siteOrigin: normalizeText(config?.siteOrigin) || null,
    });
  }
  return registry;
};

const loadState = async () =>
  (await readJson(STATE_PATH, {
    schemaVersion: "week2_p0_rescue_executor_state.v1",
    updatedAt: null,
    brands: {},
    lanes: {},
  })) ?? {};

const writeMarkdown = async (filePath, report) => {
  const lines = [
    "# Week 2 P0 Rescue Executor",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- status: ${report.status}`,
    `- runId: ${report.runId}`,
    `- dryRun: ${report.dryRun}`,
    "",
    "## Selection",
    "",
    `- lane: ${report.selection?.laneLabel ?? "n/a"}`,
    `- brand: ${report.selection?.brandName ?? "n/a"}`,
    `- batchSize: ${report.selection?.batchSize ?? "n/a"}`,
    `- selectedRows: ${report.selection?.selectedRowCount ?? 0}`,
    "",
    "## Queue Snapshot",
    "",
    `- totalPrimaryQueued: ${report.queueSnapshot?.primaryQueued ?? 0}`,
    `- configuredBrands: ${report.queueSnapshot?.configuredBrandCount ?? 0}`,
    "",
  ];

  for (const lane of report.queueSnapshot?.lanes ?? []) {
    lines.push(
      `- ${lane.label}: total=${lane.totalRows}, configured=${lane.configuredRows}, topConfiguredBrand=${lane.topConfiguredBrands?.[0]?.brandName ?? "n/a"} (${lane.topConfiguredBrands?.[0]?.count ?? 0})`,
    );
  }

  lines.push("", "## Outcome", "");
  if (report.status === "executed") {
    lines.push(
      `- improvedRows: ${report.execution?.summary?.improvedRows ?? 0}`,
      `- becameFullOverlayReady: ${report.execution?.summary?.becameFullOverlayReady ?? 0}`,
      `- filledIngredient: ${report.execution?.summary?.filledIngredient ?? 0}`,
      `- filledDosage: ${report.execution?.summary?.filledDosage ?? 0}`,
      `- filledSuggestedUse: ${report.execution?.summary?.filledSuggestedUse ?? 0}`,
      `- filledWarnings: ${report.execution?.summary?.filledWarnings ?? 0}`,
      `- outDir: ${report.execution?.outDir ?? "n/a"}`,
    );
  } else {
    lines.push(`- note: ${report.note ?? "n/a"}`);
  }

  if ((report.selection?.topConfiguredBrands?.length ?? 0) > 0) {
    lines.push("", "## Top Configured Brands In Selected Lane", "");
    for (const row of report.selection.topConfiguredBrands.slice(0, 10)) {
      lines.push(`- ${row.brandName}: ${row.count}`);
    }
  }

  if ((report.unconfiguredBrands?.length ?? 0) > 0) {
    lines.push("", "## Unconfigured Brands Still Ahead", "");
    for (const row of report.unconfiguredBrands.slice(0, 10)) {
      lines.push(`- ${row.brandName}: ${row.count}`);
    }
  }

  if ((report.execution?.topChangedRows?.length ?? 0) > 0) {
    lines.push("", "## Changed Sample Rows", "");
    for (const row of report.execution.topChangedRows) {
      lines.push(
        `- ${row.productId || "n/a"} | ${row.title || "n/a"} | after=${(row.afterMissingFields ?? []).join(", ") || "none"}`,
      );
    }
  }

  if (report.nextAction) {
    lines.push("", "## Next Action", "", `- ${report.nextAction}`);
  }

  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
};

const buildCandidateSnapshot = (queueRows, configRegistry, state) => {
  const primaryRows = queueRows.filter(
    (row) => normalizeText(row?.priorityLane) === "P0_api_fill_us_strong_identity",
  );

  const queueSnapshot = {
    primaryQueued: primaryRows.length,
    configuredBrandCount: configRegistry.size,
    lanes: [],
  };

  const laneCandidates = new Map();

  for (const lane of LANES) {
    const matchingRows = primaryRows.filter(
      (row) => comboKey(row?.coreMissingFields ?? []) === comboKey(lane.fields),
    );
    const byBrand = new Map();
    for (const row of matchingRows) {
      const brandName = normalizeText(row?.brandName);
      if (!brandName) continue;
      const key = normalizeLower(brandName);
      const bucket = byBrand.get(key) ?? {
        brandKey: key,
        brandName,
        count: 0,
        configured: configRegistry.has(key),
        rows: [],
      };
      bucket.count += 1;
      if (bucket.rows.length < lane.batchSize) bucket.rows.push(row);
      byBrand.set(key, bucket);
    }

    const candidates = [...byBrand.values()];
    const configuredCandidates = candidates
      .filter((candidate) => candidate.configured)
      .map((candidate) => {
        const brandState = state?.brands?.[candidate.brandKey] ?? {};
        return {
          ...candidate,
          attempts: brandState.attempts ?? 0,
          zeroImprovementStreak: brandState.zeroImprovementStreak ?? 0,
          lastWaveAt: brandState.lastWaveAt ?? null,
          lastLaneId: brandState.lastLaneId ?? null,
        };
      })
      .sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        if (left.zeroImprovementStreak !== right.zeroImprovementStreak) {
          return left.zeroImprovementStreak - right.zeroImprovementStreak;
        }
        if (left.attempts !== right.attempts) return left.attempts - right.attempts;
        if (left.lastWaveAt !== right.lastWaveAt) {
          if (!left.lastWaveAt) return -1;
          if (!right.lastWaveAt) return 1;
          return String(left.lastWaveAt).localeCompare(String(right.lastWaveAt));
        }
        return left.brandName.localeCompare(right.brandName);
      });

    const unconfiguredCandidates = candidates
      .filter((candidate) => !candidate.configured)
      .sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        return left.brandName.localeCompare(right.brandName);
      });

    laneCandidates.set(lane.id, {
      lane,
      totalRows: matchingRows.length,
      configuredRows: configuredCandidates.reduce((sum, row) => sum + row.count, 0),
      configuredCandidates,
      unconfiguredCandidates,
    });

    queueSnapshot.lanes.push({
      id: lane.id,
      label: lane.label,
      totalRows: matchingRows.length,
      configuredRows: configuredCandidates.reduce((sum, row) => sum + row.count, 0),
      topConfiguredBrands: configuredCandidates.slice(0, 5).map(({ brandName, count }) => ({ brandName, count })),
      topUnconfiguredBrands: unconfiguredCandidates.slice(0, 5).map(({ brandName, count }) => ({ brandName, count })),
    });
  }

  return { queueSnapshot, laneCandidates };
};

const buildRunReport = (report) => ({
  schemaVersion: "week2_p0_rescue_executor_run.v1",
  ...report,
});

const resolveLane = (laneCandidates) => {
  if (LANE_OVERRIDE) return laneById.get(LANE_OVERRIDE) ?? null;
  for (const lane of LANES) {
    const snapshot = laneCandidates.get(lane.id);
    if ((snapshot?.configuredCandidates?.length ?? 0) > 0) return lane;
  }
  return null;
};

const resolveBrandCandidate = (snapshot) => {
  if (!snapshot) return null;
  if (BRAND_OVERRIDE) {
    const normalizedOverride = normalizeLower(BRAND_OVERRIDE);
    return snapshot.configuredCandidates.find((candidate) => candidate.brandKey === normalizedOverride) ?? null;
  }
  return snapshot.configuredCandidates[0] ?? null;
};

const getLaneLockPath = (laneId) => {
  if (LOCK_PATH_OVERRIDE) return LOCK_PATH_OVERRIDE;
  const safeLaneId = slugify(laneId || "unknown_lane");
  return path.join(OUT_ROOT, `current_wave.${safeLaneId}.lock.json`);
};

const createLock = async (lockPath, payload) => {
  await ensureDir(path.dirname(lockPath));
  const handle = await fs.open(lockPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
};

const readLock = async (lockPath) => readJson(lockPath, null);

const removeLockIfOwned = async (lockPath, runId) => {
  const existing = await readLock(lockPath);
  if (!existing || existing.runId !== runId) return;
  await fs.rm(lockPath, { force: true });
};

const readRunLock = async () => readJson(RUN_LOCK_PATH, null);

const isProcessAlive = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") return true;
    return false;
  }
};

const acquireRunLock = async (runId) => {
  const existing = await readRunLock();
  if (existing) {
    const lockAgeMs = Date.now() - new Date(existing.createdAt ?? 0).getTime();
    const staleByAge = Number.isFinite(lockAgeMs) && lockAgeMs > MAX_RUN_LOCK_AGE_HOURS * 60 * 60 * 1000;
    const existingPid = Number(existing.pid);
    const staleByPid = Number.isFinite(existingPid) && !isProcessAlive(existingPid);
    if (!staleByAge && !staleByPid) {
      return {
        acquired: false,
        lock: existing,
        ageHours: Number.isFinite(lockAgeMs) ? Number((lockAgeMs / (60 * 60 * 1000)).toFixed(2)) : null,
      };
    }
    await fs.rm(RUN_LOCK_PATH, { force: true });
  }

  await ensureDir(path.dirname(RUN_LOCK_PATH));
  const payload = {
    schemaVersion: "week2_p0_rescue_executor_run_lock.v1",
    createdAt: new Date().toISOString(),
    runId,
    owner: RUN_OWNER,
    pid: process.pid,
  };
  const handle = await fs.open(RUN_LOCK_PATH, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  return { acquired: true, lock: payload, ageHours: 0 };
};

const removeRunLockIfOwned = async (runId) => {
  const existing = await readRunLock();
  if (!existing || existing.runId !== runId) return;
  await fs.rm(RUN_LOCK_PATH, { force: true });
};

const pickChangedRows = (rows) =>
  rows
    .filter((row) => row.improved)
    .slice(0, 12)
    .map((row) => ({
      productId: row.productId ?? null,
      title: row.title ?? null,
      afterMissingFields: row.afterMissingFields ?? [],
      filledFields: row.filledFields ?? [],
    }));

const runExecutor = async ({ lane, candidate, selectedRows, outDir }) => {
  const config = candidate.configPath ?? null;
  const queueJsonPath = path.join(outDir, "selected_queue.json");
  await writeJson(queueJsonPath, selectedRows);

  const argsForExecutor = [
    path.join(ROOT, "scripts", "maintainer", "run-iherb-official-fallback-parallel.mjs"),
    "--config-json",
    config,
    "--staging-json",
    STAGING_JSON,
    "--queue-json",
    queueJsonPath,
    "--out-dir",
    outDir,
    "--brand",
    candidate.brandName,
    "--priority-lane",
    "P0_api_fill_us_strong_identity",
    "--concurrency",
    String(lane.concurrency),
    "--shards",
    String(lane.shards),
    "--delay-ms",
    String(lane.delayMs),
  ];

  const { stdout, stderr } = await execFileAsync(process.execPath, argsForExecutor, {
    cwd: ROOT,
    maxBuffer: 1024 * 1024 * 12,
  });

  const parsedStdout = JSON.parse(stdout.trim());
  const reportJson = await readJson(path.join(outDir, "official_fallback_report.json"));
  return {
    parsedStdout,
    stderr: normalizeText(stderr) || null,
    reportJson,
    queueJsonPath,
  };
};

const updateStateForRun = ({ state, lane, candidate, execution }) => {
  const nextState = {
    ...state,
    schemaVersion: "week2_p0_rescue_executor_state.v1",
    updatedAt: new Date().toISOString(),
    brands: { ...(state?.brands ?? {}) },
    lanes: { ...(state?.lanes ?? {}) },
  };

  const brandState = {
    ...(nextState.brands[candidate.brandKey] ?? {}),
    brandName: candidate.brandName,
    lastWaveAt: nextState.updatedAt,
    lastLaneId: lane.id,
    attempts: (nextState.brands[candidate.brandKey]?.attempts ?? 0) + 1,
    successfulWaveCount:
      (nextState.brands[candidate.brandKey]?.successfulWaveCount ?? 0)
      + Number((execution?.summary?.improvedRows ?? 0) > 0),
    lastImprovedRows: execution?.summary?.improvedRows ?? 0,
    lastBecameFullOverlayReady: execution?.summary?.becameFullOverlayReady ?? 0,
  };

  if ((execution?.summary?.improvedRows ?? 0) > 0) {
    brandState.zeroImprovementStreak = 0;
  } else {
    brandState.zeroImprovementStreak = (nextState.brands[candidate.brandKey]?.zeroImprovementStreak ?? 0) + 1;
  }

  nextState.brands[candidate.brandKey] = brandState;
  nextState.lanes[lane.id] = {
    lastBrandName: candidate.brandName,
    lastWaveAt: nextState.updatedAt,
    lastImprovedRows: execution?.summary?.improvedRows ?? 0,
    lastBecameFullOverlayReady: execution?.summary?.becameFullOverlayReady ?? 0,
  };

  return nextState;
};

const main = async () => {
  await ensureDir(OUT_ROOT);
  const coordinatorRunId = `week2-p0-coordinator-${formatLocalStamp(new Date())}-${process.pid}`;
  const runLock = await acquireRunLock(coordinatorRunId);
  if (!runLock.acquired) {
    const report = buildRunReport({
      generatedAt: new Date().toISOString(),
      runId: `week2-p0-rescue-skip-runlock-${formatLocalStamp(new Date())}`,
      status: "skipped_run_lock_active",
      dryRun: DRY_RUN,
      note: `Another Week2 Queue Rescue Executor run is active (owner=${runLock.lock?.owner ?? "unknown"}, pid=${runLock.lock?.pid ?? "unknown"}, ageHours=${runLock.ageHours ?? "unknown"}).`,
      selection: null,
      queueSnapshot: null,
      unconfiguredBrands: [],
      execution: null,
      nextAction: "Wait for the active executor run lock to clear before starting another run.",
    });
    await writeJson(LATEST_JSON, report);
    await writeMarkdown(LATEST_MD, report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  try {
    if (!LOCK_PATH_OVERRIDE) {
      const legacyLock = await readLock(LEGACY_LOCK_PATH);
      if (legacyLock) {
        const lockAgeMs = Date.now() - new Date(legacyLock.createdAt ?? 0).getTime();
        const stale = Number.isFinite(lockAgeMs) && lockAgeMs > MAX_LOCK_AGE_HOURS * 60 * 60 * 1000;
        if (stale) await fs.rm(LEGACY_LOCK_PATH, { force: true });
      }
    }

    const [queueRows, configRegistry, state] = await Promise.all([
      readJson(QUEUE_JSON),
      readConfigRegistry(),
      loadState(),
    ]);

  const { queueSnapshot, laneCandidates } = buildCandidateSnapshot(queueRows, configRegistry, state);
  const selectedLane = resolveLane(laneCandidates);

  if (!selectedLane) {
    const report = buildRunReport({
      generatedAt: new Date().toISOString(),
      runId: `week2-p0-rescue-empty-${formatLocalStamp(new Date())}`,
      status: "skipped_no_configured_candidates",
      dryRun: DRY_RUN,
      note: "No configured brand candidates were available in the primary P0 rescue lanes.",
      selection: null,
      queueSnapshot,
      unconfiguredBrands: [],
      execution: null,
      nextAction: "Add a brand config for one of the top unconfigured P0 brands or wait for the queue mix to change.",
    });
    await writeJson(LATEST_JSON, report);
    await writeMarkdown(LATEST_MD, report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const selectedSnapshot = laneCandidates.get(selectedLane.id);
  const selectedCandidate = resolveBrandCandidate(selectedSnapshot);

  if (!selectedCandidate) {
    const report = buildRunReport({
      generatedAt: new Date().toISOString(),
      runId: `week2-p0-rescue-brand-miss-${formatLocalStamp(new Date())}`,
      status: "skipped_brand_not_available",
      dryRun: DRY_RUN,
      note: BRAND_OVERRIDE
        ? `Brand override ${BRAND_OVERRIDE} is not available in lane ${selectedLane.label}.`
        : `No brand candidate could be selected for lane ${selectedLane.label}.`,
      selection: {
        laneId: selectedLane.id,
        laneLabel: selectedLane.label,
      },
      queueSnapshot,
        unconfiguredBrands: selectedSnapshot?.unconfiguredCandidates?.slice(0, 10).map(({ brandName, count }) => ({
          brandName,
          count,
        })) ?? [],
      execution: null,
      nextAction: "Pick another configured brand or let the selector choose the highest-yield configured brand.",
    });
    await writeJson(LATEST_JSON, report);
    await writeMarkdown(LATEST_MD, report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const selectedRows = selectedCandidate.rows.slice(0, selectedLane.batchSize);
  const selectedLockPath = getLaneLockPath(selectedLane.id);
  const existingLock = await readLock(selectedLockPath);
  if (existingLock && !FORCE) {
    const lockAgeMs = Date.now() - new Date(existingLock.createdAt ?? 0).getTime();
    const stale = Number.isFinite(lockAgeMs) && lockAgeMs > MAX_LOCK_AGE_HOURS * 60 * 60 * 1000;
    if (!stale) {
      const report = buildRunReport({
        generatedAt: new Date().toISOString(),
        runId: `week2-p0-rescue-skip-${formatLocalStamp(new Date())}`,
        status: "skipped_lock_active",
        dryRun: DRY_RUN,
        note: `Existing lane lock is still active for ${existingLock.brandName ?? "unknown brand"} / ${existingLock.laneId ?? selectedLane.id}.`,
        selection: {
          laneId: selectedLane.id,
          laneLabel: selectedLane.label,
        },
        queueSnapshot,
        unconfiguredBrands: [],
        execution: null,
        nextAction: "Wait for the active lane lock to clear, or run another lane.",
      });
      await writeJson(LATEST_JSON, report);
      await writeMarkdown(LATEST_MD, report);
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    await fs.rm(selectedLockPath, { force: true });
  }

  const runId = `week2-p0-rescue-${TODAY}-${selectedLane.id}-${slugify(selectedCandidate.brandName)}-${formatLocalStamp(new Date())}`;
  const outDir = path.join(OUT_ROOT, runId);
  await ensureDir(outDir);

  const lockPayload = {
    schemaVersion: "week2_p0_rescue_executor_lock.v1",
    createdAt: new Date().toISOString(),
    runId,
    laneId: selectedLane.id,
    laneLabel: selectedLane.label,
    brandName: selectedCandidate.brandName,
    outDir,
    lockPath: selectedLockPath,
  };
  await createLock(selectedLockPath, lockPayload);

  let report;
  try {
    if (DRY_RUN) {
      report = buildRunReport({
        generatedAt: new Date().toISOString(),
        runId,
        status: "dry_run_ready",
        dryRun: true,
        note: "Selection completed; executor was not launched because dry-run mode is enabled.",
        selection: {
          laneId: selectedLane.id,
          laneLabel: selectedLane.label,
          batchSize: selectedLane.batchSize,
          brandName: selectedCandidate.brandName,
          configPath: selectedCandidate.configPath,
          selectedRowCount: selectedRows.length,
          topConfiguredBrands: selectedSnapshot.configuredCandidates
            .slice(0, 10)
            .map(({ brandName, count }) => ({ brandName, count })),
        },
        queueSnapshot,
        unconfiguredBrands: selectedSnapshot.unconfiguredCandidates.slice(0, 10).map(({ brandName, count }) => ({
          brandName,
          count,
        })),
        execution: {
          outDir,
          queueJsonPath: path.join(outDir, "selected_queue.json"),
          summary: null,
          topChangedRows: [],
        },
        nextAction: "Remove dry-run to let the isolated rescue wave execute.",
      });
      await writeJson(path.join(outDir, "selected_queue.json"), selectedRows);
    } else {
      const execution = await runExecutor({
        lane: selectedLane,
        candidate: {
          ...selectedCandidate,
          configPath: configRegistry.get(selectedCandidate.brandKey)?.configPath,
        },
        selectedRows,
        outDir,
      });
      const summary = execution.reportJson?.summary ?? {};
      const nextState = updateStateForRun({
        state,
        lane: selectedLane,
        candidate: selectedCandidate,
        execution: summary ? { summary } : null,
      });
      await writeJson(STATE_PATH, nextState);
      report = buildRunReport({
        generatedAt: new Date().toISOString(),
        runId,
        status: "executed",
        dryRun: false,
        note: null,
        selection: {
          laneId: selectedLane.id,
          laneLabel: selectedLane.label,
          batchSize: selectedLane.batchSize,
          brandName: selectedCandidate.brandName,
          configPath: configRegistry.get(selectedCandidate.brandKey)?.configPath,
          selectedRowCount: selectedRows.length,
          topConfiguredBrands: selectedSnapshot.configuredCandidates
            .slice(0, 10)
            .map(({ brandName, count }) => ({ brandName, count })),
        },
        queueSnapshot,
        unconfiguredBrands: selectedSnapshot.unconfiguredCandidates.slice(0, 10).map(({ brandName, count }) => ({
          brandName,
          count,
        })),
        execution: {
          outDir,
          queueJsonPath: execution.queueJsonPath,
          summary,
          outputs: execution.parsedStdout?.outputs ?? null,
          stderr: execution.stderr,
          topChangedRows: pickChangedRows(execution.reportJson?.rows ?? []),
        },
        nextAction:
          (summary?.becameFullOverlayReady ?? 0) > 0
            ? "Keep this lane active; it is converting queued rows into full-overlay-ready rows."
            : "If this brand stalls twice, rotate to the next configured brand in the same lane before widening scope.",
      });
    }
  } finally {
    await removeLockIfOwned(selectedLockPath, runId);
  }

    await writeJson(path.join(outDir, "rescue_executor_run.json"), report);
    await writeMarkdown(path.join(outDir, "rescue_executor_run.md"), report);
    await writeJson(LATEST_JSON, report);
    await writeMarkdown(LATEST_MD, report);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await removeRunLockIfOwned(coordinatorRunId);
  }
};

main().catch(async (error) => {
  const report = buildRunReport({
    generatedAt: new Date().toISOString(),
    runId: `week2-p0-rescue-fail-${formatLocalStamp(new Date())}`,
    status: "failed",
    dryRun: DRY_RUN,
    note: error instanceof Error ? error.stack ?? error.message : String(error),
    selection: null,
    queueSnapshot: null,
    unconfiguredBrands: [],
    execution: null,
    nextAction: "Inspect the executor error before letting the automation continue.",
  });
  await writeJson(LATEST_JSON, report);
  await writeMarkdown(LATEST_MD, report);
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
