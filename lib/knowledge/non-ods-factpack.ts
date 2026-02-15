import { normalizeHumanTextForMatch } from "@/lib/text/normalizeHumanText";
import packData from "./non-ods-factpack.json";

export type NonOdsFactEntry = {
  overview: string;
  whatItDoes: string[];
  watchOuts: string[];
  sourceLabel: string;
  sourceUrl: string | null;
};

export type NonOdsFactPack = {
  packVersion: string;
  updatedAt: string;
  entries: Record<string, NonOdsFactEntry>;
};

export type NonOdsFactHit = {
  key: string;
  entry: NonOdsFactEntry;
};

const PACK = packData as NonOdsFactPack;

const normalize = (value: string) =>
  normalizeHumanTextForMatch(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9+\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const canonicalizeNonOdsKey = (rawName: string): string | null => {
  const n = normalize(rawName);
  if (!n) return null;

  if (/\bastaxanthin\b|\bhaematococcus\b/.test(n)) return "astaxanthin";
  if (/\bashwagandha\b|\bwithania\b/.test(n)) return "ashwagandha";
  if (/\bturmeric\b|\bcurcumin\b/.test(n)) return "turmeric";
  if (/\bcoq\s*10\b|\bcoenzymeq10\b|\bcoenzyme\s*q\s*10\b|\bubiquinone\b|\bubiquinol\b/.test(n)) return "coq10";
  if (/\bprobiotic\b|\blactobacillus\b|\bbifidobacter\b/.test(n)) return "probiotics";
  if (/\bwhey\b|\bwhey\s*protein\b/.test(n)) return "whey protein";
  if (/\bcreatine\b/.test(n)) return "creatine";
  if (/\bmelatonin\b/.test(n)) return "melatonin";

  return null;
};

export const getNonOdsFactForSupplement = (params: {
  activeNames?: string[] | null;
  productName?: string | null;
}): NonOdsFactHit | null => {
  const activeNames = Array.isArray(params.activeNames) ? params.activeNames : [];

  for (const name of activeNames) {
    const key = canonicalizeNonOdsKey(name);
    if (!key) continue;
    const entry = PACK.entries[key];
    if (!entry) continue;
    return { key, entry };
  }

  const productName = typeof params.productName === "string" ? params.productName : "";
  const key = canonicalizeNonOdsKey(productName);
  if (!key) return null;
  const entry = PACK.entries[key];
  return entry ? { key, entry } : null;
};
