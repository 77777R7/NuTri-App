#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import {
  buildOverlayRecordKey,
  buildPatchStrategy,
  classifyOverlayStatus,
  deriveCompleteness,
  extractOverlayRecordFromSeedRow,
  mergeOverlayRecords,
  normalizeText,
  qualifiesHighConfidenceUsProductPage,
  stableHash,
  toGtin14,
} from "./lib/iherb-overlay-utils.mjs";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

dotenv.config();
dotenv.config({ path: path.join(ROOT, "backend", ".env") });

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const BRAND = getArg("brand");
const INPUT_JSON = getArg("input-json");
const QUEUE_JSON = getArg("queue-json");
const OUT_JSON = getArg("out-json");
const SITE_ORIGIN = getArg("site-origin");
const CONFIG_JSON = getArg("config-json");
const STORAGE_BUCKET = getArg("storage-bucket", "overlay-label-assets");
const RENDER_SIZE = Number(getArg("render-size", "900"));
const FETCH_TIMEOUT_MS = Number(getArg("fetch-timeout-ms", "12000"));
const ALLOW_GENERATED_IMAGE_FALLBACK = args.includes("--allow-generated-image-fallback");

if (!BRAND || !INPUT_JSON || !QUEUE_JSON || !OUT_JSON || !SITE_ORIGIN) {
  console.error(
    "Usage: node scripts/maintainer/close-three-brand-official-gap.mjs --brand <name> --input-json <path> --queue-json <path> --out-json <path> --site-origin <https://...> [--storage-bucket overlay-label-assets]",
  );
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const chunk = (rows, size) => {
  const out = [];
  for (let idx = 0; idx < rows.length; idx += size) out.push(rows.slice(idx, idx + size));
  return out;
};

const normalizeLower = (value) => normalizeText(value).toLowerCase();

const stripTags = (value) =>
  String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join("\n");

const fetchJson = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NuTriAppMaintainer/1.0)",
        Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) {
      throw new Error(`Fetch failed ${response.status} for ${url}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const fetchText = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NuTriAppMaintainer/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) {
      throw new Error(`Fetch failed ${response.status} for ${url}`);
    }
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
};

const ensureStorageBucket = async () => {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!(buckets ?? []).some((row) => row.name === STORAGE_BUCKET)) {
    const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, {
      public: true,
      fileSizeLimit: "10MB",
    });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
};

const renderDsldPdfToPublicUrl = async (labelId) => {
  const pdfUrl = `https://api.ods.od.nih.gov/dsld/s3/pdf/${labelId}.pdf`;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `dsld-${labelId}-`));
  const pdfPath = path.join(tmpDir, `${labelId}.pdf`);
  const pngPath = `${pdfPath}.png`;
  try {
    const response = await fetch(pdfUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NuTriAppMaintainer/1.0)" },
    });
    if (!response.ok) throw new Error(`PDF fetch failed ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(pdfPath, Buffer.from(arrayBuffer));
    await execFileAsync("/usr/bin/qlmanage", ["-t", "-s", String(RENDER_SIZE), "-o", tmpDir, pdfPath], {
      env: process.env,
    });
    const fileBuffer = await fs.readFile(pngPath);

    await ensureStorageBucket();

    const objectPath = `dsld-label-renders/${labelId}.png`;
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(objectPath, fileBuffer, {
      contentType: "image/png",
      cacheControl: "31536000",
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const publicUrl = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath).data.publicUrl;
    return normalizeText(publicUrl) || null;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
};

const uploadRemoteImageToPublicUrl = async ({ productId, imageUrl }) => {
  const response = await fetch(imageUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; NuTriAppMaintainer/1.0)" },
  });
  if (!response.ok) throw new Error(`Remote image fetch failed ${response.status}`);
  const contentType = normalizeText(response.headers.get("content-type") ?? "").toLowerCase();
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const arrayBuffer = await response.arrayBuffer();
  await ensureStorageBucket();
  const objectPath = `manual-fallback-renders/${productId}.${ext}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(objectPath, Buffer.from(arrayBuffer), {
    contentType: contentType || `image/${ext}`,
    cacheControl: "31536000",
    upsert: true,
  });
  if (error) throw error;
  return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath).data.publicUrl;
};

