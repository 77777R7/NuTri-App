import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  NUTRI_ACTIVATION_DEFINITION,
  trackOnboardingEvent,
  type OnboardingAnalyticsEvent,
} from './onboarding';

const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = 'nu.analytics:onboarding-return:';

type ReturnMilestone = {
  event: Extract<OnboardingAnalyticsEvent, 'd1_return' | 'd7_return'>;
  minElapsedDays: number;
};

export const ONBOARDING_RETURN_MILESTONES: readonly ReturnMilestone[] = [
  { event: 'd1_return', minElapsedDays: 1 },
  { event: 'd7_return', minElapsedDays: 7 },
] as const;

const parseTime = (value: string | Date | number) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
};

export const trackOnboardingReturnMilestones = async ({
  onboardingCompletedAt,
  now = Date.now(),
  source = 'home_tab',
}: {
  onboardingCompletedAt: string | Date | number;
  now?: string | Date | number;
  source?: string;
}) => {
  const completedAtMs = parseTime(onboardingCompletedAt);
  const nowMs = parseTime(now);
  if (!Number.isFinite(completedAtMs) || !Number.isFinite(nowMs) || nowMs <= completedAtMs) {
    return;
  }

  const elapsedDays = Math.floor((nowMs - completedAtMs) / DAY_MS);
  await Promise.all(
    ONBOARDING_RETURN_MILESTONES.map(async (milestone) => {
      if (elapsedDays < milestone.minElapsedDays) return;

      const key = `${STORAGE_PREFIX}${milestone.event}`;
      const alreadyTracked = await AsyncStorage.getItem(key);
      if (alreadyTracked === 'true') return;

      trackOnboardingEvent(milestone.event, {
        activationDefinition: NUTRI_ACTIVATION_DEFINITION.id,
        elapsedDays,
        source,
      });
      await AsyncStorage.setItem(key, 'true');
    }),
  );
};
