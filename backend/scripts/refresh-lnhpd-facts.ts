import { supabase } from '../src/supabase.js';

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const parseNumber = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isRpcMissing = (error: { code?: string; message?: string } | null): boolean => {
  if (!error) return false;
  if (error.code === 'PGRST202') return true;
  return (error.message ?? '').toLowerCase().includes('could not find the function');
};

const DEFAULT_BATCH_SIZE = Number(
  getArg('batch') ?? process.env.LNHPD_REFRESH_BATCH_SIZE ?? '5000',
);

const fetchEdgeId = async (ascending: boolean): Promise<number | null> => {
  const runQuery = async (useEndpoint: boolean) => {
    let query = supabase
      .from('lnhpd_raw_records')
      .select('lnhpd_id')
      .not('lnhpd_id', 'is', null)
      .order('lnhpd_id', { ascending })
      .limit(1);
    if (useEndpoint) {
      query = query.eq('endpoint', 'ProductLicence');
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`lnhpd_raw_records edge lookup failed: ${error.message}`);
    }
    const value = data?.[0]?.lnhpd_id;
    return typeof value === 'number' ? value : value != null ? Number(value) : null;
  };

  const endpointValue = await runQuery(true);
  if (endpointValue != null) return endpointValue;
  return runQuery(false);
};

const main = async () => {
  console.log('[lnhpd] refreshing facts from raw records (batched)...');

  const startOverride = parseNumber(getArg('start-id') ?? process.env.LNHPD_REFRESH_START_ID ?? null);
  const endOverride = parseNumber(getArg('end-id') ?? process.env.LNHPD_REFRESH_END_ID ?? null);

  const minId = startOverride ?? await fetchEdgeId(true);
  const maxId = endOverride ?? await fetchEdgeId(false);
  if (minId == null || maxId == null) {
    console.log('[lnhpd] no raw records to refresh');
    return;
  }

  const batchSize = Math.max(1000, DEFAULT_BATCH_SIZE);
  let current = minId;
  let batch = 0;
  while (current <= maxId) {
    const next = Math.min(maxId, current + batchSize - 1);
    batch += 1;
    const { error } = await supabase.rpc('refresh_lnhpd_facts_range', {
      p_min_id: current,
      p_max_id: next,
    });
    if (error) {
      throw new Error(`refresh_lnhpd_facts_range failed: ${error.message}`);
    }
    console.log(`[lnhpd] batch=${batch} range=${current}-${next}`);
    current = next + 1;
  }

  const { error: snapshotError } = await supabase.rpc('record_lnhpd_quality_snapshot');
  if (snapshotError) {
    if (isRpcMissing(snapshotError)) {
      console.warn('[lnhpd] record_lnhpd_quality_snapshot not available; skipping');
    } else {
      throw new Error(`record_lnhpd_quality_snapshot failed: ${snapshotError.message}`);
    }
  } else {
    console.log('[lnhpd] quality snapshot recorded');
  }

  console.log('[lnhpd] refresh complete');
};

main().catch((error) => {
  console.error('[lnhpd] refresh failed', error instanceof Error ? error.message : error);
  process.exit(1);
});
