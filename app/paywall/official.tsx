import { useLocalSearchParams, router } from 'expo-router';
import React from 'react';

import { OfficialPaywallPage } from '@/components/paywall/OfficialPaywallPage';
import type { OfficialPaywallSource } from '@/lib/pro/featureGates';

const normalizeSource = (value: string | string[] | undefined): OfficialPaywallSource => {
  if (typeof value !== 'string') {
    return 'first_scan_result' as const;
  }

  switch (value) {
    case 'score':
    case 'overview':
    case 'science':
    case 'usage':
    case 'safety':
    case 'stack_safety':
    case 'scan_limit':
    case 'product_search':
    case 'saved_supplement_limit':
    case 'first_scan_result':
      return value;
    default:
      return 'first_scan_result' as const;
  }
};

export default function OfficialPaywallRoute() {
  const params = useLocalSearchParams<{ source?: string; scanId?: string; returnTo?: string }>();
  const source = normalizeSource(params.source);
  const scanId = typeof params.scanId === 'string' && params.scanId.trim().length > 0 ? params.scanId.trim() : null;
  const returnTo =
    typeof params.returnTo === 'string' && params.returnTo.trim().startsWith('/')
      ? params.returnTo.trim()
      : null;

  return (
    <OfficialPaywallPage
      source={source}
      scanId={scanId}
      returnTo={returnTo}
      onClose={() => {
        if (returnTo) {
          router.replace(returnTo);
          return;
        }
        if (router.canGoBack()) {
          router.back();
          return;
        }
        router.replace('/main/Home-Page');
      }}
    />
  );
}
