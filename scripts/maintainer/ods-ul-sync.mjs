#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT_DIR = process.cwd();
const nowTag = new Date().toISOString().replace(/[:.]/g, "-");

const ODS_FACTS_LIST_URL = "https://ods.od.nih.gov/factsheets/list-all/";
const ODS_API_INDEX_URL = "https://ods.od.nih.gov/api/";
const ODS_API_BASE_URL = "https://ods.od.nih.gov/api/";

const RESOURCE_CANONICAL_MAP = {
  Biotin: "biotin",
  Boron: "boron",
  Calcium: "calcium",
  Carnitine: "l_carnitine",
  Choline: "choline",
  chromium: "chromium",
  Chromium: "chromium",
  Copper: "copper",
  Fluoride: "fluoride",
  Folate: "folate",
  Iodine: "iodine",
  Iron: "iron",
  Magnesium: "magnesium",
  Manganese: "manganese",
  Molybdenum: "molybdenum",
  Niacin: "niacin",
  Omega3FattyAcids: "omega_3",
  PantothenicAcid: "pantothenic_acid",
  Phosphorus: "phosphorus",
  Potassium: "potassium",
  Riboflavin: "riboflavin",
  Selenium: "selenium",
  Thiamin: "thiamin",
  VitaminA: "vitamin_a",
  VitaminB12: "vitamin_b12",
  VitaminB6: "vitamin_b6",
  VitaminC: "vitamin_c",
  VitaminD: "vitamin_d",
  VitaminE: "vitamin_e",
  VitaminK: "vitamin_k1",
  Zinc: "zinc",
};

const KEY_UNIT_PRIORITY = ["mcg", "mg", "g", "iu"];

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(`--${flag}`);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

if (hasFlag("help")) {
  console.log(`Usage:
  node scripts/maintainer/ods-ul-sync.mjs [options]

Options:
  --out-dir <path>            Output directory (default: backend/data/ods)
  --cache-dir <path>          Cache directory (default: output/cache/ods-ul-sync)
  --rate-limit-rps <number>   Request rate limit (default: 1.5)
  --max-pages <number>        Max Health Professional pages to parse (default: unlimited)
  --strict                    Fail when gold checks / minimum coverage fail
`);
  process.exit(0);
}

const outDirArg = getArg("out-dir") || path.join("backend", "data", "ods");
const cacheDirArg = getArg("cache-dir") || path.join("output", "cache", "ods-ul-sync");
const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
const cacheDir = path.isAbsolute(cacheDirArg) ? cacheDirArg : path.join(ROOT_DIR, cacheDirArg);
const rateLimitRps = Math.max(0.2, Number(getArg("rate-limit-rps") || "1.5"));
const maxPages = Number(getArg("max-pages") || "0");
const strictMode = hasFlag("strict");

