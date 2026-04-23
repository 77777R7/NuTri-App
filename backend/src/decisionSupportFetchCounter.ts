export type DecisionSupportFetchCounter = {
  record(scanSessionId: string | null, barcodeGtin14: string): number | null;
  prune(now: number): void;
};

export const createDecisionSupportFetchCounter = (params?: {
  windowMs?: number;
  now?: () => number;
  onRefetch?: () => void;
}): DecisionSupportFetchCounter => {
  const windowMs = Math.max(1, Number(params?.windowMs ?? 10 * 60 * 1000));
  const now = params?.now ?? (() => Date.now());
  const countsByScanSession = new Map<string, { count: number; lastSeenAt: number }>();

  const prune = (currentTime: number): void => {
    for (const [key, value] of countsByScanSession.entries()) {
      if (currentTime - value.lastSeenAt > windowMs) {
        countsByScanSession.delete(key);
      }
    }
  };

  return {
    prune,
    record(scanSessionId: string | null, barcodeGtin14: string): number | null {
      const normalizedScanSessionId = String(scanSessionId ?? "").trim();
      if (!normalizedScanSessionId) return null;
      const currentTime = now();
      prune(currentTime);
      const key = `${normalizedScanSessionId}:${barcodeGtin14}`;
      const current = countsByScanSession.get(key);
      const count = (current?.count ?? 0) + 1;
      countsByScanSession.set(key, {
        count,
        lastSeenAt: currentTime,
      });
      if (count > 1) {
        params?.onRefetch?.();
      }
      return count;
    },
  };
};

