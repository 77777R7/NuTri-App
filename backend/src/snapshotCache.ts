import { supabase } from './supabase.js';
import type { SupplementSnapshot } from './schemas/supplementSnapshot.js';
import type { SnapshotAnalysisPayload } from './snapshot.js';
import { validateSnapshotOrFallback } from './snapshot.js';

export type SnapshotCacheRecord = {
  snapshot: SupplementSnapshot;
  analysisPayload: SnapshotAnalysisPayload | null;
};

type SnapshotCacheRow = {
  id: string;
  key: string;
  source: string;
  payload_json: SupplementSnapshot;
  analysis_json: SnapshotAnalysisPayload | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

const isExpired = (expiresAt: string | null): boolean => {
  if (!expiresAt) return false;
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs <= Date.now();
};

export async function getSnapshotCache(params: {
  key: string;
  source: string;
}): Promise<SnapshotCacheRecord | null> {
  const { key, source } = params;
  const { data, error } = await supabase
    .from('snapshots')
    .select('*')
    .eq('key', key)
    .eq('source', source)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.warn('[snapshot-cache] read failed', error.message);
    }
    return null;
  }

  const row = data as SnapshotCacheRow;
  if (isExpired(row.expires_at)) {
    return null;
  }

  const fallbackSource =
    row.source === 'barcode' || row.source === 'label' || row.source === 'mixed'
      ? row.source
      : 'mixed';

  const snapshot = validateSnapshotOrFallback({
    candidate: row.payload_json,
    fallback: {
      source: fallbackSource,
      barcodeRaw: source === 'barcode' ? key : null,
      createdAt: row.created_at,
    },
  });

  return {
    snapshot,
    analysisPayload: row.analysis_json ?? null,
  };
}

export async function storeSnapshotCache(params: {
  key: string;
  source: 'barcode' | 'label' | 'mixed';
  snapshot: SupplementSnapshot;
  analysisPayload?: SnapshotAnalysisPayload | null;
  expiresAt?: string | null;
}): Promise<void> {
  const { key, source, snapshot, analysisPayload, expiresAt } = params;
  const record = {
    id: snapshot.snapshotId,
    key,
    source,
    payload_json: snapshot,
    analysis_json: analysisPayload ?? null,
    expires_at: expiresAt ?? null,
  };

  const { error } = await supabase.from('snapshots').insert(record);
  if (error) {
    console.warn('[snapshot-cache] write failed', error.message);
  }
}
