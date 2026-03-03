#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT_DIR = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
};

const normalizeBaseUrl = (value) => String(value ?? "").trim().replace(/\/$/, "");

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const readJsonl = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

const sha256Text = (value) => crypto.createHash("sha256").update(value).digest("hex");

const buildHeaders = ({ regressionToken, bearerToken }) => {
  const headers = {};
  if (regressionToken) headers["x-regression-token"] = regressionToken;
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  return headers;
};

const fetchJson = async (url, headers) => {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    body: parsed,
    raw: text,
  };
};

const checkHealth = async ({ apiBaseUrl, headers }) => {
  const probes = [
    `${apiBaseUrl}/health`,
    `${apiBaseUrl}/`,
  ];
  for (const url of probes) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) {
        return { pass: true, url, status: response.status };
      }
      if (response.status >= 500) {
        return { pass: false, url, status: response.status, reason: "server_error" };
      }
    } catch (error) {
      return {
        pass: false,
        url,
        status: null,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { pass: false, url: probes[0], status: null, reason: "no_ok_probe" };
};

const parseExpectedShaLine = (line) => {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return null;
  const token = trimmed.split(/\s+/)[0]?.trim();
  return token && /^[a-f0-9]{64}$/i.test(token) ? token.toLowerCase() : null;
};

const extractBarcodes = (executionSlice, filteredCandidates) => {
  const out = new Set();

  if (Array.isArray(executionSlice?.rows)) {
    for (const row of executionSlice.rows) {
      const digits = String(row?.barcode ?? "").replace(/\D/g, "");
      if (!digits) continue;
      out.add(digits.length >= 14 ? digits.slice(-14) : digits.padStart(14, "0"));
    }
  }

  const selectedKeys = new Set(
    Array.isArray(executionSlice?.selected)
      ? executionSlice.selected.map((row) => `${row?.market ?? ""}:${String(row?.brandNorm ?? "").toLowerCase()}`)
      : [],
  );

  for (const row of filteredCandidates) {
    const digits = String(row?.barcode_gtin14 ?? "").replace(/\D/g, "");
    if (!digits) continue;
    const normalized = digits.length >= 14 ? digits.slice(-14) : digits.padStart(14, "0");
    if (selectedKeys.size === 0) {
      out.add(normalized);
      continue;
    }
    const market = String(row?.market ?? "").toUpperCase();
    const brandNorm = String(row?.seedBrandNorm ?? row?.seed_brand_norm ?? row?.brandNorm ?? "").toLowerCase();
    if (selectedKeys.has(`${market}:${brandNorm}`)) out.add(normalized);
  }

  if (out.size === 0) {
    for (const row of filteredCandidates) {
      const digits = String(row?.barcode_gtin14 ?? "").replace(/\D/g, "");
      if (!digits) continue;
      out.add(digits.length >= 14 ? digits.slice(-14) : digits.padStart(14, "0"));
    }
  }

  return [...out].sort();
};

const main = async () => {
  const stageCDir = resolvePath(getArg("stage-c-dir"));
  const controlApiBaseUrl = normalizeBaseUrl(getArg("control-api-base-url", process.env.STAGING_CONTROL_API_BASE_URL || ""));
  const patchApiBaseUrl = normalizeBaseUrl(getArg("patch-api-base-url", process.env.STAGING_PATCH_API_BASE_URL || ""));
  const regressionToken = getArg("regression-token", process.env.REGRESSION_AUTH_TOKEN || "");
  const bearerToken = getArg("bearer-token", process.env.STAGE_C_PREFLIGHT_BEARER_TOKEN || "");

  if (!stageCDir) {
    console.error("[stage-c-preflight] missing --stage-c-dir");
    process.exit(1);
  }
  if (!controlApiBaseUrl || !patchApiBaseUrl) {
    console.error("[stage-c-preflight] missing control or patch api base url");
    process.exit(1);
  }

  const outDir = path.join(stageCDir, "preflight");
  const reportPath = path.join(outDir, "stage_c_preflight_report.json");

  const c3FilteredPath = path.join(stageCDir, "c3_conflict_prefilter", "stage_c_patch_candidates_filtered.jsonl");
  const planSnapshotPath = path.join(stageCDir, "inputs", "plan_snapshot.json");
  const planSnapshotShaPath = path.join(stageCDir, "inputs", "plan_snapshot.sha256");
  const c1aGatePath = path.join(stageCDir, "c1a_top100_census", "c1a_gate_result.json");
  const executionSlicePath = path.join(stageCDir, "c1b_top30_execution_slice", "execution_slice_top30.json");

  const headers = buildHeaders({ regressionToken, bearerToken });

  const checks = [];
  const fail = (id, detail) => checks.push({ id, pass: false, ...detail });
  const pass = (id, detail) => checks.push({ id, pass: true, ...detail });

  try {
    await fs.access(c3FilteredPath);
    const c3Rows = await readJsonl(c3FilteredPath);
    if (c3Rows.length > 0) {
      pass("c3_filtered_exists", { path: c3FilteredPath, count: c3Rows.length });
    } else {
      fail("c3_filtered_exists", { path: c3FilteredPath, reason: "empty_filtered_candidates" });
    }
  } catch (error) {
    fail("c3_filtered_exists", {
      path: c3FilteredPath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const [snapshotBody, shaBody] = await Promise.all([
      fs.readFile(planSnapshotPath, "utf8"),
      fs.readFile(planSnapshotShaPath, "utf8"),
    ]);
    const expected = parseExpectedShaLine(shaBody);
    const observed = sha256Text(snapshotBody);
    if (!expected) {
      fail("plan_snapshot_hash", { reason: "invalid_sha_file", path: planSnapshotShaPath });
    } else if (expected !== observed) {
      fail("plan_snapshot_hash", {
        reason: "sha_mismatch",
        expected,
        observed,
        planSnapshotPath,
      });
    } else {
      pass("plan_snapshot_hash", { planSnapshotPath, expected });
    }
  } catch (error) {
    fail("plan_snapshot_hash", {
      reason: error instanceof Error ? error.message : String(error),
      planSnapshotPath,
      planSnapshotShaPath,
    });
  }

  try {
    const c1aGate = await readJson(c1aGatePath);
    if (Number(c1aGate?.dbWriteCount ?? 1) === 0) {
      pass("c1a_db_write_count", { dbWriteCount: 0, path: c1aGatePath });
    } else {
      fail("c1a_db_write_count", {
        dbWriteCount: Number(c1aGate?.dbWriteCount ?? 1),
        path: c1aGatePath,
      });
    }
  } catch (error) {
    fail("c1a_db_write_count", {
      reason: error instanceof Error ? error.message : String(error),
      path: c1aGatePath,
    });
  }

  const controlHealth = await checkHealth({ apiBaseUrl: controlApiBaseUrl, headers });
  if (controlHealth.pass) {
    pass("control_health", controlHealth);
  } else {
    fail("control_health", controlHealth);
  }

  const patchHealth = await checkHealth({ apiBaseUrl: patchApiBaseUrl, headers });
  if (patchHealth.pass) {
    pass("patch_health", patchHealth);
  } else {
    fail("patch_health", patchHealth);
  }

  let patchStatusBody = null;
  try {
    const patchStatus = await fetchJson(`${patchApiBaseUrl}/api/patch-shadow/status`, headers);
    patchStatusBody = patchStatus.body;
    const enabled = Boolean(patchStatus.body?.enabled);
    const loaded = Number(patchStatus.body?.candidatesLoaded ?? 0);
    if (patchStatus.ok && enabled && loaded > 0) {
      pass("patch_status", {
        url: `${patchApiBaseUrl}/api/patch-shadow/status`,
        enabled,
        candidatesLoaded: loaded,
        candidatesHash: patchStatus.body?.candidatesHash ?? null,
      });
    } else {
      fail("patch_status", {
        url: `${patchApiBaseUrl}/api/patch-shadow/status`,
        status: patchStatus.status,
        enabled,
        candidatesLoaded: loaded,
        body: patchStatus.body ?? patchStatus.raw,
      });
    }
  } catch (error) {
    fail("patch_status", {
      url: `${patchApiBaseUrl}/api/patch-shadow/status`,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const [executionSlice, filteredRows] = await Promise.all([
      readJson(executionSlicePath),
      readJsonl(c3FilteredPath),
    ]);
    const barcodes = extractBarcodes(executionSlice, filteredRows);
    const barcodeHash = sha256Text(JSON.stringify(barcodes));
    if (barcodes.length > 0) {
      pass("barcodes_hash", {
        barcodesCount: barcodes.length,
        barcodesHash: barcodeHash,
      });
    } else {
      fail("barcodes_hash", {
        reason: "no_barcodes_resolved",
      });
    }
  } catch (error) {
    fail("barcodes_hash", {
      reason: error instanceof Error ? error.message : String(error),
      executionSlicePath,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    stageCDir,
    controlApiBaseUrl,
    patchApiBaseUrl,
    checks,
    patchStatus: patchStatusBody,
    pass: checks.every((item) => item.pass === true),
  };

  await writeJson(reportPath, report);
  if (!report.pass) {
    console.error(`[stage-c-preflight] failed. report=${reportPath}`);
    process.exit(2);
  }
  console.log(`[stage-c-preflight] pass. report=${reportPath}`);
};

main().catch((error) => {
  console.error("[stage-c-preflight] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
