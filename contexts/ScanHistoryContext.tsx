import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { loadScanHistory, saveScanHistory } from '@/lib/storage/scan-history';
import type { ScanHistoryInput, ScanHistoryItem } from '@/types/scan-history';

type ScanHistoryState = {
  loading: boolean;
  scans: ScanHistoryItem[];
  addScan: (input: ScanHistoryInput) => void;
};

const ScanHistoryContext = createContext<ScanHistoryState | undefined>(undefined);

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const getDedupeKey = (item: Pick<ScanHistoryItem, 'barcode' | 'brandName' | 'productName'>) => {
  if (item.barcode) {
    return `barcode:${item.barcode}`;
  }
  return `name:${normalize(item.brandName)}:${normalize(item.productName)}`;
};

const createLocalId = () => `scan_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
const MAX_ITEMS = 20;

export const ScanHistoryProvider = ({ children }: { children: React.ReactNode }) => {
  const [scans, setScans] = useState<ScanHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const hydrate = async () => {
      try {
        const stored = await loadScanHistory();
        if (!isMounted) return;
        setScans(stored);
      } catch (error) {
        console.warn('[scan-history] Failed to hydrate', error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    hydrate();

    return () => {
      isMounted = false;
    };
  }, []);

  const addScan = useCallback((input: ScanHistoryInput) => {
    const scannedAt = input.scannedAt ?? new Date().toISOString();
    const dedupeKey = getDedupeKey({
      barcode: input.barcode ?? null,
      brandName: input.brandName,
      productName: input.productName,
    });

    setScans(prev => {
      const next = [...prev];
      const existingIndex = next.findIndex(item => getDedupeKey(item) === dedupeKey);

      if (existingIndex >= 0) {
        const existing = next.splice(existingIndex, 1)[0];
        next.unshift({
          ...existing,
          ...input,
          scannedAt,
        });
      } else {
        next.unshift({
          id: createLocalId(),
          ...input,
          scannedAt,
        });
      }

      if (next.length > MAX_ITEMS) {
        next.length = MAX_ITEMS;
      }

      saveScanHistory(next).catch(error => {
        console.warn('[scan-history] Failed to persist', error);
      });

      return next;
    });
  }, []);

  const value = useMemo<ScanHistoryState>(
    () => ({
      loading,
      scans,
      addScan,
    }),
    [addScan, loading, scans],
  );

  return <ScanHistoryContext.Provider value={value}>{children}</ScanHistoryContext.Provider>;
};

export const useScanHistory = () => {
  const context = useContext(ScanHistoryContext);
  if (!context) {
    throw new Error('useScanHistory must be used within ScanHistoryProvider');
  }
  return context;
};
