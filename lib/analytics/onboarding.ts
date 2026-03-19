import { emitAnalyticsEvent } from './transport';

export type OnboardingAnalyticsEvent =
  | 'onboarding_started'
  | 'trust_page_viewed'
  | 'question_answered'
  | 'onboarding_completed'
  | 'first_scan_started'
  | 'first_scan_completed'
  | 'permission_prompted'
  | 'permission_granted'
  | 'permission_denied'
  | 'first_filter_used';

export const trackOnboardingEvent = (event: OnboardingAnalyticsEvent, payload: Record<string, unknown> = {}) => {
  emitAnalyticsEvent('onboarding', event, payload);
};
