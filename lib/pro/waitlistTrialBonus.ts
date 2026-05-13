export const WAITLIST_BASE_TRIAL_DAYS = 3;
export const WAITLIST_REFERRAL_CAMPAIGN = 'trial_bonus_invite';

export type WaitlistTrialBonus = {
  email: string;
  referralCode: string | null;
  referredCount: number;
  startingTrialDays: number;
  bonusDays: number;
  totalTrialDays: number;
  status: 'eligible' | 'active' | 'expired';
  trialStartedAt: string | null;
  trialExpiresAt: string | null;
};

export const computeWaitlistBonusDays = (referredCount: number): number => {
  if (!Number.isFinite(referredCount) || referredCount <= 0) return 0;
  if (referredCount >= 3) return 4;
  if (referredCount === 2) return 2;
  return 1;
};

export const computeWaitlistTotalTrialDays = (referredCount: number): number =>
  WAITLIST_BASE_TRIAL_DAYS + computeWaitlistBonusDays(referredCount);

export const isWaitlistTrialActive = (trialExpiresAt: string | null, now = new Date()): boolean => {
  if (!trialExpiresAt) return false;
  const expiresAt = new Date(trialExpiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now.getTime();
};

export const buildWaitlistTrialSummary = (bonus: Pick<WaitlistTrialBonus, 'bonusDays' | 'totalTrialDays'>) => {
  if (bonus.bonusDays > 0) {
    return `3-day trial + ${bonus.bonusDays} waitlist bonus ${bonus.bonusDays === 1 ? 'day' : 'days'}`;
  }

  return `${bonus.totalTrialDays}-day starting trial`;
};
