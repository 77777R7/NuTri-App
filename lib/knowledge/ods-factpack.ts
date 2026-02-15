import { normalizeHumanTextForMatch } from "@/lib/text/normalizeHumanText";
import packData from "./ods-factpack.json";
import {
  sanitizeOdsBullets,
  sanitizeOdsOverview,
} from "./ods-quality-gate.js";

export type OdsFactEntry = {
  overview: string;
  curatedOverview?: string;
  overviewSource?: "ods" | "curated" | "runtime_fallback";
  whatItDoes: string[];
  watchOuts: string[];
  sourceUrl: string | null;
};

export type OdsFactHit = {
  key: string;
  entry: OdsFactEntry;
  displayTitle: string;
  qualityRejected: boolean;
};

export type OdsFactPack = {
  packVersion: string;
  updatedAt: string;
  entries: Record<string, OdsFactEntry>;
};

const ODS_PACK = packData as OdsFactPack;

const normalize = (value: string): string =>
  normalizeHumanTextForMatch(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9+\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const canonicalizeKnowledgeKey = (rawName: string): string | null => {
  const n = normalize(rawName);
  if (!n) return null;

  if (/\b(epa|eicosapentaenoic|dha|docosahexaenoic|omega\s*[-\s]?3|fish[-\s]+oil|krill)\b/.test(n)) return "omega-3";
  if (/\b(cholecalciferol|ergocalciferol|vitamin[-\s]*d3?|vit[-\s]*d3?|calcifediol)\b/.test(n)) return "vitamin d";
  if (/\b(ascorbic acid|vitamin[-\s]*c|vit[-\s]*c|ester[-\s]?c)\b/.test(n)) return "vitamin c";
  if (/\b(vitamin[-\s]*b6|b6|pyridoxine|pyridoxal|pyridoxamine|p[-\s]*5[-\s]*p|pyridoxal[-\s]*5[-\s]*phosphate)\b/.test(n)) return "vitamin b6";
  if (/\b(pantothenic acid|vitamin[-\s]*b5|pantothenate|calcium[-\s]*pantothenate)\b/.test(n)) return "pantothenic acid";
  if (/\bcholine\b/.test(n)) return "choline";
  if (/\bchromium\b/.test(n)) return "chromium";
  if (/\bcopper\b/.test(n)) return "copper";
  if (/\bmanganese\b/.test(n)) return "manganese";
  if (/\bphosphorus\b/.test(n)) return "phosphorus";
  if (/\b(vitamin[-\s]*b12|b12|cobalamin|methylcobalamin|cyanocobalamin)\b/.test(n)) return "vitamin b12";
  if (/\bcalcium\b/.test(n)) return "calcium";
  if (/\b(folate|folic acid|methylfolate|5[-\s]*mthf)\b/.test(n)) return "folate";
  if (/\bpotassium\b/.test(n)) return "potassium";
  if (/\bselenium\b/.test(n)) return "selenium";
  if (/\b(iodine|iodide)\b/.test(n)) return "iodine";
  if (/\b(vitamin[-\s]*a|retinol|beta[-\s]*carotene)\b/.test(n)) return "vitamin a";
  if (/\b(vitamin[-\s]*e|tocopherol)\b/.test(n)) return "vitamin e";
  if (/\b(vitamin[-\s]*k[12]?|phylloquinone|menaquinone)\b/.test(n)) return "vitamin k";
  if (/\b(niacin|niacinamide|vitamin[-\s]*b3|nicotinamide|nicotinic acid)\b/.test(n)) return "niacin";
  if (/\b(thiamin|thiamine|vitamin[-\s]*b1)\b/.test(n)) return "thiamin";
  if (/\b(riboflavin|vitamin[-\s]*b2)\b/.test(n)) return "riboflavin";
  if (/\b(biotin|vitamin[-\s]*b7)\b/.test(n)) return "biotin";
  if (/\bnac\b|\bn[-\s]?acetyl[-\s]?cysteine\b/.test(n)) return "nac";
  if (/\bmagnesium\b/.test(n)) return "magnesium";
  if (/\bzinc\b/.test(n)) return "zinc";
  if (/\biron\b/.test(n)) return "iron";

  return null;
};

export const getOdsFactPackMeta = () => ({
  packVersion: ODS_PACK.packVersion,
  updatedAt: ODS_PACK.updatedAt,
});

export const getOdsFactByKey = (key: string | null | undefined): OdsFactEntry | null => {
  if (!key) return null;
  const entry = ODS_PACK.entries[key];
  return entry ?? null;
};

const applyRuntimeQualityGate = (
  entry: OdsFactEntry,
): { entry: OdsFactEntry; qualityRejected: boolean } => {
  const overviewResult = sanitizeOdsOverview(entry.overview, entry.curatedOverview ?? entry.overview);
  const whatItDoes = sanitizeOdsBullets(entry.whatItDoes ?? [], 3);
  const watchOuts = sanitizeOdsBullets(entry.watchOuts ?? [], 3);
  const qualityRejected = overviewResult.rejected || whatItDoes.length !== (entry.whatItDoes ?? []).length;
  const nextEntry: OdsFactEntry = {
    ...entry,
    overview: overviewResult.text,
    overviewSource: overviewResult.rejected ? "runtime_fallback" : entry.overviewSource ?? "ods",
    whatItDoes: whatItDoes.length > 0 ? whatItDoes : sanitizeOdsBullets(entry.whatItDoes ?? [], 3),
    watchOuts: watchOuts.length > 0 ? watchOuts : sanitizeOdsBullets(entry.watchOuts ?? [], 3),
  };
  return { entry: nextEntry, qualityRejected };
};

const odsDisplayTitleForKey = (key: string): string => {
  switch (key) {
    case "omega-3":
      return "About Omega-3 (NIH ODS)";
    case "vitamin d":
      return "About Vitamin D (NIH ODS)";
    case "vitamin c":
      return "About Vitamin C (NIH ODS)";
    case "vitamin b12":
      return "About Vitamin B12 (NIH ODS)";
    case "vitamin b6":
      return "About Vitamin B6 (NIH ODS)";
    case "pantothenic acid":
      return "About Pantothenic Acid (Vitamin B5) (NIH ODS)";
    case "choline":
      return "About Choline (NIH ODS)";
    case "chromium":
      return "About Chromium (NIH ODS)";
    case "copper":
      return "About Copper (NIH ODS)";
    case "manganese":
      return "About Manganese (NIH ODS)";
    case "phosphorus":
      return "About Phosphorus (NIH ODS)";
    case "calcium":
      return "About Calcium (NIH ODS)";
    case "folate":
      return "About Folate (NIH ODS)";
    case "potassium":
      return "About Potassium (NIH ODS)";
    case "selenium":
      return "About Selenium (NIH ODS)";
    case "iodine":
      return "About Iodine (NIH ODS)";
    case "vitamin a":
      return "About Vitamin A (NIH ODS)";
    case "vitamin e":
      return "About Vitamin E (NIH ODS)";
    case "vitamin k":
      return "About Vitamin K (NIH ODS)";
    case "niacin":
      return "About Niacin (NIH ODS)";
    case "thiamin":
      return "About Thiamin (NIH ODS)";
    case "riboflavin":
      return "About Riboflavin (NIH ODS)";
    case "biotin":
      return "About Biotin (NIH ODS)";
    case "magnesium":
      return "About Magnesium (NIH ODS)";
    case "zinc":
      return "About Zinc (NIH ODS)";
    case "iron":
      return "About Iron (NIH ODS)";
    case "nac":
      return "About N-acetylcysteine (NAC) (NIH ODS)";
    default:
      return "About this ingredient (NIH ODS)";
  }
};

export const getOdsFactForSupplement = (params: {
  activeNames?: string[] | null;
  productName?: string | null;
}): OdsFactHit | null => {
  const activeNames = Array.isArray(params.activeNames) ? params.activeNames : [];

  for (const name of activeNames) {
    const key = canonicalizeKnowledgeKey(name);
    if (!key) continue;
    const entry = getOdsFactByKey(key);
    if (!entry) continue;
    const gated = applyRuntimeQualityGate(entry);
    return { key, entry: gated.entry, displayTitle: odsDisplayTitleForKey(key), qualityRejected: gated.qualityRejected };
  }

  const productName = typeof params.productName === "string" ? params.productName : "";
  const key = canonicalizeKnowledgeKey(productName);
  if (!key) return null;
  const entry = getOdsFactByKey(key);
  if (!entry) return null;
  const gated = applyRuntimeQualityGate(entry);
  return { key, entry: gated.entry, displayTitle: odsDisplayTitleForKey(key), qualityRejected: gated.qualityRejected };
};
