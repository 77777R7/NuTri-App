#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const dsldNoFormBarcode =
  process.env.RENDER_DSLD_NOFORM_BARCODE || process.env.RENDER_DSLD_BARCODE || "026664275110";
const dsldWithFormBarcode = process.env.RENDER_DSLD_FORM_BARCODE || "00690290532093";
// Prefer a picolinate sample where DSLD facts include explicit actives (avoid proprietary-blend-only rows).
const dsldWithFormBarcode2 = process.env.RENDER_DSLD_FORM2_BARCODE || "00854936003044";
const dsldWithFormBarcode2b = process.env.RENDER_DSLD_FORM2_BARCODE2 || "09315771009765";
const dsldWithFormGlycinateBarcode = process.env.RENDER_DSLD_GLYCINATE_BARCODE || "00700461233336";
const dsldWithFormGlycinateBarcode2 = process.env.RENDER_DSLD_GLYCINATE_BARCODE2 || "00700461233350";
// Keep a fallback barcode in case the DSLD mapping drifts.
const dsldWithFormBisglycinateBarcode = process.env.RENDER_DSLD_BISGLYCINATE_BARCODE || "00850025187091";
const dsldWithFormBisglycinateBarcode2 = process.env.RENDER_DSLD_BISGLYCINATE_BARCODE2 || "00323359110306";
const dsldWithFormAscorbateBarcode = process.env.RENDER_DSLD_ASCORBATE_BARCODE || "00708118021602";
const dsldWithFormAscorbateBarcode2 = process.env.RENDER_DSLD_ASCORBATE_BARCODE2 || "00708118010262";
const dsldWithFormCreatineCitrateBarcode =
  process.env.RENDER_DSLD_CREATINE_CITRATE_BARCODE || "00850748005269";

const DEFAULT_CASES = [
  { id: "lnhpd", barcodes: [process.env.RENDER_LNHPD_BARCODE || "00029537001069"], expectedSourceType: "lnhpd" },
  { id: "dsld_no_form", barcodes: [dsldNoFormBarcode], expectedSourceType: "dsld" },
  {
    id: "dsld_with_form",
    barcodes: [dsldWithFormBarcode],
    expectedSourceType: "dsld",
    requiredFormKeyword: "citrate",
    // Bind assertions to the intended active (avoid passing due to a different citrate ingredient).
    targetActiveKeyword: "zinc citrate",
  },
  {
    id: "dsld_with_form_2",
    barcodes: [dsldWithFormBarcode2, dsldWithFormBarcode2b],
    expectedSourceType: "dsld",
    requiredFormKeyword: "picolinate",
    targetActiveKeyword: "chromium picolinate",
  },
  {
    id: "dsld_with_form_ascorbate",
    barcodes: [dsldWithFormAscorbateBarcode, dsldWithFormAscorbateBarcode2],
    expectedSourceType: "dsld",
    requiredFormKeyword: "ascorbate",
    targetActiveKeyword: "calcium ascorbate",
  },
  {
    id: "dsld_with_form_bisglycinate",
    barcodes: [dsldWithFormBisglycinateBarcode, dsldWithFormBisglycinateBarcode2],
    expectedSourceType: "dsld",
    requiredFormKeyword: "bisglycinate",
    targetActiveKeyword: "zinc bisglycinate",
  },
  {
    id: "dsld_with_form_glycinate",
    barcodes: [dsldWithFormGlycinateBarcode, dsldWithFormGlycinateBarcode2],
    expectedSourceType: "dsld",
    requiredFormKeyword: "glycinate",
    targetActiveKeyword: "magnesium glycinate",
  },
  { id: "web", barcodes: [process.env.RENDER_WEB_BARCODE || "000000000000"], expectedSourceType: "web" },
];

