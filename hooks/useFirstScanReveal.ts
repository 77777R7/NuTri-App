import { useCallback, useMemo } from 'react';

type FirstScanRevealState = 'eligible' | 'granted' | 'paywall_seen' | 'converted';

type FirstScanRevealSnapshot = {
  state: FirstScanRevealState;
  scanId: string | null;
  grantedAt?: string;
  paywallSeenAt?: string;
};

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

const DEFAULT_REVEAL: FirstScanRevealSnapshot = {
  state: 'eligible',
  scanId: null,
};

export const useFirstScanReveal = (): FirstScanRevealHook => {
  const noop = useCallback(async () => {}, []);

  return useMemo(
    () => ({
      loading: false,
      firstCompletedScanId: null,
      reveal: DEFAULT_REVEAL,
      ensureFirstCompletedScanId: noop,
      grantForScan: noop,
      markPaywallSeen: noop,
      markConverted: noop,
      refresh: noop,
    }),
    [noop],
  );
};
