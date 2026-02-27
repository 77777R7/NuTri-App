import { supabase } from '../supabase.js';

export type LnhpdFactsRecord = {
  npn: string | null;
  facts_json: unknown;
  dataset_version: string | null;
  extracted_at: string | null;
  brand_name: string | null;
  product_name: string | null;
  is_complete?: boolean | null;
  missing_fields?: unknown;
};

export const fetchLnhpdFactsRecordByNpn = async (
  npn: string,
  signal?: AbortSignal,
): Promise<LnhpdFactsRecord | null> => {
  const tables = ['lnhpd_facts_complete', 'lnhpd_facts'];
  for (const table of tables) {
    let query = supabase
      .from(table)
      .select('npn,facts_json,dataset_version,extracted_at,brand_name,product_name,is_complete,missing_fields')
      .eq('npn', npn)
      .limit(1);

    if (table === 'lnhpd_facts') {
      query = query.eq('is_on_market', true);
    }

    if (signal) {
      query = query.abortSignal(signal);
    }

    const { data, error } = await query.maybeSingle();
    if (error) continue;
    if (data) return data as LnhpdFactsRecord;
  }
  return null;
};

export type DsldFactsRecord = {
  dsld_label_id: number;
  dataset_version: string | null;
  extracted_at: string | null;
  facts_json: unknown;
};

export type DsldMetaRecord = {
  dsld_label_id: number;
  brand: string | null;
  product_name: string | null;
  serving_size_raw: string | null;
  servings_per_container: number | null;
  active_ingredients_summary: string | null;
  inactive_ingredients: string | null;
  dsld_product_version_code: string | null;
  dsld_pdf: string | null;
  dsld_thumbnail: string | null;
};

export const fetchDsldFactsRecordByLabelId = async (
  labelId: number,
  signal?: AbortSignal,
): Promise<DsldFactsRecord | null> => {
  let rpcQuery = supabase.rpc('resolve_dsld_facts_by_label_id', { p_label_id: labelId });
  if (signal) rpcQuery = rpcQuery.abortSignal(signal);
  const rpc = await rpcQuery;
  if (!rpc.error && rpc.data) {
    const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    if (row?.facts_json) return row as DsldFactsRecord;
  }

  let query = supabase
    .from('dsld_facts')
    .select('dsld_label_id,dataset_version,extracted_at,facts_json')
    .eq('dsld_label_id', labelId);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();

  if (error || !data) return null;
  return data as DsldFactsRecord;
};

export const fetchDsldMetaByLabelId = async (
  labelId: number,
  signal?: AbortSignal,
): Promise<DsldMetaRecord | null> => {
  let query = supabase
    .from('dsld_labels_meta')
    .select(
      'dsld_label_id,brand,product_name,serving_size_raw,servings_per_container,active_ingredients_summary,inactive_ingredients,dsld_product_version_code,dsld_pdf,dsld_thumbnail',
    )
    .eq('dsld_label_id', labelId);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();

  if (error || !data) return null;
  return data as DsldMetaRecord;
};

export type WebIngredientRow = {
  source_id: string;
  canonical_source_id: string | null;
  name_raw: string;
  amount: number | null;
  unit: string | null;
  is_active: boolean;
  is_proprietary_blend: boolean;
  form_raw?: string | null;
};

export const fetchWebIngredientsBySourceId = async (
  sourceId: string,
  signal?: AbortSignal,
): Promise<WebIngredientRow[]> => {
  let query = supabase
    .from('product_ingredients')
    .select('source_id,canonical_source_id,name_raw,amount,unit,is_active,is_proprietary_blend,form_raw')
    .eq('source', 'web')
    .or(`source_id.eq.${sourceId},canonical_source_id.eq.${sourceId}`)
    .limit(200);

  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error || !data) return [];
  return data as WebIngredientRow[];
};
