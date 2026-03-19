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

const RUNTIME_DIR = getArg("runtime-dir", path.join(ROOT, "output"));
const CANONICAL_DIR = getArg("canonical-dir", path.join(ROOT, "docs", "exec-plans", "active", "week2_5"));
const RUNTIME_HISTORY_DIR = getArg("runtime-history-dir", path.join(ROOT, "output", "waves"));
const CANONICAL_HISTORY_DIR = getArg("canonical-history-dir", path.join(ROOT, "docs", "exec-plans", "history", "week2_5"));
const isWeek3Phase1 = /week3_phase1/.test(CANONICAL_DIR) || /week3_phase1/.test(CANONICAL_HISTORY_DIR);

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const patternToAllowedDecision = {
  positive_then_positive: new Set(["scale", "close"]),
  positive_then_zero: new Set(["retarget", "pause"]),
  zero_then_zero: new Set(["pause", "close"]),
  single_positive: new Set(["scale", "retarget"]),
  single_zero: new Set(["pause", "retarget", "close"]),
  not_enough_history: new Set(["retarget", "pause"]),
};

const outcomeToAllowedDecision = {
  execution_success: new Set(["scale", "close"]),
  strategy_proof: new Set(["retarget"]),
  diagnostic_success: new Set(["retarget", "pause"]),
  no_signal: new Set(["pause"]),
};

