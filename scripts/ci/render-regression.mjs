#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const dsldNoFormBarcode =
  process.env.RENDER_DSLD_NOFORM_BARCODE || process.env.RENDER_DSLD_BARCODE || "026664275110";
const dsldWithFormBarcode = process.env.RENDER_DSLD_FORM_BARCODE || "00690290532093";
const dsldWithFormBarcode2 = process.env.RENDER_DSLD_FORM2_BARCODE || "00678226014301";
const dsldWithFormAscorbateBarcode = process.env.RENDER_DSLD_ASCORBATE_BARCODE || "00708118021602";
const dsldWithFormAscorbateBarcode2 = process.env.RENDER_DSLD_ASCORBATE_BARCODE2 || "00708118010262";

const DEFAULT_CASES = [
  { id: "lnhpd", barcodes: [process.env.RENDER_LNHPD_BARCODE || "00029537001069"], expectedSourceType: "lnhpd" },
  { id: "dsld_no_form", barcodes: [dsldNoFormBarcode], expectedSourceType: "dsld" },
  { id: "dsld_with_form", barcodes: [dsldWithFormBarcode], expectedSourceType: "dsld" },
  { id: "dsld_with_form_2", barcodes: [dsldWithFormBarcode2], expectedSourceType: "dsld" },
  {
    id: "dsld_with_form_ascorbate",
    barcodes: [dsldWithFormAscorbateBarcode, dsldWithFormAscorbateBarcode2],
    expectedSourceType: "dsld",
  },
  { id: "web", barcodes: [process.env.RENDER_WEB_BARCODE || "000000000000"], expectedSourceType: "web" },
];

const BASE_URL = process.env.RENDER_BASE_URL;
const SSE_TIMEOUT_MS = Number(process.env.RENDER_SSE_TIMEOUT_MS || 90_000);
const DETAIL_TIMEOUT_MS = Number(process.env.RENDER_DETAIL_TIMEOUT_MS || 45_000);
const ARTIFACT_DIR = process.env.RENDER_ARTIFACT_DIR || "artifacts/render-regression";
const DETAIL_LIMIT = Number(process.env.RENDER_DETAIL_LIMIT || 6);

if (!BASE_URL) {
  console.error("RENDER_BASE_URL is required");
  process.exit(1);
}

const buildHeaders = (acceptSse = false) => {
  const headers = {
    "Content-Type": "application/json",
  };
  if (acceptSse) headers.Accept = "text/event-stream";
  if (process.env.RENDER_REGRESSION_TOKEN) {
    headers["x-regression-token"] = process.env.RENDER_REGRESSION_TOKEN;
  } else if (process.env.RENDER_AUTH_DISABLED_HEADER) {
    headers["x-auth-disabled"] = process.env.RENDER_AUTH_DISABLED_HEADER;
  }
  return headers;
};

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

