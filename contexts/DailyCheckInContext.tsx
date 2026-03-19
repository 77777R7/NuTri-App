import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { validateCheckInDateForItem } from '@/lib/check-in-eligibility';
import { buildSupplementCheckInKey } from '@/lib/check-ins';
import { supabase } from '@/lib/supabase';
import type { RoutinePreferences } from '@/types/saved-supplements';
import {
  loadDailyCheckIns,
  saveDailyCheckIns,
  type DailyCheckInsByDate,
} from '@/lib/storage/daily-check-ins';

type CheckInEntryMeta = {
  createdAt?: string | null;
  syncedToCheckIn?: boolean;
  routine?: RoutinePreferences | null;
};

type DailyCheckInState = {
  loading: boolean;
  checkInsByDate: DailyCheckInsByDate;
  isChecked: (dateKey: string, checkInKey: string) => boolean;
  toggleCheckIn: (
    dateKey: string,
    checkInKey: string,
    supplementId?: string | null,
    meta?: CheckInEntryMeta,
  ) => Promise<void>;
  addCheckIns: (
    dateKey: string,
    entries: {
      key: string;
      supplementId?: string | null;
      createdAt?: string | null;
      syncedToCheckIn?: boolean;
      routine?: RoutinePreferences | null;
    }[],
  ) => Promise<void>;
  refreshFromRemote: () => Promise<void>;
};

const DailyCheckInContext = createContext<DailyCheckInState | undefined>(undefined);

const mergeCheckIns = (current: DailyCheckInsByDate, incoming: DailyCheckInsByDate) => {
  const merged: DailyCheckInsByDate = { ...current };

  Object.entries(incoming).forEach(([dateKey, keys]) => {
    const existing = new Set(merged[dateKey] ?? []);
    keys.forEach(key => existing.add(key));
    merged[dateKey] = Array.from(existing);
  });

  return merged;
};

