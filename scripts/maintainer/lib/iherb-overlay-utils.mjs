import crypto from "node:crypto";

export const CORE_COMPLETE_FIELDS = [
  "ingredient",
  "dosage",
  "suggested_use",
  "warnings",
  "product_image",
];

export const SECONDARY_COMPLETE_FIELDS = [
  "other_ingredients",
  "serving_size",
  "servings_per_container",
  "description",
  "categories",
  "dosage_form",
];

export const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeLower = (value) => normalizeText(value).toLowerCase();

export const extractVariationText = (value) => {
  if (!value) return null;
  if (typeof value === "string" || typeof value === "number") {
    const text = normalizeText(value);
    return text || null;
  }
  if (Array.isArray(value)) {
    const joined = value.map((item) => extractVariationText(item)).filter(Boolean).join(" ");
    const text = normalizeText(joined);
    return text || null;
  }
  if (typeof value === "object") {
    const candidate = [
      value.variationDescription,
      value.label,
      value.name,
      value.title,
      value.description,
      value.option,
      value.value,
    ]
      .map((item) => extractVariationText(item))
      .find(Boolean);
    return candidate || null;
  }
  return null;
};

const normalizeDosageFormText = (value) => {
  const text = normalizeLower(value);
  if (!text) return null;
  if (text.includes("softgel")) return "softgels";
  if (text.includes("capsule") || text.includes("caps")) return "capsules";
  if (text.includes("tablet") || text.includes("tabs")) return "tablets";
  if (text.includes("powder")) return "powder";
  if (text.includes("liquid")) return "liquid";
  if (text.includes("gummy")) return "gummies";
  if (text.includes("chewable")) return "chewables";
  return normalizeText(value) || null;
};

export const toGtin14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length > 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

export const stableHash = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

const SECTION_CANONICAL_KEYS = {
  description: "Description",
  suggesteduse: "Suggested use",
  suggestedusage: "Suggested use",
  otheringredients: "Other ingredients",
  warnings: "Warnings",
  warning: "Warnings",
  disclaimer: "Disclaimer",
};

const toSectionCanonicalKey = (key) =>
  normalizeLower(key)
    .replace(/[^a-z]/g, "");

export const parseAllDescription = (raw) => {
  const text = String(raw ?? "").replace(/\r/g, "").replace(/\u00a0/g, " ");
  if (!text.trim()) {
    return {
      Description: "",
      "Suggested use": "",
      "Other ingredients": "",
      Warnings: "",
      Disclaimer: "",
    };
  }

  const headings = ["Description", "Suggested use", "Other ingredients", "Warnings", "Disclaimer"];
  const re = /(?:^|\n)\s*(Description|Suggested use|Other ingredients|Warnings|Disclaimer)\s*(?=\n|$)/gi;
  const matches = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    matches.push({ heading: match[1], index: match.index, end: re.lastIndex });
  }

  const out = {
    Description: "",
    "Suggested use": "",
    "Other ingredients": "",
    Warnings: "",
    Disclaimer: "",
  };

  if (matches.length === 0) {
    out.Description = normalizeText(text);
    return out;
  }

  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    const start = current.end;
    const end = next ? next.index : text.length;
    const body = normalizeText(text.slice(start, end));
    if (headings.includes(current.heading)) {
      out[current.heading] = body;
    }
  }

  return out;
};

export const normalizeDescriptionSections = (rawSections, fallbackAllDescription = null) => {
  const base =
    rawSections && typeof rawSections === "object" && !Array.isArray(rawSections)
      ? rawSections
      : fallbackAllDescription
        ? parseAllDescription(fallbackAllDescription)
        : {};
  const sections = {};
  for (const [key, value] of Object.entries(base)) {
    const canonical = SECTION_CANONICAL_KEYS[toSectionCanonicalKey(key)] ?? normalizeText(key);
    const text = normalizeText(value);
    if (!text) continue;
    sections[canonical] = text;
  }
  return sections;
};

