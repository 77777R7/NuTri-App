#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const readArg = (name, fallback = null) => {
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return argv[idx + 1] ?? fallback;
};

const barcode = String(readArg("barcode", "00023249011835") ?? "").trim();
if (!barcode) {
  console.error("[overlay-audit] missing --barcode");
  process.exit(1);
}

const apiBase = String(readArg("api-base", process.env.SEARCH_API_BASE_URL ?? "http://127.0.0.1:3001") ?? "").replace(/\/$/, "");
const outRoot = String(readArg("out-root", "output/deep_category_overlay_audit") ?? "").trim();
const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
const outDir = path.resolve(outRoot, ts);
const authDisabled = String(readArg("auth-disabled", "1")) === "1";

const headers = {
  Accept: "application/json",
};
if (authDisabled) headers["X-Auth-Disabled"] = "1";

const fetchDecisionSupport = async () => {
  const url = `${apiBase}/api/decision-support/v1?barcode=${encodeURIComponent(barcode)}&viewMode=details`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`decision-support failed: HTTP ${res.status} ${body.slice(0, 400)}`);
  }
  return res.json();
};

const hasBlocker = (payload, code) =>
  Array.isArray(payload?.blockers) && payload.blockers.some((item) => item?.code === code);

const getModuleChecklistItem = (payload, moduleId, keyFragment) => {
  const modules = Array.isArray(payload?.nutriScoreCardV2?.modules) ? payload.nutriScoreCardV2.modules : [];
  const module = modules.find((item) => item?.id === moduleId);
  const checklist = Array.isArray(module?.checklist) ? module.checklist : [];
  return checklist.find((item) => String(item?.key ?? "").includes(keyFragment)) ?? null;
};

const inferSourceFromLine = (line) => {
  const normalized = String(line ?? "").toLowerCase();
  if (/supplemental|overlay|iherb|product-page/.test(normalized)) return "overlay_iherb";
  if (/scanned label|patched/.test(normalized)) return "scanned_label";
  if (/nih ods|general science|watch-out/.test(normalized)) return "general_science";
  if (/official record|dsld|lnhpd/.test(normalized)) return "official_record";
  return "mixed";
};

const toFieldRow = ({
  module,
  field,
  renderedText,
  sourceOrigin,
  replacedFallback = false,
  resolvedBlockerCodes = [],
}) => ({
  module,
  field,
  renderedText,
  sourceOrigin,
  replacedFallback,
  resolvedBlockerCodes,
});

