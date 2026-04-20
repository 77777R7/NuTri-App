#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

import { parseCanadianOfficialFacts } from "./lib/canadian-official-merge-wave.mjs";

const ROOT = process.cwd();

const DEFAULT_OFFICIAL_CANDIDATE_PATH =
  "output/canadian_brand_full_coverage_wave_v0/canadian_new_overlay_candidates.v2.json";
const DEFAULT_OFFICIAL_CATALOG_PATH =
  "output/canadian_brand_full_coverage_wave_v0/official_catalog_products.v2.json";
const DEFAULT_OUT_DIR = "output/canadian_brand_full_coverage_wave_v0/wave_set_2_parser_lane";

const DEFAULT_BRAND_TARGETS = "Organika:8,Natural Factors:8,New Roots Herbal:8";
const DEFAULT_IMAGE_OCR_BRANDS = ["Genuine Health"];

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
};

const getArgs = (name) => {
  const flag = `--${name}`;
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && index + 1 < args.length) values.push(args[index + 1]);
  }
  return values;
};

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[™®]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLower = (value) => normalizeText(value).toLowerCase();

const decodeUrlText = (value) => {
  const text = normalizeText(value);
  if (!text || !/%[0-9a-f]{2}/i.test(text)) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

const stripSiteTitleSuffix = (value) =>
  normalizeText(value).replace(/\s+[-|]\s+CanPrev(?:\s+Premium Health Products)?\s*$/i, "");

const sanitizeSectionText = (value) =>
  normalizeText(decodeEntities(value))
    .replace(/\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+out of 5 stars[\s\S]*$/i, "")
    .replace(/\s+out of 5 stars[\s\S]*$/i, "")
    .replace(/\s+\(\s*based on\s+\d+[\s\S]*$/i, "")
    .replace(/\s+\b(?:Drug Interactions?|Contra-?indications?|Known adverse reactions?)\b\s*$/i, "")
    .trim();

const normalizeGtin14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const isValidGtin = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{8,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  const expected = Number(digits.at(-1));
  const sum = [...body]
    .reverse()
    .reduce((acc, digit, index) => acc + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === expected;
};

const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const parseBrandTargets = (value) => {
  const out = new Map();
  for (const part of String(value ?? "").split(",")) {
    const [brand, countText] = part.split(":").map(normalizeText);
    const count = Number(countText);
    if (!brand || !Number.isFinite(count) || count <= 0) continue;
    out.set(brand, Math.floor(count));
  }
  return out;
};

const parseCsvList = (value) =>
  String(value ?? "")
    .split(",")
    .map(normalizeText)
    .filter(Boolean);

const parseTargetBrands = (value, brandTargets) => {
  const explicit = parseCsvList(value);
  if (explicit.length > 0) return explicit;
  return [...brandTargets.keys()];
};

const decodeEntities = (value) =>
  String(value ?? "")
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number.parseInt(dec, 10)));

const stripTags = (value) =>
  normalizeText(
    decodeEntities(value)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6]|tr|td|th|section|details)>/gi, "\n")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );

const unique = (items) => [...new Set(items.map(normalizeText).filter(Boolean))];

const absolutizeUrl = (url, pageUrl) => {
  const text = normalizeText(url);
  if (!text) return null;
  if (text.startsWith("//")) return `https:${text}`;
  try {
    return new URL(text, pageUrl).toString();
  } catch {
    return text;
  }
};

const parseJsonStringValue = (html, key) => {
  const pattern = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const match = html.match(pattern);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return decodeEntities(match[1]);
  }
};

const extractMetaContent = (html, propertyName) => {
  const escaped = propertyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,
    "i",
  );
  const match = html.match(pattern);
  return normalizeText(match?.[1] ?? match?.[2] ?? null) || null;
};

const extractBarcodeFromUrls = (urls) => {
  for (const url of urls) {
    const text = normalizeText(url);
    for (const match of text.matchAll(/(?:^|[^\d])(\d{12,14})(?=[^\d]|$)/g)) {
      const digits = match[1];
      if (isValidGtin(digits)) return normalizeGtin14(digits);
    }
  }
  return null;
};

