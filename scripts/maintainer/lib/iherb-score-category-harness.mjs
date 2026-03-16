import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

const {
  compileDecisionSupport,
} = await import("../../../backend/src/decisionSupport.ts");
const {
  buildFactsDigestFromWeb,
  computeFactsDigestHash,
} = await import("../../../backend/src/factsDigest.ts");
const {
  normalizeIherbSupplementFactsRows,
} = await import("../../../backend/src/iherbOverlayIngredients.ts");

export const safeText = (value) => String(value ?? "").trim();
export const hasText = (value) => safeText(value).length > 0;
export const pct = (part, total) => (total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0);

export const toObjectRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

export const readJson = async (targetPath) => JSON.parse(await fs.readFile(targetPath, "utf8"));

export const readJsonl = async (targetPath) =>
  (await fs.readFile(targetPath, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

export const writeJson = async (targetPath, payload) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

export const writeJsonl = async (targetPath, rows) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(targetPath, `${body}${rows.length > 0 ? "\n" : ""}`, "utf8");
};

export const readSectionText = (sections, keys) => {
  for (const key of keys) {
    const value = sections[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
};

export const toOverlayClaims = (row) => {
  const descriptionSections = toObjectRecord(row.descriptionSections);
  const supplementFacts = toObjectRecord(row.supplementFacts);
  const nutritionalFactsRaw = Array.isArray(supplementFacts.nutritionalFacts)
    ? supplementFacts.nutritionalFacts
    : [];

  return {
    provider: "iherb",
    productId: hasText(row.productId) ? String(row.productId) : null,
    brandName: hasText(row.brandName) ? String(row.brandName) : null,
    title: hasText(row.title) ? String(row.title) : null,
    link: hasText(row.link) ? String(row.link) : null,
    categories: Array.isArray(row.categories)
      ? row.categories.map((item) => safeText(item)).filter(Boolean)
      : [],
    description: readSectionText(descriptionSections, ["Description"]),
    suggestedUse: readSectionText(descriptionSections, ["Suggested use", "Suggested Use", "Suggested usage"]),
    otherIngredients: readSectionText(descriptionSections, ["Other ingredients", "Other Ingredients"]),
    warnings: readSectionText(descriptionSections, ["Warnings", "Warning"]),
    disclaimer: readSectionText(descriptionSections, ["Disclaimer"]),
    nutritionalFacts: nutritionalFactsRaw
      .map((item) => ({
        substancy: safeText(item?.substancy ?? item?.substance ?? item?.substance_name ?? item?.name),
        amountPerServing: safeText(item?.amountPerServing ?? item?.amount_per_serving ?? item?.amount),
        dailyValuePercent: safeText(item?.dailyValuePercent ?? item?.daily_value_percent ?? item?.dailyValue) || null,
      }))
      .filter((item) => item.substancy || item.amountPerServing || item.dailyValuePercent),
  };
};

const TITLE_INGREDIENT_FALLBACKS = [
  { regex: /\bbeta ecdysterone\b/i, label: "Beta Ecdysterone" },
  { regex: /\bred yeast rice\b/i, label: "Red Yeast Rice" },
  { regex: /\bberberine\b/i, label: "Berberine" },
  { regex: /\btudca\b|\btauroursodeoxycholic\b/i, label: "TUDCA" },
  { regex: /\box bile\b/i, label: "Ox Bile" },
  { regex: /\bomega-?3\b|\bfish oil\b|\btheromega\b/i, label: "Omega-3 Fish Oil" },
  { regex: /citrulline\s*malate/i, label: "Citrulline Malate" },
  { regex: /beta[- ]*alanine/i, label: "Beta-Alanine" },
  { regex: /\bmagnesium glycinate\b/i, label: "Magnesium Glycinate" },
  { regex: /\bmaca root\b/i, label: "Maca Root" },
  { regex: /\bmanuka honey\b/i, label: "Manuka Honey" },
  { regex: /\bturbinado sugar\b|\bsugar cubes?\b/i, label: "Turbinado Sugar" },
  { regex: /\bhawaiian hula rub\b|\brub\b/i, label: "Seasoning Blend" },
];

const inferFallbackIngredientLines = (overlayClaims) => {
  const title = safeText(overlayClaims?.title);
  const description = safeText(overlayClaims?.description);
  const combined = `${title} ${description}`.trim();
  if (!combined) return [];

  const amountMatch = title.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(mg|mcg|g|iu)\b/i);
  const amountText = amountMatch
    ? `${amountMatch[1].replace(/,/g, "")} ${amountMatch[2]}`
    : "";

  for (const candidate of TITLE_INGREDIENT_FALLBACKS) {
    if (!candidate.regex.test(combined)) continue;
    return [`${candidate.label}${amountText ? ` ${amountText}` : ""}`.trim()];
  }

  return [];
};

export const toIngredientsText = (overlayClaims) =>
  {
    const normalizedRows = normalizeIherbSupplementFactsRows(overlayClaims?.nutritionalFacts)
    .map((row) => [safeText(row?.name), safeText(row?.dose)].filter(Boolean).join(" "))
    .filter(Boolean);
    const fallbackRows = normalizedRows.length > 0 ? [] : inferFallbackIngredientLines(overlayClaims);
    return [...normalizedRows, ...fallbackRows].join("\n");
  };

export const toFactsDigest = (row, overlayClaims) => {
  const serving = toObjectRecord(row.serving);
  const supplementFacts = toObjectRecord(row.supplementFacts);
  const digest = buildFactsDigestFromWeb({
    facts: {
      barcode: safeText(row.barcode_gtin14),
      canonical: {
        name: hasText(row.title) ? String(row.title) : null,
        brand: hasText(row.brandName) ? String(row.brandName) : null,
        url: hasText(row.link) ? String(row.link) : null,
        domain: "iherb.com",
      },
      identifiers: { npn: null },
      textFacts: {
        ingredientsText: toIngredientsText(overlayClaims) || null,
        directionsText: overlayClaims?.suggestedUse ?? null,
        warningsText: overlayClaims?.warnings ?? null,
        servingSizeText:
          safeText(supplementFacts.servingSize) ||
          safeText(serving.servingSize) ||
          null,
      },
      coverageScore: 1,
      missingFields: [],
    },
    identityType: "gtin14",
    identityValue: safeText(row.barcode_gtin14),
    regionTags: ["us"],
  });

  digest.product.dosageForm =
    hasText(row.dosageForm) && safeText(row.dosageForm).toLowerCase() !== "n/a"
      ? safeText(row.dosageForm)
      : digest.product.dosageForm;
  digest.product.route = null;
  return digest;
};

const normalizeActiveNames = (digest) =>
  (Array.isArray(digest?.actives) ? digest.actives : [])
    .map((active) => safeText(active?.name).toLowerCase())
    .filter(Boolean);

const PROBIOTIC_CATEGORY_REGEX = /(probiotic|cfu|lactobacillus|bifidobacterium|saccharomyces|florassist|microbiome|gut)/;
const OUT_OF_SCOPE_NON_SUPPLEMENT_CATEGORY_REGEX =
  /(\bstroopwafels?\b|\bbetter stevia\b|\bconfectioners\b.*\bsweetener\b|\bxylimelts?\b|\bturbinado sugar cubes?\b|\bhawaiian hula rub\b|\bmanuka honey\b)/;
const TAXONOMY_BACKLOG_HOLD_CATEGORY_REGEX =
  /(\bflat tummy\b.*\bshakes?\b|\bcuraphen\b|\borganic spearmint\b.*\btea\b|\bchitosan\b)/;
const VITAMIN_D_CATEGORY_REGEX = /(vitamin\s*d\b|\bd3\b|\bd2\b|cholecalciferol|ergocalciferol|calcifediol|calcitriol)/;
const MAGNESIUM_CATEGORY_REGEX = /(\bmagnesium\b|glycinate|citrate|oxide|malate)/;
const METABOLIC_GLUCOSE_SUPPORT_CATEGORY_REGEX =
  /(\bberberine\b|\bwellbetx\b|\bglucose support\b|\bblood sugar\b|\bglycemic\b|\binsulin support\b)/;
const SPORTS_ANABOLIC_SUPPORT_CATEGORY_REGEX =
  /(\bbeta ecdysterone\b|\becdysterone\b|\banabol\b|\banabolic\b)/;
const CHOLESTEROL_LIPID_SUPPORT_CATEGORY_REGEX =
  /(\bred yeast rice\b|\bcholesterol support\b|\blipid support\b)/;
const LIVER_BILE_SUPPORT_CATEGORY_REGEX =
  /(\btudca\b|\btauroursodeoxycholic\b|\box bile\b|\bbile support\b|\bbile flow\b)/;
const CELLULAR_NUCLEOTIDE_SUPPORT_CATEGORY_REGEX =
  /(\bnucleotide\b|\brna\s*\/\s*dna\b|\bdna\s*\/\s*rna\b)/;
const COLLAGEN_CATEGORY_REGEX =
  /(\bcollagen\b|\bcollagen peptides?\b|\bmarine collagen\b|\bbone broth\b|\btype ii collagen\b)/;
const JOINT_BONE_CATEGORY_REGEX =
  /(\bglucosamine\b|\bchondroitin\b|\bmsm\b|\bhyaluronic\b|\bjoint\b|\bmobility\b|\bcartilage\b|\bosteo\b)/;
const SLEEP_STRESS_MOOD_CATEGORY_REGEX =
  /(\b5-htp\b|\b5[- ]hydroxytryptophan\b|\bmelatonin\b|\bgaba\b|\bl-theanine\b|\btheanine\b|\btryptophan\b|\bmood\b|\bsleep\b|\bstress\b|\bcalm\b|\brelax\b|\badrenal\b)/;
const SPORTS_AMINO_CATEGORY_REGEX =
  /(\bamino\b|\bbcaa\b|\beaa\b|\bcreatine\b|\bglutamine\b|\barginine\b|\bcitrulline\b|\bbeta alanine\b|\bcarnitine\b|\bpre[- ]?workout\b|\bpost[- ]?workout\b|\bhydration\b|\belectrolyte\b|\bwhey\b|\bprotein powder\b|\bpump\b)/;
const DIGESTIVE_FIBER_ENZYME_CATEGORY_REGEX =
  /(\bpsyllium\b|\bfiber\b|\bdigestive\b|\benzyme\b|\bcolon\b|\bcleanse\b|\bwhole husk\b)/;
const SUPERFOODS_MUSHROOMS_GREENS_CATEGORY_REGEX =
  /(\bmushroom\b|\bmushrooms\b|\bmycobotanical\b|\bcordyceps\b|\bcordychi\b|\bgreens?\b|\bsuperfood\b|\bspirulina\b|\bchlorella\b|\bwheatgrass\b|\bbarley grass\b|\bbeet root\b|\bmatcha\b)/;
const ANTIOXIDANT_CELLULAR_ENERGY_CATEGORY_REGEX =
  /(\bcoq-?10\b|\bcoenzyme q10\b|\bubiquinol\b|\bubiquinone\b|\balpha lipoic acid\b|\bastaxanthin\b|\blutein\b|\bzeaxanthin\b|\bquercetin\b|\bresveratrol\b|\bfisetin\b|\bpqq\b|\bglutathione\b|\blycopene\b|\bpolicosanol\b|\bcranberry\b|\bpomegranate\b|\bblueberry extract\b)/;
const NOOTROPIC_MEMORY_COGNITION_CATEGORY_REGEX =
  /(\bciticoline\b|\bcdp choline\b|\bcognium\b|\bmemory\b|\bcognitive\b|\bbrain\b|\bfocus\b|\bnootropic\b|\bsharpmind\b|\bsame\b|\bginkgo biloba\b|\bgotu kola\b|\bphosphatidylserine\b|\bnicotinamide riboside\b|\bniagen\b|\bnad\+\b|\bnad plus\b|\bcell regenerator\b)/;
const SPECIALTY_VITAMINS_OTHER_CATEGORY_REGEX =
  /(\bvitamin b-?12\b|\bcobalamin\b|\bvitamin b-?3\b|\bniacin\b|\bniacinamide\b|\bvitamin a\b|\bbenfotiamine\b|\bvitamin e\b)/;
const SPECIALTY_SINGLE_AMINO_AND_NEURO_CATEGORY_REGEX =
  /(\bl-lysine\b|\blysine\b|\btaurine\b|\bl-tyrosine\b|\btyrosine\b|\bn-acetyl l-tyrosine\b|\bn-acetyl cysteine\b|\bnac\b)/;
const FATTY_ACIDS_SPECIALTY_LIPIDS_CATEGORY_REGEX =
  /(\bmct oil\b|\bmedium chain triglycerides?\b|\bcoconut oil\b|\bevening primrose\b|\blecithin\b|\bphospholipid complex\b|\bliposomal phospholipid\b)/;
const WOMENS_HORMONAL_AND_LACTATION_CATEGORY_REGEX =
  /(\bmeta-balance\b|\bblack cohosh\b|\bmenopause\b|\bperimenopaus\w*\b|\bpms\b|\bchaste tree\b|\bwild yam\b|\blactation\b|\bbreastfeeding\b|\bmore milk\b)/;
const MENS_PROSTATE_AND_HORMONAL_CATEGORY_REGEX =
  /(\bsaw palmetto\b|\bdhea\b|\bdehydroepiandrosterone\b)/;
const DIGESTIVE_AND_GASTRO_FUNCTIONAL_CATEGORY_REGEX =
  /(\bpapaya\b|\bpapain\b|\bconstipation\b|\bbowel movement\b|\bkeep it movin\b|\bmove things along\b)/;
const BOTANICAL_HERBAL_CATEGORY_REGEX =
  /(\bturmeric\b|\bcurcumin\b|\bashwagandha\b|\bvalerian\b|\byellow dock\b|\bblack seed\b|\bmilk thistle\b|\bechinacea\b|\belderberry\b|\bginseng\b|\brhodiola\b|\bmaca\b|\bgarlic\b|\bboswellia\b|\bdevil'?s claw\b|\bgrape seed\b|\bastragalus\b|\bwormwood\b|\bfenugreek\b|\bolive leaf\b|\bshilajit\b|\bbutterbur\b|\bsaffron\b|\bcoleus forskoh?lii\b|\bgrapefruit seed extract\b|\bchanca piedra\b|\bginger\b|\blicorice\b|\bcinnamon\b|\bherb\b|\bbotanical\b)/;
const VITAMIN_MINERAL_OTHER_CATEGORY_REGEX =
  /(\bvitamin c\b|\bcomplex c\b|\bpaba\b|\bbiotin\b|\bselenium\b|\bchromium\b|\bboron\b|\bpotassium\b|\bcalcium\b|\biron\b|\bzinc\b|\bcopper\b|\bmanganese\b|\bmolybdenum\b|\biodine\b)/;

export const detectHarnessCategoryId = (digest) => {
  const productText = `${safeText(digest?.product?.name).toLowerCase()} ${safeText(digest?.product?.brandDisplay).toLowerCase()}`;
  const activeNames = normalizeActiveNames(digest);
  const combined = `${productText} ${activeNames.join(" ")}`;

  if (/(fish\s*oil|omega\s*-?\s*3|epa|dha|theromega)/.test(combined)) return "fish_oil_omega3";
  if (OUT_OF_SCOPE_NON_SUPPLEMENT_CATEGORY_REGEX.test(combined)) return "out_of_scope_non_supplement";
  if (TAXONOMY_BACKLOG_HOLD_CATEGORY_REGEX.test(combined)) return "taxonomy_backlog_hold";

  const probioticInProductName = PROBIOTIC_CATEGORY_REGEX.test(productText);
  const probioticInActives = activeNames.some((name) => PROBIOTIC_CATEGORY_REGEX.test(name));
  const vitaminDInProductName = VITAMIN_D_CATEGORY_REGEX.test(productText);
  const vitaminDInActives = activeNames.some((name) => VITAMIN_D_CATEGORY_REGEX.test(name));

  if (probioticInProductName || probioticInActives) {
    if (!vitaminDInProductName && vitaminDInActives && !probioticInActives) {
      return "vitamin_d";
    }
    return "probiotics";
  }

  if (vitaminDInProductName || vitaminDInActives) return "vitamin_d";
  if (MAGNESIUM_CATEGORY_REGEX.test(combined)) return "magnesium";
  if (METABOLIC_GLUCOSE_SUPPORT_CATEGORY_REGEX.test(combined)) return "metabolic_glucose_support";
  if (SPORTS_ANABOLIC_SUPPORT_CATEGORY_REGEX.test(combined)) return "sports_anabolic_support";
  if (CHOLESTEROL_LIPID_SUPPORT_CATEGORY_REGEX.test(combined)) return "cholesterol_lipid_support";
  if (LIVER_BILE_SUPPORT_CATEGORY_REGEX.test(combined)) return "liver_bile_support";
  if (CELLULAR_NUCLEOTIDE_SUPPORT_CATEGORY_REGEX.test(combined)) return "cellular_nucleotide_support";
  if (ANTIOXIDANT_CELLULAR_ENERGY_CATEGORY_REGEX.test(combined)) return "antioxidant_cellular_energy";
  if (NOOTROPIC_MEMORY_COGNITION_CATEGORY_REGEX.test(combined)) return "nootropic_memory_cognition";
  if (SPECIALTY_VITAMINS_OTHER_CATEGORY_REGEX.test(combined)) return "specialty_vitamins_other";
  if (SPECIALTY_SINGLE_AMINO_AND_NEURO_CATEGORY_REGEX.test(combined)) return "specialty_single_amino_and_neuro";
  if (FATTY_ACIDS_SPECIALTY_LIPIDS_CATEGORY_REGEX.test(combined)) return "fatty_acids_specialty_lipids";
  if (WOMENS_HORMONAL_AND_LACTATION_CATEGORY_REGEX.test(combined)) return "womens_hormonal_and_lactation";
  if (MENS_PROSTATE_AND_HORMONAL_CATEGORY_REGEX.test(combined)) return "mens_prostate_and_hormonal";
  if (DIGESTIVE_AND_GASTRO_FUNCTIONAL_CATEGORY_REGEX.test(combined)) return "digestive_and_gastro_functional";
  if (COLLAGEN_CATEGORY_REGEX.test(combined)) return "collagen_connective_support";
  if (SLEEP_STRESS_MOOD_CATEGORY_REGEX.test(combined)) return "sleep_stress_mood_support";
  if (SPORTS_AMINO_CATEGORY_REGEX.test(combined)) return "sports_performance_amino_acids";
  if (DIGESTIVE_FIBER_ENZYME_CATEGORY_REGEX.test(combined)) return "digestive_fiber_enzymes";
  if (SUPERFOODS_MUSHROOMS_GREENS_CATEGORY_REGEX.test(combined)) return "superfoods_mushrooms_greens";
  if (JOINT_BONE_CATEGORY_REGEX.test(combined)) return "joint_bone_mobility";
  if (BOTANICAL_HERBAL_CATEGORY_REGEX.test(combined)) return "botanical_herbal_support";
  if (VITAMIN_MINERAL_OTHER_CATEGORY_REGEX.test(combined)) return "vitamin_mineral_other";
  return "unknown";
};

export const isScoreV2Ready = (payload) => {
  const v2 = payload?.nutriScoreCardV2;
  const modules = Array.isArray(v2?.modules) ? v2.modules : [];
  return Number.isFinite(Number(v2?.overallScore))
    && hasText(v2?.overallBand)
    && Number.isFinite(Number(v2?.confidencePct))
    && modules.length === 6
    && modules.every((module) =>
      hasText(module?.id)
      && hasText(module?.title)
      && Number.isFinite(Number(module?.score))
      && hasText(module?.band)
      && Array.isArray(module?.checklist)
      && module.checklist.length > 0);
};

export const isDeepContentReady = (payload) => {
  const overview = payload?.overviewBlock;
  const science = payload?.scienceBlock;
  const usage = payload?.usageBlock;
  const safety = payload?.safetyBlock;

  const overviewOk =
    Array.isArray(overview?.bestForBullets) && overview.bestForBullets.length > 0
    && Array.isArray(overview?.providesVerified?.keyIngredients) && overview.providesVerified.keyIngredients.length > 0;
  const scienceOk =
    Array.isArray(science?.ingredientRows) && science.ingredientRows.length > 0
    && Array.isArray(science?.aiSummaryContract3) && science.aiSummaryContract3.length === 3;
  const usageOk =
    hasText(usage?.directions?.text)
    && Array.isArray(usage?.directions?.lines) && usage.directions.lines.length > 0;
  const safetyOk =
    (Array.isArray(safety?.labelWarnings) && safety.labelWarnings.length > 0)
    || (Array.isArray(safety?.generalWatchouts) && safety.generalWatchouts.length > 0)
    || (Array.isArray(safety?.ulGuidance) && safety.ulGuidance.length > 0);

  return overviewOk && scienceOk && usageOk && safetyOk;
};

export const buildRowAnalysis = (row) => {
  const overlayClaims = toOverlayClaims(row);
  const digest = toFactsDigest(row, overlayClaims);
  const factsDigestHash = computeFactsDigestHash(digest);
  const payload = compileDecisionSupport({
    digest,
    factsDigestHash,
    viewMode: "details",
    locale: "en",
    flagsSnapshot: null,
    patchActivation: null,
    overlayClaims,
  });

  return {
    overlayClaims,
    digest,
    factsDigestHash,
    payload,
    categoryId: safeText(payload?.categoryId) || detectHarnessCategoryId(digest),
    sourceType: safeText(payload?.decisionDebug?.sourceType) || safeText(digest?.sourceType) || "unknown",
    scoreV2Ready: isScoreV2Ready(payload),
    deepContentReady: isDeepContentReady(payload),
  };
};

export const normalizeBarcode = (value) => {
  const digits = safeText(value).replace(/\D/g, "");
  if (!digits) return "";
  return digits.length >= 14 ? digits.slice(-14) : digits.padStart(14, "0");
};

export const buildImportedRows = async ({ stagingPath, mergeReportPath }) => {
  const [stagingPayload, mergePayload] = await Promise.all([readJson(stagingPath), readJson(mergeReportPath)]);
  const products = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];
  const mergeRows = Array.isArray(mergePayload?.rows) ? mergePayload.rows : [];
  const matchedIds = new Set(
    mergeRows
      .filter((row) => row?.mergeDecision === "matched" || row?.mergeDecision === "merged")
      .map((row) => safeText(row?.productId))
      .filter(Boolean),
  );
  return products.filter((row) => matchedIds.has(safeText(row?.productId)));
};

export const buildHighFrequencyLookup = async (sourcePath) => {
  const rows = await readJsonl(sourcePath);
  const barcodeSet = new Set();
  const scoreByBarcode = new Map();
  for (const row of rows) {
    const barcode = normalizeBarcode(row?.barcode_gtin14);
    if (!barcode) continue;
    barcodeSet.add(barcode);
    const current = scoreByBarcode.get(barcode) ?? 0;
    const next = Number(row?.patchPriorityScore ?? 0);
    if (next > current) scoreByBarcode.set(barcode, next);
  }
  return { barcodeSet, scoreByBarcode };
};

export const createSeededRng = (seedText) => {
  let seed = 0;
  for (let idx = 0; idx < seedText.length; idx += 1) {
    seed = (seed * 31 + seedText.charCodeAt(idx)) >>> 0;
  }
  return () => {
    seed += 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const shuffleDeterministic = (rows, rng) => {
  const out = [...rows];
  for (let idx = out.length - 1; idx > 0; idx -= 1) {
    const j = Math.floor(rng() * (idx + 1));
    [out[idx], out[j]] = [out[j], out[idx]];
  }
  return out;
};

export const summarizeModuleScores = (payload) =>
  (Array.isArray(payload?.nutriScoreCardV2?.modules) ? payload.nutriScoreCardV2.modules : []).map((module) => ({
    id: safeText(module?.id),
    title: safeText(module?.title),
    score: Number(module?.score ?? 0),
    band: safeText(module?.band),
    checklistCount: Array.isArray(module?.checklist) ? module.checklist.length : 0,
  }));

export const summarizeTopBlockers = (payload) =>
  (Array.isArray(payload?.topBlockers) ? payload.topBlockers : []).map((item) => ({
    code: safeText(item?.code),
    title: safeText(item?.title),
    severity: safeText(item?.severity),
  }));

export const buildSampleKey = (row) =>
  safeText(row?.productId) || normalizeBarcode(row?.barcode_gtin14) || `${safeText(row?.brandName)}::${safeText(row?.title)}`;

export const toRelative = (targetPath) => path.relative(ROOT, targetPath);
