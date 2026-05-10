import React, { useCallback, useEffect } from 'react';
import { useRouter } from 'expo-router';

import { SolutionIntroScreen } from '@/components/onboarding/solution/SolutionIntroScreen';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';

export default function SolutionScreen() {
  const router = useRouter();
  const { progress, setProgress } = useOnboarding();
  const { setDirection } = useTransitionDir();

  useEffect(() => {
    if (progress < 3) {
      void setProgress(3);
    }
  }, [progress, setProgress]);

  const handleContinue = useCallback(async () => {
    setDirection('forward');
    await setProgress(4);
    router.replace({
      pathname: '/scan/barcode',
      params: { source: 'onboarding' },
    });
  }, [router, setDirection, setProgress]);

  return <SolutionIntroScreen onScan={handleContinue} />;
}