const extractBarcode = (html, candidate, imageUrls = []) => {
  const direct = normalizeGtin14(candidate?.barcode_gtin14 ?? candidate?.upcCode);
  if (direct) return direct;

  const patterns = [
    /"barcode"\s*:\s*"([^"]+)"/i,
    /"gtin13"\s*:\s*"([^"]+)"/i,
    /data-upc=["']([^"']+)["']/i,
    /<label>\s*UPC:\s*<\/label>\s*<span[^>]*>([^<]+)<\/span>/i,
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    const gtin = normalizeGtin14(value);
    if (gtin) return gtin;
  }
  const htmlImageUrls = [
    ...imageUrls,
    ...[...String(html ?? "").matchAll(/https?:\\?\/\\?\/[^"'\s<>]+?\.(?:png|jpe?g|webp)(?:\?[^"'\s<>]*)?/gi)].map(
      (match) => decodeEntities(match[0].replace(/\\\//g, "/")),
    ),
  ];
  const imageBarcode = extractBarcodeFromUrls(htmlImageUrls);
  if (imageBarcode) return imageBarcode;
  return null;
};

const extractUpc = (html, candidate) => {
  const candidateUpc = normalizeText(candidate?.upcCode);
  if (candidateUpc) return candidateUpc;
  const gtin = extractBarcode(html, candidate);
  if (!gtin) return null;
  return gtin.replace(/^0+/, "") || gtin;
};

const extractNpn = (html) =>
  normalizeText(html.match(/\bNPN\s*[:#]?\s*([0-9]{8})\b/i)?.[1] ?? html.match(/"npn"\s*:\s*"([0-9]{8})"/i)?.[1] ?? null) ||
  null;

const extractImages = (html, candidate, pageUrl) => {
  const out = [];
  if (candidate?.productCatalogImage) out.push(candidate.productCatalogImage);
  if (Array.isArray(candidate?.productImages)) out.push(...candidate.productImages);
  out.push(extractMetaContent(html, "og:image"));
  for (const pattern of [
    /"featured_image"\s*:\s*"([^"]+)"/gi,
    /"src"\s*:\s*"([^"]+\.(?:png|jpe?g|webp)(?:\?[^"]*)?)"/gi,
    /data-image=["']([^"']+\.(?:png|jpe?g|webp)(?:\?[^"']*)?)["']/gi,
  ]) {
    for (const match of html.matchAll(pattern)) out.push(match[1]);
  }
  return unique(out.map((item) => absolutizeUrl(item, pageUrl)).filter(Boolean));
};

const extractTitle = (html, candidate) =>
  stripSiteTitleSuffix(stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1])) ||
  stripSiteTitleSuffix(extractMetaContent(html, "og:title")) ||
  stripSiteTitleSuffix(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) ||
  decodeUrlText(candidate?.title) ||
  null;

const extractServing = (html, factsText) => {
  const source = stripTags(`${factsText}\n${html}`);
  const servingSize =
    source.match(/\bServing Size\s+([^.\n|]+?)(?:Servings Per Container|Amount Per Serving|Ingredients|$)/i)?.[1] ??
    source.match(/\bEACH SERVING\s*\(([^)]+)\)/i)?.[1] ??
    source.match(/\bPer\s+(1\s+(?:softgel|capsule|tablet|sachet|scoop|serving|packet)[^,\n]*)/i)?.[1] ??
    null;
  const servingsPerContainer =
    source.match(/\bServings Per Container\s+(\d+)/i)?.[1] ??
    source.match(/\b(\d+)\s+servings?\b/i)?.[1] ??
    null;
  return {
    servingType: null,
    servingDescription: null,
    servingSize: normalizeText(servingSize) || null,
    servingsPerContainer: servingsPerContainer ? Number(servingsPerContainer) : null,
  };
};

const parseTableFacts = (html) => {
  const rows = [];
  for (const rowMatch of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) =>
      stripTags(match[1]),
    );
    if (cells.length < 2) continue;
    const lower = cells.join(" ").toLowerCase();
    if (/amount per serving|daily value|human strains|plant strain|dairy strains|total/.test(lower) && cells.length < 3) {
      continue;
    }

    const amountIndex = [...cells]
      .map((cell, index) => ({ cell, index }))
      .reverse()
      .find(({ cell }) => /\d/.test(cell) && /(?:mcg|mg|g|iu|cfu|billion|million|%)/i.test(cell))?.index;
    if (amountIndex == null || amountIndex === 0) continue;

    const name = normalizeText(cells.slice(0, amountIndex).join(" "));
    const amount = normalizeText(cells[amountIndex]);
    const dv = normalizeText(cells[amountIndex + 1]) || null;
    if (!name || !amount) continue;
    if (/^(?:amount per serving|% daily value|sku|upc|npn)$/i.test(name)) continue;
    rows.push({
      substancy: name,
      amountPerServing: amount,
      dailyValuePercent: dv && /%/.test(dv) ? dv : null,
    });
  }
  return rows.slice(0, 16);
};

