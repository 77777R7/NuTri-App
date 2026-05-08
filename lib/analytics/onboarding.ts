import { emitAnalyticsEvent } from './transport';

export const NUTRI_ACTIVATION_DEFINITION = {
  id: 'first_scan_result_plus_follow_up_v1',
  description: 'Activated after the first scan result arrives and the user completes one follow-up action.',
  resultEvent: 'result_ready',
  followUpEvents: ['saved_to_stack', 'check_in_started'],
} as const;

export type OnboardingAnalyticsEvent =
  | 'onboarding_started'
  | 'trust_page_viewed'
  | 'question_answered'
  | 'goals_completed'
  | 'allergy_completed'
  | 'allergy_skipped'
  | 'onboarding_completed'
  | 'first_scan_started'
  | 'first_scan_completed'
  | 'result_ready'
  | 'coach_dismissed'
  | 'saved_to_stack'
  | 'check_in_started'
  | 'd1_return'
  | 'd7_return'
  | 'permission_prompted'
  | 'permission_granted'
  | 'permission_denied'
  | 'first_filter_used'
  | 'guest_scan_started'
  | 'guest_scan_barcode_captured'
  | 'guest_scan_result_started'
  | 'guest_scan_result_ready'
  | 'guest_scan_high_intent_claim_tapped'
  | 'guest_scan_auth_started'
  | 'guest_scan_claim_succeeded'
  | 'guest_scan_claim_failed';

export const trackOnboardingEvent = (event: OnboardingAnalyticsEvent, payload: Record<string, unknown> = {}) => {
  emitAnalyticsEvent('onboarding', event, payload);
};
