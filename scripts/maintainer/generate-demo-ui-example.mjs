#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};
const barcodeOnly = args.includes("--barcode-only");

const nightlyDir = getArg(
  "nightly-dir",
  path.join(ROOT, "output", "v1.6.14-new-top100-nightly-20260302T103930Z"),
);
const outputDir = getArg("out-dir", path.join(ROOT, "output", "demo"));
const autoSelect = args.includes("--auto-select");
const barcodeArg = getArg("barcode", null);
const controlBaseUrl = String(getArg("control-base-url", "http://192.168.1.68:3101")).replace(/\/+$/, "");
const patchBaseUrl = String(getArg("patch-base-url", "http://192.168.1.68:3102")).replace(/\/+$/, "");
const authDisabledHeader = String(getArg("auth-disabled-header", "1")).trim() === "1";

const safeSubsetPath = getArg(
  "safe-subset-json",
  path.join(ROOT, "output", "v1.6.14-e-plus-20260302T081059Z", "ux", "v4_safe_science_subset.json"),
);
const safeFallbackPath = getArg(
  "safe-fallback-json",
  path.join(ROOT, "data", "kb", "safe_science_fallbacks.v1.json"),
);
const impactPath = getArg(
  "impact-json",
  path.join(nightlyDir, "next_phase", "new_top100_product_level_ux_impact.json"),
);
const diagnosticsPath = getArg(
  "diagnostics-json",
  path.join(nightlyDir, "next_phase", "ux_refresh", "ux_visibility_diagnostics.json"),
);
const brandUxReportPath = getArg(
  "brand-ux-report-json",
  path.join(nightlyDir, "phase_f", "new_top100_patch_ux_coverage_report.json"),
);
const qualityMarkAuditPath = getArg(
  "quality-mark-audit-json",
  path.join(ROOT, "output", "quality_marks", "quality_mark_audit.json"),
);

const readJson = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const fileExists = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

const isAbortLike = (error) => {
  const name = typeof error?.name === "string" ? error.name : "";
  const message = typeof error?.message === "string" ? error.message : String(error ?? "");
  return name === "AbortError" || /\btimeout\b|\babort(ed|ing)?\b/i.test(message);
};

const fetchSse = async (url, payload, timeoutMs = 25000) => {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const events = [];
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...(authDisabledHeader ? { "X-Auth-Disabled": "1" } : {}),
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`SSE request failed: ${res.status}`);
    if (!res.body) throw new Error("SSE response body missing");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let currentEvent = null;
    let currentData = "";
    let buffer = "";
    const flushEvent = () => {
      if (!currentEvent) return;
      const data = currentData.trim();
      if (!data) {
        currentEvent = null;
        currentData = "";
        return;
      }
      try {
        events.push({ event: currentEvent, data: JSON.parse(data) });
      } catch {
        events.push({ event: currentEvent, data });
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
        if (line.startsWith("event:")) {
          currentEvent = line.replace("event:", "").trim();
        } else if (line.startsWith("data:")) {
          currentData += line.replace("data:", "").trim();
        }
      }
    }
    flushEvent();
    return { events, timedOut, error: null };
  } catch (error) {
    if (timedOut || isAbortLike(error)) {
      return { events, timedOut: true, error: error instanceof Error ? error.message : String(error) };
    }
    return { events, timedOut: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
};

const fetchJson = async (url, timeoutMs = 12000) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        ...(authDisabledHeader ? { "X-Auth-Disabled": "1" } : {}),
      },
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => null);
    return {
      ok: res.ok,
      status: res.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

const pickLastEventData = (events, eventName) => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.event === eventName) return events[i].data;
  }
  return null;
};

const pickBundle = (events) => {
  const bundles = events.filter((e) => e?.event === "analysis_bundle" && e?.data && typeof e.data === "object").map((e) => e.data);
  if (!bundles.length) return null;
  const rev1 = [...bundles].reverse().find((b) => b?.meta?.revision === 1);
  return rev1 ?? bundles[bundles.length - 1];
};

const sha256File = async (p) => {
  const buf = await fs.readFile(p);
  return crypto.createHash("sha256").update(buf).digest("hex");
};

