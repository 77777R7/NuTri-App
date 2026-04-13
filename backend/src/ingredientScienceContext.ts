import type { FactsDigest } from "./factsDigest.js";
import { selectScienceIngredientRows, type ScienceIngredientRow } from "./iherbOverlayIngredients.js";

type OverlayNutritionalFactRow = {
  substancy?: string | null;
  amountPerServing?: string | null;
  dailyValuePercent?: string | null;
};

type OverlayClaimsLike = {
  nutritionalFacts?: OverlayNutritionalFactRow[] | null;
} | null | undefined;

export type IngredientScienceSourceType = "dsld" | "iherb_overlay" | "other";
export type IngredientScienceFormulaMode = "single_ingredient" | "multi_ingredient" | "blend";
export type IngredientScienceIngredientFamily =
  | "astaxanthin_carotenoid"
  | "curcumin"
  | "ashwagandha"
  | "ginseng"
  | "green_tea_extract"
  | "5htp"
  | "b3_niacinamide"
  | "glycine"
  | "taurine"
  | "inositol"
  | "vitamin_c"
  | "vitamin_d"
  | "b12"
  | "folate"
  | "b6"
  | "zinc"
  | "magnesium"
  | "calcium"
  | "iron"
  | "melatonin"
  | "omega_3"
  | "probiotic_or_blend"
  | "generic";

export type IngredientScienceLineRole =
  | "primary_active"
  | "source_line"
  | "aggregate_line"
  | "breakdown_line"
  | "blend_line"
  | "companion_nutrient"
  | "generic_line";

export type IngredientScienceRelationshipCandidate = {
  type: "shared_purpose_pairing" | "complementary_role" | "cofactor_helper" | "formula_composition";
  ingredients: string[];
  safeStatement: string;
};

export type IngredientScienceDescriptor = {
  key: string;
  name: string;
  dose: string | null;
  ingredientFamily: IngredientScienceIngredientFamily;
  lineRole: IngredientScienceLineRole;
  categoryHint: string | null;
  sourceContext: string | null;
  formContext: string | null;
  isBlendLike: boolean;
};

export type IngredientScienceContext = {
  productName: string;
  ingredientSourceTier: "overlay_iherb" | "official_record";
  sourceType: IngredientScienceSourceType;
  ingredientRows: ScienceIngredientRow[];
  ingredientSnapshotNames: string[];
  ingredientDescriptors: IngredientScienceDescriptor[];
  formulaMode: IngredientScienceFormulaMode;
  ingredientFamily: IngredientScienceIngredientFamily;
  anchorIngredient: {
    name: string;
    dose: string | null;
    categoryHint: string | null;
    sourceContext: string | null;
  } | null;
  coIngredients: Array<{
    name: string;
    dose: string | null;
    categoryHint: string | null;
  }>;
  relationshipCandidates: IngredientScienceRelationshipCandidate[];
  labelConstraints: {
    hasOpaqueBlend: boolean;
    ingredientDisclosureLimited: boolean;
  };
};

const HARD_BLEND_LIKE_PATTERN = /\b(proprietary|blend|matrix|formula)\b/i;
const SOFT_BLEND_LIKE_PATTERN = /\bcomplex\b/i;
const OMEGA3_TOTAL_PATTERN = /\btotal\b.*\bomega\s*-?\s*3\b|\bomega\s*-?\s*3\b.*\btotal\b/i;
const OMEGA3_SOURCE_PATTERN = /\bfish\s*oil\b|\bkrill\s*oil\b|\balgal\s*oil\b|\boil\s*concentrate\b/i;
const OMEGA3_BREAKDOWN_PATTERN = /\bepa\b|\bdha\b|eicosapentaenoic|docosahexaenoic/i;
const VITAMIN_D_PATTERN = /\bvitamin\s*d(?:2|3)?\b|\bcholecalciferol\b|\bergocalciferol\b/i;
const B12_PATTERN = /\bvitamin\s*b12\b|\bb12\b|\bmethylcobalamin\b|\bcyanocobalamin\b|\badenosylcobalamin\b|\bhydroxocobalamin\b/i;
const FOLATE_PATTERN = /\bfolate\b|\bfolic\s+acid\b|\bmethylfolate\b|\b5[\s-]*mthf\b/i;
const B6_PATTERN = /\bvitamin\s*b6\b|\bb6\b|\bpyridoxine\b|\bpyridoxal(?:\s|-)?5(?:\s|-)?phosphate\b|\bp-?5-?p\b/i;
const HTP5_PATTERN = /\b5[\s-]*htp\b|\b5[\s-]*hydroxytryptophan\b|\bgriffonia\b/i;
const B3_PATTERN = /\bvitamin\s*b3\b|\bb3\b|\bniacinamide\b|\bniacin\b|\bnicotinamide\b/i;
const GLYCINE_PATTERN = /\bglycine\b/i;
const TAURINE_PATTERN = /\btaurine\b/i;
const INOSITOL_PATTERN = /\b(?:myo[\s-]*)?inositol\b|\bd[\s-]*chiro[\s-]*inositol\b/i;
const CURCUMIN_PATTERN = /\bcurcumin\b|\bturmeric\s+extract\b|\bcurcuminoids?\b/i;
const ASHWAGANDHA_PATTERN = /\bashwagandha\b|\bwithania\s+somnifera\b|\bksm-?66\b|\bsensoril\b/i;
const GINSENG_PATTERN = /\bginseng\b|\bpanax\b|\bamerican\s+ginseng\b|\bred\s+ginseng\b/i;
const GREEN_TEA_EXTRACT_PATTERN = /\bgreen\s+tea\s+extract\b|\begcg\b|\bcatechins?\b|\bcamellia\s+sinensis\b/i;
const MAGNESIUM_PATTERN =
  /\bmagnesium\b|\bmagnesium\s+(?:glycinate|citrate|oxide|malate|taurate|threonate|chloride|l-threonate)\b/i;
