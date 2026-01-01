import { supabase } from './supabase.js';
import type { SupplementSnapshot } from './schemas/supplementSnapshot.js';
import type { SnapshotAnalysisPayload } from './snapshot.js';
import { validateSnapshotOrFallback } from './snapshot.js';

export type SnapshotCacheRecord = {
  snapshot: SupplementSnapshot;
  analysisPayload: SnapshotAnalysisPayload | null;
  expiresAt: string | null;
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

const isMissingUpdatedAtColumn = (error: { message?: string } | null): boolean => {
  const message = error?.message?.toLowerCase();
  if (!message) return false;
  return message.includes('updated_at') && (message.includes('does not exist') || message.includes('schema cache'));
};

export async function getSnapshotCache(params: {
  key: string;
  source: string;
}): Promise<SnapshotCacheRecord | null> {
  const { key, source } = params;
  const runSnapshotQuery = (orderColumn: 'updated_at' | 'created_at') =>
    supabase
      .from('snapshots')
      .select('*')
      .eq('key', key)
      .eq('source', source)
      .order(orderColumn, { ascending: false })
      .limit(1)
      .maybeSingle();

  let { data, error } = await runSnapshotQuery('updated_at');
  if (error && isMissingUpdatedAtColumn(error)) {
    ({ data, error } = await runSnapshotQuery('created_at'));
  }

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
    expiresAt: row.expires_at ?? null,
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
  const updatedAt = snapshot.updatedAt ?? new Date().toISOString();
  const payloadSnapshot =
    snapshot.updatedAt === updatedAt
      ? snapshot
      : {
          ...snapshot,
          updatedAt,
        };
  const record: Record<string, unknown> = {
    id: snapshot.snapshotId,
    key,
    source,
    payload_json: payloadSnapshot,
    updated_at: updatedAt,
  };
  if (analysisPayload !== undefined) {
    record.analysis_json = analysisPayload;
  }
  if (expiresAt !== undefined) {
    record.expires_at = expiresAt;
  }

  const { error } = await supabase.from('snapshots').upsert(record, { onConflict: 'id' });
  if (error) {
    console.warn('[snapshot-cache] write failed', error.message);
  }
}
