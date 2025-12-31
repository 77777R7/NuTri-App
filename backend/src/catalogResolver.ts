import { supabase } from "./supabase.js";
import type { NormalizedBarcode } from "./barcode.js";

export type CatalogResolved = {
  resolvedFrom: "override" | "dsld";
  barcodeGtin14: string;
  dsldLabelId: number | null;

  brand: string | null;
  productName: string | null;
  category: string | null;
  categoryRaw: string | null;
  form: string | null;

  servingSizeRaw: string | null;
  servingSizeCount: number | null;

  packageQuantity: number | null;
  packageUnit: string | null;
  servingsPerContainer: number | null;

  activeIngredientsSummary: string | null;
  inactiveIngredients: string | null;

  thirdPartyTesting: string | null;
  nsfCertifiedForSport: boolean | null;
  informedSport: boolean | null;
  ifosFishOil: boolean | null;
  cgmpCompliance: string | null;

  dsldPdf: string | null;
  dsldThumbnail: string | null;

  imageUrl: string | null;
};

const digitsOnly = (s: string) => s.replace(/\D/g, "");

export function toGtin14Variants(normalized: NormalizedBarcode): string[] {
  const set = new Set<string>();
  for (const v of normalized.variants) {
    const d = digitsOnly(String(v));
    if (!d) continue;
    if (d.length > 14) continue;
    const gtin14 = d.padStart(14, "0");
    if (/^\d{14}$/.test(gtin14)) set.add(gtin14);
  }
  // 保底：把 normalized.code 也加入
  const base = digitsOnly(normalized.code);
  if (base && base.length <= 14) set.add(base.padStart(14, "0"));

  return [...set];
}

export async function resolveCatalogByBarcode(normalized: NormalizedBarcode): Promise<CatalogResolved | null> {
  const variants = toGtin14Variants(normalized);

  const { data, error } = await supabase.rpc("resolve_catalog_by_variants", {
    p_variants: variants,
  });

  if (error) {
    console.warn("[catalogResolver] rpc error:", error.message);
    return null;
  }
  if (!data || (Array.isArray(data) && data.length === 0)) return null;

  const row = Array.isArray(data) ? data[0] : data;

  return {
    resolvedFrom: row.resolved_from,
    barcodeGtin14: row.barcode_gtin14,
    dsldLabelId: row.dsld_label_id ?? null,

    brand: row.brand ?? null,
    productName: row.product_name ?? null,
    category: row.category ?? null,
    categoryRaw: row.category_raw ?? null,
    form: row.form ?? null,

    servingSizeRaw: row.serving_size_raw ?? null,
    servingSizeCount: row.serving_size_count ?? null,

    packageQuantity: row.package_quantity ?? null,
    packageUnit: row.package_unit ?? null,
    servingsPerContainer: row.servings_per_container ?? null,

    activeIngredientsSummary: row.active_ingredients_summary ?? null,
    inactiveIngredients: row.inactive_ingredients ?? null,

    thirdPartyTesting: row.third_party_testing ?? null,
    nsfCertifiedForSport: row.nsf_certified_for_sport ?? null,
    informedSport: row.informed_sport ?? null,
    ifosFishOil: row.ifos_fish_oil ?? null,
    cgmpCompliance: row.cgmp_compliance ?? null,

    dsldPdf: row.dsld_pdf ?? null,
    dsldThumbnail: row.dsld_thumbnail ?? null,

    imageUrl: row.image_url ?? null,
  };
}