const RAW_OUT_PATH = path.join(outDir, "ods_ul.raw.json");
const NORMALIZED_OUT_PATH = path.join(outDir, "ods_ul.normalized.v1.json");
const WATCHOUTS_OUT_PATH = path.join(outDir, "ods_watchouts.normalized.v1.json");
const ALIAS_MAP_OUT_PATH = path.join(outDir, "ods_alias_map.v1.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const decodeHtml = (value) =>
  String(value || "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#([0-9]+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const stripTags = (value) =>
  decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeToken = (value) =>
  String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeUnit = (rawUnit) => {
  const unit = String(rawUnit || "").trim().toLowerCase();
  if (!unit) return null;
  if (unit === "ug" || unit === "μg" || unit === "µg") return "mcg";
  if (unit === "i.u." || unit === "i.u" || unit === "ui") return "iu";
  return unit;
};

const pickByPriorityUnit = (candidates) => {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  for (const preferred of KEY_UNIT_PRIORITY) {
    const hits = candidates.filter((item) => item.unit === preferred);
    if (!hits.length) continue;
    return hits.reduce((best, item) => (item.value < best.value ? item : best), hits[0]);
  }
  return candidates[0];
};

const parseDoseCandidates = (text) => {
  const normalized = decodeHtml(text).replace(/,/g, "");
  const regex = /([<>≤≥]?\s*\d+(?:\.\d+)?)\s*(mcg|μg|µg|ug|mg|g|iu|i\.u\.?|ui)\b/gi;
  const out = [];
  for (const match of normalized.matchAll(regex)) {
    const num = Number(match[1].replace(/[<>≤≥\s]/g, ""));
    const unit = normalizeUnit(match[2]);
    if (!Number.isFinite(num) || num <= 0 || !unit) continue;
    out.push({ value: num, unit });
  }
  return out;
};

const toSentences = (text) => {
  const clean = stripTags(text);
  if (!clean) return [];
  return clean
    .split(/(?<=[.?!])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
};

const clampSentence = (line, max = 220) => {
  const cleaned = line.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
};

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: {
      "user-agent": "nutri-app-maintainer-ods-ul-sync/1.0",
      accept: "text/html,application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
};

const getTag = (xml, tagName) => {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1].trim() : null;
};

const loadReviewedAliases = async () => {
  const aliasPath = path.join(ROOT_DIR, "backend", "data", "reviewed", "reviewed-ingredient-aliases.v1.json");
  try {
    const raw = await fs.readFile(aliasPath, "utf8");
    const parsed = JSON.parse(raw);
    const aliases = parsed?.aliases && typeof parsed.aliases === "object" ? parsed.aliases : {};
    const out = new Map();
    Object.entries(aliases).forEach(([alias, canonical]) => {
      const aliasNorm = normalizeToken(alias);
      const canonicalNorm = normalizeToken(canonical);
      if (!aliasNorm || !canonicalNorm) return;
      out.set(aliasNorm, canonicalNorm);
    });
    return out;
  } catch {
    return new Map();
  }
};

const parseResourceNamesFromApiIndex = (html) => {
  const regex =
    /href="index\.aspx\?resourcename=([^"&]+)&amp;readinglevel=Health Professional&amp;outputformat=XML"/gi;
  const set = new Set();
  for (const match of html.matchAll(regex)) {
    const resourceNameRaw = match[1] ? decodeURIComponent(match[1]) : "";
    const resourceName = resourceNameRaw.trim();
    if (!resourceName) continue;
    set.add(resourceName);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
};

const parseTables = (contentHtml) => {
  const tables = [];
  const regex = /<table[\s\S]*?<\/table>/gi;
  for (const match of contentHtml.matchAll(regex)) {
    const tableHtml = match[0];
    const captionMatch = tableHtml.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
    const caption = captionMatch ? stripTags(captionMatch[1]) : "";
    const rows = [];
    for (const rowMatch of tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const rowHtml = rowMatch[0];
      const cells = [];
      for (const cellMatch of rowHtml.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)) {
        cells.push(stripTags(cellMatch[1]));
      }
      if (cells.length) rows.push(cells);
    }
    tables.push({
      caption,
      text: stripTags(tableHtml),
      rows,
    });
  }
  return tables;
};

const inferScope = (fullTextLower) => {
  if (
    /upper intake[^.]{0,140}(supplements? and fortified foods|fortified foods and supplements|synthetic folic acid)/i.test(
      fullTextLower,
    ) ||
    (/folic acid/.test(fullTextLower) &&
      /upper intake level/.test(fullTextLower) &&
      /(fortified foods|supplements)/.test(fullTextLower))
  ) {
    return "supplements_or_fortified_only";
  }
  if (
    /(upper intake|ul)[^.]{0,180}(from dietary supplements only|from supplements and medications only|supplements only)/i.test(
      fullTextLower,
    ) ||
    /tolerable upper intake levels?[^.]{0,120}for supplemental/i.test(fullTextLower) ||
    /\bfor supplemental\s+[a-z0-9_-]+\b/.test(fullTextLower)
  ) {
    return "supplements_only";
  }
  return "total_intake";
};

const isPregnancyRow = (labelLower) =>
  /pregnan|gestation|expectant/.test(labelLower);

const isLactationRow = (labelLower) =>
  /lactat|breastfeeding|nursing/.test(labelLower);

const isAdult19PlusRow = (labelLower) => {
  if (isPregnancyRow(labelLower) || isLactationRow(labelLower)) return false;
  if (/\badults?\b/.test(labelLower)) return true;
  if (/\b19\+\b/.test(labelLower)) return true;
  const ageMatch = labelLower.match(/(\d{1,2})\s*(?:\+|and older|or older|to|–|-|—|years|yrs)/);
  if (!ageMatch) return false;
  const minAge = Number(ageMatch[1]);
  return Number.isFinite(minAge) && minAge >= 19;
};

