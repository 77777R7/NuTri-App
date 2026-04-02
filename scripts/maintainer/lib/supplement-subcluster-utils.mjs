import { normalizeLower, normalizeText } from "./iherb-overlay-utils.mjs";

export const SOFT_FIELD_NAMES = ["suggested_use", "warnings", "product_image"];
export const CORE_FIELD_NAMES = ["ingredient", "dosage", "suggested_use", "warnings", "product_image"];

export const toArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

export const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const getRowCorpus = ({ brandName = null, title = null, categories = [], dosageForm = null }) =>
  [
    normalizeText(brandName),
    normalizeText(title),
    normalizeText(dosageForm),
    ...toArray(categories).map((item) => normalizeText(item)),
  ]
    .filter(Boolean)
    .join(" | ");

const CLUSTER_RULES = [
  {
    clusterKind: "utility_non_supplement",
    clusterLabel: "brand-level non-supplement line",
    confidence: "high",
    patterns: [
      /\bblack radiance\b/i,
      /\bl'oréal\b/i,
      /\bwet n wild\b/i,
      /\brimmel london\b/i,
      /\bpalladio\b/i,
      /\bcovergirl\b/i,
      /\bmaybelline\b/i,
      /\bthebalm cosmetics\b/i,
      /\balmay\b/i,
      /\baura cacia\b/i,
      /\bfrontier co-op\b/i,
      /\bstonewall kitchen\b/i,
      /\btwinings\b/i,
      /\bcelestial seasonings\b/i,
      /\bnature'?s path\b/i,
      /\bwalden farms\b/i,
      /\bchoczero\b/i,
      /\bsimply organic\b/i,
      /\bgrab green\b/i,
      /\bezy dose\b/i,
      /\bpatchaid\b/i,
      /\bthe friendly patch\b/i,
      /\bthe good patch\b/i,
      /\bpreggie\b/i,
      /\bmolly'?s suds\b/i,
      /\breal techniques\b/i,
      /\bdurex\b/i,
      /\bcrest\b/i,
      /\boral-b\b/i,
      /\bfirst response\b/i,
      /\bconceive plus\b/i,
      /\beasy@home\b/i,
      /\blip smacker\b/i,
      /\borgain\b/i,
      /\bwaterboy\b/i,
      /\bcelsius\b/i,
      /\bprime hydration\b/i,
      /\bg fuel\b/i,
    ],
  },
  {
    clusterKind: "pet_nonhuman",
    clusterLabel: "pet line",
    confidence: "high",
    patterns: [/\bpets?\b/i, /\bdog\b/i, /\bcat\b/i, /\bfor dogs?\b/i, /\bfor cats?\b/i, /\bcanine\b/i, /\bfeline\b/i],
  },
  {
    clusterKind: "baby_formula",
    clusterLabel: "baby/formula line",
    confidence: "high",
    patterns: [/\bbaby\b/i, /\binfant\b/i, /\bformula\b/i, /\bdiaper\b/i, /\bpostpartum\b/i],
  },
  {
    clusterKind: "otc_homeopathy",
    clusterLabel: "otc/homeopathy line",
    confidence: "high",
    patterns: [
      /\bhomeopathic?\b/i,
      /\ballergy\b/i,
      /\bsinus\b/i,
      /\bcough\b/i,
      /\bcold\b/i,
      /\bpain relief\b/i,
      /\bsleep aid\b/i,
      /\bflu\b/i,
      /\bdramamine\b/i,
      /\balka-seltzer\b/i,
      /\bzicam\b/i,
      /\bhyland'?s\b/i,
      /\bboiron\b/i,
    ],
  },
  {
    clusterKind: "utility_non_supplement",
    clusterLabel: "empty capsules/accessory line",
    confidence: "high",
    patterns: [
      /\bempty capsules?\b/i,
      /\bgelatin caps?\b/i,
      /\bveggie caps?\b/i,
      /\bcapsule machine\b/i,
      /\bpatch\b/i,
      /\btoothpaste\b/i,
      /\bmouthwash\b/i,
      /\bdenture\b/i,
      /\boral care\b/i,
      /\bcontact lens\b/i,
      /\blubricant\b/i,
      /\bcondom\b/i,
      /\bpregnancy test\b/i,
      /\bovulation test\b/i,
      /\btest strips?\b/i,
    ],
  },
  {
    clusterKind: "topical_beauty",
    clusterLabel: "topical/beauty line",
    confidence: "high",
    patterns: [
      /\bbeauty\b/i,
      /\bfacial\b/i,
      /\bscrub\b/i,
      /\bserum\b/i,
      /\blotion\b/i,
      /\bcream\b/i,
      /\bmoisturizer\b/i,
      /\bshampoo\b/i,
      /\bconditioner\b/i,
      /\bcleanser\b/i,
      /\bmask\b/i,
      /\bsunscreen\b/i,
      /\blip balm\b/i,
      /\blipstick\b/i,
      /\bmascara\b/i,
      /\beyeliner\b/i,
      /\bconcealer\b/i,
      /\bfoundation\b/i,
      /\bblush\b/i,
      /\bbrow\b/i,
      /\bcosmetic\b/i,
      /\bmakeup\b/i,
      /\bessential oil\b/i,
      /\baromatherapy\b/i,
      /\bbody care\b/i,
      /\bhair care\b/i,
      /\bskin care\b/i,
      /\bmassage oil\b/i,
      /\btopical\b/i,
      /\bbalm\b/i,
      /\bointment\b/i,
      /\bdiaper butter\b/i,
      /\bmist\b/i,
      /\bpaste\b/i,
      /\bbutter\b/i,
    ],
  },
  {
    clusterKind: "food_pantry",
    clusterLabel: "food/pantry line",
    confidence: "high",
    patterns: [
      /\breal food\b/i,
      /\btea\b/i,
      /\bcoffee\b/i,
      /\bfood\b/i,
      /\bsnacks?\b/i,
      /\bcondiments?\b/i,
      /\bsauce\b/i,
      /\bmarinade\b/i,
      /\bchutney\b/i,
      /\bjelly\b/i,
      /\bjam\b/i,
      /\bpesto\b/i,
      /\balmonds?\b/i,
      /\bnuts?\b/i,
      /\bseeds?\b/i,
      /\bcoconut sugar\b/i,
      /\bxylitol\b/i,
      /\bcacao\b/i,
      /\bflax\b/i,
      /\bhemp\b/i,
      /\bbroth\b/i,
      /\bjerky\b/i,
      /\bhoney\b/i,
      /\bpopcorn\b/i,
      /\bcrackers?\b/i,
      /\bchips?\b/i,
      /\bsweetener\b/i,
      /\bjulian bakery\b/i,
      /\bstonewall kitchen\b/i,
      /\bfrontier co-op\b/i,
      /\borganic traditions\b/i,
      /\bchoczero\b/i,
      /\bwalden farms\b/i,
      /\bnature'?s path\b/i,
      /\bpb2 foods\b/i,
      /\byumearth\b/i,
      /\bchicken of the sea\b/i,
    ],
  },
  {
    clusterKind: "hydration_performance",
    clusterLabel: "hydration/performance line",
    confidence: "high",
    patterns: [
      /\bhydrat(?:e|ion)\b/i,
      /\belectrolyte\b/i,
      /\bdrink mix\b/i,
      /\bsports drink\b/i,
      /\benergy drink\b/i,
      /\bketone\b/i,
      /\bprime hydration\b/i,
      /\bg fuel\b/i,
      /\bcelsius\b/i,
      /\bwaterboy\b/i,
    ],
  },
];