const renderGeneratedFallbackCardToPublicUrl = async ({ productId, brandName, title }) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `card-${productId}-`));
  const htmlPath = path.join(tmpDir, `${productId}.html`);
  const pngPath = `${htmlPath}.png`;
  const safeBrand = String(brandName ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeTitle = String(title ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html><body style="margin:0;width:900px;height:900px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f6efe4,#f0f7ff);font-family:-apple-system,BlinkMacSystemFont,sans-serif;"><div style="width:760px;height:760px;border-radius:48px;background:white;box-shadow:0 20px 60px rgba(0,0,0,.08);padding:56px;display:flex;flex-direction:column;justify-content:space-between"><div style="font-size:28px;color:#666;letter-spacing:.08em;text-transform:uppercase">${safeBrand}</div><div style="font-size:64px;line-height:1.05;color:#111;font-weight:700">${safeTitle}</div><div style="font-size:28px;color:#777">Legacy label image unavailable</div></div></body></html>`;
  try {
    await fs.writeFile(htmlPath, html, "utf8");
    await execFileAsync("/usr/bin/qlmanage", ["-t", "-s", String(RENDER_SIZE), "-o", tmpDir, htmlPath], {
      env: process.env,
    });
    const fileBuffer = await fs.readFile(pngPath);
    await ensureStorageBucket();
    const objectPath = `generated-fallback-cards/${productId}.png`;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(objectPath, fileBuffer, {
      contentType: "image/png",
      cacheControl: "31536000",
      upsert: true,
    });
    if (error) throw error;
    return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath).data.publicUrl;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
};

const MANUAL_ASSET_OVERRIDES = {
  "31143": {
    imageUrl:
      "https://www.instacart.com/image-server/591x591/d2lnr5mha7bycj.cloudfront.net/product-image/file/primary_ecd2ac8c-f8e5-4b8a-a803-a596dc8cda91.png",
  },
  "49563": {
    imageUrl: "https://images.freshop.ncrcloud.com/00074312552724/3d8ba6dc1df8c8bb06b79de41b72020c_large.png",
  },
  "64456": {
    imageUrl:
      "https://icheckcdn.net/images/original/-TheHulk/f3d49a32e2/1512032656_538eccddae364a6aa671d6195fc0232a_1a8eda.jpg",
  },
};

const scoreCandidate = ({ queueTitle, queueBarcode, handle, productJson }) => {
  const queueTitleNorm = normalizeLower(queueTitle);
  const handleNorm = normalizeLower(handle.replace(/-/g, " "));
  const titleNorm = normalizeLower(productJson?.title ?? "");
  const barcode = toGtin14(productJson?.variants?.[0]?.barcode ?? null);
  const barcodeMatch = queueBarcode && barcode && queueBarcode === barcode;
  const tokenSet = new Set(queueTitleNorm.split(/\s+/).filter(Boolean));
  const target = `${titleNorm} ${handleNorm}`;
  let overlap = 0;
  for (const token of tokenSet) {
    if (target.includes(token)) overlap += 1;
  }
  return Number(barcodeMatch) * 100 + overlap;
};

const extractProductHandles = (html) => {
  const matches = [...html.matchAll(/\/products\/([a-z0-9][a-z0-9-]+)(?:\?[^"'<> ]*)?/gi)];
  const seen = new Set();
  const out = [];
  for (const match of matches) {
    const handle = normalizeText(match[1]);
    if (!handle || /\.(?:png|jpg|jpeg|gif|webp)$/i.test(handle) || seen.has(handle)) continue;
    seen.add(handle);
    out.push(handle);
  }
  return out;
};

const parseNutritionInfoBlocks = (html) => {
  const blocks = [];
  const regex = /<div class="nutrition-card__info[^"]*">([\s\S]*?)<\/div>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const text = stripTags(match[1]);
    if (text) blocks.push(text);
  }
  return blocks;
};

const pickBlock = (blocks, prefix) => {
  for (const block of blocks) {
    const normalized = normalizeText(block);
    if (normalized.toUpperCase().startsWith(prefix)) return normalized.replace(new RegExp(`^${prefix}\\s*:?\\s*`, "i"), "");
  }
  return null;
};

const searchOfficialProductPage = async ({ title, barcode }) => {
  const searchUrl = `${SITE_ORIGIN}/search?q=${encodeURIComponent(title)}`;
  const html = await fetchText(searchUrl);
  const handles = extractProductHandles(html).slice(0, 12);
  if (handles.length === 0) return null;

  const candidates = [];
  for (const handle of handles) {
    try {
      const productJson = await fetchJson(`${SITE_ORIGIN}/products/${handle}.js`);
      candidates.push({
        handle,
        productJson,
        score: scoreCandidate({
          queueTitle: title,
          queueBarcode: toGtin14(barcode),
          handle,
          productJson,
        }),
      });
    } catch {
      continue;
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  const winner = candidates[0];
  if (!winner || winner.score <= 0) return null;

  const pageUrl = `${SITE_ORIGIN}/products/${winner.handle}`;
  const pageHtml = await fetchText(pageUrl);
  const infoBlocks = parseNutritionInfoBlocks(pageHtml);
  const directions = pickBlock(infoBlocks, "DIRECTIONS");
  const warnings = pickBlock(infoBlocks, "WARNING");
  const otherIngredients = pickBlock(infoBlocks, "Other Ingredients");
  const firstImage = Array.isArray(winner.productJson?.images) ? winner.productJson.images[0] : null;

  return {
    pageUrl,
    productCatalogImage: normalizeText(firstImage).replace(/^\/\//, "https://") || null,
    suggestedUse: directions,
    warnings,
    otherIngredients,
    title: winner.productJson?.title ?? null,
    handle: winner.handle,
  };
};

const extractDsldSections = (label) => {
  const statements = Array.isArray(label?.statements) ? label.statements : [];
  const suggested = statements.find((row) =>
    /Suggested\/Recommended\/Usage\/Directions/i.test(normalizeText(row?.type)),
  );
  const suggestedEmbedded = statements
    .map((row) => normalizeText(row?.notes))
    .find((notes) => /suggested use\s*:/i.test(notes));
  const warningParts = statements
    .filter((row) =>
      /^(Precautions|Storage|FDA Disclaimer Statement)/i.test(normalizeText(row?.type)),
    )
    .map((row) => normalizeText(row?.notes))
    .filter(Boolean);
  const otherIngredients = label?.otheringredients?.text
    ? normalizeText(label.otheringredients.text)
    : (Array.isArray(label?.otheringredients?.ingredients) ? label.otheringredients.ingredients : [])
        .map((row) => normalizeText(row?.name))
        .filter(Boolean)
        .join(", ");

  return {
    suggestedUse:
      normalizeText(suggested?.notes ?? null) ||
      normalizeText(
        suggestedEmbedded?.replace(/^[\s\S]*?suggested use\s*:\s*/i, "").trim() ?? null,
      ) ||
      null,
    warnings: normalizeText([...new Set(warningParts)].join(" ")) || null,
    otherIngredients: normalizeText(otherIngredients) || null,
  };
};

const buildSupplementFactsFromLabel = (label) => {
  const ingredientRows = Array.isArray(label?.ingredientRows) ? label.ingredientRows : [];
  const serving = Array.isArray(label?.servingSizes) ? label.servingSizes[0] : null;
  const deriveAmountFromNotes = (notes) => {
    const text = normalizeText(notes);
    if (!text) return null;
    const match = text.match(/(\d+(?:\.\d+)?)\s*(billion|million|trillion|mg|mcg|g|iu|cfu)\b/i);
    if (!match) return null;
    return normalizeText(`${match[1]} ${match[2].toUpperCase() === "CFU" ? "CFU" : match[2]}`) || null;
  };
  const formatQuantity = (quantity) => {
    if (!quantity || quantity?.quantity == null) return null;
    if (normalizeText(quantity.unit).toUpperCase() === "NP") return null;
    return normalizeText(`${quantity.quantity} ${quantity.unit ?? ""}`) || null;
  };
  return {
    servingSize:
      normalizeText(
        serving
          ? `${serving.minQuantity ?? serving.maxQuantity ?? ""} ${serving.unit ?? ""}`
          : null,
      ) || null,
    servingsPerContainer: normalizeText(label?.servingsPerContainer ?? null) || null,
    nutritionalFacts: ingredientRows
      .map((row) => {
        const quantity = Array.isArray(row?.quantity) ? row.quantity[0] : null;
        const amount = formatQuantity(quantity) || deriveAmountFromNotes(row?.notes);
        const blendMembers = (Array.isArray(row?.nestedRows) ? row.nestedRows : [])
          .map((nestedRow) => normalizeText(nestedRow?.name ?? null))
          .filter(Boolean);
        const substancy =
          blendMembers.length > 0 && /\b(blend|complex|matrix|formula)\b/i.test(normalizeText(row?.name))
            ? `${normalizeText(row?.name)}: ${blendMembers.join(", ")}`
            : normalizeText(row?.name ?? null);
        return {
          substancy,
          amountPerServing: normalizeText(amount),
          dailyValuePercent: null,
        };
      })
      .filter((row) => row.substancy && row.amountPerServing),
  };
};

const shouldPreferLabelSupplementFacts = (currentSupplementFacts, labelSupplementFacts) => {
  const currentFacts = Array.isArray(currentSupplementFacts?.nutritionalFacts)
    ? currentSupplementFacts.nutritionalFacts
    : [];
  const labelFacts = Array.isArray(labelSupplementFacts?.nutritionalFacts)
    ? labelSupplementFacts.nutritionalFacts
    : [];

  if (currentFacts.length === 0) return labelFacts.length > 0;

  const currentHasGenericBlend = currentFacts.some(
    (row) => /^proprietary blend$/i.test(normalizeText(row?.substancy ?? row?.name ?? null)),
  );
  const labelHasExpandedBlend = labelFacts.some((row) =>
    /^proprietary blend\s*:/i.test(normalizeText(row?.substancy ?? row?.name ?? null)),
  );

  return currentHasGenericBlend && labelHasExpandedBlend;
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const computeOverlayHash = (row) =>
  stableHash({
    overlayRecordKey: row.overlayRecordKey,
    barcode_gtin14: row.barcode_gtin14,
    supplementFacts: row.supplementFacts ?? {},
    descriptionSections: row.descriptionSections ?? {},
    sourceSummary: row.sourceSummary ?? {},
  });

const hydrateMergedRow = (currentRow, mergedRecord) => {
  const completeness = deriveCompleteness(mergedRecord);
  const status = classifyOverlayStatus(mergedRecord, completeness);
  const highConfidenceUsProductPageReady = qualifiesHighConfidenceUsProductPage(mergedRecord, completeness);
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
    patchStrategy: buildPatchStrategy(mergedRecord, completeness),
    overlaySha256: computeOverlayHash(mergedRecord),
  };
};

const buildBootstrapSeedRow = ({ queueRow, label, dsldMeta, brandName, title, barcodeGtin14 }) => ({
  brandName: normalizeText(brandName ?? null) || null,
  title: normalizeText(title ?? null) || null,
  productId: normalizeText(queueRow?.productId ?? dsldMeta?.dsld_label_id ?? null) || null,
  upcCode: normalizeText(barcodeGtin14 ?? null) || null,
  barcode_gtin14: toGtin14(barcodeGtin14) ?? null,
  link: null,
  productCatalogImage: null,
  productImages: [],
  categories: [],
  sourceTypes: ["dsld_label_api", "dsld_label_facts"],
  marketSources: ["US"],
  sourceUrls: normalizeText(dsldMeta?.dsld_pdf ?? null)
    ? [`https://api.ods.od.nih.gov/dsld/s3/pdf/${queueRow?.productId}.pdf`]
    : [],
  sourceNotes: ["missing_from_staging_dsld_bootstrap"],
  sections: extractDsldSections(label),
  supplementFacts: buildSupplementFactsFromLabel(label),
});

