import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readSource = (relativePath: string): string =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

const readBinary = (relativePath: string): Buffer =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url));

test('iOS camera purpose and app icon are App Store ready', () => {
  const appConfigSource = readSource('app.config.ts');
  assert.match(
    appConfigSource,
    /NSCameraUsageDescription:\s*'NuTri uses the camera to scan supplement barcodes and show product analysis\.'/,
  );
  assert.doesNotMatch(
    appConfigSource,
    /NSLocationWhenInUseUsageDescription/,
    'release config should not declare location permission unless the app requests device location',
  );

  const packageJson = JSON.parse(readSource('package.json'));
  assert.equal(
    packageJson.dependencies?.['expo-location'],
    undefined,
    'expo-location must stay out of release dependencies unless a real device-location feature ships',
  );

  const icon = readBinary('assets/images/icon.png');
  assert.equal(icon.subarray(1, 4).toString('ascii'), 'PNG');
  const colorType = icon[25];
  assert.notEqual(colorType, 4, 'PNG icon must not use grayscale alpha');
  assert.notEqual(colorType, 6, 'PNG icon must not use RGBA alpha');
  assert.equal(icon.includes(Buffer.from('tRNS')), false, 'PNG icon must not carry a transparency chunk');
});

test('legal links are shared and clickable from release-critical surfaces', () => {
  const legalLinksSource = readSource('lib/legalLinks.ts');
  assert.match(legalLinksSource, /PRIVACY_POLICY_URL\s*=\s*'https:\/\/www\.nutri\.app\/privacy'/);
  assert.match(legalLinksSource, /TERMS_OF_SERVICE_URL\s*=\s*'https:\/\/www\.nutri\.app\/terms'/);
  assert.match(legalLinksSource, /Alert\.alert\([\s\S]{0,80}'Could not open link'/);

  const paywallSource = readSource('components/paywall/OfficialPaywallPage.tsx');
  assert.match(paywallSource, /openTermsOfService/);
  assert.match(paywallSource, /openPrivacyPolicy/);
  assert.match(paywallSource, /accessibilityRole="link"/);

  const dataTrustSource = readSource('app/onboarding/data-trust.tsx');
  assert.match(dataTrustSource, /openPrivacyPolicy/);
  assert.doesNotMatch(dataTrustSource, /Linking\.openURL/);

  const profileSource = readSource('components/screens/ProfileScreen.tsx');
  assert.match(profileSource, /openPrivacyPolicy/);
  assert.match(profileSource, /openTermsOfService/);
  assert.match(profileSource, /openSupportEmail/);
  assert.match(profileSource, /openAccountDeletionRequest/);
  assert.match(profileSource, /profileDeleteAccountAction/);
});

test('release builds cannot unlock Pro with tester overrides', () => {
  const subscriptionSource = readSource('contexts/SubscriptionContext.tsx');
  assert.match(subscriptionSource, /PREMIUM_TEST_OVERRIDE_ENABLED[\s\S]{0,120}__DEV__/);
  assert.match(subscriptionSource, /DEV_FORCE_PREMIUM[\s\S]{0,120}__DEV__/);

  const guardIndex = subscriptionSource.indexOf('if (!PREMIUM_TEST_OVERRIDE_ENABLED)');
  const storageReadIndex = subscriptionSource.indexOf('getPremiumTestOverride()');
  assert.ok(guardIndex > -1, 'subscription context should guard test overrides');
  assert.ok(storageReadIndex > guardIndex, 'storage override must not be read before the release guard');
  assert.match(
    subscriptionSource,
    /const effectiveTestOverride = PREMIUM_TEST_OVERRIDE_ENABLED \? testOverride : 'auto';/,
  );

  const profileSource = readSource('components/screens/ProfileScreen.tsx');
  assert.doesNotMatch(profileSource, /showTesterControls/);
  assert.doesNotMatch(profileSource, /setTestOverride/);
  assert.doesNotMatch(profileSource, /Paid Version Requirements|Unpaid Version Requirements/);

  const appIndexSource = readSource('app/index.tsx');
  const authGateSource = readSource('app/(auth)/gate.tsx');
  assert.match(appIndexSource, /DEV_FORCE_HOME[\s\S]{0,120}__DEV__/);
  assert.match(authGateSource, /DEV_FORCE_HOME[\s\S]{0,120}__DEV__/);

  const easJson = JSON.parse(readSource('eas.json'));
  for (const [profile, build] of Object.entries(easJson.build) as Array<[string, { env?: Record<string, string> }]>) {
    assert.equal(build.env?.EXPO_PUBLIC_DEV_FORCE_HOME, undefined, `${profile} must not force Home bypass`);
    assert.equal(build.env?.EXPO_PUBLIC_DEV_FORCE_PREMIUM, undefined, `${profile} must not force Premium bypass`);
  }
});

test('paywall and locked scan previews do not carry stale product prices', () => {
  const paywallSource = readSource('components/paywall/OfficialPaywallPage.tsx');
  const scanDashboardSource = readSource('components/scan/AnalysisDashboard.tsx');
  const combined = `${paywallSource}\n${scanDashboardSource}`;

  assert.doesNotMatch(combined, /\$59\.99|\$10\.99/);
  assert.match(combined, /\$29\.99/);
  assert.match(combined, /\$4\.99/);
});

test('RevenueCat release configuration documents the live Pro contract', () => {
  const appConfigSource = readSource('app.config.ts');
  assert.match(appConfigSource, /EXPO_PUBLIC_REVENUECAT_IOS_API_KEY/);
  assert.match(appConfigSource, /EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID/);
  assert.match(appConfigSource, /revenueCatIosApiKey: REVENUECAT_IOS_API_KEY/);
  assert.match(appConfigSource, /revenueCatEntitlementId: REVENUECAT_ENTITLEMENT_ID/);

  const subscriptionSource = readSource('contexts/SubscriptionContext.tsx');
  assert.match(subscriptionSource, /findRevenueCatEntitlement/);
  assert.match(subscriptionSource, /entitlement\.identifier\.trim\(\)\.toLowerCase\(\) === normalizedPreferredId/);

  const envExample = readSource('.env.example');
  assert.match(envExample, /EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_YOUR_REVENUECAT_IOS_PUBLIC_KEY/);
  assert.match(envExample, /EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID=pro/);
  assert.match(envExample, /nutri_pro_monthly, nutri_pro_yearly/);
  assert.match(envExample, /Entitlement: pro\. Offering: default\./);

  const easJson = JSON.parse(readSource('eas.json'));
  for (const profile of ['development', 'preview', 'preview_noauth', 'production'] as const) {
    assert.equal(easJson.build[profile].env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY, 'appl_TJQdqNyqFtFiTrUTMxTdhBADTAr');
    assert.equal(easJson.build[profile].env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID, 'pro');
  }
});
