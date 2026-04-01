import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { OnboardingFlowHost } from '@/components/onboarding/flow/OnboardingFlowHost';

const OnboardingIndex = () => {
  const params = useLocalSearchParams<{ step?: string }>();

  return <OnboardingFlowHost initialStep={params.step} />;
};

export default OnboardingIndex;

