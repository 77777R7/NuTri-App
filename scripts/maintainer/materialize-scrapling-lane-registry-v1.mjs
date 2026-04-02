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

const BASE_REGISTRY_PATH = getArg(
  "base-registry-json",
  path.join(ROOT, "docs", "exec-plans", "active", "p0_p3_product_closure", "scrapling_lane_registry.v1.json"),
);
const CURRENT_REGISTRY_PATH = getArg(
  "current-registry-json",
  path.join(ROOT, "output", "scrapling_program_report_20260320", "scrapling_lane_registry_current.json"),
);
const MANIFEST_PATH = getArg(
  "manifest-json",
  path.join(ROOT, "output", "scrapling_wave_manifest_all_20260320", "scrapling_wave_manifest.json"),
);
const OUT_PATH = getArg(
  "out-json",
  path.join(ROOT, "docs", "exec-plans", "active", "p0_p3_product_closure", "scrapling_lane_registry.v1.json"),
);
const INCLUDE_DERIVED_HOLD = String(getArg("include-derived-hold", "false")).toLowerCase() === "true";

const readJson = async (filePath) => JSON.parse(await fs.readFile(path.resolve(ROOT, filePath), "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const normalizeText = (value) => String(value ?? "").trim();
const toArray = (value) => (Array.isArray(value) ? value : []);
const laneKey = (brandName, sourceBucket) => `${normalizeText(brandName)}::${normalizeText(sourceBucket)}`;
const isDerivedReason = (reason) => normalizeText(reason).toLowerCase().startsWith("derived ");

const buildManifestLaneIndex = (manifest) => {
  const keys = new Set();
  const byKey = new Map();
  for (const brand of toArray(manifest?.brands)) {
    for (const lane of toArray(brand?.lanes)) {
      const key = laneKey(brand?.brandName, lane?.sourceBucket);
      keys.add(key);
      byKey.set(key, {
        brandName: normalizeText(brand?.brandName),
        sourceBucket: normalizeText(lane?.sourceBucket),
        status: normalizeText(lane?.status).toUpperCase() || null,
        reason: normalizeText(lane?.bootstrapReason ?? null) || null,
      });
    }
  }
  return { keys, byKey };
};

const buildDerivedReason = (lane) => {
  const latest = lane?.latestWave ?? {};
  const parts = [];
  if (lane?.decision === "GO") {
    parts.push("Derived from executed Scrapling lane");
    if (Number(lane?.executedWaveCount ?? 0) > 0) parts.push(`${lane.executedWaveCount} wave(s)`);
    if (Number(lane?.totalFullOverlayReadyUplift ?? 0) > 0) parts.push(`${lane.totalFullOverlayReadyUplift} full_overlay_ready uplift`);
    if (latest?.staticGatesPass === true) parts.push("static gates pass");
    return `${parts.join(", ")}.`;
  }
  if (lane?.decision === "STOP") {
    const reasons = toArray(lane?.quarantinedReasons);
    return `Derived stop from executed lane${reasons.length > 0 ? `: ${reasons.join(", ")}` : ""}.`;
  }
  return "Derived hold from executed lane.";
};

const shouldImportLane = (lane) => {
  if (!normalizeText(lane?.sourceBucket)) return false;
  if (lane?.decision === "GO") return true;
  if (lane?.decision === "STOP") return true;
  if (lane?.decision === "HOLD" && INCLUDE_DERIVED_HOLD) return true;
  return false;
};

const main = async () => {
  const [baseRegistry, currentRegistry, manifest] = await Promise.all([
    readJson(BASE_REGISTRY_PATH),
    readJson(CURRENT_REGISTRY_PATH),
    readJson(MANIFEST_PATH),
  ]);
  const manifestLaneIndex = buildManifestLaneIndex(manifest);
  const manifestLaneKeys = manifestLaneIndex.keys;
  const manifestLaneMap = manifestLaneIndex.byKey;

  const currentLaneMap = new Map(
    toArray(currentRegistry?.lanes).map((lane) => [
      laneKey(lane.brandName, lane.sourceBucket),
      lane,
    ]),
  );

  const merged = new Map();
  for (const entry of toArray(baseRegistry?.laneStatuses)) {
    const key = laneKey(entry.brandName, entry.sourceBucket);
    const keepableManualEntry = !isDerivedReason(entry.reason);
    if (!manifestLaneKeys.has(key) && !keepableManualEntry) {
      continue;
    }

    const currentLane = currentLaneMap.get(key);
    const manifestLane = manifestLaneMap.get(key);
    const manifestBootstrapGo = manifestLane?.status === "GO";

    if (manifestBootstrapGo && (!currentLane || currentLane.decision === "HOLD")) {
      merged.set(key, {
        brandName: normalizeText(manifestLane.brandName),
        sourceBucket: normalizeText(manifestLane.sourceBucket),
        status: "GO",
        reason:
          normalizeText(manifestLane.reason) ||
          "Derived bootstrap GO from manifest lane with strong iHerb-confirmed soft-gap profile.",
      });
      currentLaneMap.delete(key);
      continue;
    }

    if (currentLane?.decision === "HOLD") {
      if (keepableManualEntry) {
        merged.set(key, {
          brandName: normalizeText(entry.brandName),
          sourceBucket: normalizeText(entry.sourceBucket),
          status: normalizeText(entry.status).toUpperCase(),
          reason: normalizeText(entry.reason),
        });
      }
      currentLaneMap.delete(key);
      continue;
    }

    if (keepableManualEntry) {
      merged.set(key, {
        brandName: normalizeText(entry.brandName),
        sourceBucket: normalizeText(entry.sourceBucket),
        status: normalizeText(entry.status).toUpperCase(),
        reason: normalizeText(entry.reason),
      });
      currentLaneMap.delete(key);
      continue;
    }

    if (currentLane && shouldImportLane(currentLane)) {
      merged.set(key, {
        brandName: normalizeText(currentLane.brandName),
        sourceBucket: normalizeText(currentLane.sourceBucket),
        status: normalizeText(currentLane.decision).toUpperCase(),
        reason: buildDerivedReason(currentLane),
      });
      currentLaneMap.delete(key);
      continue;
    }

    merged.set(key, {
      brandName: normalizeText(entry.brandName),
      sourceBucket: normalizeText(entry.sourceBucket),
      status: normalizeText(entry.status).toUpperCase(),
      reason: normalizeText(entry.reason),
    });
  }

  let importedCount = 0;
  for (const lane of currentLaneMap.values()) {
    const key = laneKey(lane.brandName, lane.sourceBucket);
    if (!manifestLaneKeys.has(key)) continue;
    if (!shouldImportLane(lane)) continue;
    merged.set(key, {
      brandName: normalizeText(lane.brandName),
      sourceBucket: normalizeText(lane.sourceBucket),
      status: normalizeText(lane.decision).toUpperCase(),
      reason: buildDerivedReason(lane),
    });
    importedCount += 1;
  }

  for (const [key, manifestLane] of manifestLaneMap.entries()) {
    if (merged.has(key)) continue;
    if (manifestLane.status !== "GO") continue;
    merged.set(key, {
      brandName: normalizeText(manifestLane.brandName),
      sourceBucket: normalizeText(manifestLane.sourceBucket),
      status: "GO",
      reason:
        normalizeText(manifestLane.reason) ||
        "Derived bootstrap GO from manifest lane with strong iHerb-confirmed soft-gap profile.",
    });
    importedCount += 1;
  }

  const laneStatuses = [...merged.values()].sort((left, right) => {
    const brandCmp = left.brandName.localeCompare(right.brandName);
    if (brandCmp !== 0) return brandCmp;
    return left.sourceBucket.localeCompare(right.sourceBucket);
  });

  const materialized = {
    schemaVersion: "scrapling_lane_registry.v1",
    generatedAt: new Date().toISOString(),
    defaults: {
      status: normalizeText(baseRegistry?.defaults?.status || "HOLD").toUpperCase(),
      reason: normalizeText(baseRegistry?.defaults?.reason || "Default hold until a brand/source lane is proven with merge + coverage validation."),
    },
    laneStatuses,
    meta: {
      baseRegistryPath: path.resolve(ROOT, BASE_REGISTRY_PATH),
      currentRegistryPath: path.resolve(ROOT, CURRENT_REGISTRY_PATH),
      importedDerivedLanes: importedCount,
      includeDerivedHold: INCLUDE_DERIVED_HOLD,
    },
  };

  await writeJson(path.resolve(ROOT, OUT_PATH), materialized);
  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath: path.resolve(ROOT, OUT_PATH),
        laneStatusCount: laneStatuses.length,
        importedDerivedLanes: importedCount,
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