const sanitizeFacts = (facts) => {
  const cleaned = [];
  const seen = new Set();
  for (const row of Array.isArray(facts) ? facts : []) {
    let substancy = normalizeText(row?.substancy)
      .replace(/\bMedicinal\s*:?\s*/gi, "")
      .replace(/\bEACH SERVING\s*\([^)]*\)\s*CONTAINS:?\s*/gi, "")
      .replace(/\bCONTAINS:?\s*/gi, "")
      .replace(/^[\s:;.,-]+|[\s:;.,-]+$/g, "");
    const amountPerServing = normalizeText(row?.amountPerServing);
    const dailyValuePercent = normalizeText(row?.dailyValuePercent) || null;

    if (!substancy || !amountPerServing) continue;
    if (/\beach serving\b/i.test(substancy)) continue;
    if (/^contains$/i.test(substancy)) continue;
    if (/^medicinal$/i.test(substancy)) continue;
    if (/^amount per serving$/i.test(substancy)) continue;
    if (/^serving size$/i.test(substancy)) continue;
    if (/\b(?:variant sold out|product variants|flavou?r:|product variants)\b/i.test(substancy)) continue;
    if (/^\d+\s+servings?\b/i.test(substancy)) continue;
    if (/^(?:of|or more|more|with)\b/i.test(substancy)) continue;
    if (/\b(?:our dose|well under|per day|risk of side effects|clinical trial)\b/i.test(substancy)) continue;
    if (substancy.length > 180) continue;

    const key = normalizeLower(`${substancy}|${amountPerServing}|${dailyValuePercent ?? ""}`);
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ substancy, amountPerServing, dailyValuePercent });
  }
  return cleaned.slice(0, 16);
};

const parseIngredientNutritionBlock = (html) => {
  const raw = parseJsonStringValue(html, "Ingredients & Nutrition");
  if (!raw) return null;
  const text = stripTags(raw);
  const facts = sanitizeFacts(parseCanadianOfficialFacts(text));
  const suggestedUse =
    text.match(/\bRecommended Use:\s*([\s\S]*?)(?:\bCautions?:|\bWarnings?:|$)/i)?.[1] ??
    text.match(/\bDirections?:\s*([\s\S]*?)(?:\bCautions?:|\bWarnings?:|$)/i)?.[1] ??
    null;
  const warnings =
    text.match(/\bCautions?:\s*([\s\S]*?)$/i)?.[1] ??
    text.match(/\bWarnings?:\s*([\s\S]*?)$/i)?.[1] ??
    null;
  const otherIngredients =
    text.match(/\bNon-medicinal:\s*([\s\S]*?)(?:\bRecommended Use:|\bDirections?:|\bCautions?:|\bWarnings?:|$)/i)?.[1] ??
    text;
  return {
    rawText: text,
    facts,
    suggestedUse: normalizeText(suggestedUse),
    warnings: normalizeText(warnings),
    otherIngredients: normalizeText(otherIngredients),
  };
};

const extractBetween = (text, startPattern, stopPatterns) => {
  const start = text.search(startPattern);
  if (start < 0) return "";
  const sliced = text.slice(start);
  const after = sliced.replace(startPattern, "");
  let end = after.length;
  for (const stopPattern of stopPatterns) {
    const stop = after.search(stopPattern);
    if (stop >= 0) end = Math.min(end, stop);
  }
  return normalizeText(after.slice(0, end));
};

const splitUseAndWarnings = (value) => {
  const text = normalizeText(value);
  if (!text) return { suggestedUse: "", warnings: "" };
  const warningStart = text.search(/\b(?:For adult use only|Keep out of the reach|Consult|Do not use|Cautions? and warnings?|Warnings?)\b/i);
  if (warningStart <= 0) return { suggestedUse: text, warnings: "" };
  return {
    suggestedUse: normalizeText(text.slice(0, warningStart)),
    warnings: normalizeText(text.slice(warningStart)),
  };
};

