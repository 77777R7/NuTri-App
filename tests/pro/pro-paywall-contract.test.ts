import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const barcodeSource = readFileSync(new URL('../../app/scan/barcode.tsx', import.meta.url), 'utf8');
const homeSource = readFileSync(new URL('../../app/main/Home-Page.tsx', import.meta.url), 'utf8');
const searchSource = readFileSync(new URL('../../app/search/index.tsx', import.meta.url), 'utf8');
const savedContextSource = readFileSync(
  new URL('../../contexts/SavedSupplementsContext.tsx', import.meta.url),
  'utf8',
);
const savedTypesSource = readFileSync(new URL('../../types/saved-supplements.ts', import.meta.url), 'utf8');
const scanResultSource = readFileSync(new URL('../../app/scan/result.tsx', import.meta.url), 'utf8');
const paywallRouteSource = readFileSync(new URL('../../app/paywall/official.tsx', import.meta.url), 'utf8');
const paywallPageSource = readFileSync(
  new URL('../../components/paywall/OfficialPaywallPage.tsx', import.meta.url),
  'utf8',
);
const postPurchaseSuccessSource = readFileSync(
  new URL('../../components/paywall/PostPurchaseSuccessPage.tsx', import.meta.url),
  'utf8',
);
const profileSource = readFileSync(new URL('../../components/screens/ProfileScreen.tsx', import.meta.url), 'utf8');
const proAnalyticsSource = readFileSync(new URL('../../lib/analytics/pro.ts', import.meta.url), 'utf8');
const premiumAccessSource = readFileSync(new URL('../../hooks/usePremiumAccess.ts', import.meta.url), 'utf8');
const waitlistTrialHookSource = readFileSync(new URL('../../hooks/useWaitlistTrialBonus.ts', import.meta.url), 'utf8');
const waitlistTrialMigrationSource = readFileSync(
  new URL('../../supabase/migrations/20260513023000_waitlist_trial_bonuses.sql', import.meta.url),
  'utf8',
) + '\n' + readFileSync(
  new URL('../../supabase/migrations/20260513070422_waitlist_referral_ledger.sql', import.meta.url),
  'utf8',
) + '\n' + readFileSync(
  new URL('../../supabase/migrations/20260513080308_waitlist_referral_pending_milestone_events.sql', import.meta.url),
  'utf8',
);

