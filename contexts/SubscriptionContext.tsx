import Constants from 'expo-constants';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { Platform } from 'react-native';
import Purchases, {
  INTRO_ELIGIBILITY_STATUS,
  LOG_LEVEL,
  PACKAGE_TYPE,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';

import { useAuth } from '@/contexts/AuthContext';
import { ENV } from '@/lib/env';
import { getPremiumTestOverride, setPremiumTestOverride, type PremiumTestOverride } from '@/lib/storage/premiumTester';
import { supabase } from '@/lib/supabase';
import { upsertUserPremiumEntitlement, type UserPremiumEntitlementWrite } from '@/lib/supabase/profile';

type TrialEligibility = 'eligible' | 'ineligible' | 'unknown' | 'not_available';

type PurchaseResult = {
  ok: boolean;
  cancelled?: boolean;
  message?: string;
  productId?: string | null;
  isTrial?: boolean;
};

type SubscriptionContextValue = {
  configured: boolean;
  loading: boolean;
  purchaseBusy: boolean;
  restoreBusy: boolean;
  previewMode: boolean;
  uiPreviewMode: boolean;
  error: string | null;
  customerInfo: CustomerInfo | null;
  offering: PurchasesOffering | null;
  primaryPackage: PurchasesPackage | null;
  annualPackage: PurchasesPackage | null;
  monthlyPackage: PurchasesPackage | null;
  trialEligibility: TrialEligibility;
  entitlementStatus: string | null;
  isPremium: boolean;
  testOverride: PremiumTestOverride;
  clearError: () => void;
  refresh: () => Promise<void>;
  setTestOverride: (value: PremiumTestOverride) => Promise<void>;
  purchasePrimaryPackage: () => Promise<PurchaseResult>;
  purchaseMonthlyPackage: () => Promise<PurchaseResult>;
  restorePurchases: () => Promise<PurchaseResult>;
};

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(undefined);

const ACTIVE_STATUSES = new Set(['active', 'trialing']);
const PREMIUM_TEST_OVERRIDE_ENABLED =
  typeof __DEV__ !== 'undefined' ? __DEV__ : false;

const normalizeStatus = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const findRevenueCatEntitlement = (
  entitlements: CustomerInfo['entitlements']['active'] | CustomerInfo['entitlements']['all'],
  preferredEntitlementId: string | null,
) => {
  if (!preferredEntitlementId) {
    return Object.values(entitlements)[0] ?? null;
  }

  const exactMatch = entitlements[preferredEntitlementId] ?? null;
  if (exactMatch) return exactMatch;

  const normalizedPreferredId = preferredEntitlementId.trim().toLowerCase();
  return (
    Object.values(entitlements).find(
      (entitlement) => entitlement.identifier.trim().toLowerCase() === normalizedPreferredId,
    ) ?? null
  );
};

const normalizeRevenueCatStatus = (customerInfo: CustomerInfo | null, preferredEntitlementId: string | null) => {
  if (!customerInfo) return null;

  const activeEntitlement = findRevenueCatEntitlement(customerInfo.entitlements.active, preferredEntitlementId);

  if (activeEntitlement) {
    return activeEntitlement.periodType?.toLowerCase() === 'trial' ? 'trialing' : 'active';
  }

  const knownEntitlement = findRevenueCatEntitlement(customerInfo.entitlements.all, preferredEntitlementId);

  if (!knownEntitlement) return 'inactive';
  if (knownEntitlement.billingIssueDetectedAt) return 'billing_issue';
  if (knownEntitlement.unsubscribeDetectedAt) return 'canceled';
  if (knownEntitlement.expirationDate) return 'expired';
  return 'inactive';
};

const resolvePreferredPackage = (offering: PurchasesOffering | null, packageType: PACKAGE_TYPE) => {
  if (!offering) return null;
  return offering.availablePackages.find((pkg) => pkg.packageType === packageType) ?? null;
};

const pickPrimaryPackage = (offering: PurchasesOffering | null) => {
  const annual = resolvePreferredPackage(offering, PACKAGE_TYPE.ANNUAL);
  if (annual) return annual;
  const monthly = resolvePreferredPackage(offering, PACKAGE_TYPE.MONTHLY);
  if (monthly) return monthly;
  return offering?.availablePackages?.[0] ?? null;
};

const mapCustomerInfoToWrite = (
  customerInfo: CustomerInfo | null,
  preferredEntitlementId: string | null,
): UserPremiumEntitlementWrite => {
  const normalizedStatus = normalizeRevenueCatStatus(customerInfo, preferredEntitlementId) ?? 'inactive';
  const entitlement = customerInfo
    ? findRevenueCatEntitlement(customerInfo.entitlements.all, preferredEntitlementId)
    : null;

  return {
    premium_status: normalizedStatus,
    premium_entitlement: entitlement?.identifier ?? preferredEntitlementId ?? null,
    premium_source: 'revenuecat',
    premium_customer_id: customerInfo?.originalAppUserId ?? null,
    premium_product_id: entitlement?.productIdentifier ?? null,
    premium_store: entitlement?.store ?? null,
    premium_expires_at: entitlement?.expirationDate ?? null,
    premium_will_renew: entitlement?.willRenew ?? null,
    premium_period_type: entitlement?.periodType?.toLowerCase?.() ?? null,
    premium_updated_at: new Date().toISOString(),
  };
};

const getActivePurchaseMetadata = (
  customerInfo: CustomerInfo | null,
  preferredEntitlementId: string | null,
) => {
  const activeEntitlement = customerInfo
    ? findRevenueCatEntitlement(customerInfo.entitlements.active, preferredEntitlementId)
    : null;

  return {
    productId: activeEntitlement?.productIdentifier ?? null,
    isTrial: activeEntitlement?.periodType?.toLowerCase?.() === 'trial',
  };
};

const getRevenueCatApiKey = () => {
  if (Platform.OS === 'ios') return ENV.revenueCatIosApiKey;
  if (Platform.OS === 'android') return ENV.revenueCatAndroidApiKey;
  return null;
};

const resolvePurchaseErrorMessage = (error: unknown) => {
  if (error && typeof error === 'object') {
    const maybeMessage = 'message' in error ? error.message : null;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage.trim();
    }
  }

  return 'Purchase could not be completed right now.';
};