const CASES = [...DEFAULT_CASES];
if (process.env.RENDER_INCLUDE_NIGHTLY_CASES === "1") {
  // Non-blocking observation cases: keep out of required checks until stable across multiple runs.
  CASES.splice(CASES.length - 1, 0, {
    id: "dsld_with_form_creatine_citrate",
    barcodes: [dsldWithFormCreatineCitrateBarcode],
    expectedSourceType: "dsld",
    requiredFormKeyword: "creatine citrate",
    targetActiveKeyword: "creatine citrate",
  });
}

const BASE_URL = process.env.RENDER_BASE_URL;
const SSE_TIMEOUT_MS = Number(process.env.RENDER_SSE_TIMEOUT_MS || 90_000);
const DETAIL_TIMEOUT_MS = Number(process.env.RENDER_DETAIL_TIMEOUT_MS || 45_000);
const ARTIFACT_DIR = process.env.RENDER_ARTIFACT_DIR || "artifacts/render-regression";
const DETAIL_LIMIT = Number(process.env.RENDER_DETAIL_LIMIT || 6);
const DETAIL_MAX_PAGES = Number(process.env.RENDER_DETAIL_MAX_PAGES || 4);

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

  let res;
  try {
    res = await fetch(`${BASE_URL}/api/enrich-stream`, {
      method: "POST",
      headers: buildHeaders(true),
      body: JSON.stringify({ barcode }),
      signal: ctrl.signal,
    });
  } catch (err) {
    // Treat an SSE timeout/abort as a case-level failure (no events), not a fatal crash.
    if (err?.name === "AbortError") return [];
    throw err;
  }

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
  let sawSkeleton = false;
  let sawFast = false;
  let shouldStopEarly = false;

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

    if (currentEvent === "analysis_bundle" && parsed && typeof parsed === "object") {
      const rev = parsed?.meta?.revision;
      const phase = parsed?.meta?.phase;
      if (rev === 0 && phase === "skeleton") sawSkeleton = true;
      if (rev === 1 && phase === "fast_ai") sawFast = true;
      // We only need revision 0 + 1 for regression assertions; don't wait for the full stream to finish.
      if (sawSkeleton && sawFast) shouldStopEarly = true;
    }

    currentEvent = null;
    currentDataLines = [];
  };

  try {
    outer: while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (err?.name === "AbortError") break;
        throw err;
      }

      const { value, done } = chunk;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.length === 0) {
          flushEvent();
          if (shouldStopEarly) break outer;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchIngredientsDetailPage(fastBundle, cursor) {
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
    cursor,
  };

  const startedAt = Date.now();
  let pollAttempts = 0;
  while (true) {
    pollAttempts += 1;
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

    if (res.status !== 202) {
      return { status: res.status, payload, response: json, pollAttempts };
    }

    const retryAfterMs = Number(json?.retryAfterMs ?? 2000);
    const elapsed = Date.now() - startedAt;
    if (elapsed >= DETAIL_TIMEOUT_MS) {
      return { status: res.status, payload, response: json, pollAttempts };
    }

    await sleep(Math.min(Math.max(retryAfterMs, 250), 5000));
  }
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

function assertDsldWithFormKbHit(detailResponse, testCase) {
  const errors = [];
  const caseId = testCase.id;
  if (detailResponse.status !== 200) return errors;
  const body = detailResponse.response;

  const items = body?.detail?.items;
  if (!Array.isArray(items)) {
    errors.push(`${caseId}: analysis-section missing detail.items`);
    return errors;
  }

  const requiredKeyword = String(testCase.requiredFormKeyword ?? "").trim().toLowerCase();
  const targetKeyword = String(testCase.targetActiveKeyword ?? requiredKeyword).trim().toLowerCase();
  const matchesTarget = (name) => {
    const s = String(name ?? "").toLowerCase();
    if (targetKeyword && !s.includes(targetKeyword)) return false;
    if (requiredKeyword && !s.includes(requiredKeyword)) return false;
    return true;
  };

  // P0-A: Confirm a true KB sentence was used, not just a non-empty string.
  // Bind the assertion to the intended active item (avoid passing due to a different ingredient).
  const hasKbSentence = items.some((item) => {
    if (!matchesTarget(item?.name)) return false;
    const tags = item?.chemicalFormExplain?.basisTags;
    return Array.isArray(tags) && tags.includes("ingredient_inference");
  });
  if (!hasKbSentence) {
    errors.push(
      `${caseId}: expected at least one chemicalFormExplain tagged ingredient_inference` +
        (targetKeyword ? ` (target=${targetKeyword})` : "") +
        (requiredKeyword && requiredKeyword !== targetKeyword ? ` (required=${requiredKeyword})` : "") +
        ` (true KB sentence)`
    );
  }

  // P0-2 (stronger): confirm sentenceId/excerptId is present (true KB hit, not rule text).
  const sentenceIds = body?.debug?.formSentenceIds;
  const hasSentenceId =
    sentenceIds && typeof sentenceIds === "object"
      ? Object.entries(sentenceIds).some(
          ([k, value]) => matchesTarget(k) && typeof value === "string" && value.startsWith("s_")
        )
      : false;
  if (!hasSentenceId) {
    errors.push(
      `${caseId}: expected at least one debug.formSentenceIds entry` +
        (targetKeyword ? ` (target=${targetKeyword})` : "") +
        ` (true KB hit)`
    );
  }

  const sources = body?.debug?.formResolveSources;
  if (!sources || typeof sources !== "object") {
    errors.push(`${caseId}: missing debug.formResolveSources`);
    return errors;
  }
  const hasNonNone = Object.entries(sources).some(
    ([k, value]) => matchesTarget(k) && typeof value === "string" && value !== "none"
  );
  if (!hasNonNone) {
    errors.push(
      `${caseId}: expected at least one formResolveSource != none` +
        (targetKeyword ? ` (target=${targetKeyword})` : "")
    );
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
    requiredFormKeyword: result.case.requiredFormKeyword ?? null,
    targetActiveKeyword: result.case.targetActiveKeyword ?? null,
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
    detailCursorUsed: result.detailResponse?.payload?.cursor ?? null,
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

  let detailResponse = { status: 0, payload: null, response: null };
  if (bundleCheck.fastBundle) {
    const requiredKeyword = String(testCase.requiredFormKeyword ?? "").trim().toLowerCase();
    const targetKeyword = String(testCase.targetActiveKeyword ?? requiredKeyword).trim().toLowerCase();
    const shouldPage = testCase.id.startsWith("dsld_with_form") && Boolean(targetKeyword || requiredKeyword);
    if (!shouldPage) {
      detailResponse = await fetchIngredientsDetailPage(bundleCheck.fastBundle, 0);
    } else {
      let cursor = 0;
      let pages = 0;
      let last = null;
      while (pages < DETAIL_MAX_PAGES) {
        // eslint-disable-next-line no-await-in-loop
        const pageRes = await fetchIngredientsDetailPage(bundleCheck.fastBundle, cursor);
        last = pageRes;
        pages += 1;

        if (pageRes.status !== 200) {
          detailResponse = pageRes;
          break;
        }

        const sentenceIds = pageRes.response?.debug?.formSentenceIds;
        const hasKeywordSentence =
          sentenceIds && typeof sentenceIds === "object"
            ? Object.entries(sentenceIds).some(
                ([k, v]) =>
                  String(k).toLowerCase().includes(targetKeyword || requiredKeyword) &&
                  typeof v === "string" &&
                  v.startsWith("s_"),
              )
            : false;
        if (hasKeywordSentence) {
          detailResponse = pageRes;
          break;
        }

        const nextCursor = pageRes.response?.page?.nextCursor;
        if (typeof nextCursor !== "number") {
          detailResponse = pageRes;
          break;
        }
        cursor = nextCursor;
      }
      if (!detailResponse?.status && last) detailResponse = last;
    }
  }

  const detailErrors = bundleCheck.fastBundle ? assertDetailContract(detailResponse) : [];

  const dsldKbErrors =
    bundleCheck.fastBundle && testCase.id.startsWith("dsld_with_form")
      ? assertDsldWithFormKbHit(detailResponse, testCase)
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

async function runCaseSafely(testCase) {
  try {
    return await runCase(testCase);
  } catch (err) {
    const errors = [`exception: ${String(err?.name === "AbortError" ? "AbortError" : err)}`];
    const summary = {
      barcode: testCase.barcode,
      caseId: testCase.id,
      expectedSourceType: testCase.expectedSourceType,
      requiredFormKeyword: testCase.requiredFormKeyword ?? null,
      targetActiveKeyword: testCase.targetActiveKeyword ?? null,
      sourceType: null,
      promptVersion: null,
      serverCommitSha: null,
      bundleId: null,
      revision: null,
      phase: null,
      factsDigestHash: null,
      factsSourceVersion: null,
      dataStatus: null,
      fallbackUsed: null,
      fallbackReason: null,
      jobStatus: null,
      attempts: null,
      timingMs: null,
      detailCursorUsed: null,
      formResolveSourcesNonNoneCount: null,
      formResolveSourcesNonNone: null,
      formSentenceIdHitsCount: null,
      formSentenceIdHits: null,
      errors,
      pass: false,
    };

    const result = {
      case: testCase,
      events: [],
      fastBundle: null,
      detailResponse: { status: 0, payload: null, response: null },
      errors,
      summary,
    };
    await writeCaseArtifacts(result);
    return result;
  }
}

async function runCaseWithFallback(testCase) {
  const [primaryBarcode, fallbackBarcode] = testCase.barcodes;
  if (!primaryBarcode) {
    throw new Error(`case ${testCase.id} missing barcode`);
  }
  const primary = await runCaseSafely({ ...testCase, barcode: primaryBarcode });
  primary.summary.usedBarcode = primaryBarcode;

  if (!fallbackBarcode || primary.summary.pass) {
    primary.summary.primaryFailedReason = null;
    primary.summary.primaryBarcode = primaryBarcode;
    return primary;
  }

  const primaryFailedReason = primary.errors.join("; ");
  const fallback = await runCaseSafely({ ...testCase, barcode: fallbackBarcode });
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
  for (const testCase of CASES) {
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
    requiredFormKeyword: item.summary.requiredFormKeyword ?? null,
    targetActiveKeyword: item.summary.targetActiveKeyword ?? null,
    promptVersion: item.summary.promptVersion,
    serverCommitSha: item.summary.serverCommitSha,
    factsSourceVersion: item.summary.factsSourceVersion,
    detailDataStatus: item.detailResponse?.response?.dataStatus ?? null,
    detailCursorUsed: item.summary.detailCursorUsed ?? null,
    fallbackUsed: item.summary.fallbackUsed,
    fallbackReason: item.summary.fallbackReason,
    formResolveSourcesNonNone: item.summary.formResolveSourcesNonNone ?? null,
    formSentenceIdHits: item.summary.formSentenceIdHits ?? null,
  }));
  await fs.writeFile(path.join(ARTIFACT_DIR, "release-evidence.json"), JSON.stringify(evidenceRows, null, 2));

  const mdLines = [
    "| caseId | barcode | usedBarcode | primaryFailedReason | sourceType | requiredKeyword | targetActive | cursor | promptVersion | serverCommitSha | factsSourceVersion | detail.dataStatus | fallbackUsed | formResolveSources(non-none) | formSentenceIds(hits) |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
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
      `| ${row.caseId} | ${row.barcode} | ${row.usedBarcode ?? ""} | ${row.primaryFailedReason ?? ""} | ${row.sourceType ?? ""} | ${row.requiredFormKeyword ?? ""} | ${row.targetActiveKeyword ?? ""} | ${row.detailCursorUsed ?? ""} | ${row.promptVersion ?? ""} | ${row.serverCommitSha ?? ""} | ${row.factsSourceVersion ?? ""} | ${row.detailDataStatus ?? ""} | ${row.fallbackUsed ?? ""} | ${sources} | ${sids} |`,
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