const mergeStageCandidate = (bucket, stage, candidate) => {
  if (!candidate) return;
  if (!bucket[stage]) bucket[stage] = [];
  bucket[stage].push(candidate);
};

const finalizeStage = (candidates) => {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const byUnit = new Map();
  candidates.forEach((candidate) => {
    if (!candidate || !candidate.unit || !Number.isFinite(candidate.value) || candidate.value <= 0) return;
    if (!byUnit.has(candidate.unit)) byUnit.set(candidate.unit, []);
    byUnit.get(candidate.unit).push(candidate.value);
  });
  for (const unit of KEY_UNIT_PRIORITY) {
    const values = byUnit.get(unit);
    if (!values?.length) continue;
    return { value: Math.min(...values), unit };
  }
  const [unit, values] = [...byUnit.entries()][0] || [];
  if (!unit || !values?.length) return null;
  return { value: Math.min(...values), unit };
};

const parseUlGroups = (contentHtml) => {
  const tables = parseTables(contentHtml);
  const ulTables = tables.filter((table) => {
    const haystack = `${table.caption} ${table.text}`.toLowerCase();
    return /tolerable upper intake level|upper intake level/.test(haystack);
  });
  const stageCandidates = {
    adult_19_plus: [],
    pregnancy: [],
    lactation: [],
  };

  ulTables.forEach((table) => {
    table.rows.forEach((cells) => {
      if (!cells.length) return;
      const label = String(cells[0] || "").trim();
      const labelLower = label.toLowerCase();
      if (!label || /\bage\b|life stage|male|female|pregnancy|lactation/.test(labelLower)) return;
      const doseCandidates = [];
      cells.slice(1).forEach((cell) => {
        parseDoseCandidates(cell).forEach((dose) => {
          doseCandidates.push(dose);
        });
      });
      const chosen = pickByPriorityUnit(doseCandidates);
      if (!chosen) return;
      if (isPregnancyRow(labelLower)) {
        mergeStageCandidate(stageCandidates, "pregnancy", chosen);
      } else if (isLactationRow(labelLower)) {
        mergeStageCandidate(stageCandidates, "lactation", chosen);
      } else if (isAdult19PlusRow(labelLower)) {
        mergeStageCandidate(stageCandidates, "adult_19_plus", chosen);
      }
    });
  });

  const groups = [];
  const adult = finalizeStage(stageCandidates.adult_19_plus);
  if (adult) groups.push({ lifeStage: "adult_19_plus", value: adult.value, unit: adult.unit });
  const pregnancy = finalizeStage(stageCandidates.pregnancy);
  if (pregnancy) groups.push({ lifeStage: "pregnancy", value: pregnancy.value, unit: pregnancy.unit });
  const lactation = finalizeStage(stageCandidates.lactation);
  if (lactation) groups.push({ lifeStage: "lactation", value: lactation.value, unit: lactation.unit });

  return {
    groups,
    ulTables,
  };
};

const extractScopeNotes = (contentHtml) => {
  const lines = toSentences(contentHtml);
  const keywords = [
    /1 mcg vitamin d.*40 iu/i,
    /upper intake[^.]*supplements? only/i,
    /upper intake[^.]*fortified foods/i,
    /upper intake[^.]*does not apply to naturally occurring folate/i,
    /supplements and medications only/i,
  ];
  const out = [];
  for (const line of lines) {
    if (!keywords.some((pattern) => pattern.test(line))) continue;
    out.push(clampSentence(line, 200));
    if (out.length >= 5) break;
  }
  return out;
};

const MEDICATION_KEYWORDS = [
  ["tetracycline", "tetracyclines"],
  ["quinolone", "quinolones"],
  ["antibiotic", "antibiotics"],
  ["thyroid", "thyroid hormone"],
  ["bisphosphonate", "bisphosphonates"],
  ["levodopa", "levodopa"],
  ["warfarin", "warfarin"],
  ["anticoagulant", "anticoagulants"],
  ["diuretic", "diuretics"],
];

