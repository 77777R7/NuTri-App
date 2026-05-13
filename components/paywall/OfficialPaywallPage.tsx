import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { Check, ChevronLeft } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useFirstScanReveal } from '@/hooks/useFirstScanReveal';
import { useWaitlistTrialBonus } from '@/hooks/useWaitlistTrialBonus';
import { openPrivacyPolicy, openTermsOfService } from '@/lib/legalLinks';
import type { OfficialPaywallSource } from '@/lib/pro/featureGates';
import { buildWaitlistTrialSummary } from '@/lib/pro/waitlistTrialBonus';

type OfficialPaywallPageProps = {
  source: OfficialPaywallSource;
  scanId?: string | null;
  returnTo?: string | null;
  onClose?: () => void;
};

type FeatureCopy = {
  title: string;
  body: string;
  titlePrefix?: string;
  titleSuffix?: string;
};

type PaywallCopy = {
  headline: string;
  subheadline: string;
  features: FeatureCopy[];
};

const SERIF_FONT = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
});

const PAYWALL_BACKGROUND = require('@/assets/images/paywall/paywall-sky-background.png');

const RESULT_BREAKDOWN_FEATURES: FeatureCopy[] = [
  {
    title: 'Full NuTri Score',
    body: 'See why a product scores well, where evidence is missing, and what needs a second look.',
  },
  {
    title: 'Ingredient Deep Dive',
    body: 'Open Science & Ingredients, Practical Usage, and Safety notes for this scan.',
  },
  {
    title: 'Personalized Fit Checks',
    body: 'Use your goals and allergies to understand fit before adding it to your routine.',
  },
  {
    title: 'More Scan Results',
    body: 'Go beyond your first free result and check more supplements before you buy.',
  },
];

const CORE_PRO_FEATURES: FeatureCopy[] = [
  {
    title: 'More Supplement Scans',
    body: 'Go beyond your first free scan and check more supplements before you buy.',
  },
  {
    title: 'Product Search',
    body: 'Open the supplement database and inspect searchable product results.',
  },
  {
    title: 'More Saved Supplements',
    body: 'Keep more than one supplement in My Saved for check-ins and stack review.',
  },
  {
    title: 'Saved Stack Safety',
    body: 'Check repeated ingredients and dose overlaps when labels include usable dose data.',
  },
];

const STACK_SAFETY_FEATURES: FeatureCopy[] = [
  {
    title: 'Saved Stack Safety',
    body: 'Check repeated ingredients across your stack, dose overlaps, and safety signals when labels include usable dose data.',
  },
  {
    title: 'Duplicate Ingredients',
    body: 'Spot repeated actives across saved supplements before they quietly stack up.',
  },
  {
    title: 'Dose Context',
    body: 'See adult upper-limit context when labels include enough usable dose data.',
  },
];

const getPaywallCopy = (source: OfficialPaywallPageProps['source']): PaywallCopy => {
  if (source === 'stack_safety') {
    return {
      headline: 'Protect your saved stack.',
      subheadline: 'Unlock stack-level checks for repeated ingredients and dose overlaps.',
      features: STACK_SAFETY_FEATURES,
    };
  }

  if (source === 'scan_limit') {
    return {
      headline: 'Scan more supplements with Pro.',
      subheadline: 'Your first supplement scan is free. Pro unlocks additional scans before you buy.',
      features: CORE_PRO_FEATURES,
    };
  }

  if (source === 'product_search') {
    return {
      headline: 'Search the supplement database with Pro.',
      subheadline: 'Find products by supplement, brand, or goal and open the results that matter.',
      features: CORE_PRO_FEATURES,
    };
  }

  if (source === 'saved_supplement_limit') {
    return {
      headline: 'Save more supplements with Pro.',
      subheadline: 'Free users can keep one supplement. Pro unlocks a fuller saved stack.',
      features: CORE_PRO_FEATURES,
    };
  }

  if (source === 'score') {
    return {
      headline: 'Unlock the full NuTri Score.',
      subheadline: 'See the score breakdown, evidence gaps, and decision details for this scan.',
      features: RESULT_BREAKDOWN_FEATURES,
    };
  }

  if (source === 'science') {
    return {
      headline: 'Unlock the ingredient deep dive.',
      subheadline: 'Open the ingredient science, form context, and practical evidence behind this formula.',
      features: RESULT_BREAKDOWN_FEATURES,
    };
  }

  if (source === 'usage') {
    return {
      headline: 'Unlock practical usage context.',
      subheadline: 'See routine timing, label directions, and what to check before using this supplement.',
      features: RESULT_BREAKDOWN_FEATURES,
    };
  }

  if (source === 'safety') {
    return {
      headline: 'Unlock safety context.',
      subheadline: 'Review label warnings, upper-limit context, and supplement-specific watch-outs.',
      features: RESULT_BREAKDOWN_FEATURES,
    };
  }

  if (source === 'overview') {
    return {
      headline: 'Unlock the full product breakdown.',
      subheadline: 'See what the supplement provides, what is missing, and where the label needs a closer look.',
      features: RESULT_BREAKDOWN_FEATURES,
    };
  }

  return {
    headline: 'Unlock full scan breakdowns and saved-stack safety checks.',
    subheadline: 'Keep checking supplements after your first free scan, search the database, and build a saved stack.',
    features: CORE_PRO_FEATURES,
  };
};