const fetchDsldMetaMap = async (labelIds) => {
  const out = new Map();
  for (const idChunk of chunk(labelIds, 200)) {
    const { data, error } = await supabase
      .from("dsld_labels_meta")
      .select(
        "dsld_label_id,brand,product_name,barcode_normalized_gtin14,dsld_pdf,dsld_thumbnail",
      )
      .in("dsld_label_id", idChunk);
    if (error) throw new Error(`dsld_labels_meta query failed: ${error.message}`);
    for (const row of data ?? []) {
      out.set(String(row.dsld_label_id), row);
    }
  }
  return out;
};

const main = async () => {
  const [payload, queueRows, config] = await Promise.all([
    readJson(INPUT_JSON),
    readJson(QUEUE_JSON),
    CONFIG_JSON ? readJson(CONFIG_JSON) : Promise.resolve(null),
  ]);
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const queue = Array.isArray(queueRows) ? queueRows : [];

  const brandRows = products.filter((row) => normalizeLower(row?.brandName) === normalizeLower(BRAND));
  const rowByProductId = new Map(brandRows.map((row) => [normalizeText(row?.productId), row]));
  const rowByBarcode = new Map(
    brandRows
      .map((row) => [toGtin14(row?.barcode_gtin14 ?? row?.upcCode ?? null), row])
      .filter(([barcode]) => Boolean(barcode)),
  );
  const metaMap = await fetchDsldMetaMap(queue.map((row) => Number(row?.productId)).filter(Number.isFinite));
  const uploadCache = new Map();
  const audit = [];
  const bootstrappedRows = [];

  for (const queueRow of queue) {
    const productId = normalizeText(queueRow?.productId);
    const label = await fetchJson(`https://api.ods.od.nih.gov/dsld/v9/label/${productId}`);
    const dsldSections = extractDsldSections(label);
    const dsldMeta = metaMap.get(productId) ?? null;
    let currentRow = rowByProductId.get(productId);
    let bootstrapped = false;
    const queueBarcode =
      toGtin14(queueRow?.barcode_gtin14 ?? null) ||
      toGtin14(dsldMeta?.barcode_normalized_gtin14 ?? null) ||
      null;

    if (!currentRow && queueBarcode) {
      currentRow = rowByBarcode.get(queueBarcode) ?? null;
    }

    if (!currentRow) {
      const bootstrapSeedRow = buildBootstrapSeedRow({
        queueRow,
        label,
        dsldMeta,
        brandName: queueRow?.brandName ?? dsldMeta?.brand ?? BRAND,
        title: queueRow?.title ?? dsldMeta?.product_name ?? label?.fullName ?? productId,
        barcodeGtin14:
          queueRow?.barcode_gtin14 ?? dsldMeta?.barcode_normalized_gtin14 ?? null,
      });
      currentRow = extractOverlayRecordFromSeedRow(bootstrapSeedRow, {
        seedName: "missing_from_staging_dsld_bootstrap",
      });
      bootstrapped = true;
    }

    const beforeMissingFields = Array.isArray(currentRow?.completeness?.coreMissingFields)
      ? currentRow.completeness.coreMissingFields
      : deriveCompleteness(currentRow).coreMissingFields;

    let officialPage = null;
    try {
      officialPage = await searchOfficialProductPage({
        title: queueRow?.title ?? currentRow?.title ?? label?.fullName ?? productId,
        barcode: queueRow?.barcode_gtin14 ?? currentRow?.barcode_gtin14 ?? null,
      });
    } catch (error) {
      officialPage = null;
      console.warn(
        `[close-three-brand-official-gap] official page search failed for ${BRAND} ${productId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let renderedImageUrl = null;
    const hasExistingImage =
      Boolean(normalizeText(currentRow?.productCatalogImage)) ||
      (Array.isArray(currentRow?.productImages) && currentRow.productImages.length > 0);
    if (!hasExistingImage && !normalizeText(officialPage?.productCatalogImage) && normalizeText(dsldMeta?.dsld_pdf)) {
      if (!uploadCache.has(productId)) {
        uploadCache.set(productId, renderDsldPdfToPublicUrl(productId));
      }
      renderedImageUrl = await uploadCache.get(productId);
    }
    const manualAsset = MANUAL_ASSET_OVERRIDES[productId] ?? null;
    let manualImageUrl = null;
    if (!hasExistingImage && !normalizeText(officialPage?.productCatalogImage) && !renderedImageUrl && manualAsset?.imageUrl) {
      if (!uploadCache.has(`manual:${productId}`)) {
        uploadCache.set(`manual:${productId}`, uploadRemoteImageToPublicUrl({ productId, imageUrl: manualAsset.imageUrl }));
      }
      manualImageUrl = await uploadCache.get(`manual:${productId}`);
    }
    let generatedImageUrl = null;
    if (
      ALLOW_GENERATED_IMAGE_FALLBACK &&
      !hasExistingImage &&
      !normalizeText(officialPage?.productCatalogImage) &&
      !renderedImageUrl &&
      !manualImageUrl
    ) {
      if (!uploadCache.has(`generated:${productId}`)) {
        uploadCache.set(
          `generated:${productId}`,
          renderGeneratedFallbackCardToPublicUrl({
            productId,
            brandName: currentRow?.brandName ?? queueRow?.brandName ?? BRAND,
            title: currentRow?.title ?? queueRow?.title ?? productId,
          }),
        );
      }
      generatedImageUrl = await uploadCache.get(`generated:${productId}`);
    }

    const nextSections = {
      ...(currentRow?.descriptionSections && typeof currentRow.descriptionSections === "object"
        ? currentRow.descriptionSections
        : {}),
    };
    const manualOverrideKey =
      normalizeText(currentRow?.productId ?? null) ||
      normalizeText(queueRow?.productId ?? null) ||
      productId;
    const manualSectionOverrides =
      config?.manualSectionOverrides && typeof config.manualSectionOverrides === "object"
        ? config.manualSectionOverrides[manualOverrideKey] ??
          config.manualSectionOverrides[productId] ??
          null
        : null;
    const suggestedUse =
      normalizeText(manualSectionOverrides?.["Suggested use"] ?? null) ||
      normalizeText(nextSections["Suggested use"] ?? null) ||
      normalizeText(officialPage?.suggestedUse ?? null) ||
      normalizeText(dsldSections.suggestedUse ?? null) ||
      null;
    const warnings =
      normalizeText(manualSectionOverrides?.Warnings ?? null) ||
      normalizeText(nextSections.Warnings ?? null) ||
      normalizeText(officialPage?.warnings ?? null) ||
      normalizeText(dsldSections.warnings ?? null) ||
      null;
    const otherIngredients =
      normalizeText(manualSectionOverrides?.["Other ingredients"] ?? null) ||
      normalizeText(nextSections["Other ingredients"] ?? null) ||
      normalizeText(officialPage?.otherIngredients ?? null) ||
      normalizeText(dsldSections.otherIngredients ?? null) ||
      null;

    if (suggestedUse) nextSections["Suggested use"] = suggestedUse;
    if (warnings) nextSections.Warnings = warnings;
    if (otherIngredients) nextSections["Other ingredients"] = otherIngredients;

    const labelSupplementFacts = buildSupplementFactsFromLabel(label);

    const mergedRecord = mergeOverlayRecords(currentRow, {
      ...currentRow,
      brandName: normalizeText(currentRow?.brandName ?? queueRow?.brandName ?? dsldMeta?.brand ?? label?.brandName) || currentRow?.brandName,
      title: normalizeText(currentRow?.title ?? queueRow?.title ?? label?.fullName) || currentRow?.title,
      barcode_gtin14:
        toGtin14(currentRow?.barcode_gtin14 ?? queueRow?.barcode_gtin14 ?? dsldMeta?.barcode_normalized_gtin14) ||
        currentRow?.barcode_gtin14,
      productCatalogImage:
        normalizeText(currentRow?.productCatalogImage ?? null) ||
        normalizeText(officialPage?.productCatalogImage ?? null) ||
        normalizeText(renderedImageUrl ?? null) ||
        normalizeText(manualImageUrl ?? null) ||
        normalizeText(generatedImageUrl ?? null) ||
        null,
      link: normalizeText(currentRow?.link ?? null) || normalizeText(officialPage?.pageUrl ?? null) || null,
      productImages: Array.isArray(currentRow?.productImages) ? currentRow.productImages : [],
      descriptionSections: nextSections,
      supplementFacts: shouldPreferLabelSupplementFacts(currentRow?.supplementFacts, labelSupplementFacts)
        ? labelSupplementFacts
        : currentRow?.supplementFacts?.nutritionalFacts?.length > 0
          ? currentRow.supplementFacts
          : labelSupplementFacts,
      sourceSummary: {
        ...(currentRow?.sourceSummary && typeof currentRow.sourceSummary === "object" ? currentRow.sourceSummary : {}),
        sourceKind: officialPage ? "official_page_plus_dsld" : "dsld_label_api",
        sourceTypes: [
          ...new Set(
            [
              ...(Array.isArray(currentRow?.sourceSummary?.sourceTypes) ? currentRow.sourceSummary.sourceTypes : []),
              "dsld_label_facts",
              "dsld_label_api",
              officialPage ? "official_product_page" : null,
              officialPage ? "official_shopify_product_json" : null,
            ].filter(Boolean),
          ),
        ],
        sourceUrls: [
          ...new Set(
            [
              ...(Array.isArray(currentRow?.sourceSummary?.sourceUrls) ? currentRow.sourceSummary.sourceUrls : []),
              officialPage?.pageUrl ?? null,
              normalizeText(dsldMeta?.dsld_pdf ?? null)
                ? `https://api.ods.od.nih.gov/dsld/s3/pdf/${productId}.pdf`
                : null,
            ].filter(Boolean),
          ),
        ],
        sourceNotes: [
          ...new Set(
            [
              ...(Array.isArray(currentRow?.sourceSummary?.sourceNotes) ? currentRow.sourceSummary.sourceNotes : []),
              "closure_path:dsld_label_api",
              suggestedUse ? "filled_suggested_use:dsld_or_official_page" : null,
              warnings ? "filled_warnings:dsld_or_official_page" : null,
              officialPage?.productCatalogImage ? "filled_product_image:official_product_page" : null,
              renderedImageUrl ? "filled_product_image:dsld_pdf_render" : null,
              manualImageUrl ? "filled_product_image:manual_remote_asset" : null,
              generatedImageUrl ? "filled_product_image:generated_image_fallback" : null,
            ].filter(Boolean),
          ),
        ],
      },
    });

    const hydrated = hydrateMergedRow(currentRow, mergedRecord);
    rowByProductId.set(productId, hydrated);
    if (normalizeText(currentRow?.productId ?? null)) {
      rowByProductId.set(normalizeText(currentRow.productId), hydrated);
    }
    if (queueBarcode) {
      rowByBarcode.set(queueBarcode, hydrated);
    }
    if (bootstrapped) bootstrappedRows.push(hydrated);
    audit.push({
      productId,
      title: hydrated.title,
      beforeMissingFields,
      afterMissingFields: hydrated?.completeness?.coreMissingFields ?? [],
      officialPageUrl: officialPage?.pageUrl ?? null,
      renderedImageUrl: renderedImageUrl ?? null,
      manualImageUrl: manualImageUrl ?? null,
      generatedImageUrl: generatedImageUrl ?? null,
      usedDsldPdf: Boolean(dsldMeta?.dsld_pdf),
      bootstrapped,
    });
  }

  const existingProductIds = new Set(products.map((row) => normalizeText(row?.productId)).filter(Boolean));
  const updatedProducts = [
    ...products.map((row) => rowByProductId.get(normalizeText(row?.productId)) ?? row),
    ...bootstrappedRows.filter((row) => !existingProductIds.has(normalizeText(row?.productId))),
  ];
  await writeJson(OUT_JSON, {
    ...payload,
    products: updatedProducts,
    audit,
  });

  const remaining = audit.filter((row) => Array.isArray(row.afterMissingFields) && row.afterMissingFields.length > 0);
  console.log(
    JSON.stringify(
      {
        ok: true,
        brand: BRAND,
        queueCount: queue.length,
        touched: audit.length,
        fullyClosed: audit.length - remaining.length,
        remaining: remaining.length,
        outJson: OUT_JSON,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
