#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.join(process.cwd(), "backend/.env") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const asNumber = (value, fallback) => {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const apiBaseUrl = getArg("api-base-url") || process.env.API_BASE_URL || "http://127.0.0.1:3001";
const driftFile = getArg("drift-file") || null;
const driftCount = Math.max(1, asNumber(getArg("drift-count"), 11));
const randomCount = Math.max(0, asNumber(getArg("random-count"), 50));
const timeoutMs = Math.max(5000, asNumber(getArg("timeout-ms"), 25000));
const concurrency = Math.max(1, Math.min(20, asNumber(getArg("concurrency"), 6)));
const outDir =
  getArg("out-dir") ||
  path.join(process.cwd(), "output/maintainer-gates", `candidate-guard-${new Date().toISOString().replace(/[:]/g, "-")}`);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 14) return digits;
  if (digits.length === 13) return `0${digits}`;
  if (digits.length === 12) return `00${digits}`;
  return null;
};

const loadDriftBarcodes = () => {
  if (!driftFile || !fs.existsSync(driftFile)) return [];
  const raw = fs.readFileSync(driftFile, "utf8");
  const rows = [];

  const tryPush = (value) => {
    const normalized = normalizeBarcode(value);
    if (normalized) rows.push(normalized);
  };

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === "string" || typeof item === "number") tryPush(item);
        else if (item && typeof item === "object") tryPush(item.barcode || item.barcode_gtin14);
      }
    } else if (parsed && typeof parsed === "object") {
      const keys = ["repairQueue", "rows", "barcodes", "items"];
      for (const key of keys) {
        const arr = parsed[key];
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          if (typeof item === "string" || typeof item === "number") tryPush(item);
          else if (item && typeof item === "object") tryPush(item.barcode || item.barcode_gtin14);
        }
      }
    }
  } catch {
    for (const line of raw.split(/\r?\n/)) {
      const text = line.trim();
      if (!text) continue;
      tryPush(text);
    }
  }

  return Array.from(new Set(rows)).slice(0, driftCount);
};

const loadRandomBarcodes = async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || randomCount <= 0) return [];
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("barcode_regulatory_map")
    .select("barcode_gtin14")
    .is("expires_at", null)
    .limit(3000);
  if (error || !Array.isArray(data)) return [];
  const candidates = data
    .map((row) => normalizeBarcode(row.barcode_gtin14))
    .filter(Boolean);
  const uniq = Array.from(new Set(candidates));
  for (let i = uniq.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [uniq[i], uniq[j]] = [uniq[j], uniq[i]];
  }
  return uniq.slice(0, randomCount);
};