const main = async () => {
  const runtimeFiles = {
    blocker: path.join(RUNTIME_DIR, "blocker_registry.json"),
    roi: path.join(RUNTIME_DIR, "brand_path_roi_registry.json"),
    manifest: path.join(RUNTIME_DIR, "wave_manifest_current.json"),
    result: path.join(RUNTIME_DIR, "wave_result_current.json"),
  };
  const canonicalFiles = {
    blocker: path.join(CANONICAL_DIR, "blocker_registry.json"),
    roi: path.join(CANONICAL_DIR, "brand_path_roi_registry.json"),
    manifest: path.join(CANONICAL_DIR, "wave_manifest_current.json"),
    result: path.join(CANONICAL_DIR, "wave_result_current.json"),
  };

  const missing = [];
  for (const filePath of [...Object.values(runtimeFiles), ...Object.values(canonicalFiles)]) {
    if (!(await fileExists(filePath))) missing.push(filePath);
  }
  if (missing.length > 0) {
    throw new Error(`Missing harness files:\n${missing.join("\n")}`);
  }

  const [runtimeBlocker, runtimeRoi, runtimeManifest, runtimeResult, canonicalBlocker, canonicalRoi, canonicalManifest, canonicalResult] =
    await Promise.all([
      readJson(runtimeFiles.blocker),
      readJson(runtimeFiles.roi),
      readJson(runtimeFiles.manifest),
      readJson(runtimeFiles.result),
      readJson(canonicalFiles.blocker),
      readJson(canonicalFiles.roi),
      readJson(canonicalFiles.manifest),
      readJson(canonicalFiles.result),
    ]);

  const compareJson = (left, right, label) => {
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      throw new Error(`${label} runtime/canonical mismatch`);
    }
  };

  compareJson(runtimeBlocker, canonicalBlocker, "blocker_registry");
  compareJson(runtimeRoi, canonicalRoi, "brand_path_roi_registry");
  compareJson(runtimeManifest, canonicalManifest, "wave_manifest_current");
  compareJson(runtimeResult, canonicalResult, "wave_result_current");

  if (runtimeManifest.waveId !== runtimeResult.waveId) {
    throw new Error("wave_manifest_current.waveId must match wave_result_current.waveId");
  }

  const runtimeHistoryManifestPath = path.join(RUNTIME_HISTORY_DIR, `${runtimeManifest.waveId}_manifest.json`);
  const runtimeHistoryResultPath = path.join(RUNTIME_HISTORY_DIR, `${runtimeManifest.waveId}_result.json`);
  const canonicalHistoryManifestPath = path.join(CANONICAL_HISTORY_DIR, `${runtimeManifest.waveId}_manifest.json`);
  const canonicalHistoryResultPath = path.join(CANONICAL_HISTORY_DIR, `${runtimeManifest.waveId}_result.json`);
  for (const filePath of [
    runtimeHistoryManifestPath,
    runtimeHistoryResultPath,
    canonicalHistoryManifestPath,
    canonicalHistoryResultPath,
  ]) {
    if (!(await fileExists(filePath))) {
      throw new Error(`Missing history file for current wave: ${filePath}`);
    }
  }
  const [runtimeHistoryManifest, runtimeHistoryResult, canonicalHistoryManifest, canonicalHistoryResult] = await Promise.all([
    readJson(runtimeHistoryManifestPath),
    readJson(runtimeHistoryResultPath),
    readJson(canonicalHistoryManifestPath),
    readJson(canonicalHistoryResultPath),
  ]);
  compareJson(runtimeManifest, runtimeHistoryManifest, "wave_manifest_current/runtime_history");
  compareJson(runtimeResult, runtimeHistoryResult, "wave_result_current/runtime_history");
  compareJson(runtimeManifest, canonicalHistoryManifest, "wave_manifest_current/canonical_history");
  compareJson(runtimeResult, canonicalHistoryResult, "wave_result_current/canonical_history");

  for (const [entryKey, entry] of Object.entries(runtimeBlocker)) {
    if (!(await fileExists(entry.evidencePath))) {
      throw new Error(`Missing blocker evidence path for ${entryKey}: ${entry.evidencePath}`);
    }
  }

  for (const [pathKey, entry] of Object.entries(runtimeRoi)) {
    const allowed = patternToAllowedDecision[entry.lastTwoBatchPattern];
    if (!allowed) {
      throw new Error(`Unknown ROI pattern for ${pathKey}: ${entry.lastTwoBatchPattern}`);
    }
    const isWeek3DiscoveryPathProof =
      isWeek3Phase1 &&
      pathKey === "official_fetch_unresolved:iherb_discovery_path_proof" &&
      entry.currentDecision === "retarget";
    if (isWeek3DiscoveryPathProof) {
      continue;
    }
    if (!allowed.has(entry.currentDecision)) {
      throw new Error(`ROI decision mismatch for ${pathKey}: pattern=${entry.lastTwoBatchPattern} decision=${entry.currentDecision}`);
    }
  }

  const touched = Array.isArray(runtimeManifest.touchedBrandPaths) ? runtimeManifest.touchedBrandPaths : [];
  const touchedBlockerKeys = Array.isArray(runtimeManifest.touchedBlockerKeys) ? runtimeManifest.touchedBlockerKeys : [];
  for (const pathKey of touched) {
    if (!runtimeRoi[pathKey]) {
      throw new Error(`Touched brand/path missing from ROI registry: ${pathKey}`);
    }
  }

  const blockedStatuses = new Set(["paused", "blocked", "exhausted"]);
  for (const blockerKey of touchedBlockerKeys) {
    const blocker = runtimeBlocker[blockerKey];
    if (!blocker) continue;
    if (blockedStatuses.has(blocker.status) && runtimeManifest.newMethod !== true) {
      throw new Error(`Current manifest touches blocked/paused path without newMethod=true: ${blockerKey}`);
    }
  }

  const allowedDecisions = outcomeToAllowedDecision[runtimeResult.outcomeClass];
  if (!allowedDecisions) {
    throw new Error(`Unknown outcomeClass: ${runtimeResult.outcomeClass}`);
  }
  if (!allowedDecisions.has(runtimeResult.decision)) {
    throw new Error(
      `wave_result_current decision does not match outcomeClass: outcome=${runtimeResult.outcomeClass} decision=${runtimeResult.decision}`,
    );
  }

  const isMicroCanary = runtimeManifest.pathKey === "official_fetch_unresolved:iherb_identity_v2_micro_canary";
  if (isWeek3Phase1 && /micro_canary/i.test(String(runtimeManifest.pathKey ?? ""))) {
    throw new Error("Week 3 Phase 1 must not execute or publish an unresolved micro-canary wave");
  }
  if (isMicroCanary) {
    const positiveControlDebugPath = path.join(RUNTIME_DIR, "identity_positive_control_debug.json");
    const positiveControlRerunPath = path.join(RUNTIME_DIR, "identity_positive_control_rerun.json");
    const discoveryPositiveControlRerunPath = path.join(RUNTIME_DIR, "discovery_positive_control_rerun.json");
    const discoverySourceComparisonPath = path.join(RUNTIME_DIR, "discovery_source_comparison.json");
    const controlPath = (await fileExists(discoveryPositiveControlRerunPath))
      ? discoveryPositiveControlRerunPath
      : (await fileExists(positiveControlRerunPath))
        ? positiveControlRerunPath
        : (await fileExists(discoverySourceComparisonPath))
          ? discoverySourceComparisonPath
          : positiveControlDebugPath;
    if (!(await fileExists(controlPath))) {
      throw new Error("Micro-canary requires identity_positive_control_debug.json or identity_positive_control_rerun.json");
    }
    const positiveControlDebug = await readJson(controlPath);
    const controlValidity = positiveControlDebug?.summary?.controlValidity;
    if (runtimeResult.executed === false) {
      if (!runtimeResult.skipReason) {
        throw new Error("Skipped micro-canary must include skipReason");
      }
      if (runtimeResult.attempted !== 0 || runtimeResult.recoveredComplete !== 0 || runtimeResult.recoveredPartial !== 0) {
        throw new Error("Skipped micro-canary must not execute unresolved-row recovery");
      }
    } else if (!["fixed", "redefined"].includes(controlValidity)) {
      throw new Error(`Executed micro-canary requires positive control validity fixed/redefined, got ${controlValidity}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        waveId: runtimeManifest.waveId,
        touchedBrandPaths: touched,
        checks: {
          blockerEntries: Object.keys(runtimeBlocker).length,
          roiEntries: Object.keys(runtimeRoi).length,
          evidencePathsVerified: Object.keys(runtimeBlocker).length,
        },
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
