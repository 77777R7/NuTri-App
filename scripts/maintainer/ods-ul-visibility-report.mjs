#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(`--${flag}`);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

if (hasFlag("help")) {
  console.log(`Usage:
  node scripts/maintainer/ods-ul-visibility-report.mjs [options]

Options:
  --barcodes-file <path>      Barcode fixture file (default: scripts/maintainer/fixtures/ods_ul_visibility_barcodes.v1.json)
  --out-dir <path>            Output directory (default: output/ods-ul-visibility/<timestamp>)
  --api-base-url <url>        API base URL (default: API_BASE_URL/RENDER_BASE_URL/http://127.0.0.1:3001)
  --sse-timeout-ms <ms>       SSE timeout per barcode (default: 45000)
`);
  process.exit(0);
}

const API_BASE_URL =
  getArg("api-base-url") ||
  process.env.API_BASE_URL ||
  process.env.RENDER_BASE_URL ||
  "http://127.0.0.1:3001";
const barcodesFileArg =
  getArg("barcodes-file") || path.join("scripts", "maintainer", "fixtures", "ods_ul_visibility_barcodes.v1.json");
const BARCODES_FILE = path.isAbsolute(barcodesFileArg)
  ? barcodesFileArg
  : path.join(ROOT_DIR, barcodesFileArg);
const outDirArg = getArg("out-dir") || path.join("output", "ods-ul-visibility", nowTag);
const OUT_DIR = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
const REPORT_JSON_PATH = path.join(OUT_DIR, "ods_ul_visibility_report.json");
const REPORT_MD_PATH = path.join(OUT_DIR, "ods_ul_visibility_report.md");
const SSE_TIMEOUT_MS = Number(getArg("sse-timeout-ms") || process.env.ODS_UL_VIS_SSE_TIMEOUT_MS || 45000);

const REGRESSION_TOKEN = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";
const SSE_HEADERS = {
  "Content-Type": "application/json",
  Accept: "text/event-stream",
  ...(REGRESSION_TOKEN ? { "x-regression-token": REGRESSION_TOKEN } : { "x-auth-disabled": "1" }),
};
const SCORE_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "x-auth-disabled": "1",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toGtin14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 14) return digits;
  if (digits.length === 13) return `0${digits}`;
  if (digits.length === 12) return `00${digits}`;
  return digits;
};

const safeJson = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeBarcodes = (raw) => {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (!isRecord(item)) return null;
        const barcode = toGtin14(item.barcode);
        if (!barcode) return null;
        return {
          barcode,
          expectedSource: typeof item.expectedSource === "string" ? item.expectedSource : null,
          note: typeof item.note === "string" ? item.note : null,
        };
      })
      .filter(Boolean);
  }
  if (isRecord(raw) && Array.isArray(raw.barcodes)) {
    return normalizeBarcodes(raw.barcodes);
  }
  return [];
};

const parseMissingReasonCounts = (value) => {
  if (!isRecord(value)) return null;
  const read = (key) =>
    typeof value[key] === "number" && Number.isFinite(value[key]) ? Math.max(0, Number(value[key])) : 0;
  return {
    noUlEstablished: read("noUlEstablished"),
    canonicalAliasMiss: read("canonicalAliasMiss"),
    unitConversionUncertain: read("unitConversionUncertain"),
    legacyFallbackUsed: read("legacyFallbackUsed"),
  };
};

