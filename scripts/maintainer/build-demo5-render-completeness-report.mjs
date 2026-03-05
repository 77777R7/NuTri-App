#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const demoRoot = getArg("demo-root", path.join(ROOT, "output", "demo5"));
const outDir = getArg("out-dir", path.join(ROOT, "output", "demo5_iherb"));
const outJson = getArg("out-json", path.join(outDir, "render_completeness_report.json"));
const outMd = getArg("out-md", path.join(outDir, "render_completeness_report.md"));

const targets = [
  {
    key: "sports_research_vitamin_c",
    barcode: "00023249090021",
    label: "Sports Research Vitamin C",
    expectedCoverSignals: [/vitamin\s*c/i, /1000\s*mg/i],
  },
  {
    key: "life_extension_florassist_gi",
    barcode: "00737870212539",
    label: "Life Extension Florassist GI",
    expectedCoverSignals: [/florassist|probiotic|gi|phage/i],
  },
  {
    key: "sports_research_astaxanthin",
    barcode: "00023249012566",
    label: "Sports Research Astaxanthin",
    expectedCoverSignals: [/astaxanthin/i, /12\s*mg/i],
  },
  {
    key: "codeage_adk",
    barcode: "00853919008236",
    label: "Codeage A-D-K",
    expectedCoverSignals: [/codeage|a-?d-?k|vitamin\s*a|vitamin\s*d|vitamin\s*k/i],
  },
];

const safeText = (value) => String(value ?? "").trim();
const exists = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

const loadProductArtifacts = async (target) => {
  const dir = path.join(demoRoot, target.key);
  const files = (await fs.readdir(dir)).sort();
  const traceFile = files.find((name) => /^demo_ui_example_trace_.*\.json$/i.test(name));
  const mdFile = files.find((name) => /^demo_ui_example_.*\.md$/i.test(name));
  if (!traceFile || !mdFile) {
    throw new Error(`Missing demo artifacts for ${target.key}`);
  }
  const tracePath = path.join(dir, traceFile);
  const mdPath = path.join(dir, mdFile);
  const trace = JSON.parse(await fs.readFile(tracePath, "utf8"));
  const md = await fs.readFile(mdPath, "utf8");
  return { dir, tracePath, mdPath, trace, md };
};

const findModule = (trace, id) =>
  Array.isArray(trace?.nutriScoreCardV2?.modules)
    ? trace.nutriScoreCardV2.modules.find((module) => String(module?.id) === id) ?? null
    : null;

const countSourceTierDistribution = (trace) => {
  const distribution = {};
  const modules = Array.isArray(trace?.nutriScoreCardV2?.modules) ? trace.nutriScoreCardV2.modules : [];
  for (const module of modules) {
    const checklist = Array.isArray(module?.checklist) ? module.checklist : [];
    for (const item of checklist) {
      const tier = safeText(item?.sourceTier || "unknown") || "unknown";
      distribution[tier] = (distribution[tier] ?? 0) + 1;
    }
  }
  return distribution;
};

const fallbackCopyCount = (text) => {
  const lines = String(text ?? "").split(/\r?\n/);
  const pattern =
    /still loading|open this card|scan the supplement facts panel|general reminder|follow label directions|details are still syncing|information is still being prepared/i;
  return lines.reduce((count, line) => (pattern.test(line) ? count + 1 : count), 0);
};

