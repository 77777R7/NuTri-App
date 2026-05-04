import { ENV } from '@/lib/env';

export const Config = {
  apiBaseUrl: ENV.apiBaseUrl,
  searchApiBaseUrl: ENV.searchApiBaseUrl,
  supabase: {
    url: ENV.supabaseUrl,
    anonKey: ENV.supabaseAnonKey,
    storageBuckets: {
      supplementImages: 'supplement-images',
      userProfilePhotos: 'user-profile-photos',
      scanHistory: 'scan-history',
    },
  },
  integrations: {
    paddleOcr: {
      endpoint: ENV.paddleOcrEndpoint,
    },
  },
  analytics: {
    sentryDsn: ENV.sentryDsn,
    posthogApiKey: ENV.posthogApiKey,
  },
  scanTerminalLockEnabled: ENV.scanTerminalLockEnabled,
  guestScanEnabled: ENV.guestScanEnabled,
} as const;