const CALCIUM_PATTERN =
  /\bcalcium\b|\bcalcium\s+(?:carbonate|citrate|ascorbate|malate|lactate|hydroxyapatite)\b/i;
const IRON_PATTERN = /\biron\b|\bferrous\b|\bferric\b/i;
const MELATONIN_PATTERN = /\bmelatonin\b/i;

const normalizeText = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeIngredientScienceKey = (value: string | null | undefined): string =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const dedupeIngredientRows = (rows: ScienceIngredientRow[]): ScienceIngredientRow[] => {
  const seen = new Set<string>();
  const deduped: ScienceIngredientRow[] = [];
  for (const row of rows) {
    const name = normalizeText(row?.name);
    if (!name) continue;
    const key = normalizeIngredientScienceKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      name,
      dose: normalizeText(row?.dose) || null,
    });
  }
  return deduped;
};

const inferFamilyFromText = (combined: string): IngredientScienceIngredientFamily => {
  if (/astaxanthin|carotenoid/.test(combined)) return "astaxanthin_carotenoid";
  if (CURCUMIN_PATTERN.test(combined)) return "curcumin";
  if (ASHWAGANDHA_PATTERN.test(combined)) return "ashwagandha";
  if (GINSENG_PATTERN.test(combined)) return "ginseng";
  if (GREEN_TEA_EXTRACT_PATTERN.test(combined)) return "green_tea_extract";
  if (HTP5_PATTERN.test(combined)) return "5htp";
  if (B3_PATTERN.test(combined)) return "b3_niacinamide";
  if (GLYCINE_PATTERN.test(combined)) return "glycine";
  if (TAURINE_PATTERN.test(combined)) return "taurine";
  if (INOSITOL_PATTERN.test(combined)) return "inositol";
  if (VITAMIN_D_PATTERN.test(combined)) return "vitamin_d";
  if (B12_PATTERN.test(combined)) return "b12";
  if (FOLATE_PATTERN.test(combined)) return "folate";
  if (B6_PATTERN.test(combined)) return "b6";
  if (/\bvitamin\s*c\b|\bascorbic\b|\bester\s*c\b/.test(combined)) return "vitamin_c";
  if (/\bzinc\b/.test(combined)) return "zinc";
  if (MAGNESIUM_PATTERN.test(combined)) return "magnesium";
  if (CALCIUM_PATTERN.test(combined)) return "calcium";
  if (IRON_PATTERN.test(combined)) return "iron";
  if (MELATONIN_PATTERN.test(combined)) return "melatonin";
  if (/\bfish\s*oil\b|\bomega\s*-?\s*3\b|\bepa\b|\bdha\b|\bkrill\b|\balgal\s*oil\b/.test(combined)) {
    return "omega_3";
  }
  if (
    /probiotic|lactobacillus|bifidobacterium|saccharomyces|microbiome|phage/.test(combined) ||
    HARD_BLEND_LIKE_PATTERN.test(combined) ||
    SOFT_BLEND_LIKE_PATTERN.test(combined)
  ) {
    return "probiotic_or_blend";
  }
  return "generic";
};