const extractUlPayload = (scoreResponse) => {
  if (!isRecord(scoreResponse) || scoreResponse.status !== "ok") {
    return {
      hasUlEntries: false,
      entries: [],
      missingUlCount: null,
      missingReasonCounts: null,
      webDisplayEligible: true,
      source: null,
    };
  }
  const bundle = scoreResponse.bundle;
  const explain = isRecord(bundle?.explain) ? bundle.explain : null;
  const ulWarnings = isRecord(explain?.ulWarnings) ? explain.ulWarnings : null;
  const entriesRaw = Array.isArray(ulWarnings?.entries) ? ulWarnings.entries : [];
  const entries = entriesRaw
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const sourceUrl = typeof entry.sourceUrl === "string" ? entry.sourceUrl.trim() : null;
      return {
        ingredientCanonicalKey:
          typeof entry.ingredientCanonicalKey === "string" ? entry.ingredientCanonicalKey : null,
        displayName: typeof entry.displayName === "string" ? entry.displayName : "Ingredient",
        currentDose: typeof entry.currentDose === "string" ? entry.currentDose : null,
        ulLimit: typeof entry.ulLimit === "string" ? entry.ulLimit : null,
        scope: typeof entry.scope === "string" ? entry.scope : null,
        scopeNote: typeof entry.scopeNote === "string" ? entry.scopeNote : null,
        reasonCode: typeof entry.reasonCode === "string" ? entry.reasonCode : null,
        confidence:
          typeof entry.confidence === "number" && Number.isFinite(entry.confidence)
            ? Number(entry.confidence)
            : null,
        riskLevel: typeof entry.riskLevel === "string" ? entry.riskLevel : null,
        sourceUrl,
        sourceLabel:
          sourceUrl && /ods\.od\.nih\.gov/i.test(sourceUrl)
            ? "NIH ODS (Health Professional Fact Sheet)"
            : sourceUrl
              ? "UL reference"
              : null,
      };
    })
    .filter(Boolean);
  return {
    hasUlEntries: entries.length > 0,
    entries,
    missingUlCount:
      typeof ulWarnings?.missingUlCount === "number" && Number.isFinite(ulWarnings.missingUlCount)
        ? Number(ulWarnings.missingUlCount)
        : null,
    missingReasonCounts: parseMissingReasonCounts(ulWarnings?.missingReasonCounts),
    webDisplayEligible:
      typeof ulWarnings?.webDisplayEligible === "boolean" ? ulWarnings.webDisplayEligible : true,
    source: typeof ulWarnings?.source === "string" ? ulWarnings.source : null,
  };
};

const fetchScoreBundle = async (source, sourceId) => {
  const encodedSource = encodeURIComponent(source);
  const encodedId = encodeURIComponent(sourceId);
  const res = await fetch(`${API_BASE_URL}/api/score/v4/${encodedSource}/${encodedId}`, {
    method: "GET",
    headers: SCORE_HEADERS,
  });
  const body = await res.json().catch(() => null);
  return {
    httpStatus: res.status,
    response: body,
  };
};