export const pickNutritionFacts = (facts) => {
  if (!Array.isArray(facts)) return [];
  return facts
    .map((row) => ({
      substancy: normalizeText(
        row?.substancy ?? row?.substance ?? row?.substance_name ?? row?.name ?? null,
      ),
      amountPerServing: normalizeText(
        row?.amountPerServing ?? row?.amount_per_serving ?? row?.amount ?? null,
      ),
      dailyValuePercent:
        normalizeText(
          row?.dailyValuePercent ?? row?.daily_value_percent ?? row?.dailyValue ?? null,
        ) || null,
    }))
    .filter((row) => row.substancy || row.amountPerServing || row.dailyValuePercent);
};

export const normalizeServing = (rawServing = {}, rawSupplementFacts = {}) => {
  const servingSize =
    normalizeText(rawSupplementFacts?.servingSize ?? rawSupplementFacts?.serving_size ?? null) || null;
  const servingsPerContainerRaw = normalizeText(
    rawSupplementFacts?.servingsPerContainer ?? rawSupplementFacts?.servings_per_container ?? null,
  );
  const servingsPerContainerNumber = Number(servingsPerContainerRaw);
  return {
    servingType: normalizeText(rawServing?.servingType ?? rawServing?.serving_type ?? null) || null,
    servingDescription:
      normalizeText(rawServing?.servingDescription ?? rawServing?.serving_description ?? null) || null,
    servingSize,
    servingsPerContainer:
      Number.isFinite(servingsPerContainerNumber) && servingsPerContainerNumber > 0
        ? servingsPerContainerNumber
        : null,
  };
};

export const collectProductsFromEntry = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.products)) return payload.products;
    if (Array.isArray(payload.items)) return payload.items;
  }
  return [];
};

export const normalizeSourceTypes = (...rawValues) => {
  const out = new Set();
  for (const raw of rawValues) {
    if (Array.isArray(raw)) {
      raw.forEach((item) => {
        const normalized = normalizeLower(item);
        if (normalized) out.add(normalized);
      });
      continue;
    }
    const normalized = normalizeLower(raw);
    if (normalized) out.add(normalized);
  }
  return [...out].sort();
};

const normalizeCategories = (raw) =>
  Array.isArray(raw) ? raw.map((item) => normalizeText(item)).filter(Boolean) : [];

const normalizeImages = (raw) =>
  Array.isArray(raw) ? [...new Set(raw.map((item) => normalizeText(item)).filter(Boolean))] : [];

const inferSourceRank = ({ sourceTypes, countryUsed, languageUsed, marketSources, hasNpn }) => {
  const sourceSet = new Set(sourceTypes);
  const marketSet = new Set(marketSources);
  if (
    sourceSet.has("iherb_us_product_page") ||
    (normalizeLower(countryUsed) === "us" && normalizeLower(languageUsed) === "en_us")
  ) {
    return 100;
  }
  if (
    sourceSet.has("official_product_page") ||
    sourceSet.has("official_product_information_sheet")
  ) {
    return 90;
  }
  if (sourceSet.has("smartq_public_product_page")) return 70;
  if (sourceSet.has("official_sitemap_title")) return 60;
  if (sourceSet.has("atriumpro_public_product_page") || hasNpn || marketSet.has("ca")) return 30;
  return 40;
};

const buildDescriptionSectionsForSeed = (row) =>
  normalizeDescriptionSections(row?.sections ?? null, row?.allDescription ?? null);

const buildDescriptionSectionsForZip = (row) =>
  normalizeDescriptionSections(null, row?.allDescription ?? null);

const buildSupplementFacts = (row) => {
  const facts = row?.supplementFacts ?? row?.supplement_facts ?? {};
  return {
    servingSize: normalizeText(facts?.servingSize ?? facts?.serving_size ?? null) || null,
    servingsPerContainer:
      normalizeText(facts?.servingsPerContainer ?? facts?.servings_per_container ?? null) || null,
    nutritionalFacts: pickNutritionFacts(facts?.nutritionalFacts ?? facts?.nutritional_facts ?? []),
  };
};

