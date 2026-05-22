#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import process from 'node:process';

const rootLayout = readFileSync('app/_layout.tsx', 'utf8');

const failures = [];

if (!rootLayout.includes("import { SubscriptionProvider } from '@/contexts/SubscriptionContext';")) {
  failures.push('app/_layout.tsx must import SubscriptionProvider');
}

if (!rootLayout.includes('<SubscriptionProvider>') || !rootLayout.includes('</SubscriptionProvider>')) {
  failures.push('app/_layout.tsx must wrap the app tree in SubscriptionProvider');
}

const authProviderIndex = rootLayout.indexOf('<AuthProvider>');
const subscriptionProviderIndex = rootLayout.indexOf('<SubscriptionProvider>');
if (authProviderIndex < 0 || subscriptionProviderIndex < 0 || subscriptionProviderIndex < authProviderIndex) {
  failures.push('SubscriptionProvider must be nested inside AuthProvider because it uses useAuth()');
}

if (failures.length > 0) {
  console.error('[app-provider-contracts] provider contract failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.error('[app-provider-contracts] root provider contracts passed');
}