const runEnrichStream = async (barcode) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SSE_TIMEOUT_MS);
  const startedAt = Date.now();
  let rev0Ms = null;
  let rev1Ms = null;
  let doneMs = null;
  let doneSeen = false;
  let requestId = null;
  let sourceType = null;
  let sourceTypeFinal = null;
  let identityType = null;
  let identityValue = null;
  let lastErrorCode = null;
  let lastErrorReasonCode = null;

  try {
    const res = await fetch(`${API_BASE_URL}/api/enrich-stream`, {
      method: "POST",
      headers: SSE_HEADERS,
      body: JSON.stringify({ barcode }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        barcode,
        httpStatus: res.status,
        error: `http_${res.status}:${text.slice(0, 160)}`,
      };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;
    let currentData = "";

    const flushEvent = () => {
      if (!currentEvent) return;
      const raw = currentData.trim();
      if (!raw) {
        currentEvent = null;
        currentData = "";
        return;
      }
      let data = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        // keep raw
      }
      const tMs = Date.now() - startedAt;
      if (!requestId && isRecord(data)) {
        requestId =
          (typeof data.requestId === "string" && data.requestId) ||
          (typeof data.request_id === "string" && data.request_id) ||
          (typeof data.meta?.requestId === "string" && data.meta.requestId) ||
          null;
      }
      if (currentEvent === "analysis_bundle" && isRecord(data) && isRecord(data.meta)) {
        const revision = Number(data.meta.revision);
        if (revision === 0 && rev0Ms == null) rev0Ms = tMs;
        if (revision >= 1) {
          if (rev1Ms == null) rev1Ms = tMs;
          sourceType =
            typeof data.meta.sourceType === "string" ? data.meta.sourceType : sourceType;
          sourceTypeFinal =
            typeof data.meta.sourceTypeFinal === "boolean" ? data.meta.sourceTypeFinal : sourceTypeFinal;
          identityType =
            typeof data.meta.authoritativeIdentity?.type === "string"
              ? data.meta.authoritativeIdentity.type
              : identityType;
          identityValue =
            typeof data.meta.authoritativeIdentity?.value === "string"
              ? data.meta.authoritativeIdentity.value
              : identityValue;
        }
      }
      if (currentEvent === "error" && isRecord(data)) {
        lastErrorCode = typeof data.code === "string" ? data.code : lastErrorCode;
        lastErrorReasonCode =
          typeof data.reasonCode === "string" ? data.reasonCode : lastErrorReasonCode;
      }
      if (currentEvent === "done") {
        doneSeen = true;
        doneMs = tMs;
      }
      currentEvent = null;
      currentData = "";
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) {
          flushEvent();
          continue;
        }
        if (line.startsWith("event:")) currentEvent = line.slice("event:".length).trim();
        if (line.startsWith("data:")) currentData += line.slice("data:".length).trim();
      }
      if (rev1Ms != null) {
        await reader.cancel().catch(() => undefined);
        break;
      }
      if (doneSeen) break;
    }
    flushEvent();

    return {
      ok: true,
      barcode,
      requestId,
      rev0Ms,
      rev1Ms,
      doneMs,
      doneSeen,
      sourceType,
      sourceTypeFinal,
      identityType,
      identityValue,
      terminalCode: doneSeen ? "DONE" : lastErrorCode ?? null,
      errorReasonCode: lastErrorReasonCode,
    };
  } catch (error) {
    return {
      ok: false,
      barcode,
      requestId,
      rev0Ms,
      rev1Ms,
      doneMs,
      doneSeen,
      sourceType,
      sourceTypeFinal,
      identityType,
      identityValue,
      terminalCode: "REQUEST_ERROR",
      errorReasonCode: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# ODS UL Visibility Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- API Base: ${report.apiBaseUrl}`);
  lines.push(`- Fixture: ${report.fixturePath}`);
  lines.push(`- Total barcodes: ${report.summary.totalBarcodes}`);
  lines.push(`- UL guidance rows: ${report.summary.ulGuidanceCount} (${(report.summary.ulGuidanceRate * 100).toFixed(1)}%)`);
  lines.push(`- scope!=total_intake rows: ${report.summary.scopeNonTotalCount}`);
  lines.push(`- unit_conversion_uncertain_rate: ${(report.summary.unitConversionUncertainRate * 100).toFixed(1)}%`);
  lines.push(`- web_unverified_entries_shown_count: ${report.summary.webUnverifiedEntriesShownCount}`);
  lines.push("");
  lines.push("## Missing Reasons");
  lines.push("");
  lines.push(`- noUlEstablished: ${report.summary.missingReasonCounts.noUlEstablished}`);
  lines.push(`- canonicalAliasMiss: ${report.summary.missingReasonCounts.canonicalAliasMiss}`);
  lines.push(`- unitConversionUncertain: ${report.summary.missingReasonCounts.unitConversionUncertain}`);
  lines.push(`- legacyFallbackUsed: ${report.summary.missingReasonCounts.legacyFallbackUsed}`);
  lines.push("");
  lines.push("## Per Barcode");
  lines.push("");
  for (const row of report.rows) {
    lines.push(
      `- ${row.barcode} source=${row.enrich.sourceType ?? "unknown"} score=${row.score.status ?? "unknown"} entries=${row.hasUlEntries ? row.entries.length : 0} scopeNonTotal=${row.scopeNonTotal}`,
    );
    if (row.entries.length > 0) {
      row.entries.slice(0, 2).forEach((entry) => {
        lines.push(
          `  - ${entry.displayName}: scope=${entry.scope ?? "n/a"} reason=${entry.reasonCode ?? "n/a"} confidence=${entry.confidence ?? "n/a"}`,
        );
      });
    } else {
      const reasons = row.missingReasonCounts;
      if (reasons) {
        lines.push(
          `  - missingReasons: noUl=${reasons.noUlEstablished} aliasMiss=${reasons.canonicalAliasMiss} uncertain=${reasons.unitConversionUncertain} legacy=${reasons.legacyFallbackUsed}`,
        );
      }
    }
  }
  lines.push("");
  return `${lines.join("\n").trim()}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const fixtureRaw = await safeJson(BARCODES_FILE);
  const barcodes = normalizeBarcodes(fixtureRaw);
  if (!barcodes.length) {
    throw new Error(`No valid barcodes in fixture: ${BARCODES_FILE}`);
  }

  const rows = [];
  for (const item of barcodes) {
    console.log(`[ods-ul-visibility] scanning barcode=${item.barcode}`);
    // eslint-disable-next-line no-await-in-loop
    const enrich = await runEnrichStream(item.barcode);
    let score = {
      status: null,
      httpStatus: null,
      reasonCode: null,
      source: enrich.sourceType,
      sourceId: enrich.identityValue,
      message: null,
      error: null,
    };
    let ul = {
      hasUlEntries: false,
      entries: [],
      missingUlCount: null,
      missingReasonCounts: null,
      webDisplayEligible: true,
      source: null,
    };

    if (enrich.ok && enrich.sourceType && enrich.identityValue) {
      // eslint-disable-next-line no-await-in-loop
      const scoreResult = await fetchScoreBundle(enrich.sourceType, enrich.identityValue);
      const response = scoreResult.response;
      score = {
        status: isRecord(response) && typeof response.status === "string" ? response.status : null,
        httpStatus: scoreResult.httpStatus,
        reasonCode: isRecord(response) && typeof response.reasonCode === "string" ? response.reasonCode : null,
        source: enrich.sourceType,
        sourceId: enrich.identityValue,
        message: isRecord(response) && typeof response.message === "string" ? response.message : null,
        error: null,
      };
      ul = extractUlPayload(response);
    } else {
      score.error = enrich.error ?? "enrich_failed";
    }

    const scopeNonTotal = ul.entries.some((entry) => entry.scope && entry.scope !== "total_intake");
    const webUnverifiedEntriesShown =
      enrich.sourceType === "web" && ul.webDisplayEligible && ul.entries.length > 0;
    rows.push({
      barcode: item.barcode,
      expectedSource: item.expectedSource,
      note: item.note,
      enrich: {
        ok: enrich.ok,
        requestId: enrich.requestId ?? null,
        sourceType: enrich.sourceType ?? null,
        sourceTypeFinal: enrich.sourceTypeFinal ?? null,
        identityType: enrich.identityType ?? null,
        identityValue: enrich.identityValue ?? null,
        terminalCode: enrich.terminalCode ?? null,
        errorReasonCode: enrich.errorReasonCode ?? null,
        error: enrich.error ?? null,
        rev0Ms: enrich.rev0Ms ?? null,
        rev1Ms: enrich.rev1Ms ?? null,
        doneMs: enrich.doneMs ?? null,
      },
      score,
      hasUlEntries: ul.hasUlEntries,
      entries: ul.entries,
      missingUlCount: ul.missingUlCount,
      missingReasonCounts: ul.missingReasonCounts,
      webDisplayEligible: ul.webDisplayEligible,
      ulSource: ul.source,
      scopeNonTotal,
      webUnverifiedEntriesShown,
    });
    await sleep(80);
  }

  const ulGuidanceRows = rows.filter((row) => row.hasUlEntries);
  const allEntries = rows.flatMap((row) => row.entries);
  const uncertainEntries = allEntries.filter((entry) => entry.reasonCode === "UNIT_CONVERSION_UNCERTAIN");
  const missingReasonCounts = rows.reduce(
    (acc, row) => {
      if (!row.missingReasonCounts) return acc;
      acc.noUlEstablished += row.missingReasonCounts.noUlEstablished;
      acc.canonicalAliasMiss += row.missingReasonCounts.canonicalAliasMiss;
      acc.unitConversionUncertain += row.missingReasonCounts.unitConversionUncertain;
      acc.legacyFallbackUsed += row.missingReasonCounts.legacyFallbackUsed;
      return acc;
    },
    {
      noUlEstablished: 0,
      canonicalAliasMiss: 0,
      unitConversionUncertain: 0,
      legacyFallbackUsed: 0,
    },
  );

  const summary = {
    totalBarcodes: rows.length,
    ulGuidanceCount: ulGuidanceRows.length,
    ulGuidanceRate: rows.length > 0 ? ulGuidanceRows.length / rows.length : 0,
    scopeNonTotalCount: rows.filter((row) => row.scopeNonTotal).length,
    unitConversionUncertainRate: allEntries.length > 0 ? uncertainEntries.length / allEntries.length : 0,
    webUnverifiedEntriesShownCount: rows.filter((row) => row.webUnverifiedEntriesShown).length,
    missingReasonCounts,
    statusBreakdown: rows.reduce((acc, row) => {
      const key = row.score.status || "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    sourceBreakdown: rows.reduce((acc, row) => {
      const key = row.enrich.sourceType || "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl: API_BASE_URL,
    fixturePath: BARCODES_FILE,
    outDir: OUT_DIR,
    summary,
    rows,
  };

  await fs.writeFile(REPORT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(REPORT_MD_PATH, toMarkdown(report), "utf8");

  console.log(`[ods-ul-visibility] wrote ${REPORT_JSON_PATH}`);
  console.log(`[ods-ul-visibility] wrote ${REPORT_MD_PATH}`);
  console.log(
    `[ods-ul-visibility] ulGuidance=${summary.ulGuidanceCount}/${summary.totalBarcodes} scopeNonTotal=${summary.scopeNonTotalCount} uncertainRate=${summary.unitConversionUncertainRate.toFixed(3)}`,
  );
};

main().catch((error) => {
  console.error("[ods-ul-visibility] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
