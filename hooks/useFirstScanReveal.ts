import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import {
  type FirstScanRevealRecord,
  type FirstScanRevealState,
  getFirstScanRevealRecord,
  setFirstScanRevealRecord,
} from '@/lib/storage/firstScanReveal';
import { supabase } from '@/lib/supabase';
import { fetchUserFirstScanReveal, upsertUserFirstScanReveal } from '@/lib/supabase/profile';

type FirstScanRevealSnapshot = FirstScanRevealRecord['reveal'];

type FirstScanRevealHook = {
  loading: boolean;
  firstCompletedScanId: string | null;
  reveal: FirstScanRevealSnapshot;
  ensureFirstCompletedScanId: (scanId: string) => Promise<void>;
  grantForScan: (scanId: string) => Promise<void>;
  markPaywallSeen: (scanId: string) => Promise<void>;
  markConverted: (scanId: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const DEFAULT_RECORD: FirstScanRevealRecord = {
  firstCompletedScanId: null,
  reveal: {
    state: 'eligible',
    scanId: null,
  },
};

const normalizeId = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const sanitizeState = (value: unknown): FirstScanRevealState => {
  switch (value) {
    case 'granted':
    case 'paywall_seen':
    case 'converted':
      return value;
    default:
      return 'eligible';
  }
};

const sanitizeRecord = (value: Partial<FirstScanRevealRecord> | null | undefined): FirstScanRevealRecord => ({
  firstCompletedScanId: normalizeId(value?.firstCompletedScanId ?? null),
  reveal: {
    state: sanitizeState(value?.reveal?.state),
    scanId: normalizeId(value?.reveal?.scanId ?? null),
    grantedAt: value?.reveal?.grantedAt ?? undefined,
    paywallSeenAt: value?.reveal?.paywallSeenAt ?? undefined,
  },
});

export const useFirstScanReveal = (): FirstScanRevealHook => {
  const { user } = useAuth();
  const storageScopeKey = normalizeId(user?.id) ?? 'guest';
  const [record, setRecord] = useState<FirstScanRevealRecord>(DEFAULT_RECORD);
  const [loading, setLoading] = useState(true);

  const persistRecord = useCallback(
    async (nextRecord: FirstScanRevealRecord) => {
      const normalizedRecord = sanitizeRecord(nextRecord);
      setRecord(normalizedRecord);
      await setFirstScanRevealRecord(normalizedRecord, storageScopeKey);

      const userId = normalizeId(user?.id);
      if (!userId) {
        return;
      }

      const remoteResult = await upsertUserFirstScanReveal(supabase, userId, {
        first_completed_scan_id: normalizedRecord.firstCompletedScanId,
        first_scan_reveal_state: normalizedRecord.reveal.state,
        first_scan_reveal_scan_id: normalizedRecord.reveal.scanId,
        first_scan_reveal_granted_at: normalizedRecord.reveal.grantedAt ?? null,
        first_scan_paywall_seen_at: normalizedRecord.reveal.paywallSeenAt ?? null,
      });

      if (!remoteResult.ok) {
        console.warn('[first-scan-reveal] failed to persist remote state', remoteResult.error);
      }
    },
    [storageScopeKey, user?.id],
  );

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      const localRecord = sanitizeRecord(await getFirstScanRevealRecord(storageScopeKey));
      let nextRecord = localRecord;
      const userId = normalizeId(user?.id);

      if (userId) {
        const remote = await fetchUserFirstScanReveal(supabase, userId);
        if (remote.error) {
          console.warn('[first-scan-reveal] failed to fetch remote state', remote.error);
        } else if (remote.data) {
          nextRecord = sanitizeRecord({
            firstCompletedScanId: remote.data.first_completed_scan_id,
            reveal: {
              state: remote.data.first_scan_reveal_state ?? 'eligible',
              scanId: remote.data.first_scan_reveal_scan_id,
              grantedAt: remote.data.first_scan_reveal_granted_at ?? undefined,
              paywallSeenAt: remote.data.first_scan_paywall_seen_at ?? undefined,
            },
          });
          await setFirstScanRevealRecord(nextRecord, storageScopeKey);
        }
      }

      setRecord(nextRecord);
    } finally {
      setLoading(false);
    }
  }, [storageScopeKey, user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ensureFirstCompletedScanId = useCallback(
    async (scanId: string) => {
      const normalizedScanId = normalizeId(scanId);
      if (!normalizedScanId) return;
      if (record.firstCompletedScanId) return;

      await persistRecord({
        ...record,
        firstCompletedScanId: normalizedScanId,
      });
    },
    [persistRecord, record],
  );

  const grantForScan = useCallback(
    async (scanId: string) => {
      const normalizedScanId = normalizeId(scanId);
      if (!normalizedScanId) return;
      if (record.firstCompletedScanId !== normalizedScanId) return;
      if (record.reveal.state !== 'eligible') return;

      await persistRecord({
        firstCompletedScanId: record.firstCompletedScanId,
        reveal: {
          state: 'granted',
          scanId: normalizedScanId,
          grantedAt: new Date().toISOString(),
          paywallSeenAt: record.reveal.paywallSeenAt,
        },
      });
    },
    [persistRecord, record],
  );

  const markPaywallSeen = useCallback(
    async (scanId: string) => {
      const normalizedScanId = normalizeId(scanId);
      if (!normalizedScanId) return;
      if (record.reveal.scanId !== normalizedScanId) return;
      if (record.reveal.state === 'paywall_seen' || record.reveal.state === 'converted') return;

      await persistRecord({
        firstCompletedScanId: record.firstCompletedScanId,
        reveal: {
          state: 'paywall_seen',
          scanId: normalizedScanId,
          grantedAt: record.reveal.grantedAt,
          paywallSeenAt: new Date().toISOString(),
        },
      });
    },
    [persistRecord, record],
  );

  const markConverted = useCallback(
    async (scanId: string) => {
      const normalizedScanId = normalizeId(scanId);
      if (!normalizedScanId) return;
      if (record.reveal.scanId !== normalizedScanId) return;
      if (record.reveal.state === 'converted') return;

      await persistRecord({
        firstCompletedScanId: record.firstCompletedScanId,
        reveal: {
          state: 'converted',
          scanId: normalizedScanId,
          grantedAt: record.reveal.grantedAt,
          paywallSeenAt: record.reveal.paywallSeenAt ?? new Date().toISOString(),
        },
      });
    },
    [persistRecord, record],
  );

  return useMemo(
    () => ({
      loading,
      firstCompletedScanId: record.firstCompletedScanId,
      reveal: record.reveal,
      ensureFirstCompletedScanId,
      grantForScan,
      markPaywallSeen,
      markConverted,
      refresh,
    }),
    [
      ensureFirstCompletedScanId,
      grantForScan,
      loading,
      markConverted,
      markPaywallSeen,
      record.firstCompletedScanId,
      record.reveal,
      refresh,
    ],
  );
};
