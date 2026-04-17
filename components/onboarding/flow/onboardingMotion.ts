import { Easing } from 'react-native-reanimated';

export const FLOW_EASE_BEZIER = [0.16, 1, 0.3, 1] as const;
export const FLOW_TRANSITION_DURATION_MS = 420;
export const FLOW_INCOMING_OFFSET_PX = 36;
export const FLOW_OUTGOING_OFFSET_PX = 24;
export const FLOW_INCOMING_SCALE = 0.992;
export const FLOW_OUTGOING_SCALE = 0.996;
export const FLOW_EASING = Easing.bezier(...FLOW_EASE_BEZIER);

export const ONBOARDING_STEP_SLIDE_TIMING = {
  durationMs: FLOW_TRANSITION_DURATION_MS,
  fadeDurationMs: FLOW_TRANSITION_DURATION_MS,
  distancePct: 0.018,
  scaleFrom: 1,
} as const;

export const ONBOARDING_CHROME_PROGRESS_DURATION_MS = FLOW_TRANSITION_DURATION_MS;
export const ONBOARDING_FOOTER_TRANSITION_DURATION_MS = 360;

export const QA_OPTION_REVEAL_DURATION_MS = 380;
export const QA_OPTION_REVEAL_BACK_DURATION_MS = 280;
export const QA_OPTION_REVEAL_STAGGER_MS = 42;
export const QA_OPTION_REVEAL_BACK_STAGGER_MS = 24;
export const QA_OPTION_REVEAL_MAX_DELAY_MS = 180;
export const QA_OPTION_REVEAL_OFFSET_Y = 10;
export const QA_OPTION_REVEAL_SCALE = 0.992;
export const QA_OPTION_SELECTION_DURATION_MS = 260;

export const QA_CTA_STATE_DURATION_MS = 260;
export const QA_CTA_DISABLED_SCALE = 0.992;
export const QA_CTA_ENABLED_LIFT_Y = -1;