const buildBaseRecord = ({
  row,
  sourceKind,
  sourceTypes,
  marketSources,
  sourceUrls,
  sourceNotes,
  countryUsed,
  languageUsed,
  hasNpn,
  descriptionSections,
}) => {
  const supplementFacts = buildSupplementFacts(row);
  const serving = normalizeServing(row?.serving ?? {}, supplementFacts);
  const sourceRank = inferSourceRank({
    sourceTypes,
    countryUsed,
    languageUsed,
    marketSources,
    hasNpn,
  });
  const normalizedTitle = normalizeLower(row?.normalizedTitle ?? row?.title ?? null);
  const count = normalizeText(row?.count ?? row?.packageQuantity ?? row?.netContent ?? null) || null;
  const dosageForm = normalizeDosageFormText(row?.dosageForm ?? extractVariationText(row?.variation) ?? null);
  const barcodeGtin14 =
    toGtin14(row?.barcode_gtin14 ?? row?.upcCode ?? row?.upc_code ?? null) ?? null;
  const hasUsIherbPage =
    sourceTypes.includes("iherb_us_product_page") ||
    (normalizeLower(countryUsed) === "us" && normalizeLower(languageUsed) === "en_us");
  const sourceSummary = {
    sourceKind,
    sourceTypes,
    marketSources,
    sourceUrls: [...new Set(sourceUrls.map((item) => normalizeText(item)).filter(Boolean))].sort(),
    sourceNotes: [...new Set(sourceNotes.map((item) => normalizeText(item)).filter(Boolean))].sort(),
    npnIgnored: Boolean(hasNpn),
    hasUsIherbPage,
    sourceRank,
  };
  return {
    brandName: normalizeText(row?.brandName ?? null) || null,
    title: normalizeText(row?.title ?? null) || null,
    normalizedTitle: normalizedTitle || null,
    productId: normalizeText(row?.productId ?? null) || null,
    upcCode: normalizeText(row?.upcCode ?? row?.upc_code ?? null) || null,
    barcode_gtin14: barcodeGtin14,
    link: normalizeText(row?.link ?? null) || null,
    productCatalogImage: normalizeText(row?.productCatalogImage ?? null) || null,
    productImages: normalizeImages(row?.productImages),
    categories: normalizeCategories(row?.categories),
    count,
    dosageForm,
    serving,
    supplementFacts,
    descriptionSections,
    sourceSummary,
  };
};

export const extractOverlayRecordFromZipRow = (row, meta = {}) => {
  const sourceTypes = normalizeSourceTypes("iherb_us_product_page");
  const marketSources = normalizeSourceTypes(row?.countryUsed ?? "US", meta.marketSource ?? "US");
  return buildBaseRecord({
    row,
    sourceKind: "zip_iherb_us",
    sourceTypes,
    marketSources,
    sourceUrls: [row?.link],
    sourceNotes: [meta.entryName],
    countryUsed: row?.countryUsed ?? "US",
    languageUsed: row?.languageUsed ?? "en_US",
    hasNpn: false,
    descriptionSections: buildDescriptionSectionsForZip(row),
  });
};

export const extractOverlayRecordFromSeedRow = (row, meta = {}) => {
  const sourceTypes = normalizeSourceTypes(row?.sourceTypes);
  const marketSources = normalizeSourceTypes(row?.marketSources);
  return buildBaseRecord({
    row,
    sourceKind: "seed_catalog",
    sourceTypes,
    marketSources,
    sourceUrls: Array.isArray(row?.sourceUrls) ? row.sourceUrls : [row?.link],
    sourceNotes: Array.isArray(row?.sourceNotes) ? row.sourceNotes : [meta.seedName],
    countryUsed:
      sourceTypes.includes("iherb_us_product_page") || marketSources.includes("us") ? "US" : null,
    languageUsed: sourceTypes.includes("iherb_us_product_page") ? "en_US" : null,
    hasNpn: Boolean(normalizeText(row?.npn)),
    descriptionSections: buildDescriptionSectionsForSeed(row),
  });
};