const buildAudit = (payload) => {
  const directionsChecklist = getModuleChecklistItem(payload, "label_clarity", "directions_present");
  const warningsChecklist = getModuleChecklistItem(payload, "label_clarity", "warnings_present");
  const breakdownChecklist = getModuleChecklistItem(payload, "formula_transparency", "breakdown_disclosed");
  const formChecklist = getModuleChecklistItem(payload, "formula_transparency", "chemical_form_disclosed");

  const directionsResolved = hasBlocker(payload, "missing_directions_dsld")
    ? (payload?.usageBlock?.directions?.hasDirectionsTextVisible === true)
    : false;
  const warningsResolved = (hasBlocker(payload, "warnings_missing_fixable") || hasBlocker(payload, "warnings_missing_ceiling"))
    ? String(warningsChecklist?.state ?? "") === "verified"
    : false;
  const breakdownResolved = hasBlocker(payload, "missing_active_breakdown")
    ? String(breakdownChecklist?.state ?? "") === "verified"
    : false;
  const formResolved = hasBlocker(payload, "missing_form_high_impact")
    ? String(formChecklist?.state ?? "") === "verified"
    : false;

  const resolvedCodes = {
    missing_directions_dsld: directionsResolved,
    warnings_missing_fixable: warningsResolved,
    warnings_missing_ceiling: warningsResolved,
    missing_active_breakdown: breakdownResolved,
    missing_form_high_impact: formResolved,
  };

  const fieldTrace = [];

  const overview = payload?.overviewBlock ?? {};
  for (const line of Array.isArray(overview?.sourceStrip) ? overview.sourceStrip : []) {
    fieldTrace.push(
      toFieldRow({
        module: "overview",
        field: "sourceStrip",
        renderedText: line,
        sourceOrigin: inferSourceFromLine(line),
      }),
    );
  }
  for (const line of Array.isArray(overview?.bestForBullets) ? overview.bestForBullets : []) {
    fieldTrace.push(
      toFieldRow({
        module: "overview",
        field: "bestFor",
        renderedText: line,
        sourceOrigin: "general_science",
      }),
    );
  }
  for (const row of Array.isArray(overview?.providesVerified?.keyIngredients) ? overview.providesVerified.keyIngredients : []) {
    const text = `${row?.name ?? "Ingredient"}${row?.dose ? `: ${row.dose}` : ""}`;
    const normalized = text.toLowerCase();
    const sourceOrigin = /omega|epa|dha|pollock|fish oil|krill/.test(normalized) && String(breakdownChecklist?.sourceTier ?? "") === "overlay_iherb"
      ? "overlay_iherb"
      : "official_record";
    fieldTrace.push(
      toFieldRow({
        module: "overview",
        field: "providesVerified.keyIngredients",
        renderedText: text,
        sourceOrigin,
      }),
    );
  }
  for (const line of Array.isArray(overview?.missingInfo) ? overview.missingInfo : []) {
    fieldTrace.push(
      toFieldRow({
        module: "overview",
        field: "missingInfo",
        renderedText: line,
        sourceOrigin: "official_record",
      }),
    );
  }

  const science = payload?.scienceBlock ?? {};
  for (const line of Array.isArray(science?.ingredientSnapshotNames) ? science.ingredientSnapshotNames : []) {
    const normalized = String(line ?? "").toLowerCase();
    const sourceOrigin = /omega|epa|dha|pollock|fish oil|krill/.test(normalized) && String(breakdownChecklist?.sourceTier ?? "") === "overlay_iherb"
      ? "overlay_iherb"
      : "official_record";
    fieldTrace.push(
      toFieldRow({
        module: "science",
        field: "ingredientSnapshotNames",
        renderedText: line,
        sourceOrigin,
      }),
    );
  }
  if (science?.formMatters?.ingredientChemicalForm) {
    fieldTrace.push(
      toFieldRow({
        module: "science",
        field: "formMatters.ingredientChemicalForm",
        renderedText: science.formMatters.ingredientChemicalForm,
        sourceOrigin: String(formChecklist?.sourceTier ?? "") || "official_record",
        replacedFallback: formResolved,
        resolvedBlockerCodes: formResolved ? ["missing_form_high_impact"] : [],
      }),
    );
  }
  for (const line of Array.isArray(science?.odsGeneralScienceBullets) ? science.odsGeneralScienceBullets : []) {
    fieldTrace.push(
      toFieldRow({
        module: "science",
        field: "odsGeneralScienceBullets",
        renderedText: line,
        sourceOrigin: "general_science",
      }),
    );
  }
  for (const line of Array.isArray(science?.aiSummaryContract3) ? science.aiSummaryContract3 : []) {
    fieldTrace.push(
      toFieldRow({
        module: "science",
        field: "aiSummaryContract3",
        renderedText: line,
        sourceOrigin: "mixed",
      }),
    );
  }

  const usage = payload?.usageBlock ?? {};
  const usageTier = usage?.directions?.sourceTier ?? "missing";
  const usageResolvedCodes = directionsResolved ? ["missing_directions_dsld"] : [];
  for (const line of Array.isArray(usage?.directions?.lines) ? usage.directions.lines : []) {
    fieldTrace.push(
      toFieldRow({
        module: "usage",
        field: "directions.lines",
        renderedText: line,
        sourceOrigin: usageTier,
        replacedFallback: directionsResolved,
        resolvedBlockerCodes: usageResolvedCodes,
      }),
    );
  }
  if (usage?.timingTip) {
    fieldTrace.push(
      toFieldRow({
        module: "usage",
        field: "timingTip",
        renderedText: usage.timingTip,
        sourceOrigin: "general_science",
      }),
    );
  }
  if (usage?.conservativeGuidance) {
    fieldTrace.push(
      toFieldRow({
        module: "usage",
        field: "conservativeGuidance",
        renderedText: usage.conservativeGuidance,
        sourceOrigin: "general_science",
      }),
    );
  }

  const safety = payload?.safetyBlock ?? {};
  const warningResolvedCodes = warningsResolved
    ? ["warnings_missing_fixable", "warnings_missing_ceiling"]
    : [];
  const warningOrigin = String(warningsChecklist?.sourceTier ?? "") || "official_record";
  for (const line of Array.isArray(safety?.labelWarnings) ? safety.labelWarnings : []) {
    fieldTrace.push(
      toFieldRow({
        module: "safety",
        field: "labelWarnings",
        renderedText: line,
        sourceOrigin: warningOrigin,
        replacedFallback: warningsResolved,
        resolvedBlockerCodes: warningResolvedCodes,
      }),
    );
  }
  for (const line of Array.isArray(safety?.ulGuidance) ? safety.ulGuidance : []) {
    fieldTrace.push(
      toFieldRow({
        module: "safety",
        field: "ulGuidance",
        renderedText: line,
        sourceOrigin: "general_science",
      }),
    );
  }
  for (const line of Array.isArray(safety?.generalWatchouts) ? safety.generalWatchouts : []) {
    fieldTrace.push(
      toFieldRow({
        module: "safety",
        field: "generalWatchouts",
        renderedText: line,
        sourceOrigin: "general_science",
      }),
    );
  }

  return {
    barcode,
    generatedAt: new Date().toISOString(),
    sourceType: payload?.sourceType ?? null,
    categoryId: payload?.categoryId ?? null,
    blockers: Array.isArray(payload?.blockers) ? payload.blockers : [],
    resolutionSummary: {
      missing_directions_dsld: {
        presentInBlockers: hasBlocker(payload, "missing_directions_dsld"),
        resolvedByOverlayOrLabel: directionsResolved,
      },
      warnings_missing: {
        presentInBlockers:
          hasBlocker(payload, "warnings_missing_fixable") || hasBlocker(payload, "warnings_missing_ceiling"),
        resolvedByOverlayOrLabel: warningsResolved,
      },
      missing_active_breakdown: {
        presentInBlockers: hasBlocker(payload, "missing_active_breakdown"),
        resolvedByOverlayOrLabel: breakdownResolved,
      },
      missing_form_high_impact: {
        presentInBlockers: hasBlocker(payload, "missing_form_high_impact"),
        resolvedByOverlayOrLabel: formResolved,
      },
    },
    fieldTrace,
  };
};

