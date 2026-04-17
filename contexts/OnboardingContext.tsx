import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { clearFirstScanRevealRecord } from '@/lib/storage/firstScanReveal';
import {
  getDraft,
  getFlags,
  getProgress,
  resetOnboardingStorage,
  saveDraft as persistDraft,
  setFlags,
  setProgress as persistProgress,
} from '@/lib/storage/onboarding';
import { supabase } from '@/lib/supabase';
import { upsertUserFirstScanReveal, upsertUserProfile } from '@/lib/supabase/profile';
import { ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding-v2';
import type { OnboardingState, ProfileDraft, TrialState } from '@/types/onboarding';

const DEFAULT_TRIAL_STATE: TrialState = { status: 'not_started' };

const OnboardingContext = createContext<OnboardingState | undefined>(undefined);

type OnboardingProviderProps = {
  children: ReactNode;
};

const mergeProfileDraft = (current: ProfileDraft | null, updates: Partial<ProfileDraft>): ProfileDraft | null => {
  const next: ProfileDraft = { ...(current ?? {}) };

  (Object.keys(updates) as (keyof ProfileDraft)[]).forEach(key => {
    const incoming = updates[key];

    if (incoming === undefined) {
      delete next[key];
      return;
    }

    if (key === 'location') {
      next.location = { ...(current?.location ?? {}) };
      const locationUpdates = incoming as ProfileDraft['location'];
      if (!locationUpdates) {
        delete next.location;
      } else {
        Object.entries(locationUpdates).forEach(([locationKey, locationValue]) => {
          if (locationValue === undefined) {
            if (next.location) {
              delete next.location[locationKey as 'country' | 'city'];
            }
          } else {
            if (!next.location) {
              next.location = {};
            }
            next.location[locationKey as 'country' | 'city'] = locationValue;
          }
        });
        if (next.location && Object.keys(next.location).length === 0) {
          delete next.location;
        }
      }
      return;
    }

    (next as Record<keyof ProfileDraft, ProfileDraft[keyof ProfileDraft]>)[key] = incoming as ProfileDraft[keyof ProfileDraft];
  });

  return Object.keys(next).length > 0 ? next : null;
};

export const OnboardingProvider = ({ children }: OnboardingProviderProps) => {
  const { loading: authLoading, session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [progress, setProgressState] = useState(1);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [trial, setTrialState] = useState<TrialState>(DEFAULT_TRIAL_STATE);
  const [onbCompleted, setOnbCompleted] = useState(false);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | undefined>(undefined);
  const [serverSyncedAt, setServerSyncedAtState] = useState<string | undefined>(undefined);
  const draftRef = useRef<ProfileDraft | null>(null);
  const progressRef = useRef(1);
  const draftUpdatedAtRef = useRef<string | undefined>(undefined);
  const flushQueueRef = useRef<Promise<void>>(Promise.resolve());
  const syncInFlightRef = useRef(false);
  const syncRequestedDraftAtRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let isMounted = true;
    console.log('🧠 OnboardingProvider mounted');

    const hydrate = async () => {
      try {
        const [draftPayload, storedProgress, flags] = await Promise.all([getDraft(), getProgress(), getFlags()]);

        if (!isMounted) return;

        draftUpdatedAtRef.current = flags.draftUpdatedAt ?? draftPayload.updatedAt;
        draftRef.current = draftPayload.draft;
        progressRef.current = storedProgress;
        setDraftUpdatedAt(draftUpdatedAtRef.current);
        setDraft(draftPayload.draft);
        setProgressState(storedProgress);
        setOnbCompleted(Boolean(flags.onbCompleted));
        setTrialState({
          status: flags.trialStatus,
          startedAt: flags.trialStartedAt,
        });
        setServerSyncedAtState(flags.serverSyncedAt);
      } catch (error) {
        console.warn('Failed to hydrate onboarding context', error);
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

  const commitProgress = useCallback((value: number) => {
    const sanitized = Math.max(1, Math.min(value, ONBOARDING_TOTAL_STEPS));
    progressRef.current = sanitized;
    setProgressState(sanitized);
  }, []);

  const flushDraft = useCallback(async () => {
    const snapshot = {
      draft: draftRef.current,
      draftUpdatedAt: draftUpdatedAtRef.current,
      progress: progressRef.current,
    };

    const persistSnapshot = async () => {
      await persistDraft(snapshot.draft, snapshot.draftUpdatedAt ?? new Date().toISOString());
      await setFlags({ draftUpdatedAt: snapshot.draftUpdatedAt ?? '' });
      await persistProgress(snapshot.progress);
    };

    const queued = flushQueueRef.current.catch(() => undefined).then(persistSnapshot);
    flushQueueRef.current = queued;
    await queued;
  }, []);

  const setProgress = useCallback(async (value: number) => {
    commitProgress(value);
    await flushDraft();
  }, [commitProgress, flushDraft]);

  const commitDraft = useCallback(
    (updates: Partial<ProfileDraft>, nextProgress?: number) => {
      const nextDraft = mergeProfileDraft(draftRef.current, updates);
      draftRef.current = nextDraft;
      setDraft(nextDraft);

      const timestamp = nextDraft ? new Date().toISOString() : undefined;
      draftUpdatedAtRef.current = timestamp;
      setDraftUpdatedAt(timestamp);

      if (typeof nextProgress === 'number') {
        commitProgress(nextProgress);
      }
    },
    [commitProgress],
  );

  const saveDraft = useCallback(
    async (updates: Partial<ProfileDraft>, nextProgress?: number) => {
      commitDraft(updates, nextProgress);
      await flushDraft();
    },
    [commitDraft, flushDraft],
  );

  const setTrial = useCallback(async (nextTrial: TrialState) => {
    setTrialState(nextTrial);
    await setFlags({
      trialStatus: nextTrial.status,
      trialStartedAt: nextTrial.startedAt ?? '',
    });
  }, []);

  const markCompletedLocal = useCallback(async () => {
    setOnbCompleted(true);
    await setFlags({ onbCompleted: true });
  }, []);

  const clearDraft = useCallback(async () => {
    draftRef.current = null;
    setDraft(null);
    draftUpdatedAtRef.current = undefined;
    setDraftUpdatedAt(undefined);
    await persistDraft(null, new Date().toISOString());
    await setFlags({ draftUpdatedAt: '' });
  }, []);

  const resetLocalOnboarding = useCallback(async () => {
    const userId = session?.user?.id?.trim() ?? null;
    draftRef.current = null;
    progressRef.current = 1;
    setDraft(null);
    setProgressState(1);
    setOnbCompleted(false);
    setTrialState(DEFAULT_TRIAL_STATE);
    draftUpdatedAtRef.current = undefined;
    setDraftUpdatedAt(undefined);
    setServerSyncedAtState(undefined);
    await resetOnboardingStorage();
    await clearFirstScanRevealRecord(userId ?? 'guest');
    if (userId) {
      const resetRevealResult = await upsertUserFirstScanReveal(supabase, userId, {
        first_completed_scan_id: null,
        first_scan_reveal_state: 'eligible',
        first_scan_reveal_scan_id: null,
        first_scan_reveal_granted_at: null,
        first_scan_paywall_seen_at: null,
      });
      if (!resetRevealResult.ok) {
        console.warn('[onboarding] failed to reset first scan reveal state', resetRevealResult.error);
      }
    }
  }, [session?.user?.id]);

  const setServerSyncedAt = useCallback(async (iso: string) => {
    setServerSyncedAtState(iso);
    await setFlags({ serverSyncedAt: iso });
  }, []);

  useEffect(() => {
    if (loading || authLoading) return;
    if (!onbCompleted || !draftRef.current) return;

    const userId = session?.user?.id;
    const draftUpdatedAt = draftUpdatedAtRef.current;

    if (!userId || !draftUpdatedAt) return;
    if (serverSyncedAt && serverSyncedAt >= draftUpdatedAt) return;
    if (syncInFlightRef.current && syncRequestedDraftAtRef.current === draftUpdatedAt) return;

    syncInFlightRef.current = true;
    syncRequestedDraftAtRef.current = draftUpdatedAt;

    void upsertUserProfile(supabase, userId, draftRef.current, trial)
      .then(async result => {
        if (!result.ok) return;
        await setServerSyncedAt(draftUpdatedAt);
      })
      .catch(error => {
        console.warn('[onboarding] failed to sync user profile', error);
      })
      .finally(() => {
        syncInFlightRef.current = false;
      });
  }, [authLoading, loading, onbCompleted, serverSyncedAt, session?.user?.id, setServerSyncedAt, trial]);

  const value = useMemo<OnboardingState>(
    () => ({
      loading,
      progress,
      draft,
      draftUpdatedAt,
      onbCompleted,
      serverSyncedAt,
      trial,
      commitDraft,
      commitProgress,
      flushDraft,
      saveDraft,
      setProgress,
      setTrial,
      markCompletedLocal,
      clearDraft,
      resetLocalOnboarding,
      setServerSyncedAt,
    }),
    [
      clearDraft,
      commitDraft,
      commitProgress,
      draft,
      draftUpdatedAt,
      flushDraft,
      loading,
      markCompletedLocal,
      onbCompleted,
      progress,
      resetLocalOnboarding,
      saveDraft,
      serverSyncedAt,
      setProgress,
      setServerSyncedAt,
      setTrial,
      trial,
    ],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
};

export const useOnboarding = () => {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
};