const SUPPLEMENT_CORE_PATTERNS = [
  /\bcapsule(?:s)?\b/i,
  /\btablet(?:s)?\b/i,
  /\bsoftgel(?:s)?\b/i,
  /\bgumm(?:y|ies)\b/i,
  /\bchewable\b/i,
  /\bdrops?\b/i,
  /\bspray\b/i,
  /\bpacket(?:s)?\b/i,
  /\bpowder(?:s)?\b/i,
  /\bextract\b/i,
  /\btincture\b/i,
  /\bprobiotic\b/i,
  /\bmultivitamin\b/i,
  /\bomega\b/i,
  /\bfish oil\b/i,
  /\bmagnesium\b/i,
  /\bmelatonin\b/i,
  /\bcreatine\b/i,
  /\bamino\b/i,
  /\bashwagandha\b/i,
  /\bberberine\b/i,
  /\bquercetin\b/i,
  /\bcurcumin\b/i,
  /\bnac\b/i,
  /\bcoq10\b/i,
  /\blutein\b/i,
  /\belderberry\b/i,
  /\bechinacea\b/i,
  /\bgarlic\b/i,
  /\benzyme\b/i,
  /\bdigestive\b/i,
  /\bgut health\b/i,
  /\bimmune\b/i,
  /\bsleep\b/i,
  /\bbrain\b/i,
  /\bjoint\b/i,
  /\bbladder\b/i,
  /\bblood sugar\b/i,
  /\bliver\b/i,
  /\bdetox\b/i,
  /\bcleanse\b/i,
  /\badaptogen\b/i,
  /\bherb\b/i,
  /\bherbal\b/i,
];