const fetchSseMeta = async (barcode) => {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  const deadlineAt = Date.now() + timeoutMs;
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/enrich-stream`;

  const payload = { barcode };
  const headers = {
    "content-type": "application/json",
    accept: "text/event-stream",
    "x-auth-disabled": "1",
  };

  let doneSeen = false;
  let errorEvent = null;
  let lastMeta = null;
  let lastBundle = null;
  let buffer = "";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      return { barcode, ok: false, error: `http_${res.status}`, doneSeen, meta: null };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    const handleFrame = (frame) => {
      const lines = frame.split(/\r?\n/);
      let eventType = "message";
      const dataLines = [];
      for (const line of lines) {
        if (line.startsWith("event:")) eventType = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      const rawData = dataLines.join("\n");
      let parsed = null;
      if (rawData) {
        try {
          parsed = JSON.parse(rawData);
        } catch {
          parsed = null;
        }
      }

      if (eventType === "analysis_bundle" && parsed && typeof parsed === "object") {
        lastBundle = parsed;
        lastMeta = parsed.meta ?? null;
      }
      if (eventType === "done") {
        doneSeen = true;
      }
      if (eventType === "error") {
        errorEvent = parsed ?? rawData ?? "error_event";
      }
    };

    while (true) {
      if (Date.now() > deadlineAt) {
        try {
          await reader.cancel("timeout");
        } catch {
          // ignore reader cancellation failure
        }
        return { barcode, ok: false, error: "timeout", doneSeen, meta: lastMeta, bundle: lastBundle };
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (!boundary) break;
        const idx = boundary.index;
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + boundary[0].length);
        if (frame.trim()) handleFrame(frame);
      }
      if (doneSeen) break;
    }

    return { barcode, ok: true, doneSeen, errorEvent, meta: lastMeta, bundle: lastBundle };
  } catch (error) {
    const msg = error?.name === "AbortError" ? "timeout" : error?.message || "fetch_error";
    return { barcode, ok: false, error: msg, doneSeen, meta: lastMeta };
  } finally {
    clearTimeout(timeout);
  }
};

const classify = (row) => {
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  const npnCandidates = Array.isArray(meta?.regulatoryIds?.npnCandidates) ? meta.regulatoryIds.npnCandidates : [];
  const candidateBackfill = meta?.candidateBackfill && typeof meta.candidateBackfill === "object" ? meta.candidateBackfill : null;
  const sourceTypeFinal = Boolean(meta?.sourceTypeFinal);
  const scoreAvailable = meta?.scoreAvailable;
  const scoreReasonCode = typeof meta?.scoreReasonCode === "string" ? meta.scoreReasonCode : null;

  const visible = npnCandidates.length > 0;
  const used = Boolean(candidateBackfill?.used);
  const rejected = !used && ["CANDIDATE_IDENTITY_MISMATCH", "CANDIDATE_LOOKUP_TIMEOUT", "CANDIDATE_LOOKUP_NOT_FOUND"].includes(String(candidateBackfill?.reasonCode ?? ""));
  const suppressed = used && !sourceTypeFinal && scoreAvailable === false && scoreReasonCode === "CANDIDATE_MATCH_NOT_FINAL";
  const violation = used && !sourceTypeFinal && scoreAvailable !== false;
  const successBackfill = used;

  return {
    visible,
    used,
    rejected,
    suppressed,
    violation,
    successBackfill,
    sourceTypeFinal,
    scoreAvailable,
    scoreReasonCode,
    candidateBackfill,
    npnCandidatesCount: npnCandidates.length,
  };
};

const main = async () => {
  const driftBarcodes = loadDriftBarcodes();
  const randomBarcodes = await loadRandomBarcodes();

  const allBarcodes = Array.from(new Set([...driftBarcodes, ...randomBarcodes]));
  const sampleTypeByBarcode = new Map([
    ...driftBarcodes.map((barcode) => [barcode, "drift"]),
    ...randomBarcodes.map((barcode) => [barcode, "random"]),
  ]);
  const pending = [...allBarcodes];
  const rows = [];
  const workerCount = Math.min(concurrency, pending.length || 1);

  const worker = async () => {
    while (pending.length > 0) {
      const barcode = pending.shift();
      if (!barcode) break;
      // eslint-disable-next-line no-await-in-loop
      const result = await fetchSseMeta(barcode);
      const klass = classify(result);
      rows.push({
        barcode,
        sampleType: sampleTypeByBarcode.get(barcode) ?? "random",
        ok: result.ok,
        doneSeen: result.doneSeen,
        error: result.error ?? null,
        ...klass,
      });
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  rows.sort((a, b) => a.barcode.localeCompare(b.barcode));

  const summary = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl,
    settings: {
      driftCount,
      randomCount,
      timeoutMs,
      concurrency: workerCount,
    },
    totals: {
      requested: allBarcodes.length,
      drift: driftBarcodes.length,
      random: randomBarcodes.length,
      ok: rows.filter((row) => row.ok).length,
      doneSeen: rows.filter((row) => row.doneSeen).length,
      visible: rows.filter((row) => row.visible).length,
      suppressed: rows.filter((row) => row.suppressed).length,
      rejected: rows.filter((row) => row.rejected).length,
      successBackfill: rows.filter((row) => row.successBackfill).length,
      violations: rows.filter((row) => row.violation).length,
    },
    violationsCount: rows.filter((row) => row.violation).length,
    rows,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "candidate_backfill_guard_report.json");
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ ok: true, outDir, jsonPath, totals: summary.totals }, null, 2));
};

main().catch((error) => {
  console.error("[validate-candidate-backfill-guard] fatal:", error?.message ?? error);
  process.exit(1);
});
