#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildOverlayRecordKey,
  buildPatchStrategy,
  classifyOverlayStatus,
  deriveCompleteness,
  extractOverlayRecordFromSeedRow,
  mergeOverlayRecords,
  normalizeLower,
  normalizeText,
  qualifiesHighConfidenceUsProductPage,
  stableHash,
  toGtin14,
} from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const STAGING_PATH = getArg(
  "staging-json",
  path.join(ROOT, "output", "post_close_now_foods_batch2_22_20260313", "staging_products.official_refreshed.json"),
);
const QUEUE_PATH = getArg(
  "queue-json",
  path.join(ROOT, "output", "high_frequency_remaining_gap_breakdown_queues", "first_kpi_wave_all.json"),
);
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "iherb_missing_from_staging_iherb_search_wave"));
const LIMIT = Number(getArg("limit", 0)) || null;
const BRANDS = (getArg("brands", "") ?? "")
  .split(",")
  .map((value) => normalizeText(value))
  .filter(Boolean);
const ENABLE_AGENT_BROWSER_FALLBACK = getArg("agent-browser-fallback", "false") !== "false";
const ENABLE_SEARCH_FALLBACK = getArg("search-fallback", "true") !== "false";
const AGENT_BROWSER_SHELL_CMD = getArg("agent-browser-shell-cmd", "npx agent-browser");
const REQUEST_TIMEOUT_MS = Number(getArg("request-timeout-ms", 15000)) || 15000;
const READER_PREFIX = getArg("reader-prefix", "https://r.jina.ai/http://");
const SITEMAP_INDEX_URL = getArg("sitemap-index-url", "https://www.iherb.com/sitemap_index.xml");