const DOSAGE_SIGNAL_PATTERNS = [/\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|g|iu|cfu|billion|million)\b/i];

const SUPPLEMENT_CATEGORY_PATTERNS = [
  /\bsupplements?\b/i,
  /\bantioxidants?\b/i,
  /\bvitamins?\b/i,
  /\bminerals?\b/i,
  /\badaptogens?\b/i,
  /\bomegas?\b/i,
  /\bfish oils?\b/i,
  /\bprobiotics?\b/i,
  /\bdigestive\b/i,
  /\bimmune\b/i,
  /\bsleep\b/i,
  /\bjoint\b/i,
  /\bbrain\b/i,
  /\bbladder\b/i,
  /\bwomen'?s health\b/i,
];

const SUPPLEMENT_BORDERLINE_PATTERNS = [
  /\bwellness\b/i,
  /\bhealth\b/i,
  /\bblend\b/i,
  /\bformula\b/i,
  /\bliposomal\b/i,
  /\bliquid\b/i,
  /\bpowder\b/i,
  /\bshots?\b/i,
  /\bsticks?\b/i,
  /\bimmune support\b/i,
];

const SUBLABEL_PATTERNS = [
  { label: "probiotic/digestive", patterns: [/\bprobiotic\b/i, /\bdigestive\b/i, /\bgut\b/i, /\benzyme\b/i] },
  { label: "omega/oil", patterns: [/\bomega\b/i, /\bfish oil\b/i, /\bkrill\b/i, /\bcod liver oil\b/i] },
  { label: "vitamin/mineral", patterns: [/\bvitamin\b/i, /\bmineral\b/i, /\bmagnesium\b/i, /\bzinc\b/i, /\bcalcium\b/i] },
  { label: "herbal extract/tincture", patterns: [/\bextract\b/i, /\btincture\b/i, /\bherb\b/i, /\bherbal\b/i, /\bashwagandha\b/i] },
  { label: "powder supplement", patterns: [/\bpowder\b/i, /\bcreatine\b/i, /\bcollagen\b/i] },
];

const pickSublabel = (corpus) => {
  for (const entry of SUBLABEL_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(corpus))) return entry.label;
  }
  return "general supplement";
};