const CONDITION_KEYWORDS = [
  ["kidney", "kidney disease"],
  ["liver", "liver disease"],
  ["bleeding", "bleeding risk"],
  ["hypertension", "hypertension"],
  ["diabetes", "diabetes"],
  ["heart", "heart condition"],
];

const POPULATION_KEYWORDS = [
  ["pregnan", "pregnancy"],
  ["lactat", "lactation"],
  ["children", "children"],
  ["infants", "infants"],
  ["older adults", "older adults"],
];

const extractKeywordTags = (text, matrix) => {
  const normalized = text.toLowerCase();
  const out = [];
  matrix.forEach(([needle, label]) => {
    if (normalized.includes(needle)) out.push(label);
  });
  return Array.from(new Set(out));
};

const resolveCanonicalKey = ({ resourceName, title, aliasMap }) => {
  if (RESOURCE_CANONICAL_MAP[resourceName]) return RESOURCE_CANONICAL_MAP[resourceName];
  const titleHead = String(title || "").split(/[:,-]/)[0] || "";
  const candidates = [
    resourceName,
    titleHead,
    title,
    String(resourceName || "").replace(/Factsheet|FactSheet/gi, ""),
  ]
    .map((candidate) => normalizeToken(candidate))
    .filter(Boolean);

  for (const candidate of candidates) {
    const mapped = aliasMap.get(candidate);
    if (mapped) return mapped;
  }
  return candidates[0] || null;
};

const createAltUnits = (canonicalKey, contentHtml) => {
  const notesText = stripTags(contentHtml);
  if (
    canonicalKey === "vitamin_d" &&
    /1 mcg vitamin d.*40 iu/i.test(notesText)
  ) {
    return [{ unit: "iu", factor: 40, direction: "mcg->iu" }];
  }
  return [];
};

const ensureDir = async (fileOrDirPath) => {
  const dir = path.extname(fileOrDirPath) ? path.dirname(fileOrDirPath) : fileOrDirPath;
  await fs.mkdir(dir, { recursive: true });
};

const hashContent = (value) => createHash("sha256").update(String(value || "")).digest("hex");

const buildStrictChecks = (normalizedItems) => {
  const byKey = new Map(normalizedItems.map((item) => [item.ingredientCanonicalKey, item]));
  const vitaminD = byKey.get("vitamin_d");
  const magnesium = byKey.get("magnesium");
  const folate = byKey.get("folate");

  const getAdultGroup = (item) => (item?.groups || []).find((group) => group.lifeStage === "adult_19_plus") ?? null;

  const vitaminDAdult = getAdultGroup(vitaminD);
  const magnesiumAdult = getAdultGroup(magnesium);
  const folateAdult = getAdultGroup(folate);
  const coverageCount = normalizedItems.filter(
    (item) => item.noUlEstablished || item.groups.some((group) => group.lifeStage === "adult_19_plus"),
  ).length;

  return {
    coverageCount,
    vitaminD: {
      ok: Boolean(vitaminDAdult && vitaminDAdult.value === 100 && vitaminDAdult.unit === "mcg"),
      actual: vitaminDAdult,
    },
    magnesium: {
      ok: Boolean(
        magnesiumAdult &&
          magnesiumAdult.value === 350 &&
          magnesiumAdult.unit === "mg" &&
          magnesium?.scope === "supplements_only",
      ),
      actual: {
        group: magnesiumAdult,
        scope: magnesium?.scope ?? null,
      },
    },
    folate: {
      ok: Boolean(
        folateAdult &&
          folateAdult.value === 1000 &&
          folateAdult.unit === "mcg" &&
          folate?.scope === "supplements_or_fortified_only",
      ),
      actual: {
        group: folateAdult,
        scope: folate?.scope ?? null,
      },
    },
  };
};