const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const normalizeDigits = (value) => normalizeText(value).replace(/\D/g, "");
const normalizeBarcode = (value) => toGtin14(value) ?? null;
const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const decodeHtml = (value) =>
  normalizeText(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchText = async (targetUrl, label, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0",
      },
      redirect: "follow",
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text, label };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: "",
      label,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const fetchTextViaAgentBrowser = (targetUrl, label) => {
  const openCmd = `${AGENT_BROWSER_SHELL_CMD} open ${JSON.stringify(targetUrl)}`;
  const waitCmd = `${AGENT_BROWSER_SHELL_CMD} wait --load networkidle`;
  const getCmd = `${AGENT_BROWSER_SHELL_CMD} get text body`;
  try {
    const output = execFileSync("zsh", ["-lc", `${openCmd} && ${waitCmd} && ${getCmd}`], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 8,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, status: 200, text: output, label };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: "",
      label,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const fetchWithFallback = async (targetUrl, label) => {
  const fetched = await fetchText(targetUrl, label);
  if (fetched.ok && fetched.text) return fetched;
  if (!ENABLE_AGENT_BROWSER_FALLBACK) return fetched;
  return fetchTextViaAgentBrowser(targetUrl, `${label}:agent-browser`);
};

const sitemapXmlPromiseByUrl = new Map();
const productSitemapUrlsPromiseByIndex = new Map();

const fetchProductSitemapUrls = async () => {
  if (!productSitemapUrlsPromiseByIndex.has(SITEMAP_INDEX_URL)) {
    productSitemapUrlsPromiseByIndex.set(
      SITEMAP_INDEX_URL,
      (async () => {
        const fetched = await fetchText(SITEMAP_INDEX_URL, "iherb-sitemap-index", REQUEST_TIMEOUT_MS);
        if (!fetched.ok || !fetched.text) return [];
        return [...fetched.text.matchAll(/<loc>(https:\/\/www\.iherb\.com\/sitemaps\/products-[^<]+\.xml)<\/loc>/g)]
          .map((match) => normalizeText(match[1]))
          .filter(Boolean);
      })(),
    );
  }
  return productSitemapUrlsPromiseByIndex.get(SITEMAP_INDEX_URL);
};

const fetchAllProductSitemapEntries = async () => {
  const sitemapUrls = await fetchProductSitemapUrls();
  const entries = [];
  for (const sitemapUrl of sitemapUrls) {
    if (!sitemapXmlPromiseByUrl.has(sitemapUrl)) {
      sitemapXmlPromiseByUrl.set(
        sitemapUrl,
        fetchText(sitemapUrl, `iherb-product-sitemap:${path.basename(sitemapUrl)}`, REQUEST_TIMEOUT_MS),
      );
    }
    const fetched = await sitemapXmlPromiseByUrl.get(sitemapUrl);
    if (!fetched.ok || !fetched.text) continue;
    const urls = [...fetched.text.matchAll(/<loc>(https:\/\/www\.iherb\.com\/pr\/[^<]+)<\/loc>/g)]
      .map((match) => normalizeText(match[1]))
      .filter(Boolean);
    for (const url of urls) {
      entries.push({ url, slug: normalizeLower(url) });
    }
  }
  return Object.values(
    entries.reduce((acc, entry) => {
      if (!acc[entry.url]) acc[entry.url] = entry;
      return acc;
    }, {}),
  );
};

const stripBrandPrefix = (title, brandName) =>
  normalizeLower(title)
    .replace(new RegExp(`^\\s*${String(brandName ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,?\\s*`, "i"), "")
    .replace(/[™®']/g, "")
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[(),/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const canonicalTitle = (title, brandName) => stripBrandPrefix(title, brandName);
const canonicalCoreTitle = (title, brandName) =>
  canonicalTitle(title, brandName)
    .replace(/\b\d+\s*(mg|mcg|μg|g|iu|cfu|billion|million)\b/g, " ")
    .replace(/\b\d+\s*(capsules?|caps?|tablets?|softgels?|gummies|chewables?|veg(?:gie)? caps?(?:ules)?|count)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const alphaKey = (title, brandName) => canonicalCoreTitle(title, brandName).replace(/[^a-z0-9]/g, "");
const titleTokens = (title, brandName) =>
  canonicalCoreTitle(title, brandName)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

const buildStrengthKey = (title) => {
  const matches = [...normalizeLower(title).matchAll(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|iu|cfu|billion|million)/g)];
  if (matches.length === 0) return null;
  return matches.map((match) => `${match[1]}${match[2]}`).join("|");
};

const inferCountFromTitle = (title) => {
  const match = normalizeLower(title).match(/(\d+)\s*(count|capsules?|caps?|tablets?|softgels?|gummies|chewables?)/i);
  return match ? match[1] : null;
};

const inferFormFromTitle = (title) => {
  const normalized = normalizeLower(title);
  if (normalized.includes("softgel")) return "softgels";
  if (normalized.includes("tablet")) return "tablets";
  if (normalized.includes("capsule") || normalized.includes("caps ")) return "capsules";
  if (normalized.includes("gumm")) return "gummies";
  if (normalized.includes("chew")) return "chewables";
  if (normalized.includes("powder")) return "powder";
  if (normalized.includes("liquid")) return "liquid";
  return null;
};

const buildCandidateProfile = (row) => ({
  title: row.productName,
  brandName: row.brandName,
  barcode_gtin14: normalizeBarcode(row.barcode_gtin14),
  canonicalTitle: canonicalTitle(row.productName, row.brandName),
  canonicalCoreTitle: canonicalCoreTitle(row.productName, row.brandName),
  alphaKey: alphaKey(row.productName, row.brandName),
  tokens: titleTokens(row.productName, row.brandName),
  count: inferCountFromTitle(row.productName),
  dosageForm: inferFormFromTitle(row.productName),
  strengthKey: buildStrengthKey(row.productName),
});

const buildPageProfile = (parsedPage, brandName) => ({
  title: parsedPage.title,
  brandName,
  barcode_gtin14: normalizeBarcode(parsedPage.upcCode),
  canonicalTitle: canonicalTitle(parsedPage.title, brandName),
  canonicalCoreTitle: canonicalCoreTitle(parsedPage.title, brandName),
  alphaKey: alphaKey(parsedPage.title, brandName),
  tokens: titleTokens(parsedPage.title, brandName),
  count: normalizeDigits(parsedPage.packageQuantity) || inferCountFromTitle(parsedPage.title),
  dosageForm: inferFormFromTitle(parsedPage.title),
  strengthKey: buildStrengthKey(parsedPage.title),
});

const scoreCandidate = (candidateProfile, pageProfile) => {
  let score = 0;
  if (candidateProfile.barcode_gtin14 && pageProfile.barcode_gtin14) {
    if (candidateProfile.barcode_gtin14 === pageProfile.barcode_gtin14) score += 1000;
    else return -1000;
  }
  if (candidateProfile.canonicalTitle && candidateProfile.canonicalTitle === pageProfile.canonicalTitle) score += 100;
  if (candidateProfile.canonicalCoreTitle && candidateProfile.canonicalCoreTitle === pageProfile.canonicalCoreTitle) score += 120;
  if (candidateProfile.alphaKey && candidateProfile.alphaKey === pageProfile.alphaKey) score += 80;
  const tokenSet = new Set(candidateProfile.tokens);
  const overlap = pageProfile.tokens.filter((token) => tokenSet.has(token)).length;
  if (pageProfile.tokens.length > 0) score += Math.round((overlap / pageProfile.tokens.length) * 60);
  if (candidateProfile.count && pageProfile.count) score += candidateProfile.count === pageProfile.count ? 18 : -18;
  if (candidateProfile.dosageForm && pageProfile.dosageForm) {
    score += candidateProfile.dosageForm === pageProfile.dosageForm ? 10 : -12;
  }
  if (candidateProfile.strengthKey && pageProfile.strengthKey) {
    score += candidateProfile.strengthKey === pageProfile.strengthKey ? 45 : -55;
  }
  return score;
};

const parseSection = (markdown, sectionName) => {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    String.raw`(?:###\s+\*\*${escaped}\*\*|###\s+${escaped}|(?:^|\n)\*\*${escaped}\*\*)([\s\S]*?)(?=\n###\s+|\n\*\*[A-Z][\s\S]{0,40}\*\*|\nSimilar items to consider|\nProduct rankings:|\nCustomer ratings & reviews|\nRecommended use|\n$)`,
    "i",
  );
  const match = markdown.match(regex);
  if (!match) return null;
  return normalizeText(
    match[1]
      .replace(/^\s*[:\-]\s*/g, "")
      .replace(/\[\]\([^)]+\)/g, " ")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
      .replace(/\*\*/g, " ")
      .replace(/\s+/g, " "),
  );
};

const parseSupplementFacts = (markdown) => {
  const start = markdown.search(/\*\*Supplement facts\*\*/i);
  if (start === -1) return { servingSize: null, servingsPerContainer: null, nutritionalFacts: [] };
  const tail = markdown.slice(start, start + 3500);
  const endMatch = tail.search(/\nSimilar items to consider|\nCustomer ratings & reviews|\nRecommended use|\nProduct rankings:/i);
  const block = endMatch >= 0 ? tail.slice(0, endMatch) : tail;
  const servingSize =
    block.match(/\*\*Serving Size:\*\*\s*([^\n]+)/i)?.[1] ??
    block.match(/\*\*Serving size:\*\*\s*([^\n]+)/i)?.[1] ??
    null;
  const servingsPerContainer =
    block.match(/\*\*Serving Per Container\*\*:?\s*([^\n]+)/i)?.[1] ??
    block.match(/\*\*Servings Per Container\*\*:?\s*([^\n]+)/i)?.[1] ??
    null;

  const nutritionalFacts = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = normalizeText(rawLine.replace(/\*\*/g, " "));
    if (!line) continue;
    if (/^supplement facts$/i.test(line)) continue;
    if (/^serving size/i.test(line)) continue;
    if (/^serving per container/i.test(line)) continue;
    if (/^amount per serving/i.test(line)) continue;
    if (/^% daily value/i.test(line)) continue;
    if (/^daily value not established/i.test(line)) continue;
    if (/^other ingredients/i.test(line)) continue;
    const match = line.match(/^(.*?)(\d+(?:\.\d+)?\s*(?:mg|mcg|g|iu|cfu|billion|million|mL|ml))(.*)$/i);
    if (match) {
      nutritionalFacts.push({
        substancy: normalizeText(match[1]),
        amountPerServing: normalizeText(match[2]),
        dailyValuePercent: normalizeText(match[3]).replace(/^[*†\s-]+/, "") || null,
      });
    }
  }

  return {
    servingSize: normalizeText(servingSize) || null,
    servingsPerContainer: normalizeText(servingsPerContainer) || null,
    nutritionalFacts,
  };
};

const parseMainImage = (markdown, title) => {
  const titleTokens = new Set(
    normalizeLower(title)
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z0-9]+/g, ""))
      .filter((token) => token.length >= 4),
  );
  for (const match of markdown.matchAll(/!\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) {
    const alt = normalizeText(match[1]);
    const url = normalizeText(match[2]);
    if (!/cloudinary\.images-iherb\.com/i.test(url)) continue;
    const altTokens = normalizeLower(alt)
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z0-9]+/g, ""))
      .filter(Boolean);
    const overlap = altTokens.filter((token) => titleTokens.has(token)).length;
    if (overlap >= 2) return url;
  }
  return null;
};

