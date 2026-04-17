import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { Check, ChevronLeft, Lock, Sparkles } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useFirstScanReveal } from '@/hooks/useFirstScanReveal';

type OfficialPaywallPageProps = {
  source: 'first_scan_result' | 'score' | 'comparison' | 'overview' | 'science' | 'usage' | 'safety';
  scanId?: string | null;
  returnTo?: string | null;
  onClose?: () => void;
};

const getCopy = (source: OfficialPaywallPageProps['source']) => {
  switch (source) {
    case 'first_scan_result':
      return {
        title: 'Know if this supplement fits you before you buy',
        body: 'You just saw the full first-scan premium analysis. Keep personalized fit, ingredient science, and better alternatives unlocked.',
      };
    case 'score':
      return {
        title: 'Unlock the full NuTri Score',
        body: 'Open the complete score breakdown, decision details, and product fit before you buy.',
      };
    case 'comparison':
      return {
        title: 'Unlock Better Alternatives',
        body: 'Compare this product with stronger options and see whether a better fit already exists.',
      };
    case 'overview':
      return {
        title: 'Unlock Product Overview',
        body: 'See what this supplement is, what it provides, and the key gaps to check before you commit.',
      };
    case 'science':
      return {
        title: 'Unlock Science & Ingredients',
        body: 'Read ingredient-by-ingredient science, dose context, and the formal evidence behind the formula.',
      };
    case 'usage':
      return {
        title: 'Unlock Usage Guidance',
        body: 'Get product-specific routine guidance, best-fit timing, and the next steps for this supplement.',
      };
    case 'safety':
      return {
        title: 'Unlock Safety Notes',
        body: 'Review warnings, upper-limit context, and the watch-outs that matter before adding this product.',
      };
    default:
      return {
        title: 'Unlock Premium',
        body: 'Get personalized fit, ingredient science, and better alternatives in one place.',
      };
  }
};

