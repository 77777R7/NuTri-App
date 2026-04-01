import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

export default function LegacyScanRedirectScreen() {
  const params = useLocalSearchParams<{ source?: string; from?: string }>();
  const isOnboardingSource = params.source === 'onboarding';
  const cameFromBarcode = params.from === 'barcode';

  if (cameFromBarcode) {
    return (
      <Redirect
        href={
          isOnboardingSource
            ? { pathname: '/scan/barcode', params: { source: 'onboarding' } }
            : '/scan/barcode'
        }
      />
    );
  }

  return <Redirect href={isOnboardingSource ? '/onboarding/done' : '/main'} />;
}