async function readSseEvents(barcode) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), SSE_TIMEOUT_MS);

  const res = await fetch(`${BASE_URL}/api/enrich-stream`, {
    method: "POST",
    headers: buildHeaders(true),
    body: JSON.stringify({ barcode }),
    signal: ctrl.signal,
  });

  if (!res.ok) {
    clearTimeout(timeout);
    throw new Error(`enrich-stream HTTP ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    clearTimeout(timeout);
    throw new Error("enrich-stream missing readable body");
  }

  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  let currentEvent = null;
  let currentDataLines = [];

  const flushEvent = () => {
    if (!currentEvent) return;
    const dataRaw = currentDataLines.join("\n").trim();
    if (!dataRaw) {
      currentEvent = null;
      currentDataLines = [];
      return;
    }

    let parsed = dataRaw;
    try {
      parsed = JSON.parse(dataRaw);
    } catch {
      // keep raw string for diagnostics
    }

    events.push({ event: currentEvent, data: parsed, rawData: dataRaw });
    currentEvent = null;
    currentDataLines = [];
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.length === 0) {
          flushEvent();
          continue;
        }
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          currentDataLines.push(line.slice(5).trimStart());
        }
      }
    }

    flushEvent();
    return events;
  } finally {
    clearTimeout(timeout);
    try {
      await reader.cancel();
    } catch {}
  }
}

function getBundleEvents(events) {
  return events
    .filter((entry) => entry.event === "analysis_bundle" && entry.data && typeof entry.data === "object")
    .map((entry) => entry.data);
}

function pickFastBundle(bundleEvents) {
  const withMeta = bundleEvents.filter((bundle) => bundle?.meta && typeof bundle.meta === "object");
  const byRevision = [...withMeta].sort((a, b) => (a.meta.revision ?? -1) - (b.meta.revision ?? -1));
  const fast = byRevision.find((bundle) => bundle?.meta?.revision === 1 && bundle?.meta?.phase === "fast_ai");
  if (fast) return fast;
  return byRevision.at(-1) ?? null;
}

function assertBundleContract(bundleEvents, expectedSourceType) {
  const errors = [];

  const hasSkeleton = bundleEvents.some(
    (bundle) => bundle?.meta?.revision === 0 && bundle?.meta?.phase === "skeleton"
  );
  if (!hasSkeleton) {
    errors.push("missing analysis_bundle revision=0 phase=skeleton");
  }

  const hasFast = bundleEvents.some(
    (bundle) => bundle?.meta?.revision === 1 && bundle?.meta?.phase === "fast_ai"
  );
  if (!hasFast) {
    errors.push("missing analysis_bundle revision=1 phase=fast_ai");
  }

  const fastBundle = pickFastBundle(bundleEvents);
  if (!fastBundle) {
    errors.push("missing analysis_bundle payload");
  } else if (fastBundle?.meta?.sourceType !== expectedSourceType) {
    errors.push(
      `unexpected sourceType ${String(fastBundle?.meta?.sourceType)} (expected ${expectedSourceType})`
    );
  }

  return { errors, fastBundle };
}

async function fetchIngredientsDetail(fastBundle) {
  const identity = fastBundle?.meta?.authoritativeIdentity;
  if (!identity?.type || !identity?.value) {
    throw new Error("analysis_bundle missing authoritativeIdentity");
  }

  const payload = {
    identity,
    section: "ingredients_detail",
    locale: fastBundle?.meta?.locale || "en",
    promptVersion: fastBundle?.meta?.promptVersion,
    factsDigestHash: fastBundle?.meta?.factsDigestHash,
    limit: DETAIL_LIMIT,
    cursor: 0,
  };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), DETAIL_TIMEOUT_MS);

  const res = await fetch(`${BASE_URL}/api/analysis-section`, {
    method: "POST",
    headers: buildHeaders(false),
    body: JSON.stringify(payload),
    signal: ctrl.signal,
  });

  clearTimeout(timeout);

  let json;
  try {
    json = await res.json();
  } catch {
    json = { parseError: "invalid_json" };
  }

  return { status: res.status, payload, response: json };
}

function assertDetailContract(detailResponse) {
  const errors = [];
  if (detailResponse.status !== 200) {
    errors.push(`analysis-section HTTP ${detailResponse.status}`);
    return errors;
  }

  const body = detailResponse.response;
  if (body?.section !== "ingredients") {
    errors.push(`analysis-section section=${String(body?.section)} (expected ingredients)`);
  }

  const dataStatus = body?.dataStatus;
  const allowedStatus = ["complete", "limited", "not_provided", "error", "pending"];
  if (!allowedStatus.includes(dataStatus)) {
    errors.push(`analysis-section invalid dataStatus=${String(dataStatus)}`);
  }

  if (dataStatus === "pending") {
    errors.push("analysis-section returned pending; expected terminal response");
  }

  return errors;
}

function assertDsldWithFormKbHit(detailResponse, caseId) {
  const errors = [];
  if (detailResponse.status !== 200) return errors;
  const body = detailResponse.response;

  const items = body?.detail?.items;
  if (!Array.isArray(items)) {
    errors.push(`${caseId}: analysis-section missing detail.items`);
    return errors;
  }

  // P0-A: Confirm a true KB sentence was used, not just a non-empty string.
  const hasKbSentence = items.some((item) => {
    const tags = item?.chemicalFormExplain?.basisTags;
    return Array.isArray(tags) && tags.includes("ingredient_inference");
  });
  if (!hasKbSentence) {
    errors.push(`${caseId}: expected at least one chemicalFormExplain tagged ingredient_inference (KB sentence)`);
  }

  // P0-2 (stronger): confirm sentenceId/excerptId is present (true KB hit, not rule text).
  const sentenceIds = body?.debug?.formSentenceIds;
  const hasSentenceId =
    sentenceIds && typeof sentenceIds === "object"
      ? Object.values(sentenceIds).some((value) => typeof value === "string" && value.startsWith("s_"))
      : false;
  if (!hasSentenceId) {
    errors.push(`${caseId}: expected at least one debug.formSentenceIds entry (true KB hit)`);
  }

  const sources = body?.debug?.formResolveSources;
  if (!sources || typeof sources !== "object") {
    errors.push(`${caseId}: missing debug.formResolveSources`);
    return errors;
  }
  const hasNonNone = Object.values(sources).some((value) => typeof value === "string" && value !== "none");
  if (!hasNonNone) {
    errors.push(`${caseId}: expected at least one formResolveSource != none`);
  }

  return errors;
}

function pickKeyFields(result) {
  const fastBundle = result.fastBundle;
  const detail = result.detailResponse?.response;
  const debug = detail?.debug;

  const formResolveSources =
    debug?.formResolveSources && typeof debug.formResolveSources === "object" ? debug.formResolveSources : null;
  const formSentenceIds =
    debug?.formSentenceIds && typeof debug.formSentenceIds === "object" ? debug.formSentenceIds : null;

  const nonNoneSources = formResolveSources
    ? Object.fromEntries(Object.entries(formResolveSources).filter(([, v]) => typeof v === "string" && v !== "none"))
    : null;
  const sentenceIdHits = formSentenceIds
    ? Object.fromEntries(Object.entries(formSentenceIds).filter(([, v]) => typeof v === "string" && v.startsWith("s_")))
    : null;

  return {
    barcode: result.case.barcode,
    caseId: result.case.id,
    expectedSourceType: result.case.expectedSourceType,
    sourceType: fastBundle?.meta?.sourceType,
    promptVersion: fastBundle?.meta?.promptVersion ?? null,
    serverCommitSha: fastBundle?.meta?.serverCommitSha ?? null,
    bundleId: fastBundle?.meta?.bundleId ?? null,
    revision: fastBundle?.meta?.revision ?? null,
    phase: fastBundle?.meta?.phase ?? null,
    factsDigestHash: fastBundle?.meta?.factsDigestHash ?? null,
    factsSourceVersion: fastBundle?.meta?.factsSourceVersion ?? null,
    dataStatus: detail?.dataStatus ?? null,
    fallbackUsed: detail?.meta?.fallbackUsed ?? null,
    fallbackReason: detail?.meta?.fallbackReason ?? null,
    jobStatus: detail?.meta?.jobStatus ?? null,
    attempts: detail?.meta?.attempts ?? null,
    timingMs: detail?.timingMs ?? null,
    formResolveSourcesNonNoneCount: nonNoneSources ? Object.keys(nonNoneSources).length : null,
    formResolveSourcesNonNone: nonNoneSources,
    formSentenceIdHitsCount: sentenceIdHits ? Object.keys(sentenceIdHits).length : null,
    formSentenceIdHits: sentenceIdHits,
  };
}

async function writeCaseArtifacts(result) {
  // Preserve multiple attempts (e.g. primary + fallback barcode) under a stable case directory.
  const caseDir = path.join(ARTIFACT_DIR, result.case.id, result.case.barcode);
  await ensureDir(caseDir);

  await fs.writeFile(path.join(caseDir, "events.json"), JSON.stringify(result.events, null, 2));
  await fs.writeFile(path.join(caseDir, "bundle.json"), JSON.stringify(result.fastBundle, null, 2));
  await fs.writeFile(path.join(caseDir, "analysis-section.json"), JSON.stringify(result.detailResponse, null, 2));
  await fs.writeFile(path.join(caseDir, "summary.json"), JSON.stringify(result.summary, null, 2));
}

async function runCase(testCase) {
  const events = await readSseEvents(testCase.barcode);
  const bundleEvents = getBundleEvents(events);
  const bundleCheck = assertBundleContract(bundleEvents, testCase.expectedSourceType);

  const detailResponse = bundleCheck.fastBundle
    ? await fetchIngredientsDetail(bundleCheck.fastBundle)
    : { status: 0, payload: null, response: null };

  const detailErrors = bundleCheck.fastBundle ? assertDetailContract(detailResponse) : [];

  const dsldKbErrors =
    bundleCheck.fastBundle && testCase.id.startsWith("dsld_with_form")
      ? assertDsldWithFormKbHit(detailResponse, testCase.id)
      : [];

  const errors = [...bundleCheck.errors, ...detailErrors, ...dsldKbErrors];
  const summary = {
    ...pickKeyFields({ case: testCase, fastBundle: bundleCheck.fastBundle, detailResponse }),
    errors,
    pass: errors.length === 0,
  };

  const result = {
    case: testCase,
    events,
    fastBundle: bundleCheck.fastBundle,
    detailResponse,
    errors,
    summary,
  };

  await writeCaseArtifacts(result);
  return result;
}

async function runCaseWithFallback(testCase) {
  const [primaryBarcode, fallbackBarcode] = testCase.barcodes;
  if (!primaryBarcode) {
    throw new Error(`case ${testCase.id} missing barcode`);
  }
  const primary = await runCase({ ...testCase, barcode: primaryBarcode });
  primary.summary.usedBarcode = primaryBarcode;

  if (!fallbackBarcode || primary.summary.pass) {
    primary.summary.primaryFailedReason = null;
    primary.summary.primaryBarcode = primaryBarcode;
    return primary;
  }

  const primaryFailedReason = primary.errors.join("; ");
  const fallback = await runCase({ ...testCase, barcode: fallbackBarcode });
  fallback.summary.usedBarcode = fallbackBarcode;
  fallback.summary.primaryBarcode = primaryBarcode;
  fallback.summary.primaryFailedReason = primaryFailedReason || "primary_failed";

  if (fallback.summary.pass) {
    return fallback;
  }

  // Both failed: keep the primary as the canonical failure, but preserve fallback context.
  primary.summary.primaryBarcode = primaryBarcode;
  primary.summary.primaryFailedReason = null;
  primary.summary.fallbackBarcode = fallbackBarcode;
  primary.summary.fallbackFailedReason = fallback.errors.join("; ") || "fallback_failed";
  primary.summary.errors = [
    ...primary.summary.errors,
    `fallback_failed: ${primary.summary.fallbackFailedReason}`,
  ];
  primary.summary.pass = false;
  primary.errors = primary.summary.errors;
  return primary;
}

async function main() {
  await ensureDir(ARTIFACT_DIR);

  const runResults = [];
  for (const testCase of DEFAULT_CASES) {
    const primaryBarcode = testCase.barcodes?.[0] ?? "";
    const fallbackBarcode = testCase.barcodes?.[1] ?? null;
    const label = fallbackBarcode
      ? `${primaryBarcode} (fallback ${fallbackBarcode})`
      : primaryBarcode;
    console.log(`[render-regression] running case=${testCase.id} barcode=${label}`);
    // serial execution keeps logs deterministic and easier to debug
    // eslint-disable-next-line no-await-in-loop
    const result = await runCaseWithFallback(testCase);
    runResults.push(result);
    console.log(
      `[render-regression] case=${testCase.id} pass=${result.summary.pass} sourceType=${result.summary.sourceType} dataStatus=${result.summary.dataStatus} fallback=${result.summary.fallbackUsed ?? "none"}`
    );
  }

  const summary = {
    baseUrl: BASE_URL,
    generatedAt: new Date().toISOString(),
    caseCount: runResults.length,
    passCount: runResults.filter((item) => item.summary.pass).length,
    failCount: runResults.filter((item) => !item.summary.pass).length,
    cases: runResults.map((item) => item.summary),
  };

  await fs.writeFile(path.join(ARTIFACT_DIR, "summary.json"), JSON.stringify(summary, null, 2));

  // Release evidence table (stable, one row per case).
  const evidenceRows = runResults.map((item) => ({
    caseId: item.summary.caseId,
    barcode: item.summary.barcode,
    usedBarcode: item.summary.usedBarcode ?? item.summary.barcode,
    primaryBarcode: item.summary.primaryBarcode ?? null,
    primaryFailedReason: item.summary.primaryFailedReason ?? null,
    sourceType: item.summary.sourceType,
    promptVersion: item.summary.promptVersion,
    serverCommitSha: item.summary.serverCommitSha,
    factsSourceVersion: item.summary.factsSourceVersion,
    detailDataStatus: item.detailResponse?.response?.dataStatus ?? null,
    fallbackUsed: item.summary.fallbackUsed,
    fallbackReason: item.summary.fallbackReason,
    formResolveSourcesNonNone: item.summary.formResolveSourcesNonNone ?? null,
    formSentenceIdHits: item.summary.formSentenceIdHits ?? null,
  }));
  await fs.writeFile(path.join(ARTIFACT_DIR, "release-evidence.json"), JSON.stringify(evidenceRows, null, 2));

  const mdLines = [
    "| caseId | barcode | usedBarcode | primaryFailedReason | sourceType | promptVersion | serverCommitSha | factsSourceVersion | detail.dataStatus | fallbackUsed | formResolveSources(non-none) | formSentenceIds(hits) |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const row of evidenceRows) {
    const sources = row.formResolveSourcesNonNone
      ? Object.entries(row.formResolveSourcesNonNone)
          .map(([k, v]) => `${k}:${v}`)
          .join("<br>")
      : "";
    const sids = row.formSentenceIdHits
      ? Object.entries(row.formSentenceIdHits)
          .map(([k, v]) => `${k}:${v}`)
          .join("<br>")
      : "";
    mdLines.push(
      `| ${row.caseId} | ${row.barcode} | ${row.usedBarcode ?? ""} | ${row.primaryFailedReason ?? ""} | ${row.sourceType ?? ""} | ${row.promptVersion ?? ""} | ${row.serverCommitSha ?? ""} | ${row.factsSourceVersion ?? ""} | ${row.detailDataStatus ?? ""} | ${row.fallbackUsed ?? ""} | ${sources} | ${sids} |`,
    );
  }
  await fs.writeFile(path.join(ARTIFACT_DIR, "release-evidence.md"), mdLines.join("\n") + "\n");

  if (summary.failCount > 0) {
    console.error("[render-regression] failures detected:");
    for (const item of runResults) {
      if (item.summary.pass) continue;
      console.error(`- ${item.case.id}: ${item.errors.join("; ")}`);
    }
    process.exit(1);
  }

  console.log("[render-regression] all cases passed");
}

main().catch((error) => {
  console.error(`[render-regression] fatal error: ${String(error)}`);
  process.exit(1);
});