export const classifySupplementSubcluster = ({ brandName = null, title = null, categories = [], dosageForm = null }) => {
  const normalizedBrand = normalizeText(brandName);
  const corpus = getRowCorpus({ brandName, title, categories, dosageForm });

  for (const rule of CLUSTER_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(corpus))) {
      return {
        clusterKind: rule.clusterKind,
        clusterLabel: `${normalizedBrand || "Unknown"} :: ${rule.clusterLabel}`,
        supplementOnly: false,
        confidence: rule.confidence,
        reason: rule.clusterLabel,
      };
    }
  }

  const hasCoreSignal = SUPPLEMENT_CORE_PATTERNS.some((pattern) => pattern.test(corpus));
  const hasDosageSignal = DOSAGE_SIGNAL_PATTERNS.some((pattern) => pattern.test(corpus));
  const hasCategorySignal = SUPPLEMENT_CATEGORY_PATTERNS.some((pattern) => pattern.test(corpus));

  if ((hasCoreSignal && (hasDosageSignal || hasCategorySignal)) || (hasDosageSignal && hasCategorySignal)) {
    const sublabel = pickSublabel(corpus);
    return {
      clusterKind: "supplement_core",
      clusterLabel: `${normalizedBrand || "Unknown"} :: ${sublabel}`,
      supplementOnly: true,
      confidence: "high",
      reason: sublabel,
    };
  }

  if (SUPPLEMENT_BORDERLINE_PATTERNS.some((pattern) => pattern.test(corpus))) {
    return {
      clusterKind: "supplement_borderline",
      clusterLabel: `${normalizedBrand || "Unknown"} :: borderline supplement`,
      supplementOnly: true,
      confidence: "medium",
      reason: "borderline supplement signals",
    };
  }

  return {
    clusterKind: "unknown_mixed",
    clusterLabel: `${normalizedBrand || "Unknown"} :: unknown mixed`,
    supplementOnly: false,
    confidence: "low",
    reason: "no strong supplement-only signals",
  };
};

export const countUsefulNutritionFacts = (supplementFacts = null) => {
  const rows = Array.isArray(supplementFacts?.nutritionalFacts) ? supplementFacts.nutritionalFacts : [];
  return rows.filter((row) => {
    const substancy = normalizeText(row?.substancy ?? row?.substance ?? row?.name);
    const amount = normalizeText(row?.amountPerServing ?? row?.amount ?? row?.value);
    if (!substancy || !amount) return false;
    if (/^amount per serving$/i.test(amount)) return false;
    if (/^amount per serving$/i.test(substancy)) return false;
    return true;
  }).length;
};

export const hasTitleDosageSignal = (title) =>
  /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|g|iu|cfu|billion|million|ml|fl oz)\b/i.test(normalizeText(title));

export const buildQueueRowFromStagingMerge = (stagingRow, mergeRow, policyReason = "refill_miner_v4") => {
  const sourceTypes = Array.isArray(stagingRow?.sourceSummary?.sourceTypes) ? stagingRow.sourceSummary.sourceTypes : [];
  const knownProductUrls = [
    ...(Array.isArray(stagingRow?.sourceSummary?.sourceUrls) ? stagingRow.sourceSummary.sourceUrls : []),
    stagingRow?.link,
  ].filter((value) => /^https?:\/\//i.test(String(value ?? "")));

  return {
    priorityLane: "P0_refill_miner_v4",
    recommendedAction: "official_fill_core_fields",
    rationale: "Queued partial row mined from supplement-only subcluster classifier and facts recovery audit.",
    brandName: stagingRow?.brandName ?? mergeRow?.brandName ?? null,
    title: stagingRow?.title ?? mergeRow?.title ?? null,
    productId: stagingRow?.productId ?? mergeRow?.productId ?? null,
    barcode_gtin14: stagingRow?.barcode_gtin14 ?? stagingRow?.barcode ?? mergeRow?.barcodeGtin14 ?? null,
    hasUsIherbPage:
      Boolean(stagingRow?.sourceSummary?.hasUsIherbPage) ||
      sourceTypes.includes("iherb_us_product_page") ||
      /^https?:\/\/([a-z0-9-]+\.)?(?:ca\.)?iherb\.com\/pr\//i.test(String(stagingRow?.link ?? "")),
    highConfidenceUsProductPageReady:
      Boolean(mergeRow?.highConfidenceUsProductPageReady) || Boolean(stagingRow?.readiness?.highConfidenceUsProductPageReady),
    coreResolvedFields: mergeRow?.overlayResolvedFields ?? [],
    coreMissingFields: mergeRow?.stillMissingFields ?? [],
    sourceTypes,
    categories: stagingRow?.categories ?? [],
    dosageForm: stagingRow?.dosageForm ?? null,
    knownProductUrls: [...new Set(knownProductUrls)],
    recommendedMode: "reader_then_scrapling",
    policyReasons: [policyReason],
  };
};