export const DailyCheckInProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [checkInsByDate, setCheckInsByDate] = useState<DailyCheckInsByDate>({});
  const [loading, setLoading] = useState(true);

  const persist = useCallback((next: DailyCheckInsByDate) => {
    setCheckInsByDate(next);
    saveDailyCheckIns(next).catch(error => {
      console.warn('[daily-check-ins] Failed to persist', error);
    });
  }, []);

  useEffect(() => {
    let isMounted = true;

    const hydrate = async () => {
      try {
        const stored = await loadDailyCheckIns();
        if (!isMounted) return;
        setCheckInsByDate(stored);
      } catch (error) {
        console.warn('[daily-check-ins] Failed to hydrate', error);
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

  const refreshFromRemote = useCallback(async () => {
    if (!user?.id) return;

    const { data, error } = await supabase
      .from('user_checkins')
      .select('supplement_id, check_in_date')
      .eq('user_id', user.id);

    if (error) {
      console.warn('[daily-check-ins] Remote fetch failed', error);
      return;
    }

    const remote: DailyCheckInsByDate = {};
    (data ?? []).forEach(row => {
      if (!row.supplement_id || !row.check_in_date) return;
      const dateKey = row.check_in_date;
      const key = buildSupplementCheckInKey(row.supplement_id);
      if (!remote[dateKey]) {
        remote[dateKey] = [];
      }
      remote[dateKey].push(key);
    });

    if (Object.keys(remote).length === 0) return;

    setCheckInsByDate(prev => {
      const merged = mergeCheckIns(prev, remote);
      saveDailyCheckIns(merged).catch(error => {
        console.warn('[daily-check-ins] Failed to persist', error);
      });
      return merged;
    });
  }, [user?.id]);

  useEffect(() => {
    if (loading || !user?.id) return;
    refreshFromRemote().catch(() => undefined);
  }, [loading, refreshFromRemote, user?.id]);

  const isEntryEligible = useCallback((dateKey: string, meta?: CheckInEntryMeta) => {
    if (!meta) {
      return validateCheckInDateForItem({ createdAt: new Date().toISOString(), syncedToCheckIn: true }, dateKey).isValid;
    }

    const hasEligibilitySignals =
      typeof meta.syncedToCheckIn === 'boolean' || typeof meta.createdAt === 'string';

    if (!hasEligibilitySignals) {
      return validateCheckInDateForItem({ createdAt: new Date().toISOString(), syncedToCheckIn: true }, dateKey).isValid;
    }

    return validateCheckInDateForItem(
      {
        createdAt: meta.createdAt ?? null,
        syncedToCheckIn: meta.syncedToCheckIn ?? true,
        routine: meta.routine ?? undefined,
      },
      dateKey,
    ).isValid;
  }, []);

  const toggleCheckIn = useCallback(
    async (dateKey: string, checkInKey: string, supplementId?: string | null, meta?: CheckInEntryMeta) => {
      if (!isEntryEligible(dateKey, meta)) return;
      const existing = new Set(checkInsByDate[dateKey] ?? []);
      const isChecked = existing.has(checkInKey);

      if (isChecked) {
        existing.delete(checkInKey);
      } else {
        existing.add(checkInKey);
      }

      const next: DailyCheckInsByDate = { ...checkInsByDate };
      if (existing.size > 0) {
        next[dateKey] = Array.from(existing);
      } else {
        delete next[dateKey];
      }

      persist(next);

      if (!user?.id || !supplementId) return;

      try {
        if (isChecked) {
          const { error } = await supabase
            .from('user_checkins')
            .delete()
            .match({ user_id: user.id, supplement_id: supplementId, check_in_date: dateKey });
          if (error) {
            console.warn('[daily-check-ins] Remote delete failed', error);
          }
        } else {
          const { error } = await supabase
            .from('user_checkins')
            .upsert(
              { user_id: user.id, supplement_id: supplementId, check_in_date: dateKey },
              { onConflict: 'user_id,supplement_id,check_in_date' },
            );
          if (error) {
            console.warn('[daily-check-ins] Remote upsert failed', error);
          }
        }
      } catch (error) {
        console.warn('[daily-check-ins] Remote sync failed', error);
      }
    },
    [checkInsByDate, isEntryEligible, persist, user?.id],
  );

  const addCheckIns = useCallback(
    async (
      dateKey: string,
      entries: {
        key: string;
        supplementId?: string | null;
        createdAt?: string | null;
        syncedToCheckIn?: boolean;
        routine?: RoutinePreferences | null;
      }[],
    ) => {
      if (!entries.length) return;
      const existing = new Set(checkInsByDate[dateKey] ?? []);
      const nextEntries = entries.filter(entry => !existing.has(entry.key) && isEntryEligible(dateKey, entry));
      if (!nextEntries.length) return;

      nextEntries.forEach(entry => existing.add(entry.key));

      const next: DailyCheckInsByDate = { ...checkInsByDate };
      next[dateKey] = Array.from(existing);
      persist(next);

      if (!user?.id) return;

      const payload = nextEntries
        .filter((entry): entry is { key: string; supplementId: string } => typeof entry.supplementId === 'string' && entry.supplementId.length > 0)
        .map((entry) => ({
          user_id: user.id,
          supplement_id: entry.supplementId,
          check_in_date: dateKey,
        }));

      if (payload.length === 0) return;

      try {
        const { error } = await supabase
          .from('user_checkins')
          .upsert(payload, { onConflict: 'user_id,supplement_id,check_in_date' });
        if (error) {
          console.warn('[daily-check-ins] Remote batch upsert failed', error);
        }
      } catch (error) {
        console.warn('[daily-check-ins] Remote batch sync failed', error);
      }
    },
    [checkInsByDate, isEntryEligible, persist, user?.id],
  );

  const isChecked = useCallback(
    (dateKey: string, checkInKey: string) => (checkInsByDate[dateKey] ?? []).includes(checkInKey),
    [checkInsByDate],
  );

  const value = useMemo<DailyCheckInState>(
    () => ({
      loading,
      checkInsByDate,
      isChecked,
      toggleCheckIn,
      addCheckIns,
      refreshFromRemote,
    }),
    [addCheckIns, checkInsByDate, isChecked, loading, refreshFromRemote, toggleCheckIn],
  );

  return <DailyCheckInContext.Provider value={value}>{children}</DailyCheckInContext.Provider>;
};

export const useDailyCheckIns = () => {
  const context = useContext(DailyCheckInContext);
  if (!context) {
    throw new Error('useDailyCheckIns must be used within DailyCheckInProvider');
  }
  return context;
};