const inferRowIngredientFamily = (params: {
  rowName: string | null;
  productName?: string | null | undefined;
}): IngredientScienceIngredientFamily => {
  const rowText = normalizeText(params.rowName).toLowerCase();
  if (!rowText) return "generic";

  const rowFamily = inferFamilyFromText(rowText);
  if (rowFamily !== "generic") return rowFamily;

  const productText = normalizeText(params.productName).toLowerCase();
  if (!productText) return "generic";

  // Only use product-level hints when the selected row is too generic to classify on its own.
  if (HARD_BLEND_LIKE_PATTERN.test(rowText) || SOFT_BLEND_LIKE_PATTERN.test(rowText)) {
    return inferFamilyFromText(`${rowText} ${productText}`);
  }

  return "generic";
};

const inferContextIngredientFamily = (params: {
  seedText: string | null;
  productName: string | null | undefined;
  rows: ScienceIngredientRow[];
}): IngredientScienceIngredientFamily => {
  const anchorText = normalizeText(params.seedText).toLowerCase();
  const productText = normalizeText(params.productName).toLowerCase();
  const combined = [anchorText, productText, ...params.rows.map((row) => normalizeText(row.name).toLowerCase())]
    .join(" ")
    .trim();

  return inferFamilyFromText(combined);
};

const categoryHintForFamily = (
  family: IngredientScienceIngredientFamily,
  rowName: string | null,
): string | null => {
  if (rowName && isBlendLike(rowName, family)) return "blend";
  if (family === "astaxanthin_carotenoid") return "carotenoid";
  if (family === "curcumin") return "botanical extract";
  if (family === "ashwagandha") return "botanical extract";
  if (family === "ginseng") return "botanical extract";
  if (family === "green_tea_extract") return "botanical extract";
  if (family === "5htp") return "amino acid derivative";
  if (family === "b3_niacinamide") return "vitamin";
  if (family === "glycine") return "amino acid";
  if (family === "taurine") return "amino sulfonic acid";
  if (family === "inositol") return "inositol compound";
  if (family === "vitamin_c") return "vitamin";
  if (family === "vitamin_d") return "vitamin";
  if (family === "b12") return "vitamin";
  if (family === "folate") return "vitamin";
  if (family === "b6") return "vitamin";
  if (family === "zinc") return "mineral";
  if (family === "magnesium") return "mineral";
  if (family === "calcium") return "mineral";
  if (family === "iron") return "mineral";
  if (family === "melatonin") return "sleep-related ingredient";
  if (family === "omega_3") return "omega-3 fatty acids";
  if (family === "probiotic_or_blend") return "probiotic blend";
  return null;
};

const isBotanicalExtractFamily = (family: IngredientScienceIngredientFamily | null | undefined): boolean =>
  family === "curcumin" ||
  family === "ashwagandha" ||
  family === "ginseng" ||
  family === "green_tea_extract";

const isBlendLike = (
  name: string | null | undefined,
  family?: IngredientScienceIngredientFamily | null,
): boolean => {
  const normalized = normalizeText(name);
  if (!normalized) return false;
  if (HARD_BLEND_LIKE_PATTERN.test(normalized)) return true;
  if (!SOFT_BLEND_LIKE_PATTERN.test(normalized)) return false;
  return !isBotanicalExtractFamily(family ?? null);
};

const COMPANION_FAMILIES = new Set<IngredientScienceIngredientFamily>([
  "b3_niacinamide",
  "b6",
  "b12",
  "folate",
  "zinc",
  "magnesium",
  "calcium",
  "iron",
]);

const PRIMARY_ACTIVE_FAMILIES = new Set<IngredientScienceIngredientFamily>([
  "5htp",
  "curcumin",
  "ashwagandha",
  "ginseng",
  "green_tea_extract",
  "glycine",
  "taurine",
  "inositol",
  "vitamin_c",
  "vitamin_d",
  "melatonin",
  "omega_3",
]);

const parseDoseMagnitude = (value: string | null | undefined): number => {
  const normalized = normalizeText(value).toLowerCase().replace(/,/g, "");
  if (!normalized) return 0;
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match?.[1]) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (/\b(mcg|µg|μg)\b/.test(normalized)) return amount / 1000;
  if (/\b(g|gram|grams)\b/.test(normalized)) return amount * 1000;
  if (/\bmg\b/.test(normalized)) return amount;
  return amount / 10;
};