export const buildOverlayRecordKey = (record) => {
  if (record?.barcode_gtin14) return `gtin14:${record.barcode_gtin14}`;
  if (record?.upcCode) return `upc:${toGtin14(record.upcCode) ?? record.upcCode}`;
  if (record?.productId) return `product:${record.productId}`;
  return `title:${normalizeLower(record?.brandName)}|${normalizeLower(record?.normalizedTitle)}|${normalizeLower(
    record?.count,
  )}|${normalizeLower(record?.dosageForm)}`;
};

const pickPreferredScalar = (currentValue, currentRank, incomingValue, incomingRank) => {
  const currentText = typeof currentValue === "string" ? normalizeText(currentValue) : currentValue;
  const incomingText = typeof incomingValue === "string" ? normalizeText(incomingValue) : incomingValue;
  if (incomingText == null || incomingText === "") return currentValue;
  if (currentText == null || currentText === "") return incomingValue;
  return incomingRank > currentRank ? incomingValue : currentValue;
};

const mergeDescriptionSections = (currentSections, currentRank, incomingSections, incomingRank) => {
  const out = { ...(currentSections ?? {}) };
  for (const [key, value] of Object.entries(incomingSections ?? {})) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    if (!out[key] || incomingRank > currentRank) {
      out[key] = normalized;
    }
  }
  return out;
};

const mergeSupplementFacts = (currentFacts, currentRank, incomingFacts, incomingRank) => {
  const current = currentFacts ?? { servingSize: null, servingsPerContainer: null, nutritionalFacts: [] };
  const incoming = incomingFacts ?? { servingSize: null, servingsPerContainer: null, nutritionalFacts: [] };
  const chooseIncoming = incomingRank > currentRank;
  const nutritionalFacts =
    chooseIncoming && Array.isArray(incoming.nutritionalFacts) && incoming.nutritionalFacts.length > 0
      ? incoming.nutritionalFacts
      : Array.isArray(current.nutritionalFacts) && current.nutritionalFacts.length > 0
        ? current.nutritionalFacts
        : Array.isArray(incoming.nutritionalFacts)
          ? incoming.nutritionalFacts
          : [];
  return {
    servingSize: pickPreferredScalar(current.servingSize, currentRank, incoming.servingSize, incomingRank),
    servingsPerContainer:
      current.servingsPerContainer == null || chooseIncoming
        ? incoming.servingsPerContainer ?? current.servingsPerContainer ?? null
        : current.servingsPerContainer,
    nutritionalFacts,
  };
};

const mergeServing = (currentServing, currentRank, incomingServing, incomingRank) => ({
  servingType: pickPreferredScalar(
    currentServing?.servingType ?? null,
    currentRank,
    incomingServing?.servingType ?? null,
    incomingRank,
  ),
  servingDescription: pickPreferredScalar(
    currentServing?.servingDescription ?? null,
    currentRank,
    incomingServing?.servingDescription ?? null,
    incomingRank,
  ),
  servingSize: pickPreferredScalar(
    currentServing?.servingSize ?? null,
    currentRank,
    incomingServing?.servingSize ?? null,
    incomingRank,
  ),
  servingsPerContainer:
    currentServing?.servingsPerContainer == null || incomingRank > currentRank
      ? incomingServing?.servingsPerContainer ?? currentServing?.servingsPerContainer ?? null
      : currentServing?.servingsPerContainer ?? null,
});

