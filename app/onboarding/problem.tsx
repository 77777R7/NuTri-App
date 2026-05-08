import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';

import { ProblemIntroScreen } from '@/components/onboarding/problem/ProblemIntroScreen';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';

export default function ProblemScreen() {
  const router = useRouter();
  const { saveDraft } = useOnboarding();
  const { setDirection } = useTransitionDir();

  const handleNext = useCallback(async () => {
    trackOnboardingEvent('problem_page_completed', {
      source: 'onboarding_problem',
      version: 'problem_blue_card_v1',
    });
    setDirection('forward');
    await saveDraft({ onboardingVersion: 'v2' });
    router.replace('/onboarding/solution');
  }, [router, saveDraft, setDirection]);

  return <ProblemIntroScreen onNext={handleNext} />;
}