const matchesProductTitle = (rowName: string, productName: string): boolean => {
  const productKey = normalizeIngredientScienceKey(productName);
  if (!productKey) return false;
  const variants = [
    rowName,
    rowName.split(/\s+\(/)[0] ?? rowName,
    rowName.split(/\s+·\s+/)[0] ?? rowName,
  ]
    .map((value) => normalizeIngredientScienceKey(value))
    .filter((value) => value.length >= 3);
  return variants.some((value) => productKey.includes(value));
};

const pickPrimaryActiveRowIndex = (
  rows: ScienceIngredientRow[],
  families: IngredientScienceIngredientFamily[],
  productName: string,
): number => {
  if (rows.length === 0) return -1;
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  rows.forEach((row, index) => {
    const family = families[index] ?? "generic";
    const score =
      (matchesProductTitle(row.name, productName) ? 160 : 0) +
      (PRIMARY_ACTIVE_FAMILIES.has(family) ? 24 : 0) +
      Math.min(parseDoseMagnitude(row.dose), 1200) / 24 +
      (row.dose ? 18 : 0) -
      (COMPANION_FAMILIES.has(family) ? 60 : 0) -
      (isBlendLike(row.name, family) ? 120 : 0) -
      index * 0.5;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
};

const buildLineRoles = (
  rows: ScienceIngredientRow[],
  families: IngredientScienceIngredientFamily[],
  primaryIndex: number,
): IngredientScienceLineRole[] => {
  const deduped = dedupeIngredientRows(rows);
  const hasOmega3Breakdown = deduped.some((row) => OMEGA3_BREAKDOWN_PATTERN.test(row.name));
  const hasOmega3Aggregate = deduped.some((row) => OMEGA3_TOTAL_PATTERN.test(row.name));

  return deduped.map((row, index) => {
    const family = families[index] ?? "generic";
    if (isBlendLike(row.name, family)) return "blend_line";
    if (OMEGA3_BREAKDOWN_PATTERN.test(row.name)) return "breakdown_line";
    if (OMEGA3_TOTAL_PATTERN.test(row.name)) return "aggregate_line";
    if (OMEGA3_SOURCE_PATTERN.test(row.name) && (hasOmega3Breakdown || hasOmega3Aggregate)) {
      return "source_line";
    }
    if (index === primaryIndex) return "primary_active";
    if (/\bvitamin\b|\bb3\b|\bb6\b|\bniacin(?:amide)?\b|\bnicotinamide\b|\bpyridoxine\b|\bpyridoxal(?:\s|-)?5(?:\s|-)?phosphate\b|\bp-?5-?p\b|\bzinc\b|\bcalcium\b|\bmagnesium\b|\bselenium\b|\bcopper\b|\bchromium\b|\biodine\b/i.test(row.name)) {
      return "companion_nutrient";
    }
    return "generic_line";
  });
};

const determineFormulaMode = (
  rows: ScienceIngredientRow[],
  families: IngredientScienceIngredientFamily[],
): IngredientScienceFormulaMode => {
  const deduped = dedupeIngredientRows(rows);
  const hasOpaqueBlend = deduped.some((row, index) => isBlendLike(row.name, families[index] ?? "generic"));
  if (deduped.length <= 1 && !hasOpaqueBlend) return "single_ingredient";
  if (hasOpaqueBlend) return "blend";
  return "multi_ingredient";
};

const buildRelationshipCandidates = (
  rows: ScienceIngredientRow[],
  families: IngredientScienceIngredientFamily[],
): IngredientScienceRelationshipCandidate[] => {
  const deduped = dedupeIngredientRows(rows);
  const byKey = new Map(deduped.map((row) => [normalizeIngredientScienceKey(row.name), row]));
  const candidates: IngredientScienceRelationshipCandidate[] = [];

  const vitaminCRow = deduped.find((row) => /\bvitamin\s*c\b|\bascorbic\b|\bester\s*c\b/i.test(row.name));
  const zincRow = deduped.find((row) => /\bzinc\b/i.test(row.name));
  if (vitaminCRow && zincRow) {
    candidates.push({
      type: "shared_purpose_pairing",
      ingredients: [vitaminCRow.name, zincRow.name],
      safeStatement: "Vitamin C and zinc are commonly paired in immune-focused formulas.",
    });
  }

  const epaRow =
    deduped.find((row) => /\bepa\b|eicosapentaenoic/i.test(row.name)) ??
    byKey.get("epa") ??
    null;
  const dhaRow =
    deduped.find((row) => /\bdha\b|docosahexaenoic/i.test(row.name)) ??
    byKey.get("dha") ??
    null;
  if (epaRow && dhaRow) {
    candidates.push({
      type: "shared_purpose_pairing",
      ingredients: [epaRow.name, dhaRow.name],
      safeStatement: "EPA and DHA are often listed together in omega-3 products.",
    });
  }

  const blendRows = deduped.filter((row, index) => isBlendLike(row.name, families[index] ?? "generic"));
  if (blendRows.length >= 2) {
    candidates.push({
      type: "formula_composition",
      ingredients: [blendRows[0].name, blendRows[1].name],
      safeStatement: `The formula combines ${blendRows[0].name} with ${blendRows[1].name}.`,
    });
  }

  return candidates.slice(0, 2);
};

export const buildIngredientScienceContext = (params: {
  digest: FactsDigest;
  overlayClaims: OverlayClaimsLike;
}): IngredientScienceContext => {
  const selection = selectScienceIngredientRows({
    digest: params.digest,
    overlayClaims: params.overlayClaims,
  });
  const ingredientRows = dedupeIngredientRows(selection.ingredientRows);
  const ingredientSnapshotNames = ingredientRows.map((row) => row.name);
  const productName = normalizeText(params.digest?.product?.name) || "Supplement formula";
  const sourceContext =
    selection.ingredientSourceTier === "overlay_iherb"
      ? "Supplemental product-page label data"
      : "Official record";
  const ingredientFamilies = ingredientRows.map((row) =>
    inferRowIngredientFamily({
      rowName: row.name,
      productName,
    }),
  );
  const primaryIndex = pickPrimaryActiveRowIndex(ingredientRows, ingredientFamilies, productName);
  const lineRoles = buildLineRoles(ingredientRows, ingredientFamilies, primaryIndex);
  const anchorRow = primaryIndex >= 0 ? ingredientRows[primaryIndex] ?? null : ingredientRows[0] ?? null;
  const ingredientDescriptors = ingredientRows.map((row, index) => {
    const ingredientFamily = ingredientFamilies[index] ?? "generic";
    return {
      key: normalizeIngredientScienceKey(row.name),
      name: row.name,
      dose: row.dose ?? null,
      ingredientFamily,
      lineRole: lineRoles[index] ?? (index === primaryIndex ? "primary_active" : "generic_line"),
      categoryHint: categoryHintForFamily(ingredientFamily, row.name),
      sourceContext,
      formContext: null,
      isBlendLike: isBlendLike(row.name, ingredientFamily),
    } satisfies IngredientScienceDescriptor;
  });
  const formulaMode = determineFormulaMode(ingredientRows, ingredientFamilies);
  const ingredientFamily = inferContextIngredientFamily({
    seedText: anchorRow?.name ?? null,
    productName,
    rows: ingredientRows,
  });
  const hasOpaqueBlend = ingredientDescriptors.some((descriptor) => descriptor.isBlendLike);
  const disclosedDoseCount = ingredientRows.filter((row) => normalizeText(row.dose).length > 0).length;
  const ingredientDisclosureLimited =
    formulaMode === "blend" ||
    ingredientRows.length === 0 ||
    disclosedDoseCount === 0 ||
    (hasOpaqueBlend && disclosedDoseCount < ingredientRows.length);
  const sourceType: IngredientScienceSourceType =
    selection.ingredientSourceTier === "overlay_iherb"
      ? "iherb_overlay"
      : params.digest.sourceType === "dsld"
        ? "dsld"
        : "other";

  return {
    productName,
    ingredientSourceTier: selection.ingredientSourceTier,
    sourceType,
    ingredientRows,
    ingredientSnapshotNames,
    ingredientDescriptors,
    formulaMode,
    ingredientFamily,
    anchorIngredient: anchorRow
      ? {
          name: anchorRow.name,
          dose: anchorRow.dose ?? null,
          categoryHint: categoryHintForFamily(ingredientFamilies[primaryIndex] ?? ingredientFamily, anchorRow.name),
          sourceContext,
        }
      : null,
    coIngredients: ingredientDescriptors
      .filter((_, index) => index !== primaryIndex)
      .map((row) => ({
      name: row.name,
      dose: row.dose ?? null,
      categoryHint: row.categoryHint,
    })),
    relationshipCandidates: buildRelationshipCandidates(ingredientRows, ingredientFamilies),
    labelConstraints: {
      hasOpaqueBlend,
      ingredientDisclosureLimited,
    },
  };
};