const extractSections = (html) => {
  const ingredientBlock = parseIngredientNutritionBlock(html);
  const tableFacts = sanitizeFacts(parseTableFacts(html));
  const text = stripTags(html);

  let facts = tableFacts.length > 0 ? tableFacts : ingredientBlock?.facts?.length ? ingredientBlock.facts : [];
  if (facts.length === 0) facts = sanitizeFacts(parseCanadianOfficialFacts(text));

  let suggestedUse = ingredientBlock?.suggestedUse || "";
  let warnings = ingredientBlock?.warnings || "";

  if (!suggestedUse) {
    const plainDirections = text.match(
      /\bDirections\s+((?:Adults?|Children|Adolescents|Children,\s*adolescents\s*and\s*adults|Adolescents\s+and\s+Adults|Take|For adults?)[\s\S]*?)(?:\bCautions?\s*(?:&|and)\s*Warnings\b|\bCautions?\b|\bWarnings?\b|\bOther Information\b|$)/i,
    )?.[1];
    const suggestedBundle =
      plainDirections ||
      extractBetween(text, /\bSuggested usage:\s*/i, [/\bAllergy Information\b/i, /\bSupplement Facts\b/i]) ||
      extractBetween(text, /\bDirections for use\s*/i, [/\bWhy is\b/i, /\bFrequently Asked Questions\b/i]) ||
      extractBetween(text, /\bDirections of Use\s*/i, [/\bWarnings\b/i, /\bIngredients\b/i]) ||
      extractBetween(text, /\bAdult Dosage\s*/i, [/\bCautions\b/i, /\bIngredients\b/i]);
    const split = splitUseAndWarnings(suggestedBundle);
    suggestedUse = split.suggestedUse;
    warnings = warnings || split.warnings;
  }

  if (!warnings) {
    warnings =
      text.match(/\bCautions?\s*(?:&|and)\s*Warnings\s+([\s\S]*?)(?:\bOther Information\b|\bReviews\b|$)/i)?.[1] ||
      extractBetween(text, /\bWarnings\s*/i, [/\bIngredients\b/i, /\bFAQs\b/i, /\bFrequently Asked Questions\b/i]) ||
      extractBetween(text, /\bCautions\s*/i, [/\bIngredients\b/i, /\bOther Ingredients\b/i, /\bOther Information\b/i, /\bReviews\b/i]) ||
      extractBetween(text, /\bCautions and warnings:\s*/i, [/\bContra-indications\b/i, /\bKnown adverse reactions\b/i]) ||
      "";
  }

  let otherIngredients = ingredientBlock?.otherIngredients || "";
  if (!otherIngredients) {
    otherIngredients =
      extractBetween(text, /\bOther Ingredients:\s*/i, [/\bSKU\b/i, /\bSuggested/i, /\bAllergy Information\b/i]) ||
      extractBetween(text, /\bNon-medicinal Ingredients?\*?:\s*/i, [/\bCapsule:\b/i, /\bDirections\b/i, /\bWarnings\b/i]) ||
      extractBetween(text, /\bNon-medicinal:\s*/i, [/\bRecommended Use\b/i, /\bDirections\b/i, /\bCautions\b/i]) ||
      "";
  }

  const description =
    normalizeText(extractMetaContent(html, "description")) ||
    normalizeText(extractMetaContent(html, "twitter:description")) ||
    "";

  return {
    facts,
    descriptionSections: {
      Description: sanitizeSectionText(description),
      "Suggested use": sanitizeSectionText(suggestedUse),
      "Other ingredients": sanitizeSectionText(otherIngredients || ingredientBlock?.rawText),
      Warnings: sanitizeSectionText(warnings).replace(/^and warnings:\s*/i, ""),
    },
    factsText: ingredientBlock?.rawText || text,
  };
};

const inferCountAndForm = (title, candidate, serving, images = []) => {
  const source = [title, candidate?.variantTitle, candidate?.count, serving?.servingSize, ...images]
    .map(normalizeText)
    .join(" ");
  const countMatch =
    source.match(/\b\d+\s+(?:v?caps|capsules?|softgels?|tablets?|sachets?|servings?|gummies|packets?)\b/i)?.[0] ||
    source.match(/\b\d+\s*(?:v?caps|softgels?|tablets?|sachets?|servings?|gummies|packets?)\b/i)?.[0];
  const lower = normalizeLower(source);
  const countFromImage = countMatch ? countMatch.replace(/(\d)([a-z])/i, "$1 $2") : null;
  const count =
    normalizeText(candidate?.count) ||
    (countFromImage && lower.includes("chewable") ? countFromImage.replace(/\bv?caps\b/i, "tablets") : countFromImage);
  const dosageForm = lower.includes("chewable") || lower.includes("tablet")
    ? "tablets"
    : lower.includes("softgel")
    ? "softgels"
    : lower.includes("capsule") || lower.includes("caps") || lower.includes("vcaps")
      ? "capsules"
      : lower.includes("sachet")
          ? "sachets"
          : lower.includes("powder") || lower.includes("scoop")
            ? "powder"
            : lower.includes("gumm")
              ? "gummies"
              : normalizeText(candidate?.dosageForm) || null;
  return { count, dosageForm };
};

const hasCleanSectionText = (value) => {
  const text = normalizeText(value);
  if (!text) return false;
  if (text.length > 1600) return false;
  return !/\b(?:SUPPLEMENT FACTS|DISCLAIMER|FAQs|Explore Research|Autoship powered by|Submit Review)\b/i.test(text);
};

const hasFullCore = (record) =>
  Boolean(
    record.barcode_gtin14 &&
      record.productCatalogImage &&
      record.supplementFacts?.nutritionalFacts?.length > 0 &&
      record.supplementFacts.nutritionalFacts.some((row) => normalizeText(row.amountPerServing)) &&
      hasCleanSectionText(record.descriptionSections?.["Suggested use"]) &&
      hasCleanSectionText(record.descriptionSections?.Warnings) &&
      (!normalizeText(record.descriptionSections?.["Other ingredients"]) ||
        hasCleanSectionText(record.descriptionSections?.["Other ingredients"])),
  );

const fetchHtml = async (url, timeoutMs = 20_000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
      signal: controller.signal,
    });
    const html = await response.text();
    return { ok: response.ok, status: response.status, html };
  } finally {
    clearTimeout(timeoutId);
  }
};

