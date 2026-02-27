#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(`--${flag}`);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

if (hasFlag("help")) {
  console.log(`Usage:
  node scripts/maintainer/write-policy-shadow-report.mjs [options]

Options:
  --api-base-url <url>   API base URL (default: API_BASE_URL or http://127.0.0.1:3001)
  --out-dir <path>       Output directory (default: output/maintainer-gates/<timestamp>)
  --window-hours <n>     Candidate fallback query window in hours (default: 48)
`);
  process.exit(0);
}

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const apiBaseUrl = (getArg("api-base-url") || process.env.API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const outDirArg = getArg("out-dir") || path.join("output", "maintainer-gates", nowTag);
const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
const outPath = path.join(outDir, "write_policy_shadow_report.json");
const windowHoursRaw = Number(getArg("window-hours") || process.env.WRITE_POLICY_SHADOW_WINDOW_HOURS || 48);
const windowHours = Number.isFinite(windowHoursRaw) && windowHoursRaw > 0 ? windowHoursRaw : 48;

const createDecisionMap = () => ({
  wouldBlock: 0,
  wouldUpgrade: 0,
  wouldReplaceSameRank: 0,
  wouldWriteCandidateOnly: 0,
});

const createBucketMap = () => ({
  wouldBlock: {},
  wouldUpgrade: {},
  wouldReplaceSameRank: {},
  wouldWriteCandidateOnly: {},
});

const ensureBucket = (candidate, fallback) => {
  if (!candidate || typeof candidate !== "object") return { ...fallback };
  return {
    ...fallback,
    ...candidate,
  };
};

const fetchMetricsReport = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${apiBaseUrl}/internal/metrics`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`metrics_http_${response.status}`);
    }
    const payload = await response.json();
    const policy = payload?.debug?.regulatoryWritePolicy ?? null;
    if (!policy) {
      throw new Error("regulatory_write_policy_metrics_missing");
    }

    const totals = ensureBucket(policy.totals, createDecisionMap());
    const sourceKind = ensureBucket(policy.bySourceKind, createBucketMap());
    const incomingRank = ensureBucket(policy.byIncomingRank, createBucketMap());
    const reason = ensureBucket(policy.byReason, createBucketMap());
    const recent = Array.isArray(policy.recent) ? policy.recent : [];

    return {
      source: "internal_metrics",
      summary: totals,
      buckets: {
        sourceKind,
        incomingRank,
        reason,
      },
      recent,
    };
  } finally {
    clearTimeout(timer);
  }
};

const fetchCandidatesFallback = async () => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceKey) {
    throw new Error("supabase_credentials_missing_for_fallback");
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("barcode_regulatory_map_candidates")
    .select(
      "incoming_source,incoming_rank,reason_code,created_at",
    )
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    throw new Error(error.message || "candidates_fallback_query_failed");
  }

  const summary = createDecisionMap();
  const buckets = {
    sourceKind: createBucketMap(),
    incomingRank: createBucketMap(),
    reason: createBucketMap(),
  };
  const recent = [];

  for (const row of data ?? []) {
    const sourceKind = String(row?.incoming_source ?? "unknown").trim().toLowerCase() || "unknown";
    const incomingRank = Number.isFinite(Number(row?.incoming_rank)) ? String(Number(row.incoming_rank)) : "unknown";
    const reason = String(row?.reason_code ?? "unknown").trim() || "unknown";
    summary.wouldBlock += 1;
    summary.wouldWriteCandidateOnly += 1;
    buckets.sourceKind.wouldBlock[sourceKind] = (buckets.sourceKind.wouldBlock[sourceKind] ?? 0) + 1;
    buckets.sourceKind.wouldWriteCandidateOnly[sourceKind] = (buckets.sourceKind.wouldWriteCandidateOnly[sourceKind] ?? 0) + 1;
    buckets.incomingRank.wouldBlock[incomingRank] = (buckets.incomingRank.wouldBlock[incomingRank] ?? 0) + 1;
    buckets.incomingRank.wouldWriteCandidateOnly[incomingRank] =
      (buckets.incomingRank.wouldWriteCandidateOnly[incomingRank] ?? 0) + 1;
    buckets.reason.wouldBlock[reason] = (buckets.reason.wouldBlock[reason] ?? 0) + 1;
    buckets.reason.wouldWriteCandidateOnly[reason] = (buckets.reason.wouldWriteCandidateOnly[reason] ?? 0) + 1;
    if (recent.length < 50) {
      recent.push({
        at: row?.created_at ?? null,
        mode: "fallback_from_candidates",
        decision: "wouldBlock",
        sourceKind,
        incomingRank: Number.isFinite(Number(row?.incoming_rank)) ? Number(row.incoming_rank) : null,
        reason,
      });
    }
  }

  return {
    source: "supabase_candidates_fallback",
    summary,
    buckets,
    recent,
  };
};

const main = async () => {
  await fs.mkdir(outDir, { recursive: true });
  let details = null;
  let errorMessage = null;
  try {
    details = await fetchMetricsReport();
  } catch (metricsError) {
    errorMessage = metricsError instanceof Error ? metricsError.message : String(metricsError);
    try {
      details = await fetchCandidatesFallback();
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      errorMessage = `${errorMessage}; fallback_failed=${fallbackMessage}`;
      details = {
        source: "none",
        summary: createDecisionMap(),
        buckets: {
          sourceKind: createBucketMap(),
          incomingRank: createBucketMap(),
          reason: createBucketMap(),
        },
        recent: [],
      };
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl,
    windowHours,
    source: details.source,
    summary: details.summary,
    buckets: details.buckets,
    recent: details.recent,
    checks: {
      hasRequiredDecisionFields: ["wouldBlock", "wouldUpgrade", "wouldReplaceSameRank", "wouldWriteCandidateOnly"].every(
        (key) => Object.prototype.hasOwnProperty.call(details.summary, key),
      ),
      hasBucketGroups: ["sourceKind", "incomingRank", "reason"].every((key) =>
        Object.prototype.hasOwnProperty.call(details.buckets, key),
      ),
    },
    warning: errorMessage,
  };

  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[write-policy-shadow-report] wrote ${outPath}`);
  if (report.source === "none") {
    console.error("[write-policy-shadow-report] no live source available");
    process.exit(1);
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[write-policy-shadow-report] failed", message);
  process.exit(1);
});