const main = async () => {
  await ensureDir(outDir);
  await ensureDir(cacheDir);

  const aliasMap = await loadReviewedAliases();
  const apiIndexHtml = await fetchText(ODS_API_INDEX_URL);
  const resourceNamesAll = parseResourceNamesFromApiIndex(apiIndexHtml);
  const resourceNames =
    maxPages > 0 ? resourceNamesAll.slice(0, maxPages) : resourceNamesAll;

  if (!resourceNames.length) {
    throw new Error("No Health Professional resources discovered from ODS API index page.");
  }

  const minIntervalMs = Math.round(1000 / rateLimitRps);
  let lastNetworkAt = 0;
  const pages = [];

  for (const [index, resourceName] of resourceNames.entries()) {
    const cachePath = path.join(cacheDir, `${normalizeToken(resourceName)}.xml`);
    let xml = null;
    try {
      xml = await fs.readFile(cachePath, "utf8");
    } catch {
      xml = null;
    }

    if (!xml) {
      const elapsed = Date.now() - lastNetworkAt;
      if (elapsed < minIntervalMs) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(minIntervalMs - elapsed);
      }
      const apiUrl = `${ODS_API_BASE_URL}?resourcename=${encodeURIComponent(
        resourceName,
      )}&readinglevel=Health+Professional&outputformat=XML`;
      // eslint-disable-next-line no-await-in-loop
      xml = await fetchText(apiUrl);
      lastNetworkAt = Date.now();
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(cachePath, xml, "utf8");
    }

    const reviewed = getTag(xml, "Reviewed");
    const sourceUrl = getTag(xml, "URL");
    const title = getTag(xml, "Title") || resourceName;
    const contentEncoded = getTag(xml, "Content") || "";
    const contentHtml = decodeHtml(contentEncoded);
    const fullText = stripTags(contentHtml);
    const scope = inferScope(fullText.toLowerCase());
    const { groups, ulTables } = parseUlGroups(contentHtml);
    const canonicalKey = resolveCanonicalKey({
      resourceName,
      title,
      aliasMap,
    });
    const notes = extractScopeNotes(contentHtml);
    const altUnits = createAltUnits(canonicalKey, contentHtml);
    const noUlEstablished = groups.length === 0;

    pages.push({
      resourceName,
      title,
      canonicalKey,
      reviewed,
      sourceUrl,
      scope,
      notes,
      altUnits,
      noUlEstablished,
      groups,
      watchouts: {
        interactionMedications: extractKeywordTags(fullText, MEDICATION_KEYWORDS),
        cautionConditions: extractKeywordTags(fullText, CONDITION_KEYWORDS),
        cautionPopulation: extractKeywordTags(fullText, POPULATION_KEYWORDS),
      },
      parse: {
        ulTableCount: ulTables.length,
      },
      contentHash: hashContent(contentHtml),
      contentPreview: fullText.slice(0, 500),
    });

    if ((index + 1) % 10 === 0 || index === resourceNames.length - 1) {
      console.log(`[ods-ul-sync] parsed ${index + 1}/${resourceNames.length} (${resourceName})`);
    }
  }

  const normalizedItems = pages
    .filter((page) => Boolean(page.canonicalKey))
    .map((page) => {
      const adultGroup = page.groups.find((item) => item.lifeStage === "adult_19_plus") || null;
      return {
        ingredientCanonicalKey: page.canonicalKey,
        displayName: page.title,
        sourceUrl: page.sourceUrl || null,
        sourceUpdatedAt: page.reviewed || null,
        scope: page.scope,
        unit: adultGroup?.unit ?? null,
        altUnits: page.altUnits,
        groups: page.groups,
        notes: page.notes,
        noUlEstablished: page.noUlEstablished,
      };
    });

  const dedupedItems = [];
  const itemByCanonical = new Map();
  normalizedItems.forEach((item) => {
    const existing = itemByCanonical.get(item.ingredientCanonicalKey);
    if (!existing) {
      itemByCanonical.set(item.ingredientCanonicalKey, item);
      return;
    }
    const chooseNew =
      Number(item.groups.length > 0) > Number(existing.groups.length > 0) ||
      (item.groups.length > 0 && existing.groups.length > 0 && Boolean(item.sourceUpdatedAt) && !existing.sourceUpdatedAt);
    if (chooseNew) {
      itemByCanonical.set(item.ingredientCanonicalKey, item);
    }
  });
  itemByCanonical.forEach((value) => dedupedItems.push(value));
  dedupedItems.sort((a, b) => a.ingredientCanonicalKey.localeCompare(b.ingredientCanonicalKey));

  const watchoutsItems = pages
    .filter((page) => Boolean(page.canonicalKey))
    .map((page) => ({
      ingredientCanonicalKey: page.canonicalKey,
      sourceUrl: page.sourceUrl || null,
      interaction: {
        medications: page.watchouts.interactionMedications,
      },
      caution: {
        conditions: page.watchouts.cautionConditions,
        population: page.watchouts.cautionPopulation,
      },
    }));

  const aliasAccumulator = {};
  pages.forEach((page) => {
    if (!page.canonicalKey) return;
    const keys = [page.resourceName, page.title, page.title.split(/[:,-]/)[0]]
      .map((item) => normalizeToken(item))
      .filter(Boolean);
    keys.forEach((key) => {
      aliasAccumulator[key] = page.canonicalKey;
    });
  });

  const generatedAt = new Date().toISOString();
  const rawPayload = {
    version: "v1",
    generatedAt,
    generatedTag: nowTag,
    source: {
      factsListUrl: ODS_FACTS_LIST_URL,
      apiIndexUrl: ODS_API_INDEX_URL,
      apiBaseUrl: ODS_API_BASE_URL,
    },
    parserConfig: {
      rateLimitRps,
      maxPages: maxPages > 0 ? maxPages : null,
      strictMode,
      parsedPages: pages.length,
    },
    pages,
  };

  const normalizedPayload = {
    version: "v1",
    generatedAt,
    sourceIndexUrl: ODS_FACTS_LIST_URL,
    parserVersion: "ods_ul_sync_v1",
    items: dedupedItems,
  };

  const watchoutsPayload = {
    version: "v1",
    generatedAt,
    sourceIndexUrl: ODS_FACTS_LIST_URL,
    items: watchoutsItems,
  };

  const aliasPayload = {
    version: "v1",
    generatedAt,
    aliases: aliasAccumulator,
  };

  const strictChecks = buildStrictChecks(dedupedItems);
  const strictErrors = [];
  if (strictChecks.coverageCount < 30) {
    strictErrors.push(`coverageCount=${strictChecks.coverageCount} < 30`);
  }
  if (!strictChecks.vitaminD.ok) {
    strictErrors.push(`vitamin_d gold check failed: ${JSON.stringify(strictChecks.vitaminD.actual)}`);
  }
  if (!strictChecks.magnesium.ok) {
    strictErrors.push(`magnesium gold check failed: ${JSON.stringify(strictChecks.magnesium.actual)}`);
  }
  if (!strictChecks.folate.ok) {
    strictErrors.push(`folate gold check failed: ${JSON.stringify(strictChecks.folate.actual)}`);
  }

  await ensureDir(RAW_OUT_PATH);
  await Promise.all([
    fs.writeFile(RAW_OUT_PATH, `${JSON.stringify(rawPayload, null, 2)}\n`, "utf8"),
    fs.writeFile(NORMALIZED_OUT_PATH, `${JSON.stringify(normalizedPayload, null, 2)}\n`, "utf8"),
    fs.writeFile(WATCHOUTS_OUT_PATH, `${JSON.stringify(watchoutsPayload, null, 2)}\n`, "utf8"),
    fs.writeFile(ALIAS_MAP_OUT_PATH, `${JSON.stringify(aliasPayload, null, 2)}\n`, "utf8"),
  ]);

  console.log(`[ods-ul-sync] wrote ${RAW_OUT_PATH}`);
  console.log(`[ods-ul-sync] wrote ${NORMALIZED_OUT_PATH}`);
  console.log(`[ods-ul-sync] wrote ${WATCHOUTS_OUT_PATH}`);
  console.log(`[ods-ul-sync] wrote ${ALIAS_MAP_OUT_PATH}`);
  console.log(`[ods-ul-sync] summary: pages=${pages.length}, items=${dedupedItems.length}, coverage=${strictChecks.coverageCount}`);
  console.log(`[ods-ul-sync] gold checks: vitamin_d=${strictChecks.vitaminD.ok} magnesium=${strictChecks.magnesium.ok} folate=${strictChecks.folate.ok}`);

  if (strictMode && strictErrors.length) {
    throw new Error(`strict checks failed: ${strictErrors.join("; ")}`);
  }
};

main().catch((error) => {
  console.error("[ods-ul-sync] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
