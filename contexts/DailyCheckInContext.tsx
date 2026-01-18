import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { buildSupplementCheckInKey } from '@/lib/check-ins';
import { supabase } from '@/lib/supabase';
import {
  loadDailyCheckIns,
  saveDailyCheckIns,
  type DailyCheckInsByDate,
} from '@/lib/storage/daily-check-ins';

type DailyCheckInState = {
  loading: boolean;
  checkInsByDate: DailyCheckInsByDate;
  isChecked: (dateKey: string, checkInKey: string) => boolean;
  toggleCheckIn: (dateKey: string, checkInKey: string, supplementId?: string | null) => Promise<void>;
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

  const toggleCheckIn = useCallback(
    async (dateKey: string, checkInKey: string, supplementId?: string | null) => {
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
    [checkInsByDate, persist, user?.id],
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
      refreshFromRemote,
    }),
    [checkInsByDate, isChecked, loading, refreshFromRemote, toggleCheckIn],
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
