import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  buildWaitlistTrialSummary,
  computeWaitlistBonusDays,
  computeWaitlistTotalTrialDays,
  isWaitlistTrialActive,
  type WaitlistTrialBonus,
} from '@/lib/pro/waitlistTrialBonus';

type WaitlistTrialBonusState = {
  loading: boolean;
  activating: boolean;
  bonus: WaitlistTrialBonus | null;
  active: boolean;
  summary: string | null;
  refresh: () => Promise<void>;
  activate: () => Promise<WaitlistTrialBonus | null>;
};

type WaitlistTrialBonusRpcRow = {
  email: string | null;
  referral_code: string | null;
  referred_count: number | null;
  starting_trial_days: number | null;
  bonus_days: number | null;
  total_trial_days: number | null;
  trial_status: string | null;
  trial_started_at: string | null;
  trial_expires_at: string | null;
};

const normalizeStatus = (value: string | null | undefined): WaitlistTrialBonus['status'] => {
  if (value === 'active' || value === 'expired') return value;
  return 'eligible';
};

const mapRowToBonus = (row: WaitlistTrialBonusRpcRow | null | undefined): WaitlistTrialBonus | null => {
  if (!row?.email) return null;

  const referredCount = Math.max(0, Number(row.referred_count ?? 0));
  const bonusDays = typeof row.bonus_days === 'number' && Number.isFinite(row.bonus_days)
    ? Number(row.bonus_days)
    : computeWaitlistBonusDays(referredCount);
  const totalTrialDays = typeof row.total_trial_days === 'number' && Number.isFinite(row.total_trial_days)
    ? Number(row.total_trial_days)
    : computeWaitlistTotalTrialDays(referredCount);

  return {
    email: row.email,
    referralCode: row.referral_code ?? null,
    referredCount,
    startingTrialDays: typeof row.starting_trial_days === 'number' && Number.isFinite(row.starting_trial_days)
      ? Number(row.starting_trial_days)
      : 3,
    bonusDays,
    totalTrialDays,
    status: normalizeStatus(row.trial_status),
    trialStartedAt: row.trial_started_at ?? null,
    trialExpiresAt: row.trial_expires_at ?? null,
  };
};

export const useWaitlistTrialBonus = (): WaitlistTrialBonusState => {
  const { user, loading: authLoading } = useAuth();
  const email = user?.email?.trim().toLowerCase() ?? null;
  const [bonus, setBonus] = useState<WaitlistTrialBonus | null>(null);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState(false);

  const refresh = useCallback(async () => {
    if (!email) {
      setBonus(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await (supabase.rpc as any)('get_waitlist_trial_bonus_preview');
      if (error) {
        console.warn('[waitlist-trial] failed to fetch waitlist trial preview', error);
        setBonus(null);
        return;
      }

      const row = Array.isArray(data) ? data[0] : data;
      setBonus(mapRowToBonus(row as WaitlistTrialBonusRpcRow | null));
    } catch (error) {
      console.warn('[waitlist-trial] unexpected waitlist trial preview error', error);
      setBonus(null);
    } finally {
      setLoading(false);
    }
  }, [email]);

  const activate = useCallback(async () => {
    if (!email) {
      setBonus(null);
      return null;
    }

    setActivating(true);

    try {
      const { data, error } = await (supabase.rpc as any)('activate_waitlist_trial_bonus');
      if (error) {
        console.warn('[waitlist-trial] failed to activate waitlist trial bonus', error);
        return null;
      }

      const row = Array.isArray(data) ? data[0] : data;
      const nextBonus = mapRowToBonus(row as WaitlistTrialBonusRpcRow | null);
      setBonus(nextBonus);
      return nextBonus;
    } catch (error) {
      console.warn('[waitlist-trial] unexpected waitlist trial activation error', error);
      return null;
    } finally {
      setActivating(false);
    }
  }, [email]);

  useEffect(() => {
    if (authLoading) return;
    void refresh();
  }, [authLoading, refresh]);

  const active = useMemo(
    () => bonus?.status === 'active' && isWaitlistTrialActive(bonus.trialExpiresAt),
    [bonus],
  );

  const summary = useMemo(() => (bonus ? buildWaitlistTrialSummary(bonus) : null), [bonus]);

  return {
    loading: authLoading || loading,
    activating,
    bonus,
    active,
    summary,
    refresh,
    activate,
  };
};
