import { getOdsFactForSupplement } from "@/lib/knowledge/ods-factpack";
import { getNonOdsFactForSupplement } from "@/lib/knowledge/non-ods-factpack";

export type FoundationKind = "ods" | "curated" | "miss";

export type FoundationLookupResult =
  | {
      kind: "ods" | "curated";
      id: string;
      title: string;
      sourceUrl: string | null;
      overview: string;
      whatItDoes: string[];
      watchOuts: string[];
    }
  | {
      kind: "miss";
      id: null;
      title: null;
      sourceUrl: null;
      overview: "";
      whatItDoes: [];
      watchOuts: [];
    };

const normalizeMissKey = (raw: string): string =>
  String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 64);

export const lookupFoundationForIngredient = (ingredientName: string): FoundationLookupResult => {
  const odsHit = getOdsFactForSupplement({ activeNames: [ingredientName], productName: null });
  if (odsHit) {
    return {
      kind: "ods",
      id: `ods:${odsHit.key}`,
      title: odsHit.displayTitle,
      sourceUrl: odsHit.entry.sourceUrl ?? null,
      overview: odsHit.entry.overview ?? "",
      whatItDoes: Array.isArray(odsHit.entry.whatItDoes) ? odsHit.entry.whatItDoes : [],
      watchOuts: Array.isArray(odsHit.entry.watchOuts) ? odsHit.entry.watchOuts : [],
    };
  }

  const curatedHit = getNonOdsFactForSupplement({ activeNames: [ingredientName], productName: null });
  if (curatedHit) {
    return {
      kind: "curated",
      id: `curated:${curatedHit.key}`,
      title: curatedHit.entry.sourceLabel,
      sourceUrl: curatedHit.entry.sourceUrl ?? null,
      overview: curatedHit.entry.overview ?? "",
      whatItDoes: Array.isArray(curatedHit.entry.whatItDoes) ? curatedHit.entry.whatItDoes : [],
      watchOuts: Array.isArray(curatedHit.entry.watchOuts) ? curatedHit.entry.watchOuts : [],
    };
  }

  return {
    kind: "miss",
    id: null,
    title: null,
    sourceUrl: null,
    overview: "",
    whatItDoes: [],
    watchOuts: [],
  };
};

export const summarizeFoundationHits = (ingredientNames: string[]) => {
  const list = Array.isArray(ingredientNames) ? ingredientNames : [];
  const seen = new Set<string>();

  let odsHitCount = 0;
  let curatedHitCount = 0;
  let missCount = 0;

  for (const raw of list) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name) continue;

    const hit = lookupFoundationForIngredient(name);
    const key = hit.kind === "miss" ? `miss:${normalizeMissKey(name)}` : hit.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);

    if (hit.kind === "ods") odsHitCount += 1;
    else if (hit.kind === "curated") curatedHitCount += 1;
    else missCount += 1;
  }

  return {
    selectedCount: seen.size,
    odsHitCount,
    curatedHitCount,
    missCount,
  };
};

