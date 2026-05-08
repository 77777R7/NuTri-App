import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';

import { SolutionIntroScreen } from '@/components/onboarding/solution/SolutionIntroScreen';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';

export default function SolutionScreen() {
  const router = useRouter();
  const { saveDraft } = useOnboarding();
  const { setDirection } = useTransitionDir();

  const handleScan = useCallback(async () => {
    trackOnboardingEvent('solution_page_completed', {
      source: 'onboarding_solution',
      version: 'solution_yellow_card_v1',
      action: 'scan_first_supplement',
    });
    setDirection('forward');
    await saveDraft({
      firstActionPreference: 'scan',
      onboardingVersion: 'v2',
    });
    router.replace({
      pathname: '/scan/barcode',
      params: { source: 'onboarding' },
    });
  }, [router, saveDraft, setDirection]);

  return <SolutionIntroScreen onScan={handleScan} />;
}
