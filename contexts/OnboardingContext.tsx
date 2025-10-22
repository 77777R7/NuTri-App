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

import { getDraft, getFlags, getProgress, saveDraft as persistDraft, setFlags, setProgress as persistProgress } from '@/lib/storage/onboarding';
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
  const [loading, setLoading] = useState(true);
  const [progress, setProgressState] = useState(1);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [trial, setTrialState] = useState<TrialState>(DEFAULT_TRIAL_STATE);
  const [onbCompleted, setOnbCompleted] = useState(false);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | undefined>(undefined);
  const [serverSyncedAt, setServerSyncedAtState] = useState<string | undefined>(undefined);
  const draftUpdatedAtRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let isMounted = true;
    console.log('🧠 OnboardingProvider mounted');

    const hydrate = async () => {
      try {
        const [draftPayload, storedProgress, flags] = await Promise.all([getDraft(), getProgress(), getFlags()]);

        if (!isMounted) return;

        draftUpdatedAtRef.current = flags.draftUpdatedAt ?? draftPayload.updatedAt;
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

  const setProgress = useCallback(async (value: number) => {
    const sanitized = Math.max(1, Math.min(value, 7));
    setProgressState(sanitized);
    await persistProgress(sanitized);
  }, []);

  const saveDraft = useCallback(
    async (updates: Partial<ProfileDraft>, nextProgress?: number) => {
      let computedDraft: ProfileDraft | null = null;

      setDraft(current => {
        computedDraft = mergeProfileDraft(current, updates);
        return computedDraft;
      });

      const timestamp = new Date().toISOString();
      const nextUpdatedAt = computedDraft ? timestamp : undefined;
      draftUpdatedAtRef.current = nextUpdatedAt;
      setDraftUpdatedAt(nextUpdatedAt);

      await persistDraft(computedDraft, timestamp);
      await setFlags({ draftUpdatedAt: nextUpdatedAt ?? '' });

      if (typeof nextProgress === 'number') {
        await setProgress(nextProgress);
      }
    },
    [setProgress],
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
    setDraft(null);
    draftUpdatedAtRef.current = undefined;
    setDraftUpdatedAt(undefined);
    await persistDraft(null, new Date().toISOString());
    await setFlags({ draftUpdatedAt: '' });
  }, []);

  const setServerSyncedAt = useCallback(async (iso: string) => {
    setServerSyncedAtState(iso);
    await setFlags({ serverSyncedAt: iso });
  }, []);

  const value = useMemo<OnboardingState>(
    () => ({
      loading,
      progress,
      draft,
      draftUpdatedAt,
      onbCompleted,
      serverSyncedAt,
      trial,
      saveDraft,
      setProgress,
      setTrial,
      markCompletedLocal,
      clearDraft,
      setServerSyncedAt,
    }),
    [clearDraft, draft, draftUpdatedAt, loading, markCompletedLocal, onbCompleted, progress, saveDraft, serverSyncedAt, setProgress, setServerSyncedAt, setTrial, trial],
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
