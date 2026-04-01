import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "../supabase.js";
import type {
  CanonicalAllergyFlag,
  CanonicalIngredientRestriction,
} from "./allergenTaxonomy.js";
import type {
  NormalizedAllergenDetail,
  ProductAllergenCoverageStatus,
} from "./allergenNormalization.js";

export type ProductAllergenFlagsSource =
  | "dsld"
  | "lnhpd"
  | "ocr"
  | "iherb_overlay";

export type ProductAllergenFlagsRow = {
  source: ProductAllergenFlagsSource;
  source_id: string;
  canonical_source_id: string | null;
  allergy_flags: CanonicalAllergyFlag[];
  ingredient_restrictions: CanonicalIngredientRestriction[];
  coverage_status: ProductAllergenCoverageStatus;
  match_evidence: Record<string, unknown>;
  normalization_version: string;
  computed_at: string;
};

type SupabaseLike = Pick<SupabaseClient<any>, "from">;

const groupDetailsByFlag = (details: NormalizedAllergenDetail[]) => {
  const grouped = new Map<string, Array<Record<string, unknown>>>();

  details.forEach((detail) => {
    const bucket = grouped.get(detail.flag) ?? [];
    bucket.push({
      source: detail.source,
      matchedText: detail.matchedText,
      confidence: detail.confidence,
    });
    grouped.set(detail.flag, bucket);
  });

  return Object.fromEntries(grouped.entries());
};

export const buildMatchEvidencePayload = (details: NormalizedAllergenDetail[]) => ({
  flags: groupDetailsByFlag(details),
});

export const buildProductAllergenFlagsRow = (input: {
  source: ProductAllergenFlagsSource;
  sourceId: string;
  canonicalSourceId?: string | null;
  allergyFlags: CanonicalAllergyFlag[];
  ingredientRestrictions: CanonicalIngredientRestriction[];
  coverageStatus: ProductAllergenCoverageStatus;
  details: NormalizedAllergenDetail[];
  normalizationVersion?: string;
  computedAt?: string;
}): ProductAllergenFlagsRow => ({
  source: input.source,
  source_id: input.sourceId,
  canonical_source_id: input.canonicalSourceId ?? null,
  allergy_flags: input.allergyFlags,
  ingredient_restrictions: input.ingredientRestrictions,
  coverage_status: input.coverageStatus,
  match_evidence: buildMatchEvidencePayload(input.details),
  normalization_version: input.normalizationVersion ?? "allergen_norm_v1",
  computed_at: input.computedAt ?? new Date().toISOString(),
});

export const upsertProductAllergenFlagsRows = async (
  rows: ProductAllergenFlagsRow[],
  client: SupabaseLike = supabase,
) => {
  if (rows.length === 0) return { ok: true as const, count: 0 };

  const { error } = await client
    .from("product_allergen_flags")
    .upsert(rows, { onConflict: "source,source_id" });

  if (error) {
    return { ok: false as const, count: 0, error };
  }

  return { ok: true as const, count: rows.length };
};

export const productAllergenFlagsRepositoryInternals = {
  groupDetailsByFlag,
};
