import { Config } from '@/constants/Config';
import { withAuthHeaders } from '@/lib/auth-token';
import type { SupplementSnapshot } from '@/types/supplementSnapshot';
import type { ScoreBundleResponse, ScoreSource } from '@/types/scoreBundle';

export const resolveScoreQueryFromSnapshot = (
    snapshot: SupplementSnapshot | null,
): { source: ScoreSource; sourceId: string } | null => {
  if (!snapshot) return null;
  if (snapshot.regulatory?.dsldLabelId) {
    return { source: 'dsld', sourceId: snapshot.regulatory.dsldLabelId };
  }
  if (snapshot.regulatory?.npn) {
    return { source: 'lnhpd', sourceId: snapshot.regulatory.npn };
  }
  return null;
};

export async function fetchScoreBundleV4(params: {
  source: ScoreSource;
  sourceId: string;
}): Promise<ScoreBundleResponse> {
  const apiBase = Config.searchApiBaseUrl?.replace(/\/$/, '');
  if (!apiBase) {
    throw new Error('Search API base URL is not configured.');
  }
  const headers = await withAuthHeaders({ 'Content-Type': 'application/json' });
  const response = await fetch(
    `${apiBase}/api/score/v4/${params.source}/${encodeURIComponent(params.sourceId)}`,
    {
      method: 'GET',
      headers,
    },
  );

  const payload = (await response.json().catch(() => null)) as ScoreBundleResponse | null;
  if (!response.ok) {
    const message = (payload as { error?: string } | null)?.error ?? `Score request failed (${response.status})`;
    throw new Error(message);
  }
  if (!payload?.status) {
    throw new Error('Invalid score response');
  }
  return payload;
}
