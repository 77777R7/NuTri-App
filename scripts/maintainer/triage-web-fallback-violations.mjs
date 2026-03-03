#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT_DIR = process.cwd();
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(`--${flag}`);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  if (digits.length >= 8) return digits.padStart(14, "0");
  return null;
};

const readJson = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
};

const findLatestGateReport = async () => {
  const outputRoot = path.join(ROOT_DIR, "output");
  let entries = [];
  try {
    entries = await fs.readdir(outputRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const reportPath = path.join(outputRoot, entry.name, "gate_full_report.json");
    try {
      const stat = await fs.stat(reportPath);
      candidates.push({ reportPath, mtimeMs: stat.mtimeMs });
    } catch {
      // ignore
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.reportPath ?? null;
};

const parseSseProbe = async ({ apiBaseUrl, barcode, timeoutMs, cacheMode }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "x-auth-disabled": "1",
    "x-probe-cache-mode": cacheMode,
    "cache-control": cacheMode === "cold" ? "no-cache" : "max-age=0",
  };
  const startedAt = Date.now();
  let latestBundle = null;
  let donePayload = null;
  let errorPayload = null;
  let requestId = null;

  try {
    const response = await fetch(`${apiBaseUrl}/api/enrich-stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({ barcode, streamMode: "analysis_bundle_only", probeNonce: `${Date.now()}-${Math.random()}` }),
      signal: controller.signal,
    });
    requestId = response.headers.get("x-request-id");
    if (!response.ok || !response.body) {
      return {
        ok: false,
        terminal: "HTTP_ERROR",
        status: response.status,
        requestId,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";
    let dataLines = [];

    const flush = () => {
      if (!dataLines.length) return;
      const dataRaw = dataLines.join("\n");
      dataLines = [];
      let payload = null;
      try {
        payload = JSON.parse(dataRaw);
      } catch {
        payload = null;
      }
      if (currentEvent === "analysis_bundle" && payload && typeof payload === "object") {
        latestBundle = payload;
      } else if (currentEvent === "done") {
        donePayload = payload;
      } else if (currentEvent === "error") {
        errorPayload = payload;
      }
      currentEvent = "message";
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) {
          flush();
          continue;
        }
        if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        if (line.startsWith("id:")) requestId = line.slice(3).trim() || requestId;
      }
    }
    if (buffer.trim()) flush();
    return {
      ok: true,
      terminal: donePayload ? "DONE" : errorPayload ? "ERROR" : "STREAM_END",
      requestId,
      elapsedMs: Date.now() - startedAt,
      sourceType: latestBundle?.sourceType ?? null,
      sourceTypeFinal:
        typeof latestBundle?.sourceTypeFinal === "boolean" ? latestBundle.sourceTypeFinal : null,
      identityType: latestBundle?.identity?.type ?? null,
      identityValue: latestBundle?.identity?.value ?? null,
      terminalReason:
        donePayload?.terminalReason
        ?? donePayload?.meta?.terminalReason
        ?? errorPayload?.reasonCode
        ?? null,
      authoritativeFinalHint:
        isAuthoritativeSourceAttribution(donePayload?.productIdentity?.sourceAttribution)
        || isAuthoritativeSourceAttribution(latestBundle?.productIdentity?.sourceAttribution),
      donePayload,
      errorPayload,
    };
  } catch (error) {
    return {
      ok: false,
      terminal: "REQUEST_ERROR",
      error: error instanceof Error ? error.message : String(error),
      requestId,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
};

export const classifyWebFallbackTriage = (attempts) => {
  const rows = Array.isArray(attempts) ? attempts : [];
  const authoritativeFinal = rows.some(
    (row) =>
      row?.authoritativeFinalHint === true
      || (
        row?.sourceTypeFinal === true
        && (row?.sourceType === "dsld" || row?.sourceType === "lnhpd")
      ),
  );
  const webFinal = rows.every((row) => {
    const sourceType = String(row?.sourceType ?? "").trim().toLowerCase();
    if (row?.sourceTypeFinal === true) return sourceType === "web";
    return sourceType === "web" || sourceType === "" || sourceType === "unknown";
  });
  if (authoritativeFinal) return "A_authoritative_possible";
  if (webFinal) return "B_expected_web_only";
  return "unknown";
};

const main = async () => {
  if (hasFlag("help")) {
    console.log(`Usage:
  node scripts/maintainer/triage-web-fallback-violations.mjs [options]

Options:
  --gate-report <path>      gate_full_report.json (default: latest in output)
  --api-base-url <url>      backend URL (default: API_BASE_URL or http://127.0.0.1:3001)
  --barcode <gtin14>        only triage this barcode (repeatable via comma)
  --out-dir <path>          output directory (default: gate report dir)
  --timeout-ms <ms>         per probe timeout (default: 30000)
`);
    process.exit(0);
  }

  const apiBaseUrl = (getArg("api-base-url") || process.env.API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
  const gateReportArg = getArg("gate-report");
  const gateReportPath = gateReportArg
    ? (path.isAbsolute(gateReportArg) ? gateReportArg : path.join(ROOT_DIR, gateReportArg))
    : await findLatestGateReport();
  const timeoutMs = Number(getArg("timeout-ms") || process.env.WEB_FALLBACK_TRIAGE_TIMEOUT_MS || 30000);
  const barcodeArg = getArg("barcode");
  const explicitBarcodes = barcodeArg
    ? barcodeArg.split(",").map((value) => normalizeBarcode(value)).filter(Boolean)
    : [];
  const report = await readJson(gateReportPath);
  if (!gateReportPath || !report) throw new Error(`gate_report_not_found:${gateReportPath ?? "none"}`);
  const outDirArg = getArg("out-dir") || path.dirname(gateReportPath);
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
  await fs.mkdir(outDir, { recursive: true });

  const violations = Array.isArray(report?.sourceTypeFinalViolations) ? report.sourceTypeFinalViolations : [];
  const webFallbackRows = violations.filter((row) => row?.bucket === "allowed_web_fallback");
  const barcodeSet = new Set(explicitBarcodes);
  for (const row of webFallbackRows) {
    const barcode = normalizeBarcode(row?.barcode);
    if (barcode) barcodeSet.add(barcode);
  }
  const barcodes = [...barcodeSet];

  const triageRows = [];
  const dataMappingQueue = [];
  const webOnlyQueue = [];
  for (const barcode of barcodes) {
    const attempts = [];
    const plan = ["cold", "warm", "warm"];
    for (const cacheMode of plan) {
      attempts.push(await parseSseProbe({ apiBaseUrl, barcode, timeoutMs, cacheMode }));
    }
    const classification = classifyWebFallbackTriage(attempts);
    const row = {
      barcode,
      classification,
      attempts,
      sourceTypeSet: [...new Set(attempts.map((item) => item?.sourceType).filter(Boolean))],
      finalTrueCount: attempts.filter((item) => item?.sourceTypeFinal === true).length,
      generatedAt: new Date().toISOString(),
    };
    triageRows.push(row);
    if (classification === "A_authoritative_possible") {
      dataMappingQueue.push({
        barcode,
        queue: "data_mapping_queue",
        reason: "authoritative_possible_after_probe",
        attempts: attempts.map((item) => ({
          terminal: item.terminal,
          sourceType: item.sourceType ?? null,
          sourceTypeFinal: item.sourceTypeFinal ?? null,
          requestId: item.requestId ?? null,
          terminalReason: item.terminalReason ?? null,
        })),
      });
    } else if (classification === "B_expected_web_only") {
      webOnlyQueue.push({
        barcode,
        expectedSourceType: "web",
        expectedScoreAvailable: false,
        reviewedAt: new Date().toISOString().slice(0, 10),
        reviewAfterDays: 30,
        notes: "triage-web-fallback-violations classified as expected web-only",
      });
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl,
    gateReportPath,
    triagedCount: triageRows.length,
    triageRows,
    summary: {
      authoritativePossibleCount: triageRows.filter((row) => row.classification === "A_authoritative_possible").length,
      expectedWebOnlyCount: triageRows.filter((row) => row.classification === "B_expected_web_only").length,
      unknownCount: triageRows.filter((row) => row.classification === "unknown").length,
    },
  };

  const reportPath = path.join(outDir, "web_fallback_triage_report.json");
  const mappingQueuePath = path.join(outDir, "web_fallback_data_mapping_queue.jsonl");
  const webOnlyQueuePath = path.join(outDir, "web_fallback_web_only_queue.jsonl");
  await fs.writeFile(reportPath, JSON.stringify(output, null, 2), "utf8");
  await fs.writeFile(
    mappingQueuePath,
    dataMappingQueue.map((row) => JSON.stringify(row)).join("\n") + (dataMappingQueue.length ? "\n" : ""),
    "utf8",
  );
  await fs.writeFile(
    webOnlyQueuePath,
    webOnlyQueue.map((row) => JSON.stringify(row)).join("\n") + (webOnlyQueue.length ? "\n" : ""),
    "utf8",
  );

  console.log(`[triage-web-fallback] wrote ${reportPath}`);
  console.log(`[triage-web-fallback] wrote ${mappingQueuePath}`);
  console.log(`[triage-web-fallback] wrote ${webOnlyQueuePath}`);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[triage-web-fallback] failed", message);
    process.exit(1);
  });
}
  const isAuthoritativeSourceAttribution = (value) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized === "verified_regulatory" || normalized === "label_record";
  };
