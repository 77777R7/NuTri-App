import type { AllergyFlag, IngredientRestriction } from '@/lib/onboarding-v2';

export type ProfileDraft = {
  age?: number;
  gender?: string;
  ageRange?: string;
  sex?: string;
  supplementExperience?: string;
  diets?: string[];
  activity?: string;
  preferredTypes?: string[];
  adherenceBlocker?: string;
  allergyFlags?: AllergyFlag[];
  ingredientRestrictions?: IngredientRestriction[];
  noKnownAllergies?: boolean;
  avoidItems?: string[];
  setupPreferences?: string[];
  location?: {
    country?: string;
    city?: string;
  };
  goals?: string[];
  smartFilterConfig?: {
    visibleGoals?: string[];
    preselectedTypes?: string[];
    preselectedTiming?: string[];
  };
  firstActionPreference?: 'scan' | 'manual' | 'later';
  onboardingVersion?: 'v2';
  onboardingCompletedAt?: string;
  permissionPreferences?: {
    camera?: boolean;
    notifications?: boolean;
    photos?: boolean;
  };
  privacy?: {
    agreed: boolean;
    camera?: boolean;
    notifications?: boolean;
    photos?: boolean;
  };
};

export type TrialStatus = 'not_started' | 'active' | 'skipped' | 'expired';

export type TrialState = {
  status: TrialStatus;
  startedAt?: string;
};

export type OnboardingState = {
  loading: boolean;
  progress: number;
  draft: ProfileDraft | null;
  draftUpdatedAt?: string;
  onbCompleted: boolean;
  serverSyncedAt?: string;
  trial: TrialState;
  commitDraft: (draft: Partial<ProfileDraft>, nextProgress?: number) => void;
  commitProgress: (progress: number) => void;
  flushDraft: () => Promise<void>;
  saveDraft: (draft: Partial<ProfileDraft>, nextProgress?: number) => Promise<void>;
  setProgress: (progress: number) => Promise<void>;
  setTrial: (trial: TrialState) => Promise<void>;
  markCompletedLocal: () => Promise<void>;
  clearDraft: () => Promise<void>;
  resetLocalOnboarding: () => Promise<void>;
  setServerSyncedAt: (iso: string) => Promise<void>;
};

export type OnboardingFlags = {
  onbCompleted: boolean;
  draftUpdatedAt?: string;
  trialStatus: TrialStatus;
  trialStartedAt?: string;
  serverSyncedAt?: string;
  version?: number;
};
