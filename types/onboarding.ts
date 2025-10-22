export type ProfileDraft = {
  height?: number;
  weight?: number;
  age?: number;
  gender?: string;
  diets?: string[];
  activity?: string;
  location?: {
    country?: string;
    city?: string;
  };
  goals?: string[];
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
  saveDraft: (draft: Partial<ProfileDraft>, nextProgress?: number) => Promise<void>;
  setProgress: (progress: number) => Promise<void>;
  setTrial: (trial: TrialState) => Promise<void>;
  markCompletedLocal: () => Promise<void>;
  clearDraft: () => Promise<void>;
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