export function OfficialPaywallPage({ source, scanId = null, returnTo = null, onClose }: OfficialPaywallPageProps) {
  const { session, setPostAuthRedirect } = useAuth();
  const subscription = useSubscription();
  const firstScanReveal = useFirstScanReveal();
  const impressionLoggedRef = useRef(false);

  const annualProduct = subscription.annualPackage?.product ?? null;
  const monthlyProduct = subscription.monthlyPackage?.product ?? null;
  const annualPriceLine = annualProduct?.priceString ?? '$59.99/year';
  const monthlyPriceLine = monthlyProduct?.priceString ?? '$10.99/month';
  const annualMetaLine = annualProduct?.pricePerMonthString ?? '$5.00/month';
  const copy = useMemo(() => getCopy(source), [source]);

  useEffect(() => {
    if (source !== 'first_scan_result' || !scanId || impressionLoggedRef.current) {
      return;
    }

    impressionLoggedRef.current = true;
    void firstScanReveal.markPaywallSeen(scanId);
  }, [firstScanReveal, scanId, source]);

  const primaryLabel = useMemo(() => {
    if (!session?.user) {
      return 'Sign in to continue';
    }
    if (subscription.uiPreviewMode) {
      return 'Preview Premium';
    }
    if (subscription.purchaseBusy) {
      return 'Starting purchase...';
    }

    const purchaseProduct = annualProduct ?? subscription.primaryPackage?.product ?? null;
    if (purchaseProduct?.introPrice && subscription.trialEligibility === 'eligible') {
      return 'Start Free Trial';
    }
    if (purchaseProduct?.priceString) {
      return `Continue for ${purchaseProduct.priceString}`;
    }
    if (subscription.loading) {
      return 'Loading plans...';
    }
    return 'Get Premium';
  }, [
    annualProduct,
    session?.user,
    subscription.loading,
    subscription.primaryPackage,
    subscription.purchaseBusy,
    subscription.trialEligibility,
    subscription.uiPreviewMode,
  ]);

  const supportingText = useMemo(() => {
    if (!session?.user) {
      return 'Sign in first so we can attach Premium access to your account.';
    }
    if (subscription.uiPreviewMode) {
      return 'UI preview mode. Purchase buttons stay local until store keys are configured.';
    }
    if (subscription.previewMode) {
      return 'Real purchases work in a development build or production build.';
    }
    const purchaseProduct = annualProduct ?? subscription.primaryPackage?.product ?? null;
    if (!purchaseProduct) {
      return subscription.loading ? 'Loading the latest plans from the store.' : 'Plans are temporarily unavailable.';
    }
    if (purchaseProduct.introPrice && subscription.trialEligibility === 'eligible' && purchaseProduct.priceString) {
      return `Free trial available, then ${purchaseProduct.priceString}.`;
    }
    return purchaseProduct.priceString ?? null;
  }, [
    annualProduct,
    session?.user,
    subscription.loading,
    subscription.previewMode,
    subscription.primaryPackage,
    subscription.trialEligibility,
    subscription.uiPreviewMode,
  ]);

  const footerText = useMemo(() => {
    if (subscription.uiPreviewMode) {
      return '7-day free trial, then $59.99/year. Auto-renews until canceled. Cancel anytime in App Store or Google Play settings.';
    }
    if (annualProduct?.introPrice && subscription.trialEligibility === 'eligible') {
      return `${annualPriceLine}. Trial eligibility is shown before purchase. Auto-renews until canceled.`;
    }
    return `${annualPriceLine}. Auto-renews until canceled. Cancel anytime in App Store or Google Play settings.`;
  }, [annualPriceLine, annualProduct?.introPrice, subscription.trialEligibility, subscription.uiPreviewMode]);

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

    const result = await subscription.purchasePrimaryPackage();
    if (result.ok) {
      if (source === 'first_scan_result' && scanId) {
        await firstScanReveal.markConverted(scanId);
      }
      handleClose();
    }
  };

  const handleRestorePress = async () => {
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

  return (
    <ResponsiveScreen style={styles.screen} contentStyle={styles.content} gutter={0}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={handleClose}>
          <ChevronLeft size={20} color="#0F172A" />
        </Pressable>
        <View style={styles.headerBadge}>
          <Lock size={14} color="#0F172A" />
          <Text style={styles.headerBadgeText}>Premium</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroBadge}>
            <Sparkles size={14} color="#1D4ED8" />
            <Text style={styles.heroBadgeText}>Official Paywall</Text>
          </View>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
        </View>

        {source === 'first_scan_result' ? (
          <View style={styles.previewCard}>
            <Text style={styles.previewEyebrow}>First Scan Reveal</Text>
            <Text style={styles.previewTitle}>Your first scan showed the full premium result.</Text>
            <Text style={styles.previewBody}>
              If you continue without subscribing, that one-time reveal is spent and future access falls back to the locked version.
            </Text>
          </View>
        ) : null}

        <View style={styles.benefitList}>
          {[
            'Personalized fit for your goals',
            'Ingredient science that is easier to trust',
            'Compare with better alternatives before checkout',
          ].map(item => (
            <View key={item} style={styles.benefitRow}>
              <View style={styles.benefitIconWrap}>
                <Check size={14} color="#FFFFFF" />
              </View>
              <Text style={styles.benefitText}>{item}</Text>
            </View>
          ))}
        </View>

        <View style={styles.planList}>
          <View style={[styles.planCard, styles.planCardSelected]}>
            <View style={styles.planHeader}>
              <Text style={[styles.planTitle, styles.planTitleSelected]}>Annual</Text>
              <View style={styles.planBadge}>
                <Text style={styles.planBadgeText}>Best value</Text>
              </View>
            </View>
            <Text style={[styles.planPrice, styles.planPriceSelected]}>{annualPriceLine}</Text>
            <Text style={styles.planDetail}>
              {subscription.uiPreviewMode
                ? 'Billed yearly'
                : subscription.trialEligibility === 'eligible'
                  ? '7-day free trial'
                  : 'Billed yearly'}
            </Text>
            {annualMetaLine ? <Text style={styles.planMeta}>{annualMetaLine}</Text> : null}
          </View>

          <View style={[styles.planCard, styles.planCardMuted]}>
            <View style={styles.planHeader}>
              <Text style={styles.planTitle}>Monthly</Text>
            </View>
            <Text style={styles.planPrice}>{monthlyPriceLine}</Text>
            <Text style={styles.planDetail}>Billed monthly</Text>
          </View>
        </View>

        <Pressable
          style={[
            styles.primaryButton,
            (subscription.purchaseBusy || (Boolean(session?.user) && !subscription.uiPreviewMode && (!subscription.primaryPackage || subscription.loading)))
              ? styles.primaryButtonDisabled
              : null,
          ]}
          onPress={() => {
            void handlePrimaryPress();
          }}
          disabled={
            subscription.purchaseBusy
            || (Boolean(session?.user) && !subscription.uiPreviewMode && (!subscription.primaryPackage || subscription.loading))
          }
        >
          {subscription.purchaseBusy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
          )}
        </Pressable>

        {supportingText ? <Text style={styles.supportingText}>{supportingText}</Text> : null}
        {subscription.error ? <Text style={styles.errorText}>{subscription.error}</Text> : null}
        <Text style={styles.footerText}>{footerText}</Text>

        {session?.user ? (
          <Pressable
            style={styles.restoreButton}
            onPress={() => {
              void handleRestorePress();
            }}
            disabled={subscription.restoreBusy}
          >
            {subscription.restoreBusy ? (
              <ActivityIndicator size="small" color="#0F172A" />
            ) : (
              <Text style={styles.restoreButtonText}>Restore Purchases</Text>
            )}
          </Pressable>
        ) : null}

        <Pressable style={styles.secondaryButton} onPress={handleClose}>
          <Text style={styles.secondaryButtonText}>Not now</Text>
        </Pressable>
      </ScrollView>
    </ResponsiveScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F3F4F8',
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  headerBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSpacer: {
    width: 38,
    height: 38,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 16,
  },
  hero: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 20,
    gap: 10,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#E8F0FF',
  },
  heroBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  title: {
    fontSize: 29,
    lineHeight: 35,
    fontWeight: '800',
    color: '#0F172A',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: '#475569',
  },
  previewCard: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 18,
    gap: 8,
  },
  previewEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    color: '#93C5FD',
    textTransform: 'uppercase',
  },
  previewTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  previewBody: {
    fontSize: 14,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.82)',
  },
  benefitList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 18,
    gap: 14,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  benefitIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
    marginTop: 1,
  },
  benefitText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: '#0F172A',
  },
  planList: {
    gap: 12,
  },
  planCard: {
    borderRadius: 8,
    padding: 18,
    borderWidth: 1,
  },
  planCardSelected: {
    backgroundColor: '#ECF3FF',
    borderColor: '#3B82F6',
  },
  planCardMuted: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  planTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
  },
  planTitleSelected: {
    color: '#0F172A',
  },
  planBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#1D4ED8',
  },
  planBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  planPrice: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
    color: '#1E293B',
  },
  planPriceSelected: {
    color: '#0F172A',
  },
  planDetail: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: '#475569',
  },
  planMeta: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: '#64748B',
  },
  primaryButton: {
    height: 54,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    marginTop: 4,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  supportingText: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    color: '#475569',
  },
  errorText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    color: '#B91C1C',
  },
  footerText: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    color: '#64748B',
  },
  restoreButton: {
    height: 46,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  restoreButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
});
