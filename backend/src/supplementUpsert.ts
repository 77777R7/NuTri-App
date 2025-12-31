import { supabase } from './supabase.js';
import type { SupplementSnapshot } from './schemas/supplementSnapshot.js';

type UpsertSupplementResult = {
  brandId: string | null;
  supplementId: string | null;
  createdBrand: boolean;
  createdSupplement: boolean;
};

const safeTrim = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const isNotFoundError = (error: { code?: string } | null | undefined) =>
  error?.code === 'PGRST116';

export async function upsertSupplementFromSnapshot(
  snapshot: SupplementSnapshot,
): Promise<UpsertSupplementResult> {
  const brandName = safeTrim(snapshot.product.brand);
  const productName = safeTrim(snapshot.product.name);
  const barcode = safeTrim(snapshot.product.barcode.normalized);

  const result: UpsertSupplementResult = {
    brandId: null,
    supplementId: null,
    createdBrand: false,
    createdSupplement: false,
  };

  if (!brandName || !productName || !barcode) {
    console.warn('[SupplementUpsert] Missing required snapshot fields', {
      brandName,
      productName,
      barcode,
      snapshotId: snapshot.snapshotId,
    });
    return result;
  }

  const { data: existingBrand, error: brandFetchError } = await supabase
    .from('brands')
    .select('id')
    .eq('name', brandName)
    .maybeSingle();

  if (brandFetchError && !isNotFoundError(brandFetchError)) {
    console.warn('[SupplementUpsert] Brand lookup failed', brandFetchError.message);
    return result;
  }

  let brandId = existingBrand?.id ?? null;
  if (!brandId) {
    const { data: insertedBrand, error: brandInsertError } = await supabase
      .from('brands')
      .insert({ name: brandName })
      .select('id')
      .single();

    if (brandInsertError) {
      if (brandInsertError.code === '23505') {
        const { data: conflictBrand } = await supabase
          .from('brands')
          .select('id')
          .eq('name', brandName)
          .maybeSingle();
        brandId = conflictBrand?.id ?? null;
      } else {
        console.warn('[SupplementUpsert] Brand insert failed', brandInsertError.message);
        return result;
      }
    } else {
      brandId = insertedBrand?.id ?? null;
      result.createdBrand = Boolean(brandId);
    }
  }

  if (!brandId) {
    console.warn('[SupplementUpsert] Unable to resolve brand id', { brandName });
    return result;
  }

  result.brandId = brandId;

  const { data: existingSupplement, error: supplementFetchError } = await supabase
    .from('supplements')
    .select('id')
    .eq('barcode', barcode)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (supplementFetchError && !isNotFoundError(supplementFetchError)) {
    console.warn('[SupplementUpsert] Supplement lookup failed', supplementFetchError.message);
    return result;
  }

  const category = safeTrim(snapshot.product.category);
  const imageUrl = safeTrim(snapshot.product.imageUrl);

  const insertPayload = {
    brand_id: brandId,
    name: productName,
    barcode,
    category,
    image_url: imageUrl,
    source: 'ai_search',
    needs_review: true,
  };

  const updatePayload: Record<string, unknown> = {
    brand_id: brandId,
    name: productName,
    barcode,
    source: 'ai_search',
    needs_review: true,
  };
  if (category) updatePayload.category = category;
  if (imageUrl) updatePayload.image_url = imageUrl;

  if (existingSupplement?.id) {
    const { error: updateError } = await supabase
      .from('supplements')
      .update(updatePayload)
      .eq('id', existingSupplement.id);

    if (updateError) {
      console.warn('[SupplementUpsert] Supplement update failed', updateError.message);
      return result;
    }

    result.supplementId = existingSupplement.id;
    return result;
  }

  const { data: insertedSupplement, error: supplementInsertError } = await supabase
    .from('supplements')
    .insert(insertPayload)
    .select('id')
    .single();

  if (supplementInsertError) {
    if (supplementInsertError.code === '23505') {
      const { data: conflictSupplement } = await supabase
        .from('supplements')
        .select('id')
        .eq('brand_id', brandId)
        .eq('name', productName)
        .maybeSingle();

      if (conflictSupplement?.id) {
        const { error: updateError } = await supabase
          .from('supplements')
          .update(updatePayload)
          .eq('id', conflictSupplement.id);

        if (!updateError) {
          result.supplementId = conflictSupplement.id;
          return result;
        }
      }
    }

    console.warn('[SupplementUpsert] Supplement insert failed', supplementInsertError.message);
    return result;
  }

  result.supplementId = insertedSupplement?.id ?? null;
  result.createdSupplement = Boolean(result.supplementId);
  return result;
}