const toMarkdown = (audit) => {
  const lines = [];
  lines.push("# Sports Research Omega-3 Overlay Trace");
  lines.push("");
  lines.push(`- Barcode: \`${audit.barcode}\``);
  lines.push(`- Source Type: \`${audit.sourceType ?? "unknown"}\``);
  lines.push(`- Category: \`${audit.categoryId ?? "unknown"}\``);
  lines.push(`- Generated At: ${audit.generatedAt}`);
  lines.push("");
  lines.push("## Blocker Resolution Summary");
  lines.push("");
  for (const [code, summary] of Object.entries(audit.resolutionSummary ?? {})) {
    lines.push(
      `- \`${code}\`: present=${summary.presentInBlockers ? "yes" : "no"}, resolved=${summary.resolvedByOverlayOrLabel ? "yes" : "no"}`,
    );
  }
  lines.push("");
  lines.push("## Field Trace");
  lines.push("");
  lines.push("| Module | Field | Source | Replaced Fallback | Resolved Blockers | Rendered Text |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const row of audit.fieldTrace ?? []) {
    const blockers = Array.isArray(row.resolvedBlockerCodes) && row.resolvedBlockerCodes.length > 0
      ? row.resolvedBlockerCodes.join(", ")
      : "-";
    const rendered = String(row.renderedText ?? "").replace(/\|/g, "\\|");
    lines.push(
      `| ${row.module} | ${row.field} | ${row.sourceOrigin} | ${row.replacedFallback ? "yes" : "no"} | ${blockers} | ${rendered} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
};

const main = async () => {
  const payload = await fetchDecisionSupport();
  const audit = buildAudit(payload);
  fs.mkdirSync(outDir, { recursive: true });

  const filenameStem = barcode === "00023249011835" ? "sports_research_omega3_overlay_trace" : `overlay_trace_${barcode}`;
  const jsonPath = path.join(outDir, `${filenameStem}.json`);
  const mdPath = path.join(outDir, `${filenameStem}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, `${toMarkdown(audit)}\n`, "utf8");

  console.log(JSON.stringify({ status: "ok", jsonPath, mdPath }, null, 2));
};

main().catch((error) => {
  console.error("[overlay-audit] failed", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