const buildCandidates = ({ officialCandidates, officialCatalog, targetBrands }) => {
  const rows = [];
  const seen = new Set();
  const targetBrandSet = new Set(targetBrands);
  const add = (row, sourceName) => {
    const brandName = normalizeText(row?.brandName ?? row?.officialBrandName ?? row?.seedBrandName);
    if (!targetBrandSet.has(brandName)) return;
    const link = normalizeText(row?.link ?? row?.productUrl ?? row?.sourceUrl);
    if (!link) return;
    const key = `${brandName}|${link}|${normalizeText(row?.barcode_gtin14 ?? row?.upcCode)}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      sourceName,
      brandName,
      title: normalizeText(row?.title),
      normalizedTitle: normalizeLower(row?.normalizedTitle ?? row?.title),
      productId: normalizeText(row?.productId),
      upcCode: normalizeText(row?.upcCode),
      barcode_gtin14: normalizeGtin14(row?.barcode_gtin14 ?? row?.upcCode),
      link,
      productCatalogImage: normalizeText(row?.productCatalogImage ?? row?.image),
      productImages: Array.isArray(row?.productImages) ? row.productImages : Array.isArray(row?.images) ? row.images : [],
      categories: Array.isArray(row?.categories) ? row.categories : Array.isArray(row?.tags) ? row.tags : [],
      count: normalizeText(row?.count ?? row?.variantTitle),
      dosageForm: normalizeText(row?.dosageForm),
    });
  };
  for (const row of officialCandidates) add(row, "official_overlay_candidates");
  for (const row of officialCatalog) add(row, "official_catalog");
  return rows.sort((left, right) => {
    const leftHasUpc = left.barcode_gtin14 ? 0 : 1;
    const rightHasUpc = right.barcode_gtin14 ? 0 : 1;
    if (leftHasUpc !== rightHasUpc) return leftHasUpc - rightHasUpc;
    return `${left.brandName}|${left.title}`.localeCompare(`${right.brandName}|${right.title}`);
  });
};

const buildOverlayRecord = ({ candidate, html, pageUrl, waveId }) => {
  const title = extractTitle(html, candidate);
  const images = extractImages(html, candidate, pageUrl);
  const barcodeGtin14 = extractBarcode(html, candidate, images);
  const { facts, descriptionSections, factsText } = extractSections(html);
  const serving = extractServing(html, factsText);
  const { count, dosageForm } = inferCountAndForm(title, candidate, serving, images);
  const npn = extractNpn(html);
  const productId =
    normalizeText(candidate.productId) ||
    `ca-official-${slugify(candidate.brandName)}-${barcodeGtin14 || slugify(title)}`;

  return {
    brandName: candidate.brandName,
    title,
    normalizedTitle: normalizeLower(title),
    productId,
    upcCode: extractUpc(html, candidate),
    barcode_gtin14: barcodeGtin14,
    link: pageUrl,
    productCatalogImage: images[0] ?? null,
    productImages: images,
    categories: unique(candidate.categories),
    count,
    dosageForm,
    serving,
    supplementFacts: {
      servingSize: serving.servingSize,
      servingsPerContainer: serving.servingsPerContainer,
      nutritionalFacts: facts,
    },
    descriptionSections,
    sourceSummary: {
      sourceKind: "canadian_official_product_page",
      sourceTypes: ["official_product_page"],
      marketSources: ["ca"],
      sourceUrls: [pageUrl],
      sourceNotes: [
        `${waveId}: Canadian Wave Set 2 parser lane`,
        `${candidate.sourceName}: live official page parse`,
        ...(npn ? [`NPN captured for reference only: ${npn}`] : []),
      ],
      npnIgnored: false,
      hasUsIherbPage: false,
      sourceRank: 90,
    },
    readiness: {
      canadianOfficialFullOverlayReady: true,
      highConfidenceUsProductPageReady: false,
      factParseMethod: "canadian_wave_set_2_live_html_v1",
      factParseRowCount: facts.length,
    },
    overlayRecordKey: `gtin14:${barcodeGtin14}`,
  };
};

const renderMarkdown = (payload) => {
  const lines = [
    "# Canadian Wave Set 2 Parser Lane",
    "",
    `- generatedAt: ${payload.generatedAt}`,
    `- waveId: ${payload.waveId}`,
    `- selected: ${payload.summary.selected}`,
    `- skipped: ${payload.summary.skipped}`,
    "",
    "## Selected By Brand",
    "",
  ];
  for (const [brand, count] of Object.entries(payload.summary.byBrand)) {
    lines.push(`- ${brand}: ${count}`);
  }
  lines.push("", "## Products", "");
  for (const row of payload.products) {
    const fact = row.supplementFacts?.nutritionalFacts?.[0];
    lines.push(
      `- ${row.brandName} | ${row.title} | ${row.barcode_gtin14 || "no-gtin"} | first=${fact?.substancy ?? "n/a"} ${fact?.amountPerServing ?? ""}`,
    );
  }
  lines.push("", "## Skips", "");
  for (const row of payload.skipped.slice(0, 120)) {
    lines.push(`- ${row.brandName} | ${row.title || row.link} | ${row.reason}`);
  }
  return `${lines.join("\n")}\n`;
};

const writeOutputs = async ({ payload, outDir, fileStem }) => {
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${fileStem}.json`);
  const mdPath = path.join(outDir, `${fileStem}.md`);
  await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, renderMarkdown(payload), "utf8");
  return { jsonPath, mdPath };
};

