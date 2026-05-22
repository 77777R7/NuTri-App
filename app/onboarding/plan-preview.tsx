import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

import { getLegacyOnboardingRedirect } from '@/lib/onboarding/postScanReturn';

export default function LegacyPlanPreviewRedirect() {
  const params = useLocalSearchParams<{ returnTo?: string }>();
  return <Redirect href={getLegacyOnboardingRedirect(params.returnTo) as never} />;
}