const normalizeAnnualMeta = (value: string | null) => {
  if (!value) return '$2.50/mo';
  return value.replace('/month', '/mo').replace('/mo.', '/mo');
};

const annualTrialLine = (annualPrice: string, annualMeta: string | null) => (
  `${annualPrice} / Year · About ${normalizeAnnualMeta(annualMeta)}`
);

export function OfficialPaywallPage({ source, scanId = null, returnTo = null, onClose }: OfficialPaywallPageProps) {
  const insets = useSafeAreaInsets();
  const { session, setPostAuthRedirect } = useAuth();
  const subscription = useSubscription();
  const waitlistTrial = useWaitlistTrialBonus();
  const firstScanReveal = useFirstScanReveal();
  const impressionLoggedRef = useRef(false);

  const annualProduct = subscription.annualPackage?.product ?? null;
  const monthlyProduct = subscription.monthlyPackage?.product ?? null;
  const annualPriceLine = annualProduct?.priceString ?? '$29.99';
  const monthlyPriceLine = monthlyProduct?.priceString ?? '$4.99';
  const annualMetaLine = annualProduct?.pricePerMonthString ?? null;
  const monthlyPlanMeta = `${monthlyPriceLine} / Month`;
  const copy = useMemo(() => getPaywallCopy(source), [source]);
  const annualTrialEligible = Boolean(annualProduct?.introPrice) && subscription.trialEligibility === 'eligible';
  const waitlistTrialActive = Boolean(waitlistTrial.active && waitlistTrial.bonus);
  const waitlistTrialSummary = waitlistTrial.bonus ? buildWaitlistTrialSummary(waitlistTrial.bonus) : null;
  const annualPlanMeta = waitlistTrialActive && waitlistTrialSummary
    ? waitlistTrialSummary
    : annualTrialLine(annualPriceLine, annualMetaLine);

  useEffect(() => {
    if (source !== 'first_scan_result' || !scanId || impressionLoggedRef.current) {
      return;
    }

    impressionLoggedRef.current = true;
    void firstScanReveal.markPaywallSeen(scanId);
  }, [firstScanReveal, scanId, source]);

  const primaryLabel = useMemo(() => {
    if (subscription.purchaseBusy) {
      return 'Starting purchase...';
    }
    if (waitlistTrialActive && waitlistTrial.bonus) {
      return `Continue with ${waitlistTrial.bonus.totalTrialDays}-day trial`;
    }
    if (subscription.loading && session?.user && !subscription.uiPreviewMode) {
      return 'Loading plans...';
    }
    return annualTrialEligible ? 'Start 7-day free trial' : 'Continue yearly';
  }, [
    annualTrialEligible,
    session?.user,
    subscription.loading,
    subscription.purchaseBusy,
    subscription.uiPreviewMode,
    waitlistTrial.bonus,
    waitlistTrialActive,
  ]);

  const primaryDisabled =
    subscription.purchaseBusy
    || (!waitlistTrialActive && Boolean(session?.user) && !subscription.uiPreviewMode && (!subscription.primaryPackage || subscription.loading));
  const monthlyDisabled =
    subscription.purchaseBusy
    || (Boolean(session?.user) && !subscription.uiPreviewMode && (!subscription.monthlyPackage || subscription.loading));

  const footerText = useMemo(() => {
    if (waitlistTrialActive && waitlistTrial.bonus) {
      return `Your waitlist trial is active until ${new Date(waitlistTrial.bonus.trialExpiresAt ?? '').toLocaleDateString()}. No payment is collected for this waitlist trial.`;
    }
    if (annualTrialEligible) {
      return `7-day free trial, then ${annualPriceLine} per year. Auto-renews until canceled. Cancel anytime in App Store or Google Play subscription settings.`;
    }
    return `${annualPriceLine} per year or ${monthlyPriceLine} per month. Auto-renews until canceled. Cancel anytime in App Store or Google Play subscription settings.`;
  }, [annualPriceLine, annualTrialEligible, monthlyPriceLine, waitlistTrial.bonus, waitlistTrialActive]);

  const handleClose = () => {
    subscription.clearError();
    if (onClose) {
      onClose();
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(returnTo ?? '/main/Home-Page');
  };

  const handlePrimaryPress = async () => {
    if (!session?.user) {
      const query = new URLSearchParams({
        source,
        ...(scanId ? { scanId } : {}),
        ...(returnTo ? { returnTo } : {}),
      });
      setPostAuthRedirect(`/paywall/official?${query.toString()}`);
      subscription.clearError();
      router.push('/auth/login');
      return;
    }

    if (subscription.uiPreviewMode) {
      if (source === 'first_scan_result' && scanId) {
        await firstScanReveal.markConverted(scanId);
      }
      handleClose();
      return;
    }

    if (waitlistTrialActive) {
      handleClose();
      return;
    }

    const result = await subscription.purchasePrimaryPackage();
    if (result.ok) {
      if (source === 'first_scan_result' && scanId) {
        await firstScanReveal.markConverted(scanId);
      }
      handleClose();
    }
  };

  const handleMonthlyPress = async () => {
    if (!session?.user) {
      const query = new URLSearchParams({
        source,
        ...(scanId ? { scanId } : {}),
        ...(returnTo ? { returnTo } : {}),
      });
      setPostAuthRedirect(`/paywall/official?${query.toString()}`);
      subscription.clearError();
      router.push('/auth/login');
      return;
    }

    if (subscription.uiPreviewMode) {
      if (source === 'first_scan_result' && scanId) {
        await firstScanReveal.markConverted(scanId);
      }
      handleClose();
      return;
    }

    if (waitlistTrialActive) {
      handleClose();
      return;
    }

    const result = await subscription.purchaseMonthlyPackage();
    if (result.ok) {
      if (source === 'first_scan_result' && scanId) {
        await firstScanReveal.markConverted(scanId);
      }
      handleClose();
    }
  };

  const handleRestorePress = async () => {
    if (!session?.user) {
      const query = new URLSearchParams({
        source,
        ...(scanId ? { scanId } : {}),
        ...(returnTo ? { returnTo } : {}),
      });
      setPostAuthRedirect(`/paywall/official?${query.toString()}`);
      subscription.clearError();
      router.push('/auth/login');
      return;
    }

    if (subscription.uiPreviewMode) {
      return;
    }

    const result = await subscription.restorePurchases();
    if (result.ok) {
      if (source === 'first_scan_result' && scanId) {
        await firstScanReveal.markConverted(scanId);
      }
      handleClose();
    }
  };

  const renderFeatureTitle = (feature: FeatureCopy) => {
    if (!feature.titleSuffix) {
      return <Text style={styles.featureTitle}>{feature.title}</Text>;
    }

    return (
      <Text style={styles.featureTitle}>
        {feature.title}{' '}
        <Text style={styles.featureAmpersand}>&</Text>
        {' '}{feature.titleSuffix}
      </Text>
    );
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.headerArt}>
        <Image
          source={PAYWALL_BACKGROUND}
          contentFit="cover"
          transition={180}
          style={StyleSheet.absoluteFill}
        />
        <Pressable
          style={[styles.closeButton, { top: Math.max(insets.top + 10, 48) }]}
          onPress={handleClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close paywall"
        >
          <ChevronLeft size={22} color="#FFFFFF" strokeWidth={2.8} />
        </Pressable>
        <Text style={styles.proTitle}>NuTri Pro</Text>
      </View>

      <View style={styles.sheet}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 26, 42) }]}
        >
          <View style={styles.heroCopy}>
            <Text style={styles.headline}>{copy.headline}</Text>
            <Text style={styles.subheadline}>{copy.subheadline}</Text>
          </View>

          <View style={styles.featureList}>
            {copy.features.map((feature) => (
              <View key={`${feature.title}-${feature.titleSuffix ?? ''}`} style={styles.featureRow}>
                <View style={styles.featureIcon}>
                  <Check size={14} color="#FFFFFF" strokeWidth={3.2} />
                </View>
                <View style={styles.featureCopy}>
                  {renderFeatureTitle(feature)}
                  <Text style={styles.featureBody}>{feature.body}</Text>
                </View>
              </View>
            ))}
          </View>

          {waitlistTrialActive && waitlistTrial.bonus ? (
            <View style={styles.waitlistBonusCard}>
              <Text style={styles.waitlistBonusEyebrow}>WAITLIST BONUS APPLIED</Text>
              <Text style={styles.waitlistBonusTitle}>
                {waitlistTrial.bonus.totalTrialDays} days of NuTri Pro trial
              </Text>
              <Text style={styles.waitlistBonusBody}>
                {waitlistTrial.bonus.bonusDays > 0
                  ? `Your invite activity unlocked ${waitlistTrial.bonus.bonusDays} extra ${waitlistTrial.bonus.bonusDays === 1 ? 'day' : 'days'} on top of the 3-day starting trial.`
                  : 'Your 3-day starting trial is active. Invite friends before launch to unlock more bonus days.'}
              </Text>
            </View>
          ) : null}

          <View style={styles.planStack}>
            <Pressable
              style={[styles.planButton, styles.annualButton, primaryDisabled ? styles.disabled : null]}
              onPress={() => {
                void handlePrimaryPress();
              }}
              disabled={primaryDisabled}
              accessibilityRole="button"
              accessibilityLabel={
                waitlistTrialActive
                  ? 'Continue with waitlist trial'
                  : annualTrialEligible
                    ? 'Start annual free trial'
                    : 'Continue yearly'
              }
            >
              <Image source={PAYWALL_BACKGROUND} contentFit="cover" style={styles.annualBackground} />
              <View style={styles.bestValueBadge}>
                <Text style={styles.bestValueText}>{waitlistTrialActive ? 'WAITLIST BONUS' : 'BEST VALUE'}</Text>
              </View>
              {subscription.purchaseBusy ? (
                <ActivityIndicator size="small" color="#0F172A" />
              ) : (
                <>
                  <Text style={styles.planTitlePrimary}>{primaryLabel}</Text>
                  <Text style={styles.planMetaPrimary}>{annualPlanMeta}</Text>
                </>
              )}
            </Pressable>

            {waitlistTrialActive ? null : (
              <Pressable
                style={[styles.planButton, styles.monthlyButton, monthlyDisabled ? styles.disabled : null]}
                onPress={() => {
                  void handleMonthlyPress();
                }}
                disabled={monthlyDisabled}
                accessibilityRole="button"
                accessibilityLabel="Continue monthly"
              >
                <Text style={styles.planTitleSecondary}>Continue monthly</Text>
                <Text style={styles.planMetaSecondary}>{monthlyPlanMeta}</Text>
              </Pressable>
            )}
          </View>

          {subscription.error ? <Text style={styles.errorText}>{subscription.error}</Text> : null}

          <Pressable
            style={styles.restoreButton}
            onPress={() => {
              void handleRestorePress();
            }}
            disabled={subscription.restoreBusy}
            accessibilityRole="button"
            accessibilityLabel="Restore purchases"
          >
            {subscription.restoreBusy ? (
              <ActivityIndicator size="small" color="#45556C" />
            ) : (
              <Text style={styles.restoreButtonText}>Restore Purchases</Text>
            )}
          </Pressable>

          <View style={styles.legalLinks}>
            <Pressable
              onPress={() => {
                void openTermsOfService();
              }}
              accessibilityRole="link"
              accessibilityLabel="Open Terms of Service"
              hitSlop={10}
            >
              <Text style={styles.legalLink}>Terms</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                void openPrivacyPolicy();
              }}
              accessibilityRole="link"
              accessibilityLabel="Open Privacy Policy"
              hitSlop={10}
            >
              <Text style={styles.legalLink}>Privacy</Text>
            </Pressable>
          </View>

          <Text style={styles.footerText}>{footerText}</Text>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#050505',
  },
  headerArt: {
    height: 240,
    overflow: 'hidden',
    backgroundColor: '#87D9FF',
  },
  closeButton: {
    position: 'absolute',
    left: 20,
    zIndex: 4,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.20)',
  },
  proTitle: {
    position: 'absolute',
    left: 24,
    bottom: 48,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.12)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 3,
  },
  sheet: {
    flex: 1,
    marginTop: -32,
    overflow: 'hidden',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  heroCopy: {
    gap: 10,
  },
  headline: {
    width: '100%',
    fontFamily: SERIF_FONT,
    fontSize: 26,
    lineHeight: 36,
    fontWeight: '600',
    color: '#1C1C1E',
    letterSpacing: -0.2,
  },
  subheadline: {
    maxWidth: 382,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    color: '#62748E',
    letterSpacing: -0.2,
  },
  featureList: {
    gap: 20,
    marginTop: 32,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  featureIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    backgroundColor: '#2C2C2E',
  },
  featureCopy: {
    flex: 1,
    gap: 2,
  },
  featureTitle: {
    fontFamily: SERIF_FONT,
    fontSize: 17,
    lineHeight: 23.5,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  featureAmpersand: {
    fontFamily: Platform.select({
      ios: 'Times New Roman',
      android: 'serif',
      default: 'serif',
    }),
    fontWeight: '600',
  },
  featureBody: {
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '600',
    color: '#62748E',
    letterSpacing: -0.2,
  },
  waitlistBonusCard: {
    marginTop: 30,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#B7E7FF',
    paddingHorizontal: 18,
    paddingVertical: 17,
    backgroundColor: '#F0FAFF',
  },
  waitlistBonusEyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    color: '#0678B8',
    letterSpacing: 0.8,
  },
  waitlistBonusTitle: {
    marginTop: 5,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.45,
  },
  waitlistBonusBody: {
    marginTop: 5,
    fontSize: 14,
    lineHeight: 19.5,
    fontWeight: '600',
    color: '#52657A',
    letterSpacing: -0.15,
  },
  planStack: {
    gap: 14,
    marginTop: 40,
  },
  planButton: {
    position: 'relative',
    width: '100%',
    minHeight: 80,
    overflow: 'visible',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  annualButton: {
    backgroundColor: '#93DAFF',
  },
  annualBackground: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
  },
  monthlyButton: {
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  disabled: {
    opacity: 0.62,
  },
  bestValueBadge: {
    position: 'absolute',
    top: -12,
    right: 18,
    minWidth: 92,
    height: 27,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2B7FFF',
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  bestValueText: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.6,
  },
  planTitlePrimary: {
    fontSize: 17,
    lineHeight: 25.5,
    fontWeight: '800',
    color: '#000000',
    letterSpacing: -0.75,
  },
  planMetaPrimary: {
    fontSize: 13.5,
    lineHeight: 20,
    fontWeight: '600',
    color: '#62748E',
    letterSpacing: -0.35,
  },
  planTitleSecondary: {
    fontSize: 17,
    lineHeight: 25.5,
    fontWeight: '800',
    color: '#000000',
    letterSpacing: -0.75,
  },
  planMetaSecondary: {
    fontSize: 13.5,
    lineHeight: 20,
    fontWeight: '600',
    color: '#62748E',
    letterSpacing: -0.35,
  },
  errorText: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    color: '#B91C1C',
  },
  restoreButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    paddingVertical: 2,
  },
  restoreButtonText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
    color: '#45556C',
    textDecorationLine: 'underline',
  },
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 14,
  },
  legalLink: {
    fontSize: 13,
    lineHeight: 19.5,
    fontWeight: '600',
    color: '#62748E',
    textDecorationLine: 'underline',
  },
  footerText: {
    marginTop: 28,
    paddingHorizontal: 16,
    fontSize: 11,
    lineHeight: 15.5,
    fontWeight: '600',
    textAlign: 'center',
    color: '#90A1B9',
    letterSpacing: 0.05,
  },
});