const readJsonIfExists = async (filePath) => {
  if (!filePath) return null;
  try {
    return JSON.parse(await fs.readFile(path.resolve(ROOT, filePath), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};

const loadRetailerUpcMap = async (filePath) => {
  const payload = await readJsonIfExists(filePath);
  const entries = Array.isArray(payload?.entries) ? payload.entries : Array.isArray(payload) ? payload : [];
  return entries
    .map((entry) => ({
      brandName: normalizeText(entry?.brandName),
      titleIncludes: normalizeLower(entry?.titleIncludes ?? entry?.title),
      officialUrl: normalizeText(entry?.officialUrl ?? entry?.link),
      upcCode: normalizeText(entry?.upcCode ?? entry?.upc),
      barcode_gtin14: normalizeGtin14(entry?.barcode_gtin14 ?? entry?.upcCode ?? entry?.upc),
      retailerSourceUrl: normalizeText(entry?.retailerSourceUrl ?? entry?.sourceUrl),
      retailerName: normalizeText(entry?.retailerName),
      evidenceNote: normalizeText(entry?.evidenceNote),
    }))
    .filter((entry) => entry.brandName && entry.barcode_gtin14);
};

const findRetailerUpcEvidence = ({ candidate, record, retailerUpcMap }) => {
  const brand = normalizeText(record?.brandName ?? candidate?.brandName);
  const title = normalizeLower(record?.title ?? candidate?.title);
  const link = normalizeText(record?.link ?? candidate?.link);
  return retailerUpcMap.find((entry) => {
    if (entry.brandName !== brand) return false;
    if (entry.officialUrl && entry.officialUrl === link) return true;
    if (entry.titleIncludes && title.includes(entry.titleIncludes)) return true;
    return false;
  });
};

const applyRetailerUpcEvidence = ({ record, candidate, retailerUpcMap, waveId }) => {
  if (record.barcode_gtin14) return record;
  const evidence = findRetailerUpcEvidence({ candidate, record, retailerUpcMap });
  if (!evidence?.barcode_gtin14) return record;
  return {
    ...record,
    upcCode: evidence.upcCode || evidence.barcode_gtin14.replace(/^0+/, ""),
    barcode_gtin14: evidence.barcode_gtin14,
    overlayRecordKey: `gtin14:${evidence.barcode_gtin14}`,
    sourceSummary: {
      ...(record.sourceSummary ?? {}),
      sourceTypes: [
        ...new Set([...(record.sourceSummary?.sourceTypes ?? []), "retailer_upc_evidence"]),
      ].sort(),
      sourceUrls: [
        ...new Set([
          ...(record.sourceSummary?.sourceUrls ?? []),
          evidence.retailerSourceUrl,
        ].filter(Boolean)),
      ].sort(),
      sourceNotes: [
        ...new Set([
          ...(record.sourceSummary?.sourceNotes ?? []),
          `${waveId}: UPC supplied by retailer evidence${evidence.retailerName ? ` (${evidence.retailerName})` : ""}`,
          evidence.evidenceNote,
        ].filter(Boolean)),
      ].sort(),
    },
    readiness: {
      ...(record.readiness ?? {}),
      retailerUpcEvidenceApplied: true,
    },
  };
};

const collectExclusionsFromPayloads = async (filePaths) => {
  const gtins = new Set();
  const productIds = new Set();
  for (const filePath of filePaths) {
    const payload = await readJsonIfExists(filePath);
    const products = Array.isArray(payload?.products) ? payload.products : [];
    for (const row of products) {
      const gtin = normalizeGtin14(row?.barcode_gtin14 ?? row?.upcCode);
      const productId = normalizeText(row?.productId);
      if (gtin) gtins.add(gtin);
      if (productId) productIds.add(productId);
    }
  }
  return { gtins, productIds };
};

const buildImageOcrRetailerLane = ({ skipped, imageOcrBrands, waveId }) => {
  const imageOcrBrandSet = new Set(imageOcrBrands);
  const candidates = [];
  const seen = new Set();
  for (const row of skipped) {
    if (!imageOcrBrandSet.has(row.brandName)) continue;
    if (
      ![
        "parsed_but_not_full_core",
        "missing_required_official_fields",
        "official_parser_withheld_for_image_ocr_retailer_lane",
      ].includes(row.reason)
    ) {
      continue;
    }
    const key = `${row.brandName}|${row.link}|${row.barcode_gtin14 || row.upcCode || row.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      brandName: row.brandName,
      title: row.title,
      productId: row.productId || null,
      upcCode: row.upcCode || null,
      barcode_gtin14: normalizeGtin14(row.barcode_gtin14 ?? row.upcCode),
      link: row.link,
      sourceName: row.sourceName,
      parsed: row.parsed ?? null,
      admissionBlocker:
        row.reason === "parsed_but_not_full_core"
          ? "official_page_is_visible_but_not_machine_readable_full_core"
          : "candidate_missing_required_official_fields",
      recommendedLane: "image_ocr_or_retailer_facts",
      sourceNotes: [
        `${waveId}: held out from official parser lane`,
        "Do not merge until a facts image OCR or trusted retailer field source supplies ingredient amount rows plus use/warnings.",
      ],
    });
  }
  return {
    schemaVersion: "canadian-image-ocr-retailer-facts-lane.v1",
    generatedAt: new Date().toISOString(),
    waveId,
    summary: {
      candidateCount: candidates.length,
      byBrand: candidates.reduce((acc, row) => {
        acc[row.brandName] = (acc[row.brandName] ?? 0) + 1;
        return acc;
      }, {}),
    },
    candidates,
  };
};

const renderImageLaneMarkdown = (payload) => {
  const lines = [
    "# Canadian Image/OCR/Retailer Facts Lane",
    "",
    `- generatedAt: ${payload.generatedAt}`,
    `- waveId: ${payload.waveId}`,
    `- candidateCount: ${payload.summary.candidateCount}`,
    "",
    "## By Brand",
    "",
  ];
  for (const [brand, count] of Object.entries(payload.summary.byBrand)) lines.push(`- ${brand}: ${count}`);
  lines.push("", "## Candidates", "");
  for (const row of payload.candidates.slice(0, 160)) {
    const parsed = row.parsed
      ? ` parsed={gtin:${row.parsed.gtin ? "yes" : "no"}, image:${row.parsed.image ? "yes" : "no"}, facts:${row.parsed.facts ?? 0}, use:${row.parsed.suggestedUse ? "yes" : "no"}, warnings:${row.parsed.warnings ? "yes" : "no"}}`
      : "";
    lines.push(`- ${row.brandName} | ${row.title || row.link} | ${row.recommendedLane}${parsed}`);
  }
  return `${lines.join("\n")}\n`;
};

const writeImageOcrRetailerLane = async ({ payload, outDir, fileStem }) => {
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${fileStem}.json`);
  const mdPath = path.join(outDir, `${fileStem}.md`);
  await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, renderImageLaneMarkdown(payload), "utf8");
  return { jsonPath, mdPath };
};

const main = async () => {
  const officialCandidatePath = getArg("official-candidates-json", DEFAULT_OFFICIAL_CANDIDATE_PATH);
  const officialCatalogPath = getArg("official-catalog-json", DEFAULT_OFFICIAL_CATALOG_PATH);
  const outDir = getArg("out-dir", DEFAULT_OUT_DIR);
  const waveId = getArg("wave-id", "canadian_wave_set_2_parser_lane_01");
  const fileStem = getArg("file-stem", `staging_products.${waveId}`);
  const imageLaneFileStem = getArg("image-ocr-lane-file-stem", `image_ocr_retailer_facts_candidates.${waveId}`);
  const promotionPolicy = getArg("promotion-policy", "merge_validation_gate_only");
  const maxFetchPerBrand = Math.max(1, Number(getArg("max-fetch-per-brand", "24")) || 24);
  const brandTargets = parseBrandTargets(getArg("brand-targets", DEFAULT_BRAND_TARGETS));
  const imageOcrBrands = parseCsvList(getArg("image-ocr-brands", DEFAULT_IMAGE_OCR_BRANDS.join(",")));
  const targetBrands = [
    ...new Set([...parseTargetBrands(getArg("target-brands", ""), brandTargets), ...imageOcrBrands]),
  ];
  const retailerUpcMapPath = getArg("retailer-upc-map-json", null);
  const retailerUpcMap = await loadRetailerUpcMap(retailerUpcMapPath);
  const exclusionFiles = [
    ...getArgs("exclude-staging-json"),
    ...parseCsvList(getArg("exclude-staging-jsons", "")),
  ];
  const exclusions = await collectExclusionsFromPayloads(exclusionFiles);
  for (const gtin of parseCsvList(getArg("exclude-gtin14s", ""))) {
    const normalized = normalizeGtin14(gtin);
    if (normalized) exclusions.gtins.add(normalized);
  }

  const officialCandidatesPayload = JSON.parse(await fs.readFile(path.resolve(ROOT, officialCandidatePath), "utf8"));
  const officialCatalogPayload = JSON.parse(await fs.readFile(path.resolve(ROOT, officialCatalogPath), "utf8"));
  const officialCandidates = Array.isArray(officialCandidatesPayload?.products)
    ? officialCandidatesPayload.products
    : [];
  const officialCatalog = Array.isArray(officialCatalogPayload) ? officialCatalogPayload : [];
  const sourceCandidates = buildCandidates({ officialCandidates, officialCatalog, targetBrands });

  const selected = [];
  const skipped = [];
  const fetchedByBrand = new Map();
  const selectedByBrand = new Map();

  for (const candidate of sourceCandidates) {
    const target = brandTargets.get(candidate.brandName) ?? 0;
    const imageOcrOnly = imageOcrBrands.includes(candidate.brandName) && target <= 0;
    if (target <= 0 && !imageOcrOnly) continue;
    if (!imageOcrOnly && (selectedByBrand.get(candidate.brandName) ?? 0) >= target) continue;
    if ((fetchedByBrand.get(candidate.brandName) ?? 0) >= maxFetchPerBrand) continue;
    if (candidate.barcode_gtin14 && exclusions.gtins.has(candidate.barcode_gtin14)) {
      skipped.push({ ...candidate, reason: "excluded_previous_staging_gtin" });
      continue;
    }
    if (candidate.productId && exclusions.productIds.has(candidate.productId)) {
      skipped.push({ ...candidate, reason: "excluded_previous_staging_product_id" });
      continue;
    }

    fetchedByBrand.set(candidate.brandName, (fetchedByBrand.get(candidate.brandName) ?? 0) + 1);
    try {
      const fetched = await fetchHtml(candidate.link);
      if (!fetched.ok) {
        skipped.push({ ...candidate, reason: `http_${fetched.status}` });
        continue;
      }
      const record = applyRetailerUpcEvidence({
        record: buildOverlayRecord({ candidate, html: fetched.html, pageUrl: candidate.link, waveId }),
        candidate,
        retailerUpcMap,
        waveId,
      });
      const extractedGtin = normalizeGtin14(record.barcode_gtin14);
      if (extractedGtin && exclusions.gtins.has(extractedGtin)) {
        skipped.push({
          ...candidate,
          barcode_gtin14: extractedGtin,
          reason: "excluded_previous_or_manual_extracted_gtin",
        });
        continue;
      }
      if (!hasFullCore(record)) {
        skipped.push({
          ...candidate,
          reason: "parsed_but_not_full_core",
          parsed: {
            gtin: record.barcode_gtin14,
            image: Boolean(record.productCatalogImage),
            facts: record.supplementFacts?.nutritionalFacts?.length ?? 0,
            suggestedUse: Boolean(record.descriptionSections?.["Suggested use"]),
            warnings: Boolean(record.descriptionSections?.Warnings),
          },
        });
        continue;
      }
      if (imageOcrOnly) {
        skipped.push({
          ...candidate,
          reason: "official_parser_withheld_for_image_ocr_retailer_lane",
          parsed: {
            gtin: record.barcode_gtin14,
            image: Boolean(record.productCatalogImage),
            facts: record.supplementFacts?.nutritionalFacts?.length ?? 0,
            suggestedUse: Boolean(record.descriptionSections?.["Suggested use"]),
            warnings: Boolean(record.descriptionSections?.Warnings),
          },
        });
        continue;
      }
      selected.push(record);
      selectedByBrand.set(candidate.brandName, (selectedByBrand.get(candidate.brandName) ?? 0) + 1);
    } catch (error) {
      skipped.push({
        ...candidate,
        reason: `fetch_or_parse_error:${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const payload = {
    schemaVersion: "canadian-wave-set-2-parser-lane.v1",
    generatedAt: new Date().toISOString(),
    waveId,
    sourceInputs: {
      officialCandidatePath,
      officialCatalogPath,
      exclusionFiles,
      retailerUpcMapPath,
      retailerUpcMapEntries: retailerUpcMap.length,
      excludedGtin14Count: exclusions.gtins.size,
      excludedProductIdCount: exclusions.productIds.size,
    },
    targetPolicy: {
      brands: targetBrands,
      brandTargets: Object.fromEntries(brandTargets),
      promotionPolicy,
      maxFetchPerBrand,
      rules: [
        "fetch live official product page",
        "require UPC/GTIN",
        "require product image",
        "require at least one parsed fact row with amount",
        "require suggested use",
        "require warnings/cautions",
        "emit staging JSON only for full-core rows",
      ],
    },
    summary: {
      sourceCandidates: sourceCandidates.length,
      selected: selected.length,
      skipped: skipped.length,
      fetchedByBrand: Object.fromEntries(fetchedByBrand),
      byBrand: selected.reduce((acc, row) => {
        acc[row.brandName] = (acc[row.brandName] ?? 0) + 1;
        return acc;
      }, {}),
    },
    skipped,
    products: selected,
  };
  const imageLanePayload = buildImageOcrRetailerLane({ skipped, imageOcrBrands, waveId });

  const outputs = await writeOutputs({
    payload,
    outDir: path.resolve(ROOT, outDir),
    fileStem,
  });
  const imageLaneOutputs = await writeImageOcrRetailerLane({
    payload: imageLanePayload,
    outDir: path.resolve(ROOT, outDir),
    fileStem: imageLaneFileStem,
  });

  console.log(
    JSON.stringify(
      {
        ok: selected.length > 0,
        outputs: { ...outputs, imageOcrRetailerLane: imageLaneOutputs },
        summary: payload.summary,
        imageOcrRetailerLane: imageLanePayload.summary,
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