const normalizeDedupKey = (line) =>
  String(line ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const uniqLines = (arr) => {
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const line = String(raw ?? "").trim();
    if (!line) continue;
    const key = normalizeDedupKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
};

const startsUpper = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const safeText = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

const SUPPLEMENT_NUTRITION_FIELDS = new Set([
  "calories",
  "total fat",
  "cholesterol",
  "sodium",
  "total carbohydrate",
  "carbohydrate",
  "protein",
  "sugars",
  "added sugars",
]);

const formatDose = (item) => {
  const amount = item?.amount;
  const unit = item?.amountUnitRaw || item?.amountUnit || "";
  if (amount === null || amount === undefined) return "";
  return `${amount} ${unit}`.trim();
};

const formFromProductName = (productName) => {
  const name = String(productName ?? "").toLowerCase();
  if (name.includes("ubiquinol")) return "ubiquinol";
  if (name.includes("ubiquinone")) return "ubiquinone";
  if (name.includes("d3")) return "vitamin d3";
  if (name.includes("d2")) return "vitamin d2";
  return null;
};

const hasBannedFluff = (line) =>
  /(normal function|day-to-day wellness|general wellness)/i.test(String(line ?? ""));

const checklistGroupName = (id) => {
  if (!id) return "Other";
  const key = String(id).split(":")[0];
  if (key.startsWith("goalevidencefit")) return "Goal-Evidence Fit";
  if (key.startsWith("formulaquality")) return "Formula Quality";
  if (key.startsWith("safetytransparency")) return "Safety & Transparency";
  if (key.startsWith("trustqualityassurance")) return "Trust & QA";
  return "Other";
};

const getPrefixedLine = (lines, prefix, fallback) => {
  const normalizedPrefix = String(prefix).toLowerCase();
  const match = (Array.isArray(lines) ? lines : [])
    .map((line) => safeText(line))
    .find((line) => line.toLowerCase().startsWith(normalizedPrefix));
  if (match) return match;
  const fallbackText = safeText(fallback);
  return fallbackText.toLowerCase().startsWith(normalizedPrefix)
    ? fallbackText
    : `${prefix} ${fallbackText}`;
};

const normalizeTerminalPunctuation = (value) =>
  safeText(value)
    .replace(/\.\.+$/g, ".")
    .replace(/([.!?]){2,}$/g, "$1")
    .trim();

const scoreBandOverall = (score) => {
  const s = Number.isFinite(Number(score)) ? Number(score) : 0;
  if (s >= 90) return "Excellent";
  if (s >= 80) return "Strong";
  if (s >= 70) return "Good";
  if (s >= 60) return "Fair";
  if (s >= 45) return "Limited";
  return "Weak";
};

const scoreBandModule = (score) => {
  const s = Number.isFinite(Number(score)) ? Number(score) : 0;
  if (s >= 85) return "High";
  if (s >= 65) return "Moderate";
  if (s >= 40) return "Limited";
  return "Low";
};

const checklistDisplayState = (item) => {
  const state = safeText(item?.state).toLowerCase();
  const strength = safeText(item?.evidenceStrength).toLowerCase();
  if (state === "missing") return "Not shown";
  if (state === "unknown") return "Not verified";
  if (state === "verified" && strength === "overlay_claim") return "Detected";
  if (state === "verified" && ["official", "scanned_label", "overlay_label_transcription", "cert_page_verified"].includes(strength)) return "Verified";
  if (state === "verified") return "Detected";
  return "Not verified";
};

const renderNutriScoreCardV2Lines = (nutriScoreCardV2) => {
  const lines = [];
  if (!nutriScoreCardV2 || !Array.isArray(nutriScoreCardV2.modules)) return lines;
  const overall = Number.isFinite(Number(nutriScoreCardV2.overallScore))
    ? Math.round(Number(nutriScoreCardV2.overallScore))
    : 0;
  const confidence = Number.isFinite(Number(nutriScoreCardV2.confidencePct))
    ? Math.round(Number(nutriScoreCardV2.confidencePct))
    : 0;
  const overallBand = safeText(nutriScoreCardV2.overallBand) || scoreBandOverall(overall);
  lines.push("## 0) Nutri Score Card v2");
  lines.push("");
  lines.push(`- Overall score: ${overall}/100`);
  lines.push(`- Overall band: ${overallBand}`);
  lines.push(`- Confidence: ${confidence}%`);
  lines.push("");
  for (const module of nutriScoreCardV2.modules) {
    const title = safeText(module?.title) || String(module?.id ?? "module");
    const moduleScore = Number.isFinite(Number(module?.score)) ? Math.round(Number(module.score)) : 0;
    const moduleBand = safeText(module?.band) || scoreBandModule(moduleScore);
    lines.push(`### ${title}`);
    lines.push(`- Score: ${moduleScore}/100`);
    lines.push(`- Band: ${moduleBand}`);
    const checklist = Array.isArray(module?.checklist) ? module.checklist : [];
    if (checklist.length === 0) {
      lines.push("- [Not verified] No checklist evidence available.");
    } else {
      for (const item of checklist) {
        const label = safeText(item?.label) || safeText(item?.key) || "checklist item";
        const display = checklistDisplayState(item);
        lines.push(`- [${display}] ${label}`);
      }
    }
    lines.push("");
  }
  return lines;
};

const coerceNutriScoreCardV2 = (decisionSupportBody) => {
  const existing = decisionSupportBody?.nutriScoreCardV2;
  if (existing && Array.isArray(existing.modules) && existing.modules.length === 6) {
    return existing;
  }
  return null;
};

const slugify = (value, fallback = "sample") => {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || fallback;
};

const runBarcodeOnlyMode = async () => {
  await fs.mkdir(outputDir, { recursive: true });
  const barcode = String(barcodeArg ?? "00766536026586").trim();
  if (!barcode) throw new Error("--barcode is required in --barcode-only mode");

  const controlSse = await fetchSse(`${controlBaseUrl}/api/enrich-stream`, { barcode }, 32000);
  const patchSse = await fetchSse(`${patchBaseUrl}/api/enrich-stream`, { barcode }, 32000);
  const controlBundle = pickBundle(controlSse.events);
  const patchBundle = pickBundle(patchSse.events);
  const patchSnapshot = pickLastEventData(patchSse.events, "snapshot");
  if (!patchBundle) {
    throw new Error("Patch bundle not found from SSE in --barcode-only mode");
  }

  const dsResp = await fetchJson(
    `${patchBaseUrl}/api/decision-support/v1?barcode=${encodeURIComponent(barcode)}&viewMode=details`,
    15000,
  );
  if (!dsResp.ok || !dsResp.body) {
    throw new Error(`Decision support request failed: ${dsResp.status}`);
  }
  const decisionSupportBody = dsResp.body;
  const patchStatusResp = await fetchJson(`${patchBaseUrl}/api/patch-shadow/status`, 10000);

  const sourceTypeFinal = safeText(
    patchBundle?.meta?.sourceType ??
      decisionSupportBody?.sourceType ??
      "unknown",
  ).toLowerCase() || "unknown";
  const identityType = safeText(
    patchBundle?.meta?.authoritativeIdentity?.type ??
      decisionSupportBody?.authoritativeIdentity?.type ??
      "",
  );
  const identityValue = safeText(
    patchBundle?.meta?.authoritativeIdentity?.value ??
      decisionSupportBody?.authoritativeIdentity?.value ??
      barcode,
  );
  const identityKey = identityType && identityValue
    ? `${sourceTypeFinal}:${identityValue}`
    : `${sourceTypeFinal}:${barcode}`;

  const brandName = safeText(
    patchBundle?.meta?.productIdentity?.brand ??
      patchSnapshot?.product?.brand ??
      patchBundle?.sections?.overview?.detail?.summary ??
      "brand",
  );
  const productName = safeText(
    patchBundle?.meta?.productIdentity?.name ??
      patchSnapshot?.product?.name ??
      "Supplement product",
  );
  const brandSlug = slugify(brandName, "brand");

  const bundleControlPath = path.join(outputDir, `demo_bundle_control_${brandSlug}_${barcode}.json`);
  const bundlePatchPath = path.join(outputDir, `demo_bundle_patch_${brandSlug}_${barcode}.json`);
  const decisionSupportPath = path.join(outputDir, `demo_decision_support_${brandSlug}_${barcode}.json`);
  const patchStatusPath = path.join(outputDir, `demo_patch_shadow_status_${brandSlug}_${barcode}.json`);
  const mdPath = path.join(outputDir, `demo_ui_example_${brandSlug}_${barcode}.md`);
  const tracePath = path.join(outputDir, `demo_ui_example_trace_${brandSlug}_${barcode}.json`);

  await Promise.all([
    fs.writeFile(
      bundleControlPath,
      JSON.stringify(
        {
          baseUrl: controlBaseUrl,
          barcode,
          ok: Boolean(controlBundle),
          error: controlSse.error,
          timedOut: controlSse.timedOut,
          bundle: controlBundle ?? null,
          snapshot: pickLastEventData(controlSse.events, "snapshot") ?? null,
        },
        null,
        2,
      ),
    ),
    fs.writeFile(
      bundlePatchPath,
      JSON.stringify(
        {
          baseUrl: patchBaseUrl,
          barcode,
          ok: Boolean(patchBundle),
          error: patchSse.error,
          timedOut: patchSse.timedOut,
          bundle: patchBundle,
          snapshot: patchSnapshot ?? null,
        },
        null,
        2,
      ),
    ),
    fs.writeFile(
      decisionSupportPath,
      JSON.stringify(
        {
          url: `${patchBaseUrl}/api/decision-support/v1`,
          status: dsResp.status,
          body: decisionSupportBody,
        },
        null,
        2,
      ),
    ),
    fs.writeFile(
      patchStatusPath,
      JSON.stringify(
        {
          url: `${patchBaseUrl}/api/patch-shadow/status`,
          status: patchStatusResp.status,
          body: patchStatusResp.body ?? null,
          error: patchStatusResp.error ?? null,
        },
        null,
        2,
      ),
    ),
  ]);

  const template = {
    scoreCardV2: coerceNutriScoreCardV2(decisionSupportBody),
    overview: decisionSupportBody?.overviewBlock ?? null,
    science: decisionSupportBody?.scienceBlock ?? null,
    usage: decisionSupportBody?.usageBlock ?? null,
    safety: decisionSupportBody?.safetyBlock ?? null,
    qualityMark: decisionSupportBody?.qualityMark ?? null,
  };
  const usageDirectionsSourceTier = safeText(template?.usage?.directions?.sourceTier);
  const hasDirectionsTextVisible = Boolean(template?.usage?.directions?.hasDirectionsTextVisible);
  const labelUsedLine = usageDirectionsSourceTier === "scanned_label"
    ? "Yes (scanned-label patch applied)"
    : hasDirectionsTextVisible
    ? "Yes (official record directions available)"
    : "No (directions/warnings not extracted yet)";

  const v2Lines = renderNutriScoreCardV2Lines(template.scoreCardV2);
  const bestForLinesRaw = uniqLines(Array.isArray(template?.overview?.bestForBullets) ? template.overview.bestForBullets : []);
  const bestForPrimary = getPrefixedLine(
    bestForLinesRaw,
    "Best for:",
    "Best for: comparing products with clear ingredient and serving disclosure.",
  );
  const bestForSecondary = getPrefixedLine(
    bestForLinesRaw,
    "Good if you want:",
    "Good if you want: labels that clearly disclose key details for easier product comparison.",
  );
  const bestForTertiary = getPrefixedLine(
    bestForLinesRaw,
    "Not ideal if:",
    "Not ideal if: core disclosure is missing, because confidence drops when key fields are not stated.",
  );

  const provides = template?.overview?.providesVerified ?? {};
  const keyIngredient = Array.isArray(provides?.keyIngredients) ? provides.keyIngredients[0] : null;
  const servingSizeDisplay = safeText(provides?.servingSize) || "not stated";
  const servingsPerContainer = provides?.servingsPerContainer;
  const keyIngredientLine = keyIngredient?.name
    ? `${safeText(keyIngredient.name)}${safeText(keyIngredient.dose) ? ` ${safeText(keyIngredient.dose)}` : ""}`
    : "not available yet from this record";

  const missingInfoLines = uniqLines(Array.isArray(template?.overview?.missingInfo) ? template.overview.missingInfo : []).slice(0, 2);
  const missingInfoText = missingInfoLines.length > 0
    ? missingInfoLines.join("; ")
    : "No high-impact missing fields were detected for this sample.";
  const singleCta = safeText(template?.overview?.singleCta?.label) || "Scan Directions + Warnings panel";

  const ingredientNames = uniqLines(Array.isArray(template?.science?.ingredientSnapshotNames) ? template.science.ingredientSnapshotNames : []).slice(0, 6);
  const ingredientPrimary = ingredientNames[0] || "Ingredient not clearly stated";
  const chemicalForm = safeText(template?.science?.formMatters?.ingredientChemicalForm) || "not stated in the official record";
  const dosageForm = safeText(template?.science?.formMatters?.dosageForm) || "not stated in the official record";
  const odsBullets = uniqLines(Array.isArray(template?.science?.odsGeneralScienceBullets) ? template.science.odsGeneralScienceBullets : []).slice(0, 3);
  const aiSummary3 = uniqLines(Array.isArray(template?.science?.aiSummaryContract3) ? template.science.aiSummaryContract3 : []).slice(0, 3);
  while (aiSummary3.length < 3) {
    aiSummary3.push(
      aiSummary3.length === 0
        ? "Often used to support goal-oriented supplement routines (general science)."
        : aiSummary3.length === 1
        ? `This product provides ${keyIngredientLine}, but disclosure status affects how easy it is to compare.`
        : `Main limitation: ${missingInfoLines[0] ?? "label transparency remains incomplete"}. Next step: ${singleCta.replace(/[.]+$/, "")}.`,
    );
  }

  const usageDirectionLines = uniqLines(Array.isArray(template?.usage?.directions?.lines) ? template.usage.directions.lines : [])
    .map((line) =>
      String(line)
        .replace(/\bSource:\s*scanned_label\./i, "Source: scanned label data (patched).")
        .replace(
          /\bSource:\s*overlay_iherb(?:\s*\([^)]+\))?\./i,
          "Source: supplemental product-page label data.",
        )
        .replace(/\bSource:\s*official_record\./i, "Source: official record data.")
        .replace(/\(serving\s*!=\s*daily dose\)/gi, "(a serving is not the same as the daily amount)"),
    );
  if (usageDirectionLines.length === 0) {
    usageDirectionLines.push("Directions are not included in the official record.");
    usageDirectionLines.push("Please use the bottle's Directions panel to confirm daily serving and schedule.");
    usageDirectionLines.push(`Serving cue (verified): ${servingSizeDisplay} per serving (a serving is not the same as the daily amount).`);
  }
  const usageTimingTip = safeText(template?.usage?.timingTip) || "Build a consistent routine after confirming label directions.";
  const usageConservative = safeText(template?.usage?.conservativeGuidance) || "If unsure, start with the lowest label-suggested daily amount and reassess tolerance.";

  const labelWarnings = uniqLines(Array.isArray(template?.safety?.labelWarnings) ? template.safety.labelWarnings : []);
  const ulGuidance = uniqLines(Array.isArray(template?.safety?.ulGuidance) ? template.safety.ulGuidance : []);
  const generalWatchouts = uniqLines(Array.isArray(template?.safety?.generalWatchouts) ? template.safety.generalWatchouts : []);
  const dataStatusRef = safeText(template?.safety?.dataStatusRef) || "See Missing info in Overview.";

  const qualityMark = template?.qualityMark ?? {};
  const qualityCheckedMode = safeText(qualityMark?.checkedMode);
  const qualityEvidenceType = safeText(qualityMark?.evidenceType);
  const qualityEvidenceRef = safeText(qualityMark?.evidenceRef);
  const qualitySearchOnly = qualityCheckedMode === "search_only" ||
    qualityEvidenceType === "search" ||
    /duckduckgo\.com\/html\/\?q=/i.test(qualityEvidenceRef);
  const qualityStatusLine = qualitySearchOnly
    ? "unknown (search-only evidence; no verified mark page/image found yet)"
    : safeText(qualityMark?.status) || "unknown";
  const qualitySources = Array.isArray(qualityMark?.sourcesTried) ? qualityMark.sourcesTried : [];

  const summaryTop =
    "This page supports buying decisions by separating verified facts, general science, and what is missing, then turning missing fields into one-step actions.";
  const retrievedAt = safeText(
    patchBundle?.meta?.factsSourceVersion ??
      patchSnapshot?.analysis?.labelExtraction?.fetchedAt ??
      decisionSupportBody?.factsSourceVersion ??
      "",
  ) || "from record";

  const mdLines = [];
  mdLines.push("# Demo UI Example");
  mdLines.push("");
  mdLines.push(summaryTop);
  mdLines.push("");
  mdLines.push(`- Brand: ${brandName || "Unknown brand"}`);
  mdLines.push(`- Product: ${productName || "Unknown product"}`);
  mdLines.push(`- Barcode: ${barcode}`);
  mdLines.push(`- Identity: ${identityKey}`);
  mdLines.push(`- Source type: ${sourceTypeFinal}`);
  mdLines.push("");
  mdLines.push(...v2Lines);
  mdLines.push("## 1) Product Overview");
  mdLines.push("");
  mdLines.push("### Source strip");
  mdLines.push(`- Official record: ${sourceTypeFinal.toUpperCase()} (${identityKey})`);
  mdLines.push(`- Label used: ${labelUsedLine}`);
  mdLines.push(`- Retrieved: ${retrievedAt}`);
  mdLines.push("- View sources: (sources drawer)");
  mdLines.push("");
  mdLines.push("### Best for");
  mdLines.push(`- ${bestForPrimary}`);
  mdLines.push(`- ${bestForSecondary}`);
  mdLines.push(`- ${bestForTertiary}`);
  mdLines.push("");
  mdLines.push("### What this product provides (verified)");
  mdLines.push(`- Serving size: ${servingSizeDisplay}`);
  if (servingsPerContainer !== null && servingsPerContainer !== undefined) {
    mdLines.push(`- Servings per container: ${servingsPerContainer}`);
  }
  mdLines.push(`- Key ingredient: ${keyIngredientLine}`);
  mdLines.push("");
  mdLines.push("### Missing info (single CTA)");
  mdLines.push(`- Missing from official record: ${missingInfoText}`);
  mdLines.push(`- To improve accuracy: ${singleCta.replace(/\.$/, "")}.`);
  mdLines.push("");
  mdLines.push("## 2) Science & Ingredients");
  mdLines.push("");
  mdLines.push("### Verified ingredient snapshot (names only)");
  mdLines.push(`- ${ingredientPrimary}`);
  mdLines.push("");
  mdLines.push("### Form matters (two forms, no confusion)");
  mdLines.push(`- Ingredient form (chemical): ${chemicalForm}.`);
  mdLines.push(`- Dosage form: ${dosageForm}.`);
  mdLines.push("");
  mdLines.push("### NIH ODS (general science, short)");
  for (const line of (odsBullets.length > 0 ? odsBullets : ["General science guidance is currently limited in this sample."])) {
    mdLines.push(`- ${normalizeTerminalPunctuation(line)}`);
  }
  mdLines.push("");
  mdLines.push("### AI summary (buying explanation, 3 sentences)");
  for (const line of aiSummary3) {
    mdLines.push(`- ${normalizeTerminalPunctuation(line)}`);
  }
  mdLines.push("");
  mdLines.push("## 3) Practical Usage");
  mdLines.push("");
  mdLines.push("### Directions (from label / record)");
  for (const line of usageDirectionLines) {
    mdLines.push(`- ${normalizeTerminalPunctuation(line)}`);
  }
  mdLines.push("");
  mdLines.push("### Timing tip (general)");
  mdLines.push(`- ${normalizeTerminalPunctuation(usageTimingTip)}`);
  mdLines.push("");
  mdLines.push("### Conservative guidance (general)");
  mdLines.push(`- ${normalizeTerminalPunctuation(usageConservative)}`);
  mdLines.push("");
  mdLines.push("## 4) Safety & Tips");
  mdLines.push("");
  mdLines.push("### Label warnings (product-specific)");
  for (const line of (labelWarnings.length > 0
    ? labelWarnings
    : [
      "Product-specific label warnings were not included in the official record.",
      "Check the bottle's Warnings/Cautions panel.",
    ])) {
    mdLines.push(`- ${normalizeTerminalPunctuation(line)}`);
  }
  mdLines.push("");
  mdLines.push("### Upper limit (NIH ODS, general)");
  for (const line of (ulGuidance.length > 0
    ? ulGuidance
    : ["UL guidance is general and should be compared against total daily intake."])) {
    mdLines.push(`- ${normalizeTerminalPunctuation(line)}`);
  }
  mdLines.push("");
  mdLines.push("### General watch-outs (general)");
  for (const line of (generalWatchouts.length > 0
    ? generalWatchouts
    : ["General watch-outs are currently limited for this sample."])) {
    mdLines.push(`- ${normalizeTerminalPunctuation(line)}`);
  }
  mdLines.push("");
  mdLines.push("### Data status");
  mdLines.push(`- ${normalizeTerminalPunctuation(dataStatusRef)}`);
  mdLines.push("");
  mdLines.push("### Third-party quality mark (Integrity helper)");
  mdLines.push(`- Status: ${qualityStatusLine}`);
  if (qualityEvidenceRef) mdLines.push(`- Evidence: ${qualityEvidenceRef}`);
  if (qualitySources.length > 0) {
    mdLines.push(`- Sources searched: ${qualitySources.join(", ")}`);
  }

  const mdText = `${mdLines.join("\n")}\n`;
  await fs.writeFile(mdPath, mdText, "utf8");

  const generatedFromArtifacts = [bundleControlPath, bundlePatchPath, decisionSupportPath, patchStatusPath];
  const artifactHashes = {};
  for (const artifactPath of generatedFromArtifacts) {
    // eslint-disable-next-line no-await-in-loop
    artifactHashes[artifactPath] = await sha256File(artifactPath);
  }

  const usedPatchLanes = usageDirectionsSourceTier === "scanned_label" ? ["patch_directions_text_v1"] : [];
  const trace = {
    generatedAt: new Date().toISOString(),
    brand: brandName || null,
    product: productName || null,
    barcode,
    identityKey,
    sourceTypeFinal,
    usedPatchLanes,
    runtimeHitEvidence: {
      runtimePatchHitCount: Number(
        patchStatusResp?.body?.runtimePatchHitCount ??
          patchStatusResp?.body?.metrics?.runtimePatchHitCount ??
          0,
      ),
      runtimePatchHitCountByLane:
        patchStatusResp?.body?.runtimePatchHitCountByLane ??
        patchStatusResp?.body?.metrics?.runtimePatchHitCountByLane ??
        {},
      decisionSupportDigest: safeText(decisionSupportBody?.digest),
    },
    qualityMarkAuditSummary: {
      status: qualitySearchOnly ? "unknown" : (safeText(qualityMark?.status) || "unknown"),
      checked: Boolean(qualityMark?.checked),
      evidenceRef: qualityMark?.evidenceRef ?? null,
      sourcesTried: qualitySources,
      checkedMode: qualitySearchOnly ? "search_only" : (qualityMark?.checkedMode ?? null),
      pagesFetchedCount: Number(qualityMark?.pagesFetchedCount ?? 0),
      searchPagesFetchedCount: Number(qualityMark?.searchPagesFetchedCount ?? 0),
      evidenceType: qualitySearchOnly ? "search" : (qualityMark?.evidenceType ?? null),
      note: qualityMark?.note ?? null,
    },
    nutriScoreCardV2: template.scoreCardV2 ?? null,
    generatedFromArtifacts,
    generatedFromArtifactsSha256: artifactHashes,
  };
  await fs.writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "barcode-only",
        barcode,
        brand: brandName,
        output: {
          md: mdPath,
          trace: tracePath,
          controlBundle: bundleControlPath,
          patchBundle: bundlePatchPath,
          decisionSupport: decisionSupportPath,
          patchStatus: patchStatusPath,
        },
      },
      null,
      2,
    ),
  );
};