export const mergeOverlayRecords = (current, incoming) => {
  if (!current) return incoming;
  const currentRank = Number(current?.sourceSummary?.sourceRank ?? 0);
  const incomingRank = Number(incoming?.sourceSummary?.sourceRank ?? 0);
  const chooseIncoming = incomingRank > currentRank;
  return {
    brandName: pickPreferredScalar(current.brandName, currentRank, incoming.brandName, incomingRank),
    title: pickPreferredScalar(current.title, currentRank, incoming.title, incomingRank),
    normalizedTitle: pickPreferredScalar(
      current.normalizedTitle,
      currentRank,
      incoming.normalizedTitle,
      incomingRank,
    ),
    productId: pickPreferredScalar(current.productId, currentRank, incoming.productId, incomingRank),
    upcCode: pickPreferredScalar(current.upcCode, currentRank, incoming.upcCode, incomingRank),
    barcode_gtin14: pickPreferredScalar(
      current.barcode_gtin14,
      currentRank,
      incoming.barcode_gtin14,
      incomingRank,
    ),
    link: pickPreferredScalar(current.link, currentRank, incoming.link, incomingRank),
    productCatalogImage: pickPreferredScalar(
      current.productCatalogImage,
      currentRank,
      incoming.productCatalogImage,
      incomingRank,
    ),
    productImages: [
      ...new Set(
        (chooseIncoming
          ? [...(incoming.productImages ?? []), ...(current.productImages ?? [])]
          : [...(current.productImages ?? []), ...(incoming.productImages ?? [])]
        ).filter(Boolean),
      ),
    ],
    categories: [...new Set([...(chooseIncoming ? incoming.categories : current.categories), ...(chooseIncoming ? current.categories : incoming.categories)].filter(Boolean))],
    count: pickPreferredScalar(current.count, currentRank, incoming.count, incomingRank),
    dosageForm: pickPreferredScalar(current.dosageForm, currentRank, incoming.dosageForm, incomingRank),
    serving: mergeServing(current.serving, currentRank, incoming.serving, incomingRank),
    supplementFacts: mergeSupplementFacts(
      current.supplementFacts,
      currentRank,
      incoming.supplementFacts,
      incomingRank,
    ),
    descriptionSections: mergeDescriptionSections(
      current.descriptionSections,
      currentRank,
      incoming.descriptionSections,
      incomingRank,
    ),
    sourceSummary: {
      sourceKind: chooseIncoming ? incoming.sourceSummary.sourceKind : current.sourceSummary.sourceKind,
      sourceTypes: [...new Set([...(current.sourceSummary.sourceTypes ?? []), ...(incoming.sourceSummary.sourceTypes ?? [])])].sort(),
      marketSources: [...new Set([...(current.sourceSummary.marketSources ?? []), ...(incoming.sourceSummary.marketSources ?? [])])].sort(),
      sourceUrls: [...new Set([...(current.sourceSummary.sourceUrls ?? []), ...(incoming.sourceSummary.sourceUrls ?? [])])].sort(),
      sourceNotes: [...new Set([...(current.sourceSummary.sourceNotes ?? []), ...(incoming.sourceSummary.sourceNotes ?? [])])].sort(),
      npnIgnored: Boolean(current.sourceSummary.npnIgnored || incoming.sourceSummary.npnIgnored),
      hasUsIherbPage: Boolean(current.sourceSummary.hasUsIherbPage || incoming.sourceSummary.hasUsIherbPage),
      sourceRank: Math.max(currentRank, incomingRank),
    },
  };
};