test('second normal scan is gated before barcode capture starts', () => {
  assert.match(barcodeSource, /getScanEntryGateDecision/);
  assert.match(barcodeSource, /firstCompletedScanId:\s*firstScanReveal\.firstCompletedScanId/);
  assert.match(barcodeSource, /isOnboardingScan,/);
  assert.match(barcodeSource, /isGuestScan,/);
  assert.match(barcodeSource, /router\.replace\(\{\s*pathname:\s*'\/paywall\/official'/);

  const gateIndex = barcodeSource.indexOf('getScanEntryGateDecision');
  const cameraIndex = barcodeSource.indexOf('<CameraView');
  const handlerIndex = barcodeSource.indexOf('const handleBarcode = useCallback');
  assert.ok(gateIndex > -1 && cameraIndex > -1 && gateIndex < cameraIndex);
  assert.ok(gateIndex > -1 && handlerIndex > -1 && gateIndex < handlerIndex);
});

test('product search gates both normal entry and direct route access', () => {
  assert.match(homeSource, /getProductSearchGateDecision/);
  assert.match(homeSource, /source:\s*'product_search'/);
  assert.match(searchSource, /const SearchExperience = \(\) =>/);
  assert.match(searchSource, /const SearchPage = \(\) =>/);
  assert.match(searchSource, /getProductSearchGateDecision/);
  assert.match(searchSource, /router\.replace\(\{\s*pathname:\s*'\/paywall\/official'/);
  assert.match(searchSource, /return <SearchExperience \/>/);
});

test('saved supplement add returns typed outcomes and limit routes to paywall at callsites', () => {
  assert.match(savedTypesSource, /SavedSupplementAddResult/);
  assert.match(savedTypesSource, /status:\s*'duplicate'/);
  assert.match(savedTypesSource, /status:\s*'limit_reached'/);
  assert.match(savedTypesSource, /status:\s*'added'/);
  assert.match(savedContextSource, /getSavedSupplementAddGateDecision/);
  assert.match(savedContextSource, /gate\.status === 'duplicate'/);
  assert.match(savedContextSource, /gate\.status === 'limit_reached'/);

  assert.match(scanResultSource, /addResult\.status === 'limit_reached'/);
  assert.match(scanResultSource, /source:\s*'saved_supplement_limit'/);
  assert.match(scanResultSource, /resumeAction:\s*'save_supplement'/);
  assert.match(scanResultSource, /resumeAction !== 'save_supplement'/);
  assert.match(homeSource, /addResult\.status === 'limit_reached'/);
  assert.match(homeSource, /source:\s*'saved_supplement_limit'/);
});

test('official paywall sources and copy are limited to implemented release features', () => {
  assert.match(paywallRouteSource, /case 'scan_limit':/);
  assert.match(paywallRouteSource, /case 'product_search':/);
  assert.match(paywallRouteSource, /case 'saved_supplement_limit':/);
  assert.match(paywallRouteSource, /case 'profile_upgrade':/);

  assert.match(paywallPageSource, /More Supplement Scans/);
  assert.match(paywallPageSource, /Product Search/);
  assert.match(paywallPageSource, /More Saved Supplements/);
  assert.match(paywallPageSource, /Saved Stack Safety/);
  assert.doesNotMatch(paywallPageSource, /Smart Filter/);
  assert.doesNotMatch(paywallPageSource, /30-day trend/);
  assert.doesNotMatch(paywallPageSource, /Goal Navigator/);
  assert.doesNotMatch(paywallPageSource, /Continue monthly[\s\S]{0,120}7-day free trial/);
});

test('purchase success shows source-specific aftercare with one CTA and Pro analytics', () => {
  assert.match(paywallPageSource, /PostPurchaseSuccessPage/);
  assert.match(paywallPageSource, /setPostPurchaseVisible\(true\)/);
  assert.match(paywallPageSource, /resolvePostPurchaseResumePath/);
  assert.match(profileSource, /openPaywall\('profile_upgrade'\)/);

  assert.match(postPurchaseSuccessSource, /Haptics\.notificationAsync\(Haptics\.NotificationFeedbackType\.Success\)/);
  assert.match(postPurchaseSuccessSource, /trackPostPurchaseViewed/);
  assert.match(postPurchaseSuccessSource, /trackPostPurchaseCtaTapped/);
  assert.match(paywallPageSource, /trackPaywallViewed/);
  assert.match(paywallPageSource, /trackPaywallPurchaseStarted/);
  assert.match(paywallPageSource, /trackPaywallPurchaseSuccess/);
  assert.match(paywallPageSource, /trackPostPurchaseResumeSuccess/);
  assert.match(paywallPageSource, /trackPostPurchaseResumeFailed/);
  assert.match(proAnalyticsSource, /post_purchase_viewed/);
  assert.match(proAnalyticsSource, /post_purchase_cta_tapped/);
  assert.match(proAnalyticsSource, /paywall_viewed/);
  assert.match(proAnalyticsSource, /paywall_purchase_started/);
  assert.match(proAnalyticsSource, /paywall_purchase_success/);
  assert.match(proAnalyticsSource, /post_purchase_resume_success/);
  assert.match(proAnalyticsSource, /post_purchase_resume_failed/);
  assert.match(proAnalyticsSource, /timeToFirstProAction/);
  assert.match(postPurchaseSuccessSource, /Continue scanning/);
  assert.match(postPurchaseSuccessSource, /Continue searching/);
  assert.match(postPurchaseSuccessSource, /Save this supplement/);
  assert.match(postPurchaseSuccessSource, /Product Search is unlocked/);
  assert.match(postPurchaseSuccessSource, /Your supplement stack is unlocked/);
  assert.match(postPurchaseSuccessSource, /Want a reminder before your trial renews\?/);
  assert.equal((postPurchaseSuccessSource.match(/style=\{styles\.cta\}/g) ?? []).length, 1);
  assert.doesNotMatch(postPurchaseSuccessSource, /Smart Filter|30-day trend|Goal Navigator/);
});

test('waitlist trial bonuses use Supabase ledger preview plus explicit paywall activation', () => {
  assert.match(waitlistTrialMigrationSource, /create table if not exists public\.waitlist_signups/);
  assert.match(waitlistTrialMigrationSource, /create table if not exists public\.waitlist_referrals/);
  assert.match(waitlistTrialMigrationSource, /create table if not exists public\.waitlist_trial_bonuses/);
  assert.match(waitlistTrialMigrationSource, /create or replace function public\.register_waitlist_signup/);
  assert.match(waitlistTrialMigrationSource, /create or replace function public\.get_waitlist_trial_bonus_preview/);
  assert.match(waitlistTrialMigrationSource, /create or replace function private\.activate_waitlist_trial_bonus_impl/);
  assert.match(waitlistTrialMigrationSource, /create or replace function public\.activate_waitlist_trial_bonus/);
  assert.match(waitlistTrialMigrationSource, /create or replace function public\.claim_waitlist_referral_milestone_events/);
  assert.match(waitlistTrialMigrationSource, /waitlist_referrals_no_self_referral/);
  assert.match(waitlistTrialMigrationSource, /waitlist_referrals_referred_confirmed_uidx/);
  assert.match(waitlistTrialMigrationSource, /security definer/);
  assert.match(waitlistTrialMigrationSource, /grant execute on function public\.register_waitlist_signup[\s\S]+to service_role/);
  assert.match(waitlistTrialMigrationSource, /grant execute on function public\.claim_waitlist_referral_milestone_events[\s\S]+to service_role/);
  assert.match(waitlistTrialMigrationSource, /revoke all on function private\.activate_waitlist_trial_bonus_impl\(\) from public/);
  assert.match(waitlistTrialMigrationSource, /compute_waitlist_bonus_days/);
  assert.match(waitlistTrialMigrationSource, /waitlist_trial_bonuses_select_own_email/);

  assert.match(waitlistTrialHookSource, /get_waitlist_trial_bonus_preview/);
  assert.match(waitlistTrialHookSource, /activate_waitlist_trial_bonus/);
  assert.match(premiumAccessSource, /'waitlist_trial'/);
  assert.match(premiumAccessSource, /status:\s*'waitlist_trialing'/);

  assert.match(paywallPageSource, /WAITLIST BONUS READY/);
  assert.match(paywallPageSource, /Continue with \$\{waitlistTrial\.bonus\.totalTrialDays\}-day trial/);
  assert.match(paywallPageSource, /Start your \$\{waitlistTrial\.bonus\.totalTrialDays\}-day free trial/);
  assert.match(paywallPageSource, /waitlistTrial\.activate/);
  assert.match(paywallPageSource, /waitlistTrialAvailable \? null :/);
  assert.doesNotMatch(paywallPageSource, /Enter invite code|Have an invite code/i);
});