const parseIherbProductPage = (markdown, sourceUrl, expectedBrand) => {
  const title =
    normalizeText(markdown.match(/^Title:\s*(.+)$/m)?.[1]) ||
    normalizeText(markdown.split(/\r?\n/).find((line) => line && !/^Title:/i.test(line))) ||
    normalizeText(sourceUrl.split("/").filter(Boolean).pop()?.replace(/\d+$/, "").replace(/[-_]+/g, " "));
  const canonicalUrl = normalizeText(markdown.match(/^URL Source:\s*(.+)$/m)?.[1]) || sourceUrl;
  const productId = normalizeText(canonicalUrl.match(/\/pr\/[^/]+\/(\d+)(?:[/?#]|$)/)?.[1]) || null;
  const upcCode =
    normalizeText(markdown.match(/\*\s+UPC:\s*([0-9]+)/i)?.[1]) ||
    normalizeText(markdown.match(/\bUPC:\s*([0-9]+)/i)?.[1]) ||
    null;
  const packageQuantity =
    normalizeText(markdown.match(/\*\s+Package quantity:\s*([^\n]+)/i)?.[1]) ||
    normalizeText(markdown.match(/\bPackage quantity:\s*([^\n]+)/i)?.[1]) ||
    null;

  const suggestedUse = parseSection(markdown, "Suggested use");
  const warnings = parseSection(markdown, "Warnings");
  const otherIngredients = parseSection(markdown, "Other ingredients");
  const description = parseSection(markdown, "Description");
  const supplementFacts = parseSupplementFacts(markdown);
  const imageUrl = parseMainImage(markdown, title);

  return {
    title,
    canonicalUrl,
    productId,
    upcCode,
    packageQuantity,
    suggestedUse,
    warnings,
    otherIngredients,
    description,
    supplementFacts,
    imageUrl,
    brandName: expectedBrand,
  };
};

const canonicalizeIherbUrl = (value) => {
  const decoded = decodeHtml(value);
  const match = decoded.match(/https?:\/\/(?:[a-z]{2}\.)?iherb\.com\/pr\/[^"'?\s<>]+(?:\/\d+)?(?:\?[^"'<> ]*)?/i);
  if (!match) return null;
  const url = new URL(match[0]);
  url.hostname = "www.iherb.com";
  url.protocol = "https:";
  url.hash = "";
  return url.toString().replace(/\?at=0&?$/i, "").replace(/\?$/i, "");
};

const searchIherbViaRjina = async (query) => {
  const searchUrl = `${READER_PREFIX}www.iherb.com/search?kw=${encodeURIComponent(query)}`;
  const fetched = await fetchWithFallback(searchUrl, `iherb-search:${query}`);
  if (!fetched.ok || !fetched.text) return [];
  const links = new Set();
  for (const match of fetched.text.matchAll(/https?:\/\/(?:www|[a-z]{2})\.iherb\.com\/pr\/[^)\s]+/g)) {
    const url = canonicalizeIherbUrl(match[0]);
    if (url) links.add(url);
  }
  return [...links];
};

const searchBraveForIherb = async (query) => {
  const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
  const fetched = await fetchText(url, `brave-search:${query}`);
  if (!fetched.ok || !fetched.text) return [];
  const links = new Set();
  for (const rawHref of fetched.text.matchAll(/href="([^"]+)"/g)) {
    const candidate = canonicalizeIherbUrl(rawHref[1]);
    if (candidate) links.add(candidate);
  }
  return [...links];
};

const buildSearchQueries = (row) => {
  const barcode = normalizeDigits(row.barcode_gtin14);
  const title = normalizeText(row.productName);
  const brand = normalizeText(row.brandName);
  const coreTitle = canonicalCoreTitle(title, brand);
  const queries = [];
  queries.push(`site:iherb.com/pr "${brand}" "${title}"`);
  if (coreTitle && coreTitle !== normalizeLower(title)) {
    queries.push(`site:iherb.com/pr "${brand}" "${coreTitle}"`);
  }
  const firstThreeWords = coreTitle.split(" ").slice(0, 3).join(" ");
  if (firstThreeWords && firstThreeWords !== coreTitle) {
    queries.push(`site:iherb.com/pr "${brand}" "${firstThreeWords}"`);
  }
  if (barcode) {
    queries.push(`site:iherb.com/pr "${brand}" "${barcode}"`);
    queries.push(`site:iherb.com/pr "${barcode}"`);
    queries.push(barcode);
  }
  return [...new Set(queries.map((value) => normalizeText(value)).filter(Boolean))];
};

const buildBrandSlugCandidates = (brandName) => {
  const normalized = normalizeText(brandName);
  const variants = new Set([
    slugify(normalized),
    slugify(normalized.replace(/['’]/g, "")),
    slugify(normalized.replace(/&/g, " and ")),
    slugify(normalized.replace(/\band\b/gi, "&")),
  ]);
  return [...variants].filter(Boolean);
};

const buildTitleSlugTokens = (row) =>
  canonicalCoreTitle(row.productName, row.brandName)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .map((token) => token.replace(/[^a-z0-9]+/g, "-"))
    .filter(Boolean)
    .slice(0, 8);

const findSitemapCandidateUrls = async (row) => {
  const entries = await fetchAllProductSitemapEntries();
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const brandSlugs = buildBrandSlugCandidates(row.brandName);
  const titleTokens = buildTitleSlugTokens(row);
  const firstToken = titleTokens[0] ?? null;

  const brandMatched = entries.filter((entry) => brandSlugs.some((brandSlug) => entry.slug.includes(`/pr/${brandSlug}-`)));
  const scored = brandMatched
    .map((entry) => {
      const tokenHits = titleTokens.filter((token) => entry.slug.includes(token)).length;
      let score = scoreUrlHeuristic(entry.url, row);
      score += tokenHits * 18;
      if (firstToken && entry.slug.includes(`-${firstToken}`)) score += 12;
      return { url: entry.url, score, tokenHits };
    })
    .filter((entry) => entry.tokenHits > 0 && entry.score >= 28)
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));

  return scored.slice(0, 20).map((entry) => entry.url);
};

const scoreUrlHeuristic = (url, row) => {
  const text = normalizeLower(url);
  const brandTokens = canonicalCoreTitle(row.brandName, "")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  const titleCoreTokens = canonicalCoreTitle(row.productName, row.brandName)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 6);

  let score = 0;
  for (const token of brandTokens) {
    if (text.includes(token)) score += 20;
  }
  for (const token of titleCoreTokens) {
    if (text.includes(token)) score += 12;
  }
  const strengthKey = buildStrengthKey(row.productName);
  if (strengthKey) {
    for (const token of strengthKey.split("|")) {
      if (text.includes(token.replace(/[^a-z0-9]+/g, ""))) score += 8;
    }
  }
  return score;
};

const hydrateMergedRow = (currentRow, mergedRecord) => {
  const completeness = deriveCompleteness(mergedRecord);
  const status = classifyOverlayStatus(mergedRecord, completeness);
  const highConfidenceUsProductPageReady = qualifiesHighConfidenceUsProductPage(mergedRecord, completeness);
  const patchStrategy = buildPatchStrategy(mergedRecord, completeness);
  return {
    ...currentRow,
    ...mergedRecord,
    overlayRecordKey: buildOverlayRecordKey(mergedRecord),
    completeness: {
      ...completeness,
      status,
    },
    readiness: {
      highConfidenceUsProductPageReady,
    },
    patchStrategy,
    overlaySha256: stableHash({
      brandName: mergedRecord.brandName,
      title: mergedRecord.title,
      barcode_gtin14: mergedRecord.barcode_gtin14,
      supplementFacts: mergedRecord.supplementFacts,
      descriptionSections: mergedRecord.descriptionSections,
      sourceSummary: mergedRecord.sourceSummary,
    }),
  };
};

const toSeedRow = (sourceRow, parsedPage, sourceUrl) => {
  const barcode = normalizeBarcode(parsedPage.upcCode ?? sourceRow.barcode_gtin14);
  const sections = {};
  if (parsedPage.description) sections.Description = parsedPage.description;
  if (parsedPage.suggestedUse) sections["Suggested use"] = parsedPage.suggestedUse;
  if (parsedPage.otherIngredients) sections["Other ingredients"] = parsedPage.otherIngredients;
  if (parsedPage.warnings) sections.Warnings = parsedPage.warnings;
  return {
    brandName: sourceRow.brandName,
    title: parsedPage.title,
    productId: parsedPage.productId,
    upcCode: normalizeText(parsedPage.upcCode) || null,
    barcode_gtin14: barcode,
    link: sourceUrl,
    productCatalogImage: parsedPage.imageUrl,
    productImages: parsedPage.imageUrl ? [parsedPage.imageUrl] : [],
    serving: {
      servingSize: parsedPage.supplementFacts.servingSize,
      servingsPerContainer: parsedPage.supplementFacts.servingsPerContainer,
    },
    supplementFacts: parsedPage.supplementFacts,
    sections,
    sourceTypes: ["iherb_us_product_page"],
    marketSources: ["US"],
    sourceUrls: [sourceUrl],
    sourceNotes: ["iherb_missing_from_staging_search_wave"],
  };
};

const buildMarkdownReport = (report) => {
  const lines = [
    "# Missing From Staging iHerb Search Recovery",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- stagingPath: ${report.inputs.stagingPath}`,
    `- queuePath: ${report.inputs.queuePath}`,
    `- brands: ${report.inputs.brands.join(", ") || "all"}`,
    "",
    "## Summary",
    "",
    `- queued: ${report.summary.queued}`,
    `- processed: ${report.summary.processed}`,
    `- recovered_complete: ${report.summary.recoveredComplete}`,
    `- recovered_partial: ${report.summary.recoveredPartial}`,
    `- unresolved_identity: ${report.summary.identityUnresolved}`,
    `- no_path_found: ${report.summary.noPathFound}`,
    "",
    "## Brand Summary",
    "",
  ];

  for (const brand of report.brandResults) {
    lines.push(
      `- ${brand.brandName}: requested=${brand.requested}, recovered_complete=${brand.recoveredComplete}, recovered_partial=${brand.recoveredPartial}, identity_unresolved=${brand.identityUnresolved}, no_path_found=${brand.noPathFound}`,
    );
  }

  if (report.auditRows.length > 0) {
    lines.push("", "## Sample Audit Rows", "");
    for (const row of report.auditRows.slice(0, 80)) {
      lines.push(
        `- ${row.brandName} | ${row.productName} | result=${row.result} | bestScore=${row.bestScore ?? "n/a"} | url=${row.selectedUrl ?? "n/a"}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const [stagingPayload, queuePayload] = await Promise.all([readJson(STAGING_PATH), readJson(QUEUE_PATH)]);
  const stagingRows = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];
  const queueRows = Array.isArray(queuePayload) ? queuePayload : Array.isArray(queuePayload?.rows) ? queuePayload.rows : [];

  const filteredQueue = queueRows.filter((row) => {
    if (BRANDS.length === 0) return true;
    return BRANDS.some((brand) => normalizeLower(brand) === normalizeLower(row?.brandName));
  });
  const selectedRows = LIMIT ? filteredQueue.slice(0, LIMIT) : filteredQueue;

  const refreshedRows = [...stagingRows];
  const stagingByBarcode = new Map();
  const stagingByProductId = new Map();
  stagingRows.forEach((row, idx) => {
    const barcode = normalizeBarcode(row?.barcode_gtin14);
    const productId = normalizeText(row?.productId);
    if (barcode) stagingByBarcode.set(barcode, idx);
    if (productId) stagingByProductId.set(productId, idx);
  });

  const auditRows = [];
  const recoveredSeeds = [];
  const unresolvedRows = [];
  const brandRollup = new Map();

  const ensureBrandRollup = (brandName) => {
    const key = normalizeLower(brandName);
    if (!brandRollup.has(key)) {
      brandRollup.set(key, {
        brandName,
        requested: 0,
        recoveredComplete: 0,
        recoveredPartial: 0,
        identityUnresolved: 0,
        noPathFound: 0,
      });
    }
    return brandRollup.get(key);
  };

  for (let idx = 0; idx < selectedRows.length; idx += 1) {
    const row = selectedRows[idx];
    console.error(
      `[iherb-search-recovery] ${idx + 1}/${selectedRows.length} ${normalizeText(row.brandName)} | ${normalizeText(row.productName)}`,
    );
    const rollup = ensureBrandRollup(row.brandName);
    rollup.requested += 1;

    const candidateUrls = new Set();
    const candidateProfile = buildCandidateProfile(row);
    const sitemapLinks = await findSitemapCandidateUrls(row);
    sitemapLinks.forEach((url) => candidateUrls.add(url));
    console.error(`[iherb-search-recovery] sitemap_candidates=${sitemapLinks.length}`);

    if (candidateUrls.size === 0 && ENABLE_SEARCH_FALLBACK) {
      const searchQueries = buildSearchQueries(row);
      for (const query of searchQueries) {
        if (candidateUrls.size >= 12) break;
        console.error(`[iherb-search-recovery] query=${query}`);
        const iherbLinks = await searchIherbViaRjina(query);
        iherbLinks.forEach((url) => candidateUrls.add(url));
        const braveLinks = await searchBraveForIherb(query);
        braveLinks.forEach((url) => candidateUrls.add(url));
        await sleep(250);
      }
    }

    console.error(`[iherb-search-recovery] candidate_urls=${candidateUrls.size}`);

    if (candidateUrls.size === 0) {
      rollup.noPathFound += 1;
      unresolvedRows.push({ ...row, reason: "no_iherb_candidate_found" });
      auditRows.push({
        brandName: row.brandName,
        productName: row.productName,
        result: "no_path_found",
        selectedUrl: null,
        bestScore: null,
      });
      continue;
    }

    const scoredCandidates = [];
    const orderedCandidateUrls = [...candidateUrls]
      .map((url) => ({ url, heuristic: scoreUrlHeuristic(url, row) }))
      .sort((left, right) => right.heuristic - left.heuristic || left.url.localeCompare(right.url))
      .map((item) => item.url);

    for (const url of orderedCandidateUrls.slice(0, 3)) {
      console.error(`[iherb-search-recovery] fetch_candidate=${url}`);
      const readerUrl = `${READER_PREFIX}${url.replace(/^https?:\/\//i, "")}`;
      const fetched = await fetchWithFallback(readerUrl, `iherb-product:${url}`);
      if (!fetched.ok || !fetched.text) continue;
      const parsedPage = parseIherbProductPage(fetched.text, url, row.brandName);
      const pageProfile = buildPageProfile(parsedPage, row.brandName);
      const score = scoreCandidate(candidateProfile, pageProfile);
      if (score <= 0) continue;
      scoredCandidates.push({
        url,
        parsedPage,
        score,
      });
      const recoveredBarcode = normalizeBarcode(parsedPage.upcCode);
      if (candidateProfile.barcode_gtin14 && recoveredBarcode && candidateProfile.barcode_gtin14 === recoveredBarcode) {
        break;
      }
      if (score >= 220) break;
      await sleep(150);
    }

    scoredCandidates.sort((left, right) => right.score - left.score);
    const best = scoredCandidates[0] ?? null;
    const second = scoredCandidates[1] ?? null;

    if (!best) {
      rollup.noPathFound += 1;
      unresolvedRows.push({ ...row, reason: "no_iherb_page_match_after_fetch" });
      auditRows.push({
        brandName: row.brandName,
        productName: row.productName,
        result: "no_path_found",
        selectedUrl: null,
        bestScore: null,
      });
      continue;
    }

    const exactBarcodeRecovered =
      candidateProfile.barcode_gtin14 &&
      normalizeBarcode(best.parsedPage.upcCode) &&
      candidateProfile.barcode_gtin14 === normalizeBarcode(best.parsedPage.upcCode);
    const ambiguous = second && best.score < 1000 && second.score >= best.score - 20;
    const acceptable = exactBarcodeRecovered || best.score >= 95;

    if (!acceptable || ambiguous) {
      rollup.identityUnresolved += 1;
      unresolvedRows.push({
        ...row,
        reason: ambiguous ? "identity_unresolved_multiple_candidates" : "identity_score_below_threshold",
        candidateUrls: scoredCandidates.map((item) => ({ url: item.url, score: item.score })),
      });
      auditRows.push({
        brandName: row.brandName,
        productName: row.productName,
        result: "identity_unresolved",
        selectedUrl: best.url,
        bestScore: best.score,
      });
      continue;
    }

    const seedRow = toSeedRow(row, best.parsedPage, best.url);
    const incomingRecord = extractOverlayRecordFromSeedRow(seedRow, {
      seedName: "iherb_missing_from_staging_search_wave",
    });
    const barcode = normalizeBarcode(seedRow.barcode_gtin14);
    const existingIdx =
      (barcode ? stagingByBarcode.get(barcode) : null) ??
      (seedRow.productId ? stagingByProductId.get(normalizeText(seedRow.productId)) : null) ??
      null;
    const currentRow = existingIdx != null ? refreshedRows[existingIdx] : {};
    const mergedRecord = mergeOverlayRecords(currentRow, incomingRecord);
    const hydratedRow = hydrateMergedRow(currentRow, mergedRecord);

    if (existingIdx != null) {
      refreshedRows[existingIdx] = hydratedRow;
    } else {
      refreshedRows.push(hydratedRow);
      const newIdx = refreshedRows.length - 1;
      if (barcode) stagingByBarcode.set(barcode, newIdx);
      if (seedRow.productId) stagingByProductId.set(normalizeText(seedRow.productId), newIdx);
    }

    const isComplete = Array.isArray(hydratedRow?.completeness?.coreMissingFields)
      ? hydratedRow.completeness.coreMissingFields.length === 0
      : false;
    if (isComplete) rollup.recoveredComplete += 1;
    else rollup.recoveredPartial += 1;

    recoveredSeeds.push(seedRow);
    auditRows.push({
      brandName: row.brandName,
      productName: row.productName,
      result: isComplete ? "recovered_complete" : "recovered_partial",
      selectedUrl: best.url,
      bestScore: best.score,
      productId: seedRow.productId,
      barcode_gtin14: seedRow.barcode_gtin14,
      stillMissingFields: hydratedRow?.completeness?.coreMissingFields ?? [],
    });
  }

  const report = {
    schemaVersion: "iherb_missing_from_staging_iherb_search_wave.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      stagingPath: STAGING_PATH,
      queuePath: QUEUE_PATH,
      brands: BRANDS,
      limit: LIMIT,
    },
    summary: {
      queued: selectedRows.length,
      processed: auditRows.length,
      recoveredComplete: auditRows.filter((row) => row.result === "recovered_complete").length,
      recoveredPartial: auditRows.filter((row) => row.result === "recovered_partial").length,
      identityUnresolved: auditRows.filter((row) => row.result === "identity_unresolved").length,
      noPathFound: auditRows.filter((row) => row.result === "no_path_found").length,
    },
    brandResults: [...brandRollup.values()].sort((left, right) => {
      if (right.requested !== left.requested) return right.requested - left.requested;
      return left.brandName.localeCompare(right.brandName);
    }),
    recoveredSeeds,
    unresolvedRows,
    auditRows,
  };

  const stagingOut = path.join(OUT_DIR, "staging_products.iherb_search_recovered.json");
  const seedOut = path.join(OUT_DIR, "iherb_search_seed.json");
  const unresolvedOut = path.join(OUT_DIR, "unresolved_candidates.json");
  const reportJsonOut = path.join(OUT_DIR, "iherb_search_recovery_report.json");
  const reportMdOut = path.join(OUT_DIR, "iherb_search_recovery_report.md");

  await writeJson(stagingOut, { products: refreshedRows });
  await writeJson(seedOut, { products: recoveredSeeds });
  await writeJson(unresolvedOut, unresolvedRows);
  await writeJson(reportJsonOut, report);
  await fs.writeFile(reportMdOut, buildMarkdownReport(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          stagingJson: stagingOut,
          seedJson: seedOut,
          unresolvedJson: unresolvedOut,
          reportJson: reportJsonOut,
          reportMd: reportMdOut,
        },
        summary: report.summary,
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