export const deriveCompleteness = (record) => {
  const sections = record?.descriptionSections ?? {};
  const supplementFacts = record?.supplementFacts ?? {};
  const nutritionalFacts = Array.isArray(supplementFacts?.nutritionalFacts)
    ? supplementFacts.nutritionalFacts
    : [];
  const core = {
    ingredient: nutritionalFacts.length > 0,
    dosage: nutritionalFacts.some((row) => normalizeText(row?.amountPerServing)),
    suggested_use: Boolean(normalizeText(sections["Suggested use"])),
    warnings: Boolean(normalizeText(sections.Warnings)),
    product_image:
      Boolean(normalizeText(record?.productCatalogImage)) ||
      (Array.isArray(record?.productImages) && record.productImages.length > 0),
  };
  const secondary = {
    other_ingredients: Boolean(normalizeText(sections["Other ingredients"])),
    serving_size: Boolean(normalizeText(supplementFacts?.servingSize)),
    servings_per_container:
      Number.isFinite(Number(supplementFacts?.servingsPerContainer)) &&
      Number(supplementFacts?.servingsPerContainer) > 0,
    description: Boolean(normalizeText(sections.Description)),
    categories: Array.isArray(record?.categories) && record.categories.length > 0,
    dosage_form: Boolean(normalizeText(record?.dosageForm)),
  };
  const coreResolvedFields = CORE_COMPLETE_FIELDS.filter((field) => core[field]);
  const secondaryResolvedFields = SECONDARY_COMPLETE_FIELDS.filter((field) => secondary[field]);
  return {
    coreResolvedFields,
    coreMissingFields: CORE_COMPLETE_FIELDS.filter((field) => !core[field]),
    secondaryResolvedFields,
    secondaryMissingFields: SECONDARY_COMPLETE_FIELDS.filter((field) => !secondary[field]),
    completenessScore:
      Math.round(
        ((coreResolvedFields.length + secondaryResolvedFields.length) /
          (CORE_COMPLETE_FIELDS.length + SECONDARY_COMPLETE_FIELDS.length)) *
          100,
      ) || 0,
  };
};

export const classifyOverlayStatus = (record, completeness) => {
  const hasAuthoritativeUsPath = Boolean(record?.sourceSummary?.hasUsIherbPage);
  const hasNonUsOnlySignals =
    Boolean(record?.sourceSummary?.npnIgnored) ||
    (record?.sourceSummary?.sourceTypes ?? []).includes("atriumpro_public_product_page");
  if (!hasAuthoritativeUsPath && hasNonUsOnlySignals) return "conflicted_or_non_us";
  if (hasAuthoritativeUsPath && completeness.coreMissingFields.length === 0) return "full_overlay_ready";
  if (
    hasAuthoritativeUsPath ||
    completeness.coreResolvedFields.length > 0 ||
    Boolean(record?.barcode_gtin14 || record?.upcCode || record?.productId)
  ) {
    return "partial_overlay";
  }
  return "catalog_only";
};

export const qualifiesHighConfidenceUsProductPage = (record, completeness) => {
  const hasUsAuthoritativeOverlay = Boolean(record?.sourceSummary?.hasUsIherbPage);
  if (!hasUsAuthoritativeOverlay) return false;
  if (Boolean(record?.sourceSummary?.npnIgnored)) return false;

  const hasStableIdentity = Boolean(
    normalizeText(record?.barcode_gtin14) &&
      (normalizeText(record?.productId) || normalizeText(record?.link)),
  );
  if (!hasStableIdentity) return false;

  const hasProductImage = completeness.coreResolvedFields.includes("product_image");
  const hasIngredient = completeness.coreResolvedFields.includes("ingredient");
  const hasDosage = completeness.coreResolvedFields.includes("dosage");
  const hasUsageOrWarnings =
    completeness.coreResolvedFields.includes("suggested_use") ||
    completeness.coreResolvedFields.includes("warnings");

  return hasProductImage && hasIngredient && hasDosage && hasUsageOrWarnings;
};

export const buildPatchStrategy = (record, completeness) => {
  const missingFields = completeness.coreMissingFields;
  if (missingFields.length === 0) return null;
  const preferredAction = record?.sourceSummary?.hasUsIherbPage
    ? "official_product_page_fallback"
    : "rapidapi_brand_products";
  return {
    preferredAction,
    missingFields,
    reason:
      preferredAction === "official_product_page_fallback"
        ? "missing_core_fields_from_existing_us_product_page"
        : "missing_us_iherb_overlay_match",
  };
};
