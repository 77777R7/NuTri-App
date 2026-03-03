#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const normalizeBarcode14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

const stopServer = async (server) => {
  if (!server || server.killed) return;
  server.kill("SIGTERM");
  await sleep(400);
  if (!server.killed) server.kill("SIGKILL");
};

const runNodeSoft = ({ script, scriptArgs, env }) =>
  new Promise((resolve) => {
    const child = spawn("node", [script, ...scriptArgs], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("close", (code) => resolve({ ok: code === 0, code: code ?? 1 }));
    child.on("error", () => resolve({ ok: false, code: 1 }));
  });

const fetchJson = async (url) => {
  try {
    const res = await fetch(url, { headers: { "x-auth-disabled": "1" } });
    const txt = await res.text();
    const body = txt ? JSON.parse(txt) : null;
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: { error: String(error) } };
  }
};

const waitForStatus = async (url, attempts = 80) => {
  for (let i = 0; i < attempts; i += 1) {
    const r = await fetchJson(url);
    if (r.ok && r.body && typeof r.body === "object") return r;
    await sleep(250);
  }
  return null;
};

const hashJsonl = (rows) => {
  const body = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  return {
    body,
    hash: crypto.createHash("sha256").update(body).digest("hex"),
  };
};

const main = async () => {
  const nightlyDir = resolvePath(getArg("nightly-dir"));
  if (!nightlyDir) {
    console.error("[run-new-top100-lane2-shadow-validation] missing --nightly-dir");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) ?? path.join(nightlyDir, "next_phase");
  const lane2CandidatesJson =
    resolvePath(getArg("lane2-candidates-json"))
    ?? path.join(outDir, "new_top100_lane2_candidates.json");

  const controlApi = String(getArg("control-api-base-url", "http://192.168.1.68:3101")).trim();
  const basePort = Number(getArg("base-port", 3260));
  const samplePerLane = Math.max(10, Number(getArg("sample-per-lane", 15)));

  const lane2 = await readJson(lane2CandidatesJson);
  const rows = Array.isArray(lane2?.rows) ? lane2.rows : [];
  const lanes = [...new Set(rows.map((r) => r?.laneId).filter(Boolean))];

  const shadowReports = [];
  const decisions = [];

  for (let i = 0; i < lanes.length; i += 1) {
    const laneId = lanes[i];
    const laneRows = rows.filter((r) => r.laneId === laneId);
    const sampleRows = laneRows.slice(0, samplePerLane);
    const { body, hash } = hashJsonl(sampleRows);
    const candidateScopeId = crypto.createHash("sha256").update(`${laneId}|${hash}`).digest("hex");

    const laneDir = path.join(outDir, "lane2", laneId);
    await ensureDir(laneDir);
    const candidatePath = path.join(laneDir, "lane2_candidates.jsonl");
    await fs.writeFile(candidatePath, body, "utf8");

    const barcodes = [...new Set(sampleRows.map((r) => normalizeBarcode14(r?.barcode_gtin14)).filter(Boolean))]
      .slice(0, samplePerLane)
      .map((barcode, idx) => ({
        role: idx === 0 ? "killer" : `lane2_${String(idx + 1).padStart(3, "0")}`,
        barcode,
      }));
    const barcodesPath = path.join(laneDir, "barcodes.json");
    await writeJson(barcodesPath, { barcodes });

    const port = basePort + i;
    const patchApi = `http://127.0.0.1:${port}`;

    const serverLog = path.join(laneDir, "patch_server.log");
    const server = spawn("npm", ["run", "serve:backend"], {
      cwd: ROOT,
      env: {
        ...process.env,
        DISABLE_AUTH: "1",
        PORT: String(port),
        PATCH_SHADOW_ENABLE: "1",
        PATCH_SHADOW_CANDIDATES_PATH: candidatePath,
        PATCH_SHADOW_STAGE_C_DIR: nightlyDir,
        PATCH_SHADOW_CANDIDATE_SCOPE_ID: candidateScopeId,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const logFile = await fs.open(serverLog, "w");
    server.stdout.on("data", (d) => void logFile.appendFile(d));
    server.stderr.on("data", (d) => void logFile.appendFile(d));

    const statusUrl = `${patchApi}/api/patch-shadow/status`;
    const ready = await waitForStatus(statusUrl, 80);
    if (!ready) {
      await stopServer(server);
      await logFile.close();
      shadowReports.push({
        laneId,
        pass: false,
        reason: "patch_server_not_ready",
      });
      decisions.push({
        laneId,
        enforce: false,
        reasonCode: "shadow_not_ready",
      });
      continue;
    }

    const before = await fetchJson(statusUrl);

    const commonArgs = [
      "--skip-cold-hot",
      "--no-open-result-screen",
      "--concurrent-rounds", "0",
      "--killer-cold-runs", "0",
      "--killer-hot-runs", "0",
      "--serial-rounds", "1",
      "--barcodes-json", barcodesPath,
      "--content-pass-threshold", "0",
      "--verified-content-threshold", "0",
      "--web-hint-content-threshold", "0",
      "--degraded-content-threshold", "0",
      "--ul-visibility-threshold", "0",
      "--first-frame-trusted-threshold", "0",
    ];

    const controlOut = path.join(laneDir, "shadow", "control");
    const patchOut = path.join(laneDir, "shadow", "patch");

    await runNodeSoft({
      script: "scripts/maintainer/mobile-soak-run.mjs",
      scriptArgs: ["--api-base-url", controlApi, "--out-dir", controlOut, ...commonArgs],
      env: {},
    });

    await runNodeSoft({
      script: "scripts/maintainer/mobile-soak-run.mjs",
      scriptArgs: ["--api-base-url", patchApi, "--out-dir", patchOut, ...commonArgs],
      env: {},
    });

    const after = await fetchJson(statusUrl);

    const beforeHit = Number(before?.body?.runtimePatchHitCount || 0);
    const afterHit = Number(after?.body?.runtimePatchHitCount || 0);
    const delta = Math.max(0, afterHit - beforeHit);
    const sampled = barcodes.length;
    const visibilityProxy = sampled > 0 ? delta / sampled : 0;
    const runtimeHitIntensityPerSampledBarcode = visibilityProxy;

    const scopePass =
      String(after?.body?.candidatesPath || "") === candidatePath &&
      String(after?.body?.candidatesHash || "") === hash &&
      String(after?.body?.candidateScopeId || "") === candidateScopeId;

    const minSampleRequired = Math.min(10, Math.max(1, laneRows.length));
    const pass = scopePass && runtimeHitIntensityPerSampledBarcode >= 0.2 && sampled >= minSampleRequired;

    const shadowReport = {
      generatedAt: new Date().toISOString(),
      laneId,
      sampledBarcodes: sampled,
      minSampleRequired,
      runtimePatchHitCountBefore: beforeHit,
      runtimePatchHitCountAfter: afterHit,
      runtimePatchHitCountDelta: delta,
      runtimeHitIntensityPerSampledBarcode: Number(runtimeHitIntensityPerSampledBarcode.toFixed(6)),
      visibilityProxyRate: Number(visibilityProxy.toFixed(6)),
      deprecatedFields: {
        visibilityProxyRate: "runtimeHitIntensityPerSampledBarcode",
      },
      patchModeConfirmed: Boolean(after?.body?.patchModeConfirmed),
      candidateScopeEvidence: {
        candidatePath,
        candidateHash: hash,
        candidateScopeId,
        runtimeCandidatesPath: after?.body?.candidatesPath || null,
        runtimeCandidatesHash: after?.body?.candidatesHash || null,
        runtimeCandidateScopeId: after?.body?.candidateScopeId || null,
        scopeEvidencePass: scopePass,
      },
      pass,
    };

    shadowReports.push(shadowReport);
    decisions.push({
      laneId,
      enforce: pass,
      decision: pass ? "shadow_pass_preview_enforce_ready" : "shadow_hold",
      reasonCode: pass ? "lane2_shadow_pass" : "lane2_shadow_not_ready",
      sampledBarcodes: sampled,
      runtimeHitIntensityPerSampledBarcode: Number(runtimeHitIntensityPerSampledBarcode.toFixed(6)),
      visibilityProxyRate: Number(visibilityProxy.toFixed(6)),
    });

    await stopServer(server);
    await logFile.close();
  }

  const uxVisibility = {
    generatedAt: new Date().toISOString(),
    summary: {
      lanesTested: shadowReports.length,
      passLanes: shadowReports.filter((r) => r.pass).length,
      primaryLane: "patch_probiotics_strain_cfu_v1",
      primaryLanePass: Boolean(shadowReports.find((r) => r.laneId === "patch_probiotics_strain_cfu_v1")?.pass),
      lane2_readiness_visibility: shadowReports.length > 0
        ? Number((shadowReports.filter((r) => r.pass).length / shadowReports.length).toFixed(6))
        : 0,
    },
    rows: shadowReports,
  };

  await writeJson(path.join(outDir, "new_top100_lane2_shadow_reports.json"), {
    generatedAt: new Date().toISOString(),
    rows: shadowReports,
  });
  await writeJson(path.join(outDir, "new_top100_lane2_enforce_decisions.json"), {
    generatedAt: new Date().toISOString(),
    rows: decisions,
  });
  await writeJson(path.join(outDir, "new_top100_lane2_ux_visibility.json"), uxVisibility);

  await writeText(
    path.join(outDir, "new_top100_lane2_ux_visibility.md"),
    [
      "# New Top100 Lane2 UX Visibility",
      "",
      "## Summary / 摘要",
      `- lanes tested: ${uxVisibility.summary.lanesTested}`,
      `- pass lanes: ${uxVisibility.summary.passLanes}`,
      `- lane2 readiness visibility: ${(uxVisibility.summary.lane2_readiness_visibility * 100).toFixed(2)}%`,
      `- primary lane pass (probiotics): ${uxVisibility.summary.primaryLanePass}`,
      "",
      "## Decisions / 决策",
      ...decisions.map((d) => `- ${d.laneId}: enforce=${d.enforce}, hitIntensity=${d.runtimeHitIntensityPerSampledBarcode.toFixed(4)}, reason=${d.reasonCode}`),
      "",
    ].join("\n"),
  );

  console.log("[run-new-top100-lane2-shadow-validation] completed");
  console.log(JSON.stringify({
    outDir,
    lanes: uxVisibility.summary.lanesTested,
    passLanes: uxVisibility.summary.passLanes,
  }, null, 2));
};

main().catch((error) => {
  console.error("[run-new-top100-lane2-shadow-validation] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