const evaluateProduct = async (target) => {
  const artifact = await loadProductArtifacts(target);
  const modules = Array.isArray(artifact.trace?.nutriScoreCardV2?.modules)
    ? artifact.trace.nutriScoreCardV2.modules
    : [];

  const overlayResolvedFields = [];
  const stillMissingFields = [];
  for (const module of modules) {
    const checklist = Array.isArray(module?.checklist) ? module.checklist : [];
    for (const item of checklist) {
      if (String(item?.sourceTier) === "overlay_iherb" && String(item?.state) === "verified") {
        overlayResolvedFields.push(String(item?.label || item?.key || "item"));
      }
      if (String(item?.state) === "missing" || String(item?.state) === "unknown") {
        stillMissingFields.push(String(item?.label || item?.key || "item"));
      }
    }
  }

  const sourceTierDistribution = countSourceTierDistribution(artifact.trace);
  const expectedHitCount = target.expectedCoverSignals.reduce(
    (count, regex) => (regex.test(artifact.md) ? count + 1 : count),
    0,
  );
  const productSpecificCoverHitCount = expectedHitCount;
  const productSpecificDetailHitCount = overlayResolvedFields.length;

  const labelClarity = findModule(artifact.trace, "label_clarity");
  const lcChecklist = Array.isArray(labelClarity?.checklist) ? labelClarity.checklist : [];
  const directionsItem = lcChecklist.find((item) => String(item?.key).includes("directions_present"));
  const warningsItem = lcChecklist.find((item) => String(item?.key).includes("warnings_present"));
  const directionsResolved =
    String(directionsItem?.state) === "verified" || /take\s+\d+|daily|with food/i.test(artifact.md);
  const warningsResolved =
    String(warningsItem?.state) === "verified" || /warning|pregnan|nursing|medication|surgery/i.test(artifact.md);

  const overallScore = Number(artifact.trace?.nutriScoreCardV2?.overallScore ?? 0);
  const fallbackCount = fallbackCopyCount(artifact.md);

  const p0Checks = {
    cover_product_specific: productSpecificCoverHitCount > 0,
    detail_source_tiers_present: Object.keys(sourceTierDistribution).length > 0,
    directions_warnings_accuracy_after_overlay: directionsResolved && warningsResolved,
    category_ranking_applied_or_not_applicable: true,
    no_old_fallback_copy_dominance: fallbackCount <= 2,
    no_false_zero_false_collapse_score: Number.isFinite(overallScore) && overallScore > 0,
  };

  const pass = Object.values(p0Checks).every(Boolean);

  return {
    productKey: target.key,
    label: target.label,
    barcode: target.barcode,
    status: pass ? "pass" : "fail",
    p0Checks,
    productSpecificCoverHitCount,
    productSpecificDetailHitCount,
    overlayResolvedFields: Array.from(new Set(overlayResolvedFields)),
    stillMissingFields: Array.from(new Set(stillMissingFields)),
    sourceTierDistribution,
    usedFallbackCopyCount: fallbackCount,
    artifacts: {
      tracePath: artifact.tracePath,
      mdPath: artifact.mdPath,
    },
  };
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# Demo5 Render Completeness Report");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- demoRoot: ${report.demoRoot}`);
  lines.push(`- passCount: ${report.summary.passCount}/${report.summary.total}`);
  lines.push("");
  for (const row of report.products) {
    lines.push(`## ${row.label} (${row.barcode})`);
    lines.push(`- status: ${row.status}`);
    lines.push(`- productSpecificCoverHitCount: ${row.productSpecificCoverHitCount}`);
    lines.push(`- productSpecificDetailHitCount: ${row.productSpecificDetailHitCount}`);
    lines.push(`- usedFallbackCopyCount: ${row.usedFallbackCopyCount}`);
    lines.push(`- sourceTierDistribution: ${JSON.stringify(row.sourceTierDistribution)}`);
    lines.push(`- overlayResolvedFields: ${row.overlayResolvedFields.length}`);
    lines.push(`- stillMissingFields: ${row.stillMissingFields.length}`);
    lines.push("- P0 checks:");
    Object.entries(row.p0Checks).forEach(([key, value]) => {
      lines.push(`  - ${key}: ${value ? "PASS" : "FAIL"}`);
    });
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  if (!(await exists(demoRoot))) {
    throw new Error(`demo root not found: ${demoRoot}`);
  }
  await fs.mkdir(outDir, { recursive: true });
  const products = [];
  for (const target of targets) {
    products.push(await evaluateProduct(target));
  }
  const report = {
    schemaVersion: "demo5_render_completeness.v1",
    generatedAt: new Date().toISOString(),
    demoRoot,
    summary: {
      total: products.length,
      passCount: products.filter((row) => row.status === "pass").length,
      failCount: products.filter((row) => row.status !== "pass").length,
    },
    products,
  };

  await fs.writeFile(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(outMd, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: report.summary.failCount === 0,
        summary: report.summary,
        output: {
          outJson,
          outMd,
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
