import React, { useCallback, useEffect } from 'react';
import { useRouter } from 'expo-router';

import { ProblemIntroScreen } from '@/components/onboarding/problem/ProblemIntroScreen';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';

export default function ProblemScreen() {
  const router = useRouter();
  const { progress, setProgress } = useOnboarding();
  const { setDirection } = useTransitionDir();

  useEffect(() => {
    if (progress < 2) {
      void setProgress(2);
    }
  }, [progress, setProgress]);

  const handleContinue = useCallback(async () => {
    setDirection('forward');
    await setProgress(3);
    router.replace('/onboarding/solution');
  }, [router, setDirection, setProgress]);

  return <ProblemIntroScreen onNext={handleContinue} />;
}
