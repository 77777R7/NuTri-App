import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useWaitlistTrialBonus } from '@/hooks/useWaitlistTrialBonus';
import { supabase } from '@/lib/supabase';

type PremiumAccessSource =
  | 'tester_override'
  | 'subscription_sdk'
  | 'session_metadata'
  | 'remote_user_profile'
  | 'waitlist_trial'
  | 'local_trial'
  | 'none';

type PremiumAccessState = {
  isPremium: boolean;
  loading: boolean;
  source: PremiumAccessSource;
  status: string | null;
  refresh: () => Promise<void>;
};

const ACTIVE_PREMIUM_STATUSES = new Set([
  'active',
  'premium',
  'paid',
  'subscriber',
  'subscribed',
  'trialing',
]);

const normalizeStatus = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const readSessionSubscriptionStatus = (sessionUser: ReturnType<typeof useAuth>['user']): string | null => {
  if (!sessionUser) return null;

  const appMetadata = (sessionUser.app_metadata ?? {}) as Record<string, unknown>;
  const userMetadata = (sessionUser.user_metadata ?? {}) as Record<string, unknown>;

  return (
    normalizeStatus(appMetadata.premium_status)
    ?? normalizeStatus(userMetadata.premium_status)
    ?? normalizeStatus(appMetadata.subscription_status)
    ?? normalizeStatus(appMetadata.subscription)
    ?? normalizeStatus(appMetadata.entitlement)
    ?? normalizeStatus(userMetadata.subscription_status)
    ?? normalizeStatus(userMetadata.subscription)
    ?? normalizeStatus(userMetadata.entitlement)
  );
};

const hasPremiumFromStatus = (status: string | null): boolean =>
  status != null && ACTIVE_PREMIUM_STATUSES.has(status);

export const usePremiumAccess = (): PremiumAccessState => {
  const { user, loading: authLoading } = useAuth();
  const { trial, loading: onboardingLoading } = useOnboarding();
  const subscription = useSubscription();
  const {
    active: waitlistTrialActive,
    loading: waitlistTrialLoading,
    refresh: refreshWaitlistTrial,
  } = useWaitlistTrialBonus();
  const [remoteStatus, setRemoteStatus] = useState<string | null>(null);
  const [remoteTrialStatus, setRemoteTrialStatus] = useState<string | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);

  const refresh = useCallback(async () => {
    const userId = user?.id?.trim();
    if (!userId) {
      setRemoteStatus(null);
      setRemoteTrialStatus(null);
      setRemoteLoading(false);
      return;
    }

    setRemoteLoading(true);

    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('premium_status, trial_status')
        .eq('user_id', userId)
        .maybeSingle<{ premium_status: string | null; trial_status: string | null }>();

      if (error) {
        console.warn('[premium-access] failed to fetch user profile entitlement', error);
        setRemoteStatus(null);
        setRemoteTrialStatus(null);
        return;
      }

      setRemoteStatus(normalizeStatus(data?.premium_status ?? null));
      setRemoteTrialStatus(normalizeStatus(data?.trial_status ?? null));
    } catch (error) {
      console.warn('[premium-access] unexpected entitlement fetch error', error);
      setRemoteStatus(null);
      setRemoteTrialStatus(null);
    } finally {
      setRemoteLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<PremiumAccessState>(() => {
    if (subscription.testOverride === 'paid') {
      return {
        isPremium: true,
        loading: authLoading || onboardingLoading || remoteLoading || subscription.loading,
        source: 'tester_override',
        status: 'paid_override',
        refresh,
      };
    }

    if (subscription.testOverride === 'unpaid') {
      return {
        isPremium: false,
        loading: authLoading || onboardingLoading || remoteLoading || subscription.loading,
        source: 'tester_override',
        status: 'unpaid_override',
        refresh,
      };
    }

    if (subscription.isPremium) {
      return {
        isPremium: true,
        loading: authLoading || onboardingLoading || remoteLoading || subscription.loading,
        source: 'subscription_sdk',
        status: subscription.entitlementStatus,
        refresh,
      };
    }

    const sessionStatus = readSessionSubscriptionStatus(user);
    if (hasPremiumFromStatus(sessionStatus)) {
      return {
        isPremium: true,
        loading: authLoading || onboardingLoading || remoteLoading || subscription.loading,
        source: 'session_metadata',
        status: sessionStatus,
        refresh,
      };
    }

    if (hasPremiumFromStatus(remoteStatus)) {
      return {
        isPremium: true,
        loading: authLoading || onboardingLoading || remoteLoading || subscription.loading,
        source: 'remote_user_profile',
        status: remoteStatus,
        refresh,
      };
    }

    if (hasPremiumFromStatus(remoteTrialStatus)) {
      return {
        isPremium: true,
        loading: authLoading || onboardingLoading || remoteLoading || subscription.loading,
        source: 'remote_user_profile',
        status: remoteTrialStatus,
        refresh,
      };
    }

    if (waitlistTrialActive) {
      return {
        isPremium: true,
        loading: authLoading || onboardingLoading || remoteLoading || subscription.loading || waitlistTrialLoading,
        source: 'waitlist_trial',
        status: 'waitlist_trialing',
        refresh: async () => {
          await Promise.all([refresh(), refreshWaitlistTrial()]);
        },
      };
    }

    const localStatus = normalizeStatus(trial.status);
    if (hasPremiumFromStatus(localStatus)) {
      return {
        isPremium: true,
        loading: authLoading || onboardingLoading || remoteLoading || subscription.loading,
        source: 'local_trial',
        status: localStatus,
        refresh,
      };
    }

    return {
      isPremium: false,
      loading: authLoading || onboardingLoading || remoteLoading || subscription.loading || waitlistTrialLoading,
      source: 'none',
      status: subscription.entitlementStatus ?? remoteStatus ?? remoteTrialStatus ?? sessionStatus ?? localStatus,
      refresh: async () => {
        await Promise.all([refresh(), refreshWaitlistTrial()]);
      },
    };
  }, [
    authLoading,
    onboardingLoading,
    refresh,
    remoteLoading,
    remoteStatus,
    remoteTrialStatus,
    subscription.entitlementStatus,
    subscription.isPremium,
    subscription.loading,
    subscription.testOverride,
    trial.status,
    user,
    waitlistTrialActive,
    waitlistTrialLoading,
    refreshWaitlistTrial,
  ]);

  return value;
};
