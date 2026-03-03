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

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const readJsonl = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const body = (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
};

const hasValue = (value) => !(value == null || (typeof value === "string" && value.trim().length === 0));
const normalizeBrand = (value) => String(value ?? "").trim().toLowerCase();
const normalizeOwner = (value) => String(value ?? "").trim();
const normalizeOwnerCandidate = (value) => {
  const normalized = normalizeOwner(value);
  if (!normalized) return "";
  return normalized.toLowerCase() === "unassigned" ? "" : normalized;
};
const normalizeCandidateScope = (value) => String(value ?? "").trim();

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const rowHash = (row) => crypto.createHash("sha256").update(stableStringify(row)).digest("hex");

const main = async () => {
  const e1EvalDir = resolvePath(getArg("e1-eval-dir"));
  if (!e1EvalDir) {
    console.error("[close-e1-owner-metadata] missing --e1-eval-dir");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) || path.join(e1EvalDir, "owner_closure");
  await ensureDir(outDir);

  const previewPath = resolvePath(getArg("preview-jsonl"))
    || path.join(e1EvalDir, "e1_enforce_readiness_preview.jsonl");
  const ownerQueuePath = resolvePath(getArg("owner-queue-jsonl"))
    || path.join(e1EvalDir, "e1_fixable_owner_assignment_queue.jsonl");
  const decisionPath = resolvePath(getArg("decision-json"))
    || path.join(e1EvalDir, "e1_release_readiness_decision.json");
  const ownerMapPath = resolvePath(getArg("owner-map-json"));

  const defaultOwner = normalizeOwner(getArg("default-owner", process.env.STAGE_E_OWNER_DEFAULT || "stage-e-ops"));
  const defaultTargetRelease = String(getArg("target-release", process.env.STAGE_E_TARGET_RELEASE || "v1.6.14-e2-pilot")).trim();
  const defaultPatchBatchId = String(getArg("default-patch-batch-id", process.env.STAGE_E_PATCH_BATCH_ID || "e2-pilot-top10")).trim();
  const scopeIdOverride = normalizeCandidateScope(getArg("candidate-scope-id", process.env.STAGE_E_CANDIDATE_SCOPE_ID || ""));

  const previewRows = await readJsonl(previewPath);
  if (previewRows.length === 0) {
    console.error("[close-e1-owner-metadata] preview file has no rows");
    process.exit(1);
  }
  const ownerQueueRows = await readJsonl(ownerQueuePath);
  const decision = await readJson(decisionPath).catch(() => null);
  const ownerMap = ownerMapPath ? await readJson(ownerMapPath).catch(() => null) : null;

  const byCandidateId = new Map();
  const byBrand = new Map();
  const byLane = new Map();
  if (ownerMap?.byCandidateId && typeof ownerMap.byCandidateId === "object") {
    for (const [candidateId, owner] of Object.entries(ownerMap.byCandidateId)) {
      const norm = normalizeOwner(owner);
      if (norm) byCandidateId.set(String(candidateId), norm);
    }
  }
  if (ownerMap?.byBrand && typeof ownerMap.byBrand === "object") {
    for (const [brand, owner] of Object.entries(ownerMap.byBrand)) {
      const norm = normalizeOwner(owner);
      if (norm) byBrand.set(normalizeBrand(brand), norm);
    }
  }
  if (ownerMap?.byLane && typeof ownerMap.byLane === "object") {
    for (const [laneId, owner] of Object.entries(ownerMap.byLane)) {
      const norm = normalizeOwner(owner);
      if (norm) byLane.set(String(laneId), norm);
    }
  }

  const missingRequiredFields = [
    "owner",
    "status",
    "targetRelease",
    "expiresAt",
    "reviewAfterDays",
    "reasonCode",
    "evidenceRef",
    "patchBatchId",
    "laneId",
    "candidateScopeId",
  ];

  const fixedRows = [];
  const residualRows = [];
  const assignedOwnerRows = [];
  const queueByCandidate = new Map(ownerQueueRows.map((row) => [String(row?.candidateId || ""), row]));

  const expectedScopeId = scopeIdOverride
    || normalizeCandidateScope(decision?.thresholds?.expectedCandidateScopeId)
    || normalizeCandidateScope(previewRows[0]?.candidateScopeId);

  for (const row of previewRows) {
    const candidateId = String(row?.candidateId || "");
    const queueRow = queueByCandidate.get(candidateId) || null;
    const brandKey = normalizeBrand(row?.brandName || row?.seedBrand);
    const laneId = String(row?.laneId || "patch_probiotics_strain_cfu_v1");

    const resolvedOwner = normalizeOwner(
      normalizeOwnerCandidate(byCandidateId.get(candidateId))
      || normalizeOwnerCandidate(byBrand.get(brandKey))
      || normalizeOwnerCandidate(byLane.get(laneId))
      || normalizeOwnerCandidate(row?.owner)
      || normalizeOwnerCandidate(queueRow?.owner)
      || normalizeOwnerCandidate(ownerMap?.defaultOwner)
      || normalizeOwnerCandidate(defaultOwner),
    );
    const ownerAssigned = resolvedOwner.length > 0 && resolvedOwner.toLowerCase() !== "unassigned";

    const normalizedRow = {
      ...row,
      owner: ownerAssigned ? resolvedOwner : "unassigned",
      status: hasValue(row?.status) ? row.status : "enforce_preview_ready",
      targetRelease: hasValue(row?.targetRelease) ? row.targetRelease : defaultTargetRelease,
      patchBatchId: hasValue(row?.patchBatchId) ? row.patchBatchId : defaultPatchBatchId,
      candidateScopeId: normalizeCandidateScope(row?.candidateScopeId) || expectedScopeId || null,
      laneId,
    };

    const fieldViolations = missingRequiredFields.filter((field) => !hasValue(normalizedRow?.[field]));
    const sourceTierOk = String(normalizedRow?.sourceTier || "").toLowerCase() === "scanned_label";
    const scopeMatches = !expectedScopeId || normalizedRow.candidateScopeId === expectedScopeId;

    const isReady = ownerAssigned && sourceTierOk && scopeMatches && fieldViolations.length === 0;
    if (isReady) {
      fixedRows.push(normalizedRow);
      if (String(row?.owner || "").trim().toLowerCase() === "unassigned" || !hasValue(row?.owner)) {
        assignedOwnerRows.push({
          candidateId,
          ownerBefore: row?.owner || null,
          ownerAfter: normalizedRow.owner,
        });
      }
      continue;
    }

    residualRows.push({
      ...normalizedRow,
      missingFields: fieldViolations,
      ownerAssigned,
      sourceTierOk,
      scopeMatches,
      status: "open",
      breachType: "owner_or_metadata_incomplete",
      reasonCode: fieldViolations.length > 0 ? `missing_${fieldViolations.join("_")}` : "owner_or_scope_not_ready",
    });
  }

  const audit = {
    generatedAt: new Date().toISOString(),
    input: {
      e1EvalDir,
      previewPath,
      ownerQueuePath,
      decisionPath,
      ownerMapPath: ownerMapPath || null,
    },
    policy: {
      defaultOwner,
      defaultTargetRelease,
      defaultPatchBatchId,
      expectedScopeId: expectedScopeId || null,
      ownerResolutionOrder: [
        "ownerMap.byCandidateId",
        "ownerMap.byBrand",
        "ownerMap.byLane",
        "row.owner",
        "ownerQueue.owner",
        "ownerMap.defaultOwner",
        "defaultOwner",
      ],
    },
    counts: {
      previewRows: previewRows.length,
      pilotReadyRows: fixedRows.length,
      residualRows: residualRows.length,
      ownerAssignedRows: assignedOwnerRows.length,
    },
    hashes: {
      pilotReadyHash: rowHash(fixedRows),
      residualHash: rowHash(residualRows),
    },
  };

  await writeJsonl(path.join(outDir, "e2_pilot_ready_candidates.jsonl"), fixedRows);
  await writeJson(path.join(outDir, "owner_assignment_audit.json"), audit);
  await writeJsonl(path.join(outDir, "owner_assignment_residual_queue.jsonl"), residualRows);

  console.log("[close-e1-owner-metadata] completed");
  console.log(JSON.stringify({
    outDir,
    previewRows: previewRows.length,
    pilotReadyRows: fixedRows.length,
    residualRows: residualRows.length,
    expectedScopeId: expectedScopeId || null,
  }, null, 2));
};

main().catch((error) => {
  console.error("[close-e1-owner-metadata] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
