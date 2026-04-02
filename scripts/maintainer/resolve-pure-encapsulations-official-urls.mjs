#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeText } from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const DEFAULT_QUEUE_JSON = path.join(
  ROOT,
  "output",
  "scrapling_wave_manifest_stop-fix-v11",
  "brand_queues",
  "pure-encapsulations__official-browser-candidate.json",
);
const DEFAULT_HISTORY_JSON = path.join(
  ROOT,
  "output",
  "p0_p3_v1_strict_only_merge_cohort_20260318",
  "v1_strict_only_full_staging.json",
);
const DEFAULT_OUT_DIR = path.join(
  ROOT,
  "output",
  `pure_encapsulations_official_url_resolver_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
);

const QUEUE_JSON = path.resolve(ROOT, getArg("queue-json", DEFAULT_QUEUE_JSON));
const HISTORY_JSON = path.resolve(ROOT, getArg("history-staging-json", DEFAULT_HISTORY_JSON));
const OUT_DIR = path.resolve(ROOT, getArg("out-dir", DEFAULT_OUT_DIR));

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};

const toArray = (value) => (Array.isArray(value) ? value : []);
const lower = (value) => normalizeText(value).toLowerCase();

const NON_DISTINCTIVE_TOKENS = new Set([
  "pure",
  "encapsulations",
  "with",
  "without",
  "and",
  "or",
  "the",
  "capsule",
  "capsules",
  "softgel",
  "softgels",
  "tablet",
  "tablets",
  "packet",
  "packets",
  "powder",
  "liquid",
  "gummy",
  "gummies",
  "chewable",
  "chewables",
  "mg",
  "mcg",
  "iu",
  "oz",
  "g",
  "s",
]);

const FORM_PATTERNS = [
  "powder",
  "liquid",
  "gummy",
  "gummies",
  "chewable",
  "chewables",
  "capsule",
  "capsules",
  "softgel",
  "softgels",
  "tablet",
  "tablets",
  "packet",
  "packets",
];

const TITLE_ALIAS_PATTERNS = {
  "ultra b complex w pqq": [/ultra[-\s]?b[-\s]?complex with pqq/i],
  "ultra pure pack": [/ultra pure pack/i],
  "niacitol 650 mg": [/niacitol/i],
  "mineral 650 without copper and iron": [/nutrient 950.*without copper.*iron/i],
  "vitamin d3 250 mcg": [/vitamin d3.*250 mcg/i],
};

const toAsciiLower = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const normalizeCanonicalTitle = (value) => {
  let next = toAsciiLower(value)
    .replace(/&/g, " and ")
    .replace(/\bw\//g, "with ")
    .replace(/['’®™•()+]/g, " ")
    .replace(/\bmcg\b/g, " mcg ")
    .replace(/\bmg\b/g, " mg ")
    .replace(/\biu\b/g, " iu ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  next = next.replace(/\s+/g, " ");
  return next;
};

const stripPackagingWords = (value) =>
  normalizeCanonicalTitle(value)
    .replace(/\b(pure encapsulations|capsules?|softgels?|tablets?|packet|packets|powder|liquid|gummy|gummies|chewables?)\b/g, " ")
    .replace(/\b\d+\s*(count|capsules?|softgels?|tablets?|packets?|oz|g)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractDosageTokens = (value) => {
  const matches = normalizeCanonicalTitle(value).match(/\b\d+\s*(?:mg|mcg|iu)\b/g);
  return new Set(matches ?? []);
};

const tokenizeDistinctive = (value) =>
  normalizeCanonicalTitle(value)
    .split(" ")
    .filter((token) => token && !NON_DISTINCTIVE_TOKENS.has(token) && !/^\d+$/.test(token));

const extractForms = (value) => {
  const canonical = normalizeCanonicalTitle(value);
  return new Set(FORM_PATTERNS.filter((token) => canonical.includes(token)));
};

const tokensOverlapCount = (left, right) => {
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
};

const extractOfficialPageUrl = (row) =>
  toArray(row?.sourceSummary?.sourceUrls).find((url) =>
    /^https?:\/\/(www\.)?pureencapsulationspro\.com\/.+\.html(?:[?#].*)?$/i.test(String(url ?? "")),
  ) ?? null;

const extractOfficialPdfUrl = (row) =>
  toArray(row?.sourceSummary?.sourceUrls).find((url) =>
    /^https?:\/\/(www\.)?pureencapsulationspro\.com\/media\/pdf_upload\/.+\.pdf(?:[?#].*)?$/i.test(String(url ?? "")),
  ) ?? null;

const extractSlugTokens = (url) => {
  const slug = String(url ?? "")
    .split("/")
    .filter(Boolean)
    .pop() ?? "";
  return tokenizeDistinctive(slug.replace(/\.html$/i, ""));
};

const buildHistoryIndex = (rows) => {
  const out = [];
  for (const row of rows) {
    const brand = lower(row?.brand ?? row?.brandName ?? "");
    const pageUrl = extractOfficialPageUrl(row);
    const pdfUrl = extractOfficialPdfUrl(row);
    const hasPureSignal =
      brand === "pure encapsulations" ||
      toArray(row?.sourceSummary?.sourceUrls).some((url) => lower(url).includes("pureencapsulations"));
    if (!hasPureSignal || (!pageUrl && !pdfUrl)) continue;
    const title = normalizeText(row?.title);
    if (!title) continue;
    out.push({
      title,
      canonicalTitle: normalizeCanonicalTitle(title),
      relaxedTitle: stripPackagingWords(title),
      pageUrl,
      pdfUrl,
      dosageTokens: extractDosageTokens(title),
      forms: extractForms(title),
      distinctiveTokens: tokenizeDistinctive(title),
      slugTokens: extractSlugTokens(pageUrl),
      row,
    });
  }
  return out;
};

const buildSearchQueries = (title) => [
  `site:pureencapsulations.com "${title}"`,
  `site:pureencapsulations.com "Pure Encapsulations" "${title}"`,
  `site:pureencapsulationspro.com "${title}"`,
];

const scoreCandidate = (queueRow, historyCandidate) => {
  const queueTitle = normalizeText(queueRow?.title);
  const queueCanonical = normalizeCanonicalTitle(queueTitle);
  const queueRelaxed = stripPackagingWords(queueTitle);
  const queueDistinctive = tokenizeDistinctive(queueTitle);
  const queueDosage = extractDosageTokens(queueTitle);
  const queueForms = extractForms(queueTitle);
  const aliasPatterns = TITLE_ALIAS_PATTERNS[queueCanonical] ?? [];

  let score = 0;
  const reasons = [];

  if (queueCanonical && historyCandidate.canonicalTitle === queueCanonical) {
    score += 100;
    reasons.push("exact_canonical_title_match");
  }

  if (queueRelaxed && historyCandidate.relaxedTitle === queueRelaxed) {
    score += 85;
    reasons.push("exact_relaxed_title_match");
  }

  if (
    queueRelaxed &&
    historyCandidate.relaxedTitle &&
    (historyCandidate.relaxedTitle.includes(queueRelaxed) || queueRelaxed.includes(historyCandidate.relaxedTitle))
  ) {
    score += 45;
    reasons.push("title_containment_match");
  }

  if (aliasPatterns.some((pattern) => pattern.test(historyCandidate.title))) {
    score += 70;
    reasons.push("manual_alias_pattern_match");
  }

  const overlap = tokensOverlapCount(queueDistinctive, historyCandidate.distinctiveTokens);
  if (overlap > 0) {
    score += overlap * 12;
    reasons.push(`distinctive_token_overlap:${overlap}`);
  }

  const slugOverlap = tokensOverlapCount(queueDistinctive, historyCandidate.slugTokens);
  if (historyCandidate.pageUrl && slugOverlap > 0) {
    score += slugOverlap * 10;
    reasons.push(`slug_token_overlap:${slugOverlap}`);
  }

  if (historyCandidate.pageUrl) {
    score += 8;
    reasons.push("has_official_page_url");
  }
  if (historyCandidate.pdfUrl) {
    score += 4;
    reasons.push("has_official_pdf_url");
  }

  if (queueDosage.size > 0 && historyCandidate.dosageTokens.size > 0) {
    const dosageOverlap = [...queueDosage].filter((token) => historyCandidate.dosageTokens.has(token)).length;
    if (dosageOverlap > 0) {
      score += dosageOverlap * 10;
      reasons.push(`dosage_overlap:${dosageOverlap}`);
    } else {
      score -= 20;
      reasons.push("dosage_mismatch_penalty");
    }
  }

  if (queueForms.size > 0 && historyCandidate.forms.size > 0) {
    const formOverlap = [...queueForms].filter((token) => historyCandidate.forms.has(token)).length;
    if (formOverlap > 0) {
      score += formOverlap * 8;
      reasons.push(`form_overlap:${formOverlap}`);
    } else {
      score -= 30;
      reasons.push("form_mismatch_penalty");
    }
  }

  if (historyCandidate.pageUrl && queueDistinctive.length > 0 && slugOverlap === 0) {
    score -= 35;
    reasons.push("page_slug_does_not_support_title_penalty");
  }

  return {
    score,
    reasons,
  };
};

const determineResolution = (queueRow, historyCandidates) => {
  const scored = historyCandidates
    .map((candidate) => ({
      candidate,
      ...scoreCandidate(queueRow, candidate),
    }))
    .sort((left, right) => right.score - left.score);

  const best = scored[0] ?? null;
  const second = scored[1] ?? null;
  if (!best || best.score < 80) {
    return {
      resolved: false,
      resolutionCode: "no_high_confidence_history_match",
      bestCandidates: scored.slice(0, 5),
    };
  }
  if (second && best.score - second.score < 10) {
    return {
      resolved: false,
      resolutionCode: "ambiguous_history_match",
      bestCandidates: scored.slice(0, 5),
    };
  }
  if (best.candidate.pageUrl && !best.candidate.slugTokens.length) {
    return {
      resolved: false,
      resolutionCode: "missing_slug_support",
      bestCandidates: scored.slice(0, 5),
    };
  }
  return {
    resolved: true,
    resolutionCode: "resolved_from_history",
    best,
    bestCandidates: scored.slice(0, 5),
  };
};

const summarizeResolved = (resolvedRows) => {
  const page = resolvedRows.filter((row) => row.productPageUrl).length;
  const pdf = resolvedRows.filter((row) => row.pdfUrl).length;
  return { page, pdf };
};

const main = async () => {
  const queueRows = await readJson(QUEUE_JSON);
  const historyRaw = await readJson(HISTORY_JSON);
  const historyRows = Array.isArray(historyRaw) ? historyRaw : (historyRaw.products ?? []);
  const historyIndex = buildHistoryIndex(historyRows);

  const resolvedRows = [];
  const unresolvedRows = [];
  const productPageUrlOverrides = {};
  const pdfUrlOverrides = {};

  for (const queueRow of queueRows) {
    const resolution = determineResolution(queueRow, historyIndex);
    if (!resolution.resolved) {
      unresolvedRows.push({
        ...queueRow,
        resolutionCode: resolution.resolutionCode,
        browserDiscoveryQueries: buildSearchQueries(queueRow.title),
        topHistoryCandidates: resolution.bestCandidates.map((entry) => ({
          title: entry.candidate.title,
          pageUrl: entry.candidate.pageUrl,
          pdfUrl: entry.candidate.pdfUrl,
          score: entry.score,
          reasons: entry.reasons,
        })),
      });
      continue;
    }

    const detail = {
      productId: queueRow.productId,
      title: queueRow.title,
      sourceTypes: queueRow.sourceTypes,
      productPageUrl: resolution.best.candidate.pageUrl,
      pdfUrl: resolution.best.candidate.pdfUrl,
      matchedHistoryTitle: resolution.best.candidate.title,
      score: resolution.best.score,
      reasons: resolution.best.reasons,
      browserDiscoveryQueries: buildSearchQueries(queueRow.title),
    };
    resolvedRows.push(detail);
    if (detail.productPageUrl) {
      productPageUrlOverrides[String(queueRow.productId)] = detail.productPageUrl;
    }
    if (detail.pdfUrl) {
      pdfUrlOverrides[String(queueRow.productId)] = detail.pdfUrl;
    }
  }

  const resolvedSummary = summarizeResolved(resolvedRows);
  const summary = {
    generatedAt: new Date().toISOString(),
    queueJson: QUEUE_JSON,
    historyJson: HISTORY_JSON,
    queueCount: queueRows.length,
    historyCandidateCount: historyIndex.length,
    resolvedCount: resolvedRows.length,
    unresolvedCount: unresolvedRows.length,
    resolvedWithPageUrlCount: resolvedSummary.page,
    resolvedWithPdfUrlCount: resolvedSummary.pdf,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await writeJson(path.join(OUT_DIR, "resolved_rows.json"), resolvedRows);
  await writeJson(path.join(OUT_DIR, "resolved_product_page_url_overrides.json"), productPageUrlOverrides);
  await writeJson(path.join(OUT_DIR, "resolved_pdf_urls.json"), pdfUrlOverrides);
  await writeJson(path.join(OUT_DIR, "unresolved_rows.json"), unresolvedRows);
  await writeJson(path.join(OUT_DIR, "summary.json"), summary);

  const md = [
    "# Pure Encapsulations Official URL Resolver",
    "",
    `- queueCount: ${summary.queueCount}`,
    `- historyCandidateCount: ${summary.historyCandidateCount}`,
    `- resolvedCount: ${summary.resolvedCount}`,
    `- unresolvedCount: ${summary.unresolvedCount}`,
    `- resolvedWithPageUrlCount: ${summary.resolvedWithPageUrlCount}`,
    `- resolvedWithPdfUrlCount: ${summary.resolvedWithPdfUrlCount}`,
    "",
    "## Resolved",
    ...resolvedRows.slice(0, 50).map(
      (row) =>
        `- ${row.title} -> ${row.productPageUrl || "no_page_url"} | pdf=${row.pdfUrl || "none"} | matched=${row.matchedHistoryTitle}`,
    ),
    "",
    "## Unresolved",
    ...unresolvedRows.slice(0, 50).map(
      (row) => `- ${row.title} | code=${row.resolutionCode} | query=${row.browserDiscoveryQueries[0]}`,
    ),
  ].join("\n");
  await writeText(path.join(OUT_DIR, "summary.md"), `${md}\n`);

  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
