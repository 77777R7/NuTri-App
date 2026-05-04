import {
  QA_PROGRESS_FILL_WIDTH,
  QA_PROGRESS_TRACK_WIDTH,
} from '@/components/onboarding/qa/qaTokens';

import type { OnboardingFlowStep } from './OnboardingSceneRegistry';

export type OnboardingShellBackgroundVariant = 'qa' | 'summary';

export type OnboardingSharedShellConfig = {
  backgroundVariant: OnboardingShellBackgroundVariant;
  progressFillWidth: number;
  onBack: () => void | Promise<void>;
  onContinue: () => void | Promise<void>;
  continueLabel: string;
  continueDisabled?: boolean;
  onSkip?: () => void | Promise<void>;
  footerHint?: string;
  footerError?: string | null;
  footerReserveHeight: number;
};

export const ONBOARDING_SHARED_SHELL_STEPS: readonly OnboardingFlowStep[] = [
  'goals',
  'allergy',
  'plan-preview',
  'first-stack',
] as const;

export const getSharedShellProgressFillWidth = (step: OnboardingFlowStep) => {
  const stepIndex = ONBOARDING_SHARED_SHELL_STEPS.indexOf(step) + 1;
  const totalSteps = ONBOARDING_SHARED_SHELL_STEPS.length;
  const clampedStep = Math.max(1, Math.min(stepIndex, totalSteps));

  if (totalSteps <= 1) {
    return QA_PROGRESS_TRACK_WIDTH;
  }

  const ratio = (clampedStep - 1) / (totalSteps - 1);
  return Math.round(
    QA_PROGRESS_FILL_WIDTH +
      (QA_PROGRESS_TRACK_WIDTH - QA_PROGRESS_FILL_WIDTH) * ratio,
  );
};

export const ONBOARDING_SHARED_SHELL_TOP_OFFSET = 10;
export const ONBOARDING_SHARED_SHELL_HEADER_HEIGHT = 44;

export const ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE = 112;
export const ONBOARDING_SHARED_SHELL_QA_FOOTER_SPACE_WITH_HELPER = 132;
export const ONBOARDING_SHARED_SHELL_SUMMARY_FOOTER_SPACE = 120;

export const isSharedShellStep = (
  step: OnboardingFlowStep | null | undefined,
): step is OnboardingFlowStep =>
  Boolean(
    step &&
      ONBOARDING_SHARED_SHELL_STEPS.includes(step as OnboardingFlowStep),
  );