const main = async () => {
  if (barcodeOnly) {
    await runBarcodeOnlyMode();
    return;
  }
  await fs.mkdir(outputDir, { recursive: true });

  const [impact, diagnostics, safeSubset, safeFallback, brandUx] = await Promise.all([
    readJson(impactPath),
    readJson(diagnosticsPath),
    readJson(safeSubsetPath),
    readJson(safeFallbackPath),
    readJson(brandUxReportPath),
  ]);
  const candidates = (impact?.products ?? []).filter((row) =>
    row?.sourceType &&
    (String(row.sourceType).toLowerCase() === "dsld" || String(row.sourceType).toLowerCase() === "lnhpd") &&
    row?.delta?.directions_added === true &&
    row?.current?.best_for === true &&
    row?.current?.before_you_buy === true &&
    String(row?.barcode_gtin14 ?? "").trim().length >= 8,
  );
  let selectedFromAuto = candidates[0] ?? null;
  if (!barcodeArg && autoSelect && candidates.length > 1) {
    for (const candidate of candidates) {
      const slug = String(candidate?.brandName ?? "brand")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      const cachedPatchBundlePath = path.join(outputDir, `demo_bundle_patch_${slug}_${String(candidate?.barcode_gtin14 ?? "").trim()}.json`);
      // Prefer an already-cached sample first so --auto-select works even when staging endpoints are offline.
      // eslint-disable-next-line no-await-in-loop
      if (await fileExists(cachedPatchBundlePath)) {
        selectedFromAuto = candidate;
        break;
      }
    }
  }
  const barcode = String(barcodeArg ?? selectedFromAuto?.barcode_gtin14 ?? "00766536026586").trim();
  const productImpact = (impact?.products ?? []).find((p) => String(p?.barcode_gtin14 ?? "") === barcode);
  if (!productImpact) throw new Error(`Barcode ${barcode} not found in product impact report`);
  const diagnosticsRow = (diagnostics ?? []).find((row) => String(row?.barcode_gtin14 ?? "") === barcode) ?? null;

  const brandRuntime = (brandUx?.brands ?? []).find(
    (row) => String(row?.brandName ?? "").toLowerCase() === String(productImpact.brandName ?? "").toLowerCase() && String(row?.market ?? "") === String(productImpact.market ?? ""),
  );

  const brandSlug = String(productImpact.brandName ?? "brand")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const bundleControlPath = path.join(outputDir, `demo_bundle_control_${brandSlug}_${barcode}.json`);
  const bundlePatchPath = path.join(outputDir, `demo_bundle_patch_${brandSlug}_${barcode}.json`);
  const decisionSupportPath = path.join(outputDir, `demo_decision_support_${brandSlug}_${barcode}.json`);
  const mdPath = path.join(outputDir, `demo_ui_example_${brandSlug}_${barcode}.md`);
  const tracePath = path.join(outputDir, `demo_ui_example_trace_${brandSlug}_${barcode}.json`);

  const readJsonIfExists = async (p) => {
    try {
      return await readJson(p);
    } catch {
      return null;
    }
  };
  const existingControlArtifact = await readJsonIfExists(bundleControlPath);
  const existingPatchArtifact = await readJsonIfExists(bundlePatchPath);
  const existingDecisionArtifact = await readJsonIfExists(decisionSupportPath);

  const controlSse = await fetchSse(`${controlBaseUrl}/api/enrich-stream`, { barcode }, 28000);
  const patchSse = await fetchSse(`${patchBaseUrl}/api/enrich-stream`, { barcode }, 28000);

  const controlBundle = pickBundle(controlSse.events) ?? existingControlArtifact?.bundle ?? null;
  const patchBundle = pickBundle(patchSse.events) ?? existingPatchArtifact?.bundle ?? null;
  const patchSnapshot = pickLastEventData(patchSse.events, "snapshot") ?? existingPatchArtifact?.snapshot ?? null;
  if (!patchBundle) throw new Error("Patch bundle not found from SSE or existing artifact");

  const decisionSupportUrl = `${patchBaseUrl}/api/decision-support/v1?barcode=${encodeURIComponent(barcode)}&viewMode=details`;
  let decisionSupportStatus = 0;
  let decisionSupportBody = existingDecisionArtifact?.body ?? null;
  let decisionSupportError = null;
  try {
    const decisionSupportResp = await fetch(decisionSupportUrl, {
      headers: {
        accept: "application/json",
        ...(authDisabledHeader ? { "X-Auth-Disabled": "1" } : {}),
      },
    });
    decisionSupportStatus = decisionSupportResp.status;
    const body = await decisionSupportResp.json();
    if (!decisionSupportResp.ok) {
      decisionSupportError = `Decision support failed: ${decisionSupportResp.status}`;
    } else {
      decisionSupportBody = body;
      decisionSupportError = null;
    }
  } catch (error) {
    decisionSupportError = error instanceof Error ? error.message : String(error);
  }
  if (!decisionSupportBody) {
    throw new Error(`Decision support unavailable from live API and artifact: ${decisionSupportError ?? "unknown error"}`);
  }

  let qualityMarkAudit = null;
  try {
    qualityMarkAudit = await readJson(qualityMarkAuditPath);
  } catch {
    qualityMarkAudit = null;
  }

  await Promise.all([
    fs.writeFile(
      bundleControlPath,
      JSON.stringify(
        {
          baseUrl: controlBaseUrl,
          barcode,
          ok: !controlSse.error || Boolean(existingControlArtifact?.bundle),
          error: controlSse.error,
          bundle: controlBundle,
          source: pickBundle(controlSse.events) ? "live_sse" : "existing_artifact",
        },
        null,
        2,
      ),
    ),
    fs.writeFile(
      bundlePatchPath,
      JSON.stringify(
        {
          baseUrl: patchBaseUrl,
          barcode,
          ok: !patchSse.error || Boolean(existingPatchArtifact?.bundle),
          error: patchSse.error,
          bundle: patchBundle,
          snapshot: patchSnapshot,
          source: pickBundle(patchSse.events) ? "live_sse" : "existing_artifact",
        },
        null,
        2,
      ),
    ),
    fs.writeFile(
      decisionSupportPath,
      JSON.stringify(
        {
          url: decisionSupportUrl,
          status: decisionSupportStatus || existingDecisionArtifact?.status || 0,
          body: decisionSupportBody,
          source: decisionSupportStatus >= 200 && decisionSupportStatus < 300 ? "live_api" : "existing_artifact",
          error: decisionSupportError,
        },
        null,
        2,
      ),
    ),
  ]);

  const signalKey = String(diagnosticsRow?.matchedSafeSignal ?? diagnosticsRow?.ingredientToken ?? "").toLowerCase();
  const safeSignalSubset = safeSubset?.signalsByIngredient?.[signalKey] ?? null;
  const safeSignalFallback = safeFallback?.signalsByIngredient?.[signalKey] ?? null;

  // Prefer subset when present, but allow fallback to fill missing structures.
  const bestForRaw = uniqLines([
    ...(safeSignalSubset?.best_for_bullets ?? []),
    ...(safeSignalFallback?.best_for_fallback ?? []),
  ]).filter((line) => !hasBannedFluff(line));
  const evidenceRaw = uniqLines([
    ...(safeSignalSubset?.evidence_lines ?? []),
    ...(safeSignalFallback?.comparison_fallback ?? []),
    ...(safeSignalFallback?.evidence_lines ?? []),
  ]).filter((line) => !hasBannedFluff(line));
  const beforeBuyLine =
    safeText(safeSignalSubset?.before_you_buy_line) ||
    safeText(safeSignalFallback?.before_you_buy_line) ||
    "Verify product-specific directions and caution text on the package before purchase.";

  const label = patchSnapshot?.label ?? {};
  const product = patchSnapshot?.product ?? {};
  const activeRows = Array.isArray(label?.actives) ? label.actives : [];
  const keyActives = activeRows.filter((item) => !SUPPLEMENT_NUTRITION_FIELDS.has(String(item?.name ?? "").toLowerCase()));
  const activeDisplay = (keyActives.length ? keyActives : activeRows)
    .slice(0, 4)
    .map((item) => ({
      name: safeText(item?.name),
      dose: formatDose(item),
    }))
    .filter((item) => item.name);

  const dosageForm = safeText(label?.servingSize) || safeText(patchBundle?.sections?.usage?.cover?.bestTimeToTake?.text);
  const chemicalForm = formFromProductName(product?.name ?? productImpact?.productName);
  const directionsAdded = productImpact?.delta?.directions_added === true;

  const runtimeByBatch = [];
  try {
    const batchesDir = path.join(nightlyDir, "phase_d", "batches");
    const batchNames = await fs.readdir(batchesDir);
    for (const batchName of batchNames) {
      const gatePath = path.join(batchesDir, batchName, "batch_gate_report.json");
      try {
        const gate = JSON.parse(await fs.readFile(gatePath, "utf8"));
        const brandName = String(gate?.brandName ?? "");
        const seedBrand = String(gate?.seedBrand ?? "");
        if (
          brandName.toLowerCase() === String(productImpact.brandName ?? "").toLowerCase() ||
          seedBrand.toLowerCase() === String(productImpact.brandName ?? "").toLowerCase()
        ) {
          runtimeByBatch.push({
            batchId: batchName,
            runtimePatchHitCountDelta: Number(gate?.runtimePatchHitCountDelta ?? 0),
          });
        }
      } catch {
        // ignore batch parse failures
      }
    }
  } catch {
    // optional
  }
  runtimeByBatch.sort((a, b) => b.runtimePatchHitCountDelta - a.runtimePatchHitCountDelta);

  let attributedBatchDelta = Number(runtimeByBatch[0]?.runtimePatchHitCountDelta ?? 0);
  if (Array.isArray(brandRuntime?.attributedByBatchIds) && brandRuntime.attributedByBatchIds.length > 0) {
    for (const batchId of brandRuntime.attributedByBatchIds) {
      const gatePath = path.join(nightlyDir, "phase_d", "batches", String(batchId), "batch_gate_report.json");
      try {
        const gate = JSON.parse(await fs.readFile(gatePath, "utf8"));
        const delta = Number(gate?.runtimePatchHitCountDelta ?? gate?.metrics?.runtimePatchHitCountDelta ?? 0);
        if (delta > attributedBatchDelta) attributedBatchDelta = delta;
      } catch {
        // keep best known value
      }
    }
  }

  const template = {
    overview: decisionSupportBody?.overviewBlock ?? null,
    science: decisionSupportBody?.scienceBlock ?? null,
    usage: decisionSupportBody?.usageBlock ?? null,
    safety: decisionSupportBody?.safetyBlock ?? null,
    qualityMark: decisionSupportBody?.qualityMark ?? null,
  };
  const qualityMarkAuditRow =
    Array.isArray(qualityMarkAudit?.rows)
      ? qualityMarkAudit.rows.find(
          (row) => String(row?.barcode_gtin14 ?? "") === barcode || String(row?.identityKey ?? "") === String(productImpact.identityKey ?? ""),
        ) ?? null
      : null;

  const templateQualityMark = template.qualityMark ?? {};
  const qualityMarkCheckedMode = safeText(
    templateQualityMark?.checkedMode ?? qualityMarkAuditRow?.checkedMode ?? "",
  );
  const qualityMarkEvidenceType = safeText(
    templateQualityMark?.evidenceType ?? qualityMarkAuditRow?.evidenceType ?? "",
  );
  const qualityMarkEvidenceRef = safeText(
    templateQualityMark?.evidenceRef ?? qualityMarkAuditRow?.evidenceRef ?? "",
  );
  const qualityMarkSearchOnly = qualityMarkCheckedMode === "search_only" ||
    qualityMarkEvidenceType === "search" ||
    /duckduckgo\.com\/html\/\?q=/i.test(qualityMarkEvidenceRef);
  const effectiveQualityMarkStatus = qualityMarkSearchOnly
    ? "unknown"
    : safeText(templateQualityMark?.status ?? qualityMarkAuditRow?.status ?? "unknown");
  const effectiveQualityMarkNote = qualityMarkSearchOnly
    ? "unknown (search-only evidence; no verified mark page/image found yet)"
    : safeText(templateQualityMark?.note) || effectiveQualityMarkStatus;

  const sourcesLines = uniqLines([
    ...(template.overview?.sourceStrip ?? []),
    `Official record (${String(productImpact?.sourceType ?? "unknown").toUpperCase()})`,
    "Scanned label (patch/label)",
    diagnosticsRow?.signalSource === "subset"
      ? "General science (NIH ODS verified subset)"
      : diagnosticsRow?.signalSource === "fallback"
        ? "General science (NIH ODS fallback guidance)"
        : "General science (NIH ODS)",
    "AI summary (grounded)",
  ]);

  const fallbackBestFor = uniqLines(bestForRaw).slice(0, 3);
  const overviewBestForRaw = uniqLines([
    ...(template.overview?.bestForBullets ?? []),
    ...fallbackBestFor,
  ]).slice(0, 6);
  const isOmega3 = signalKey === "fish_oil_omega3";
  const bestForPrimary = getPrefixedLine(
    overviewBestForRaw,
    "Best for:",
    isOmega3
      ? "Best for: increasing omega-3 intake as part of a heart/vascular-support routine."
      : "Best for: comparing ingredient support based on clear label disclosure.",
  );
  const bestForSecondary = getPrefixedLine(
    overviewBestForRaw,
    "Good if you want:",
    isOmega3
      ? "Good if you want: products with clear EPA+DHA per serving (easier to compare strength)."
      : "Good if you want: clear per-serving disclosure so products are easier to compare.",
  );
  const bestForTertiary = getPrefixedLine(
    overviewBestForRaw,
    "Not ideal if:",
    isOmega3
      ? "Not ideal if: the label does not disclose EPA+DHA, because fish-oil mg alone is a weak strength signal."
      : "Not ideal if: key disclosure is missing, because comparison confidence drops quickly.",
  );

  const provides = template.overview?.providesVerified ?? {};
  const servingSizeRaw = safeText(provides?.servingSize || label?.servingSize || "");
  const servingSizeDisplay = servingSizeRaw
    ? servingSizeRaw.replace(/softgel\(s\)/gi, "softgel").replace(/\s+/g, " ").trim()
    : "not stated";
  const servingsPerContainer =
    provides?.servingsPerContainer !== undefined && provides?.servingsPerContainer !== null
      ? provides.servingsPerContainer
      : label?.servingsPerContainer;
  const keyIngredientLine = (() => {
    const source = (Array.isArray(provides?.keyIngredients) && provides.keyIngredients.length > 0)
      ? provides.keyIngredients[0]
      : activeDisplay[0];
    if (!source?.name) return "Key ingredient: not clearly stated in official record.";
    const normalizedName = String(source.name).replace(/\s+/g, " ").trim();
    const dose = safeText(source?.dose || "");
    return dose
      ? `Key ingredient: ${normalizedName} ${dose} per serving.`
      : `Key ingredient: ${normalizedName}.`;
  })();

  const missingInfo = uniqLines(
    (template.overview?.missingInfo ?? []).map((line) => safeText(line)).filter(Boolean),
  ).slice(0, 2);
  const missingInfoLine = missingInfo.length > 0
    ? missingInfo.join("; ")
    : "No high-impact missing fields were flagged in this sample.";
  const singleCta = safeText(template.overview?.singleCta?.label) || "Scan Directions + Warnings panel on the bottle.";

  const scienceNames = uniqLines([
    ...(template.science?.ingredientSnapshotNames ?? []),
    ...activeDisplay.map((item) => item.name),
  ]).slice(0, 8);
  const ingredientSnapshotPrimary = (() => {
    const base = scienceNames[0] || activeDisplay[0]?.name || "ingredient not stated";
    if (/superba krill oil/i.test(base)) return "Krill oil (Superba)";
    return base;
  })();
  const scienceFormChemical = safeText(template.science?.formMatters?.ingredientChemicalForm) ||
    (chemicalForm ? startsUpper(chemicalForm) : "not stated in the official record");
  const scienceFormDosage = safeText(template.science?.formMatters?.dosageForm) ||
    (dosageForm || "not stated in the official record");
  const odsBullets = uniqLines([
    ...(template.science?.odsGeneralScienceBullets ?? []),
    ...evidenceRaw,
  ]).slice(0, 3);
  const aiSummary3 = uniqLines(
    Array.isArray(template.science?.aiSummaryContract3) ? template.science.aiSummaryContract3 : [],
  ).map((line) => normalizeTerminalPunctuation(line)).slice(0, 3);
  while (aiSummary3.length < 3) {
    aiSummary3.push(
      aiSummary3.length === 0
        ? "Often used to support goal-oriented supplement routines (general science)."
        : aiSummary3.length === 1
          ? `This product provides ${keyIngredientLine.replace(/^Key ingredient:\s*/i, "").replace(/\.$/, "")}, but disclosure gaps affect how easy it is to compare.`
          : `Main limitation: ${missingInfo[0] ?? "label transparency is incomplete"}. Next step: ${singleCta.replace(/[.]+$/, "")}.`,
    );
  }
  for (let i = 0; i < aiSummary3.length; i += 1) {
    aiSummary3[i] = normalizeTerminalPunctuation(aiSummary3[i]);
  }

  const usageDirectionsLines = uniqLines([
    ...(template.usage?.directions?.lines ?? []),
    safeText(template.usage?.directions?.text),
  ]).slice(0, 4);
  const hasDirectionsVisible = Boolean(template.usage?.directions?.hasDirectionsTextVisible);
  if (usageDirectionsLines.length === 0) {
    if (hasDirectionsVisible) {
      usageDirectionsLines.push("Directions are shown from scanned label in this view.");
    } else {
      usageDirectionsLines.push("Directions are not included in the official record.");
      usageDirectionsLines.push("Please use the bottle's Directions panel to confirm daily serving and schedule.");
      usageDirectionsLines.push(`Serving cue (verified): ${servingSizeDisplay} per serving (serving != daily dose).`);
    }
  }
  const usageTimingTip = safeText(template.usage?.timingTip) || "Build a consistent routine after confirming label directions.";
  const usageConservative = safeText(template.usage?.conservativeGuidance) || "If unsure, start with the lowest label-suggested daily amount and reassess tolerance.";

  const safetySignals = patchBundle?.sections?.safety?.signals ?? {};
  const labelWarnings = uniqLines([
    ...(template.safety?.labelWarnings ?? []),
    ...(safetySignals?.labelWarnings ?? []).map((w) => safeText(w?.text)),
  ]).slice(0, 3);
  const ulSignals = uniqLines([
    ...(template.safety?.ulGuidance ?? []),
    ...(safetySignals?.ulSignals ?? []).map((u) => safeText(u?.text)),
  ]).slice(0, 3);
  const watchouts = uniqLines([
    ...(template.safety?.generalWatchouts ?? []),
    ...(safetySignals?.odsWatchouts ?? []).map((w) => safeText(w?.text)),
    ...((patchBundle?.sections?.safety?.detail?.consultDoctorIf ?? []).map((w) => safeText(w?.text))),
  ]).slice(0, 4);
  const dataStatus = safeText(template.safety?.dataStatusRef) || "See Missing info in Overview (shown once to avoid repetition).";

  const summaryTop =
    "This page is now easier for buying decisions because it translates record facts into clear compare-and-buy checks instead of generic supplement copy.";
  const sourceTypeLabel = String(productImpact?.sourceType ?? "unknown").toUpperCase();
  const identityDisplay = safeText(productImpact?.identityKey || "unknown");
  const retrievedRaw =
    safeText(patchSnapshot?.analysis?.labelExtraction?.fetchedAt) ||
    safeText(patchBundle?.meta?.factsSourceVersion) ||
    safeText(patchBundle?.meta?.revision);
  const viewSourcesLine = `View sources: ${qualityMarkEvidenceRef || decisionSupportUrl}`;

  const mdLines = [];
  mdLines.push("# Demo UI Example");
  mdLines.push("");
  mdLines.push(summaryTop);
  mdLines.push("");
  mdLines.push(`- Brand: ${productImpact.brandName}`);
  mdLines.push(`- Product: ${productImpact.productName}`);
  mdLines.push(`- Barcode: ${barcode}`);
  mdLines.push(`- Identity: ${identityDisplay}`);
  mdLines.push(`- Source type: ${productImpact.sourceType}`);
  mdLines.push("");
  const coercedV2Card = coerceNutriScoreCardV2(decisionSupportBody);
  const v2Lines = renderNutriScoreCardV2Lines(coercedV2Card);
  if (v2Lines.length > 0) {
    mdLines.push(...v2Lines);
  }
  mdLines.push("## 1) Product Overview");
  mdLines.push("");
  mdLines.push("### Source strip");
  mdLines.push(`- Official record: ${sourceTypeLabel} (${identityDisplay})`);
  mdLines.push(`- Label used: ${hasDirectionsVisible ? "Yes (scanned-label patch applied)" : "Yes (evidence captured; directions/warnings text not extracted yet)"}`);
  mdLines.push(`- Retrieved: ${retrievedRaw || "from record"}`);
  mdLines.push(`- ${viewSourcesLine}`);
  mdLines.push("");
  mdLines.push("### Best for");
  mdLines.push(`- ${bestForPrimary}`);
  mdLines.push(`- ${bestForSecondary}`);
  mdLines.push(`- ${bestForTertiary}`);
  mdLines.push("");
  mdLines.push("### What this product provides (verified)");
  mdLines.push(`- Serving size: ${servingSizeDisplay}`);
  if (servingsPerContainer !== undefined && servingsPerContainer !== null) {
    mdLines.push(`- Servings per container: ${servingsPerContainer}`);
  }
  mdLines.push(`- ${keyIngredientLine}`);
  mdLines.push("");
  mdLines.push("### Missing info (single CTA)");
  mdLines.push(`- Missing from official record: ${missingInfoLine}`);
  mdLines.push(`- To improve accuracy: ${singleCta.replace(/\.$/, "")}.`);
  mdLines.push("");
  mdLines.push("## 2) Science & Ingredients");
  mdLines.push("");
  mdLines.push("### Verified ingredient snapshot (names only)");
  mdLines.push(`- ${ingredientSnapshotPrimary}`);
  mdLines.push("");
  mdLines.push("### Form matters (two forms, no confusion)");
  mdLines.push(`- Ingredient form (chemical): ${scienceFormChemical}.`);
  mdLines.push(`- Dosage form: ${scienceFormDosage}.`);
  mdLines.push("");
  mdLines.push("### NIH ODS (general science, short)");
  for (const line of odsBullets.slice(0, 3)) {
    mdLines.push(`- ${line}`);
  }
  mdLines.push("");
  mdLines.push("### AI summary (buying explanation, 3 sentences)");
  for (const line of aiSummary3) {
    mdLines.push(`- ${line}`);
  }
  mdLines.push("");
  mdLines.push("## 3) Practical Usage");
  mdLines.push("");
  mdLines.push("### Directions (from label / record)");
  for (const line of usageDirectionsLines) {
    mdLines.push(`- ${line}`);
  }
  mdLines.push("");
  mdLines.push("### Timing tip (general)");
  mdLines.push(`- ${usageTimingTip}`);
  mdLines.push("");
  mdLines.push("### Conservative guidance (general)");
  mdLines.push(`- ${usageConservative}`);
  mdLines.push("");
  mdLines.push("## 4) Safety & Tips");
  mdLines.push("");
  mdLines.push("### Label warnings (product-specific)");
  for (const line of (labelWarnings.length > 0
    ? labelWarnings
    : [
      "Product-specific label warnings were not included in the official record.",
      "Check the bottle's Warnings/Cautions panel.",
    ])) {
    mdLines.push(`- ${line}`);
  }
  mdLines.push("");
  mdLines.push("### Upper limit (NIH ODS, general)");
  for (const line of (ulSignals.length > 0
    ? ulSignals
    : [
      "NIH ODS does not set a single UL for omega-3 in the same way as some vitamins/minerals.",
      "General tip: consider total intake from all sources and follow label guidance.",
    ])) {
    mdLines.push(`- ${line}`);
  }
  mdLines.push("");
  mdLines.push("### General watch-outs (general)");
  for (const line of (watchouts.length > 0
    ? watchouts
    : [
      "If pregnant/nursing or taking blood thinners / preparing for surgery, confirm with a clinician and read label cautions.",
      "Stop/adjust if you notice unexpected effects and consult a professional.",
    ])) {
    mdLines.push(`- ${line}`);
  }
  mdLines.push("");
  mdLines.push("### Data status");
  mdLines.push(`- ${dataStatus}`);
  mdLines.push("");
  mdLines.push("### Third-party quality mark (Integrity helper)");
  mdLines.push(`- Status: ${effectiveQualityMarkNote}`);
  if (qualityMarkEvidenceRef) mdLines.push(`- Evidence: ${qualityMarkEvidenceRef}`);
  const qualityMarkSources = Array.isArray(templateQualityMark?.sourcesTried)
    ? templateQualityMark.sourcesTried
    : Array.isArray(qualityMarkAuditRow?.sourcesTried)
      ? qualityMarkAuditRow.sourcesTried
      : [];
  if (qualityMarkSources.length > 0) {
    mdLines.push(`- Sources searched: ${qualityMarkSources.join(", ")}`);
  }

  // Lint: prevent obvious contradictions / fluff.
  const mdText = mdLines.join("\n");
  const lintErrors = [];
  const hasDirectionsMissingPhrase = /does not include dosage directions yet|directions are not provided in this record|directions are not included in the official record/i.test(mdText);
  const hasDirectionsPatchedClarifier = /shown from scanned label|from scanned label|official record|bottle'?s directions panel/i.test(mdText);
  if (directionsAdded && hasDirectionsMissingPhrase && !hasDirectionsPatchedClarifier) {
    lintErrors.push("Directions contradiction: directions_added=true but text says missing without clarifying visible-check state.");
  }
  if ((productImpact.productName || "").toLowerCase().includes("ubiquinol") && /\bubiquinone is a common form\b/i.test(mdText)) {
    lintErrors.push("CoQ10 form mismatch: product is ubiquinol but best-for line claims ubiquinone without comparison framing.");
  }
  if (/normal function|day-to-day wellness|general wellness/i.test(mdText)) {
    lintErrors.push("Fluff wording detected.");
  }
  if (!/Best for:/i.test(mdText) || !/Good if you want:/i.test(mdText) || !/Not ideal if:/i.test(mdText)) {
    lintErrors.push("Best-for contract incomplete: expected Best for / Good if you want / Not ideal if lines.");
  }
  if (lintErrors.length) {
    throw new Error(`Demo lint failed:\n- ${lintErrors.join("\n- ")}`);
  }

  await fs.writeFile(mdPath, `${mdText}\n`, "utf8");

  const generatedFromArtifacts = [
    impactPath,
    diagnosticsPath,
    brandUxReportPath,
    safeSubsetPath,
    safeFallbackPath,
    qualityMarkAuditPath,
    bundleControlPath,
    bundlePatchPath,
    decisionSupportPath,
  ];

  const artifactHashes = {};
  for (const artifactPath of generatedFromArtifacts) {
    try {
      // eslint-disable-next-line no-await-in-loop
      artifactHashes[artifactPath] = await sha256File(artifactPath);
    } catch {
      artifactHashes[artifactPath] = null;
    }
  }

  const traceQualitySummaryCandidate = qualityMarkAuditRow
    ? {
        status: safeText(qualityMarkAuditRow.status || templateQualityMark?.status || effectiveQualityMarkStatus),
        checked: Boolean(qualityMarkAuditRow.checked ?? templateQualityMark?.checked),
        confidence: Number.isFinite(Number(qualityMarkAuditRow.confidence))
          ? Number(qualityMarkAuditRow.confidence)
          : Number.isFinite(Number(templateQualityMark?.confidence))
            ? Number(templateQualityMark.confidence)
            : null,
        evidenceRef: qualityMarkAuditRow.evidenceRef ?? templateQualityMark?.evidenceRef ?? null,
        sourcesTried: Array.isArray(qualityMarkAuditRow.sourcesTried) && qualityMarkAuditRow.sourcesTried.length > 0
          ? qualityMarkAuditRow.sourcesTried
          : Array.isArray(templateQualityMark?.sourcesTried)
            ? templateQualityMark.sourcesTried
            : [],
        checkedMode: qualityMarkAuditRow.checkedMode ?? templateQualityMark?.checkedMode ?? null,
        pagesFetchedCount: Number.isFinite(Number(qualityMarkAuditRow.pagesFetchedCount))
          ? Number(qualityMarkAuditRow.pagesFetchedCount)
          : Number.isFinite(Number(templateQualityMark?.pagesFetchedCount))
            ? Number(templateQualityMark.pagesFetchedCount)
            : 0,
        searchPagesFetchedCount: Number.isFinite(Number(qualityMarkAuditRow.searchPagesFetchedCount))
          ? Number(qualityMarkAuditRow.searchPagesFetchedCount)
          : Number.isFinite(Number(templateQualityMark?.searchPagesFetchedCount))
            ? Number(templateQualityMark.searchPagesFetchedCount)
            : 0,
        evidenceType: qualityMarkAuditRow.evidenceType ?? templateQualityMark?.evidenceType ?? null,
      }
    : {
        status: effectiveQualityMarkStatus,
        checked: Boolean(templateQualityMark?.checked),
        confidence: Number.isFinite(Number(templateQualityMark?.confidence))
          ? Number(templateQualityMark.confidence)
          : null,
        evidenceRef: qualityMarkEvidenceRef || null,
        sourcesTried: Array.isArray(templateQualityMark?.sourcesTried) ? templateQualityMark.sourcesTried : [],
        checkedMode: templateQualityMark?.checkedMode ?? null,
        pagesFetchedCount: Number.isFinite(Number(templateQualityMark?.pagesFetchedCount))
          ? Number(templateQualityMark.pagesFetchedCount)
          : 0,
        searchPagesFetchedCount: Number.isFinite(Number(templateQualityMark?.searchPagesFetchedCount))
          ? Number(templateQualityMark.searchPagesFetchedCount)
          : 0,
        evidenceType: templateQualityMark?.evidenceType ?? null,
      };

  const traceQualitySearchOnly = traceQualitySummaryCandidate.checkedMode === "search_only" ||
    traceQualitySummaryCandidate.evidenceType === "search" ||
    /duckduckgo\.com\/html\/\?q=/i.test(String(traceQualitySummaryCandidate.evidenceRef ?? ""));
  const traceQualitySummary = traceQualitySearchOnly
    ? {
        ...traceQualitySummaryCandidate,
        status: "unknown",
        checkedMode: "search_only",
        evidenceType: "search",
      }
    : traceQualitySummaryCandidate;

  const trace = {
    generatedAt: new Date().toISOString(),
    brand: productImpact.brandName,
    barcode,
    identityKey: productImpact.identityKey,
    sourceTypeFinal: productImpact.sourceType,
    usedPatchLanes: ["patch_directions_text_v1"],
    runtimeHitEvidence: {
      brandRuntimeHitCount: Number(brandRuntime?.runtimeHitCount ?? 0),
      runtimeAttributionStatus: safeText(brandRuntime?.runtimeAttributionStatus || "unknown"),
      attributedByBatchIds: Array.isArray(brandRuntime?.attributedByBatchIds)
        ? brandRuntime.attributedByBatchIds
        : runtimeByBatch.map((row) => row.batchId),
      batchRuntimePatchHitCountDelta: attributedBatchDelta,
      decisionSupportDigest: safeText(decisionSupportBody?.digest || null),
    },
    qualityMarkAuditSummary: traceQualitySummary,
    nutriScoreCardV2: coercedV2Card ?? null,
    sampleSelection: {
      enforced_and_visible: true,
      directions_added: productImpact?.delta?.directions_added === true,
      best_for_visible: productImpact?.current?.best_for === true,
      before_you_buy_completeness: productImpact?.current?.before_you_buy === true,
      signalSource: diagnosticsRow?.signalSource ?? "none",
      matchedSafeSignal: diagnosticsRow?.matchedSafeSignal ?? null,
    },
    generatedFromArtifacts,
    generatedFromArtifactsSha256: artifactHashes,
    notes: [
      "Demo content generated from live enrich-stream SSE bundle + decision-support + nightly reports.",
      "Overview and Science are de-duplicated by section ownership rules.",
      "Directions wording follows contradiction lint for directions_added semantics.",
      "Patch pipeline remains scanned_label-only and overlay-only.",
    ],
  };
  await fs.writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        barcode,
        brand: productImpact.brandName,
        output: {
          md: mdPath,
          trace: tracePath,
          controlBundle: bundleControlPath,
          patchBundle: bundlePatchPath,
          decisionSupport: decisionSupportPath,
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
