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

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp01 = (value) => Math.max(0, Math.min(1, asNumber(value, 0)));
const hasValue = (value) => !(value == null || (typeof value === "string" && value.trim().length === 0));
const normalizeBrand = (value) => String(value ?? "").trim().toLowerCase();

const scorePresence = (...flags) => {
  const values = flags.map((flag) => (flag ? 1 : 0));
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
};

const normalizeBarcode14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const stableHash = (rows) => {
  const stable = rows.map((row) => [
    row?.candidateId || "",
    row?.identityKey || "",
    row?.owner || "",
    row?.candidateScopeId || "",
    row?.rankScore ?? "",
  ].join("|")).sort().join("\n");
  return crypto.createHash("sha256").update(stable).digest("hex");
};

const main = async () => {
  const pilotReadyPath = resolvePath(getArg("pilot-ready-jsonl"));
  const stagingComparePath = resolvePath(getArg("staging-repeat-compare-json"));
  if (!pilotReadyPath || !stagingComparePath) {
    console.error("[select-e2-pilot-scope] missing --pilot-ready-jsonl or --staging-repeat-compare-json");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) || path.join(path.dirname(pilotReadyPath), "e2_pilot_scope");
  await ensureDir(outDir);

  const targetSize = Math.max(1, asNumber(getArg("target-size", 10), 10));
  const maxPerBrand = Math.max(1, asNumber(getArg("max-per-brand", 3), 3));

  const compare = await readJson(stagingComparePath);
  if (compare?.pass !== true) {
    console.error("[select-e2-pilot-scope] staging repeat compare is not passing");
    process.exit(2);
  }

  const latestCandidateScopeId = String(compare?.latestCandidateScopeId ?? "").trim();
  const rows = await readJsonl(pilotReadyPath);
  if (rows.length === 0) {
    console.error("[select-e2-pilot-scope] pilot-ready input is empty");
    process.exit(1);
  }

  const requiredFields = [
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

  const filteredOut = [];
  const scored = [];
  for (const row of rows) {
    const missingFields = requiredFields.filter((field) => !hasValue(row?.[field]));
    const ownerOk = String(row?.owner ?? "").trim().toLowerCase() !== "unassigned";
    const sourceTierOk = String(row?.sourceTier ?? "").toLowerCase() === "scanned_label";
    const scopeId = String(row?.candidateScopeId ?? "").trim();
    const scopeMatches = !latestCandidateScopeId || (scopeId.length > 0 && scopeId === latestCandidateScopeId);

    if (missingFields.length > 0 || !ownerOk || !sourceTierOk || !scopeMatches) {
      filteredOut.push({
        ...row,
        missingFields,
        ownerOk,
        sourceTierOk,
        scopeMatches,
      });
      continue;
    }

    const confidence = clamp01(row?.confidence ?? 0.7);
    const determinism = scorePresence(
      hasValue(row?.candidateId),
      hasValue(row?.identityKey),
      hasValue(row?.reasonCode),
      hasValue(row?.evidenceRef),
      hasValue(row?.evidenceRef?.recordIdentity),
    );
    const evidenceQuality = scorePresence(
      String(row?.sourceTier ?? "").toLowerCase() === "scanned_label",
      hasValue(row?.evidenceRef),
      hasValue(row?.evidenceRef?.recordIdentity),
    );
    const identityTraceability = scorePresence(
      hasValue(normalizeBarcode14(row?.barcode_gtin14)),
      hasValue(row?.identityKey),
      hasValue(row?.sourceId),
    );
    const rankScore = Number((
      0.35 * confidence
      + 0.25 * determinism
      + 0.20 * evidenceQuality
      + 0.20 * identityTraceability
    ).toFixed(6));

    scored.push({
      ...row,
      confidence,
      determinism,
      evidenceQuality,
      identityTraceability,
      rankScore,
    });
  }

  scored.sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return String(a.candidateId || "").localeCompare(String(b.candidateId || ""));
  });

  const selected = [];
  const brandCounts = new Map();
  for (const row of scored) {
    if (selected.length >= targetSize) break;
    const brandKey = normalizeBrand(row?.brandName || row?.seedBrand || "unknown");
    const current = brandCounts.get(brandKey) || 0;
    if (current >= maxPerBrand) continue;
    brandCounts.set(brandKey, current + 1);
    selected.push(row);
  }

  const pass = selected.length >= targetSize;
  const blockingReasons = [];
  if (!pass) blockingReasons.push("insufficient_pilot_candidates_after_filter_and_diversity");

  const report = {
    generatedAt: new Date().toISOString(),
    pass,
    targetSize,
    maxPerBrand,
    latestCandidateScopeId: latestCandidateScopeId || null,
    counts: {
      inputRows: rows.length,
      filteredOut: filteredOut.length,
      eligibleRows: scored.length,
      selectedRows: selected.length,
    },
    blockingReasons,
    scoreFormula: "0.35*confidence + 0.25*determinism + 0.20*evidenceQuality + 0.20*identityTraceability",
    selectionHash: stableHash(selected),
    selected: selected.map((row, idx) => ({
      rank: idx + 1,
      candidateId: row?.candidateId || null,
      laneId: row?.laneId || null,
      brandName: row?.brandName || row?.seedBrand || null,
      identityKey: row?.identityKey || null,
      barcode_gtin14: row?.barcode_gtin14 || null,
      owner: row?.owner || null,
      candidateScopeId: row?.candidateScopeId || null,
      rankScore: row?.rankScore ?? null,
      confidence: row?.confidence ?? null,
      determinism: row?.determinism ?? null,
      evidenceQuality: row?.evidenceQuality ?? null,
      identityTraceability: row?.identityTraceability ?? null,
    })),
  };

  await writeJson(path.join(outDir, "e2_pilot_scope_top10.json"), report);
  await writeText(path.join(outDir, "e2_pilot_scope_top10.md"), [
    "# E2 Pilot Scope Top10",
    "",
    `- pass: ${pass}`,
    `- targetSize: ${targetSize}`,
    `- selectedRows: ${selected.length}`,
    `- filteredOut: ${filteredOut.length}`,
    `- maxPerBrand: ${maxPerBrand}`,
    `- latestCandidateScopeId: ${latestCandidateScopeId || "n/a"}`,
    `- selectionHash: ${report.selectionHash}`,
    `- blockingReasons: ${blockingReasons.length > 0 ? blockingReasons.join(", ") : "none"}`,
  ].join("\n") + "\n");
  await writeJsonl(path.join(outDir, "e2_pilot_scope_top10.rows.jsonl"), selected);
  await writeJsonl(path.join(outDir, "e2_pilot_scope_filtered_out.jsonl"), filteredOut);

  console.log("[select-e2-pilot-scope] completed");
  console.log(JSON.stringify({ outDir, pass, selectedRows: selected.length, targetSize }, null, 2));

  if (!pass) process.exit(2);
};

main().catch((error) => {
  console.error("[select-e2-pilot-scope] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