export const SubscriptionProvider = ({ children }: PropsWithChildren) => {
  const { user, loading: authLoading } = useAuth();
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [trialEligibility, setTrialEligibility] = useState<TrialEligibility>('unknown');
  const [testOverride, setTestOverrideState] = useState<PremiumTestOverride>('auto');
  const configuredRef = useRef(false);
  const currentAppUserIdRef = useRef<string | null>(null);
  const lastSyncedSignatureRef = useRef<string | null>(null);
  const appOwnership = Constants.appOwnership;
  const previewMode = appOwnership === 'expo' || appOwnership === 'guest';
  const entitlementId = ENV.revenueCatEntitlementId?.trim() || null;
  const apiKey = getRevenueCatApiKey();
  const uiPreviewMode = previewMode || !apiKey;

  useEffect(() => {
    lastSyncedSignatureRef.current = null;
  }, [user?.id]);

  useEffect(() => {
    let active = true;

    if (!PREMIUM_TEST_OVERRIDE_ENABLED) {
      setTestOverrideState('auto');
      return () => {
        active = false;
      };
    }

    void getPremiumTestOverride()
      .then((value) => {
        if (!active) return;
        setTestOverrideState(value);
      })
      .catch((loadError) => {
        console.warn('[subscription] failed to load premium test override', loadError);
      });

    return () => {
      active = false;
    };
  }, []);

  const persistEntitlement = useCallback(
    async (nextCustomerInfo: CustomerInfo | null) => {
      const userId = user?.id?.trim();
      if (!userId) return;

      const write = mapCustomerInfoToWrite(nextCustomerInfo, entitlementId);
      const signature = JSON.stringify(write);
      if (lastSyncedSignatureRef.current === signature) return;
      lastSyncedSignatureRef.current = signature;

      const profileResult = await upsertUserPremiumEntitlement(supabase, userId, write);
      if (!profileResult.ok) {
        console.warn('[subscription] failed to persist premium entitlement to user_profiles', profileResult.error);
      }

      const { error: metadataError } = await supabase.auth.updateUser({
        data: {
          subscription_status: write.premium_status,
          entitlement: write.premium_entitlement,
          premium_source: write.premium_source,
          premium_product_id: write.premium_product_id,
          premium_expires_at: write.premium_expires_at,
          premium_updated_at: write.premium_updated_at,
        },
      });

      if (metadataError) {
        console.warn('[subscription] failed to persist premium entitlement to user metadata', metadataError);
      }
    },
    [entitlementId, user?.id],
  );

  const refresh = useCallback(async () => {
    if (!configuredRef.current) return;

    try {
      const [nextCustomerInfo, offerings] = await Promise.all([
        Purchases.getCustomerInfo(),
        Purchases.getOfferings(),
      ]);

      setCustomerInfo(nextCustomerInfo);
      setOffering(offerings.current ?? null);
      await persistEntitlement(nextCustomerInfo);

      const annual = resolvePreferredPackage(offerings.current ?? null, PACKAGE_TYPE.ANNUAL);
      if (annual?.product?.identifier && Platform.OS === 'ios') {
        const intro = await Purchases.checkTrialOrIntroductoryPriceEligibility([annual.product.identifier]);
        const eligibility = intro[annual.product.identifier];
        if (!eligibility) {
          setTrialEligibility('unknown');
        } else if (eligibility.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE) {
          setTrialEligibility('eligible');
        } else if (
          eligibility.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE
          || eligibility.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS
        ) {
          setTrialEligibility('ineligible');
        } else {
          setTrialEligibility('unknown');
        }
      } else if (annual?.product?.introPrice) {
        setTrialEligibility('eligible');
      } else {
        setTrialEligibility('not_available');
      }
    } catch (refreshError) {
      console.warn('[subscription] failed to refresh offerings/customer info', refreshError);
      setError(resolvePurchaseErrorMessage(refreshError));
    }
  }, [persistEntitlement]);

  useEffect(() => {
    if (authLoading) return;

    if (!apiKey || (Platform.OS !== 'ios' && Platform.OS !== 'android')) {
      setConfigured(false);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const bootstrap = async () => {
      try {
        if (__DEV__) {
          Purchases.setLogLevel(LOG_LEVEL.VERBOSE);
        }

        if (!configuredRef.current) {
          Purchases.configure({
            apiKey,
            appUserID: user?.id ?? undefined,
          });
          configuredRef.current = true;
          currentAppUserIdRef.current = user?.id ?? null;
          setConfigured(true);
        } else if (currentAppUserIdRef.current !== (user?.id ?? null)) {
          if (user?.id) {
            const loginResult = await Purchases.logIn(user.id);
            if (!cancelled) {
              setCustomerInfo(loginResult.customerInfo);
              await persistEntitlement(loginResult.customerInfo);
            }
          } else {
            const loggedOutCustomerInfo = await Purchases.logOut();
            if (!cancelled) {
              setCustomerInfo(loggedOutCustomerInfo);
            }
          }
          currentAppUserIdRef.current = user?.id ?? null;
        }

        if (!cancelled) {
          await refresh();
        }
      } catch (bootstrapError) {
        console.warn('[subscription] failed to initialize RevenueCat', bootstrapError);
        if (!cancelled) {
          setConfigured(false);
          setError(resolvePurchaseErrorMessage(bootstrapError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [apiKey, authLoading, persistEntitlement, refresh, user?.id]);

  useEffect(() => {
    if (!configuredRef.current) return;

    const listener = (nextCustomerInfo: CustomerInfo) => {
      setCustomerInfo(nextCustomerInfo);
      void persistEntitlement(nextCustomerInfo);
    };

    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, [persistEntitlement]);

  const purchasePrimaryPackage = useCallback(async (): Promise<PurchaseResult> => {
    if (previewMode) {
      const message = 'Real purchases require a development build or production build.';
      setError(message);
      return { ok: false, message };
    }

    const primaryPackage = pickPrimaryPackage(offering);
    if (!primaryPackage) {
      const message = 'Plans are temporarily unavailable.';
      setError(message);
      return { ok: false, message };
    }

    setPurchaseBusy(true);
    setError(null);

    try {
      const result = await Purchases.purchasePackage(primaryPackage);
      setCustomerInfo(result.customerInfo);
      await persistEntitlement(result.customerInfo);
      await refresh();
      const metadata = getActivePurchaseMetadata(result.customerInfo, entitlementId);
      return {
        ok: true,
        productId: metadata.productId ?? primaryPackage.product.identifier,
        isTrial: metadata.isTrial || Boolean(primaryPackage.product.introPrice),
      };
    } catch (purchaseError) {
      const userCancelled =
        purchaseError != null
        && typeof purchaseError === 'object'
        && 'userCancelled' in purchaseError
        && purchaseError.userCancelled === true;

      if (userCancelled) {
        return { ok: false, cancelled: true };
      }

      const message = resolvePurchaseErrorMessage(purchaseError);
      setError(message);
      return { ok: false, message };
    } finally {
      setPurchaseBusy(false);
    }
  }, [entitlementId, offering, persistEntitlement, previewMode, refresh]);

  const purchaseMonthlyPackage = useCallback(async (): Promise<PurchaseResult> => {
    if (previewMode) {
      const message = 'Real purchases require a development build or production build.';
      setError(message);
      return { ok: false, message };
    }

    const monthlyPackage = resolvePreferredPackage(offering, PACKAGE_TYPE.MONTHLY);
    if (!monthlyPackage) {
      const message = 'Monthly plan is temporarily unavailable.';
      setError(message);
      return { ok: false, message };
    }

    setPurchaseBusy(true);
    setError(null);

    try {
      const result = await Purchases.purchasePackage(monthlyPackage);
      setCustomerInfo(result.customerInfo);
      await persistEntitlement(result.customerInfo);
      await refresh();
      const metadata = getActivePurchaseMetadata(result.customerInfo, entitlementId);
      return {
        ok: true,
        productId: metadata.productId ?? monthlyPackage.product.identifier,
        isTrial: metadata.isTrial || Boolean(monthlyPackage.product.introPrice),
      };
    } catch (purchaseError) {
      const userCancelled =
        purchaseError != null
        && typeof purchaseError === 'object'
        && 'userCancelled' in purchaseError
        && purchaseError.userCancelled === true;

      if (userCancelled) {
        return { ok: false, cancelled: true };
      }

      const message = resolvePurchaseErrorMessage(purchaseError);
      setError(message);
      return { ok: false, message };
    } finally {
      setPurchaseBusy(false);
    }
  }, [entitlementId, offering, persistEntitlement, previewMode, refresh]);

  const restorePurchases = useCallback(async (): Promise<PurchaseResult> => {
    if (previewMode) {
      const message = 'Restoring purchases requires a development build or production build.';
      setError(message);
      return { ok: false, message };
    }

    setRestoreBusy(true);
    setError(null);

    try {
      const restoredCustomerInfo = await Purchases.restorePurchases();
      setCustomerInfo(restoredCustomerInfo);
      await persistEntitlement(restoredCustomerInfo);
      await refresh();
      const restoredStatus = normalizeStatus(normalizeRevenueCatStatus(restoredCustomerInfo, entitlementId));
      const isPremium = restoredStatus != null && ACTIVE_STATUSES.has(restoredStatus);
      if (!isPremium) {
        const message = 'No active Premium purchase was found for this account.';
        setError(message);
        return { ok: false, message };
      }

      const metadata = getActivePurchaseMetadata(restoredCustomerInfo, entitlementId);
      return {
        ok: true,
        productId: metadata.productId,
        isTrial: metadata.isTrial,
      };
    } catch (restoreError) {
      const message = resolvePurchaseErrorMessage(restoreError);
      setError(message);
      return { ok: false, message };
    } finally {
      setRestoreBusy(false);
    }
  }, [entitlementId, persistEntitlement, previewMode, refresh]);

  const handleSetTestOverride = useCallback(async (value: PremiumTestOverride) => {
    if (!PREMIUM_TEST_OVERRIDE_ENABLED) {
      setTestOverrideState('auto');
      return;
    }

    setTestOverrideState(value);
    await setPremiumTestOverride(value);
  }, []);

  const value = useMemo<SubscriptionContextValue>(() => {
    const annualPackage = resolvePreferredPackage(offering, PACKAGE_TYPE.ANNUAL);
    const monthlyPackage = resolvePreferredPackage(offering, PACKAGE_TYPE.MONTHLY);
    const primaryPackage = pickPrimaryPackage(offering);
    const liveEntitlementStatus = normalizeStatus(normalizeRevenueCatStatus(customerInfo, entitlementId));
    const effectiveTestOverride = PREMIUM_TEST_OVERRIDE_ENABLED ? testOverride : 'auto';
    const entitlementStatus =
      effectiveTestOverride === 'paid'
        ? 'paid_override'
        : effectiveTestOverride === 'unpaid'
          ? 'unpaid_override'
          : liveEntitlementStatus;
    const isPremium =
      effectiveTestOverride === 'paid'
        ? true
        : effectiveTestOverride === 'unpaid'
          ? false
          : entitlementStatus != null && ACTIVE_STATUSES.has(entitlementStatus);

    return {
      configured,
      loading,
      purchaseBusy,
      restoreBusy,
      previewMode,
      uiPreviewMode,
      error,
      customerInfo,
      offering,
      primaryPackage,
      annualPackage,
      monthlyPackage,
      trialEligibility,
      entitlementStatus,
      isPremium,
      testOverride: effectiveTestOverride,
      clearError: () => setError(null),
      refresh,
      setTestOverride: handleSetTestOverride,
      purchasePrimaryPackage,
      purchaseMonthlyPackage,
      restorePurchases,
    };
  }, [
    configured,
    customerInfo,
    entitlementId,
    error,
    loading,
    offering,
    previewMode,
    uiPreviewMode,
    purchaseBusy,
    purchaseMonthlyPackage,
    purchasePrimaryPackage,
    refresh,
    restoreBusy,
    restorePurchases,
    handleSetTestOverride,
    testOverride,
    trialEligibility,
  ]);

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
};

export const useSubscription = () => {
  const value = useContext(SubscriptionContext);
  if (!value) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return value;
};
