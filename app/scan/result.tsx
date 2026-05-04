import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { FileText } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import { ScanResultHeaderChrome } from '@/components/scan/ScanResultHeaderChrome';
import { OrganicSpinner } from '@/components/ui/OrganicSpinner';
import { ShinyText } from '@/components/ui/ShinyText';
import { useAuth } from '@/contexts/AuthContext';
import { useScanHistory } from '@/contexts/ScanHistoryContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';
import { useFirstScanReveal } from '@/hooks/useFirstScanReveal';
import { useStreamAnalysis } from '@/hooks/useStreamAnalysis';
import { useSavedSupplements } from '@/contexts/SavedSupplementsContext';
import { usePremiumAccess } from '@/hooks/usePremiumAccess';
import { choosePreferredProductImageUrl } from '@/lib/productImagePreference';
import { consumeScanSessionWithStatusAsync, ensureSessionId, type ScanSession } from '@/lib/scan/session';
import { resolveReasonCodeMessage } from '@/lib/scan/streamStateMachine';
import { getBarcodeQuality } from '@/lib/scan/quality';
import { formatDoseForPill } from '@/lib/supplementDisplay';
import { AnalysisDashboard } from '@/components/scan/AnalysisDashboard';

type HeaderMiniScoreState = {
  overallScore: number;
  overallBand: string | null;
  muted: boolean;
};

type HeaderMiniScoreTriggerState = {
  start: number;
  range: number;
};

type RecentScanProductInfo = {
  name: string | null;
  brand: string | null;
  category: string | null;
  image: string | null;
};

const FORCE_LITE_DASHBOARD =
  process.env.EXPO_PUBLIC_FORCE_LITE_DASHBOARD === 'true' ||
  process.env.EXPO_PUBLIC_FORCE_LITE_DASHBOARD === '1';
const FORCE_FULL_DASHBOARD =
  process.env.EXPO_PUBLIC_FORCE_FULL_DASHBOARD === 'true' ||
  process.env.EXPO_PUBLIC_FORCE_FULL_DASHBOARD === '1';
const SHOW_SCAN_DEBUG =
  process.env.EXPO_PUBLIC_SHOW_SCAN_DEBUG === 'true' ||
  process.env.EXPO_PUBLIC_SHOW_SCAN_DEBUG === '1';
const DEFAULT_HEADER_MINI_SCORE_TRIGGER: HeaderMiniScoreTriggerState = {
  start: 210,
  range: 70,
};

const emitScanUxMetric = (event: string, payload: Record<string, unknown> = {}) => {
  console.info('[scan-ux-metric]', { event, ...payload });
};

const resolveDashboardRenderMode = (_isExpoGo: boolean): 'full' => {
  // Hard-lock to full dashboard so we never regress to legacy Lite UI during runtime.
  return 'full';
};

const normalizeBarcode = (value?: string | null) => {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length >= 14) return digits.slice(-14);
  if (digits.length >= 8) return digits.padStart(14, '0');
  return digits;
};

const normalizeSavedKeyPart = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '').trim();

const buildSavedNameKey = (productName: string, brandName: string) =>
  `name:${normalizeSavedKeyPart(brandName)}:${normalizeSavedKeyPart(productName)}`;

const getSavedSupplementKeys = (item: {
  supplementId?: string | null;
  barcode?: string | null;
  productName: string;
  brandName: string;
}) => {
  const keys: string[] = [];
  if (item.supplementId) keys.push(`supplement:${item.supplementId}`);
  if (item.barcode) keys.push(`barcode:${item.barcode}`);
  keys.push(buildSavedNameKey(item.productName, item.brandName));
  return keys;
};

type DashboardErrorBoundaryProps = {
  children: React.ReactNode;
  onError?: (message: string, detail?: string | null) => void;
};

type DashboardErrorBoundaryState = {
  hasError: boolean;
  message: string | null;
  detail: string | null;
};

class DashboardErrorBoundary extends React.Component<
  DashboardErrorBoundaryProps,
  DashboardErrorBoundaryState
> {
  state: DashboardErrorBoundaryState = {
    hasError: false,
    message: null,
    detail: null,
  };

  static getDerivedStateFromError(error: unknown): DashboardErrorBoundaryState {
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Dashboard render failed';
    const detail =
      error instanceof Error && typeof error.stack === 'string'
        ? error.stack.split('\n').slice(0, 8).join('\n')
        : null;
    return { hasError: true, message, detail };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Dashboard render failed';
    const errorStack =
      error instanceof Error && typeof error.stack === 'string'
        ? error.stack.split('\n').slice(0, 8).join('\n')
        : null;
    const componentStack = info.componentStack?.trim() || null;
    const detail = [errorStack, componentStack].filter(Boolean).join('\n\n') || null;
    console.error('[ScanResult][DashboardErrorBoundary]', error, info);
    if (detail && this.state.detail !== detail) {
      this.setState({ detail });
    }
    this.props.onError?.(message, detail);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.fallbackContainer}>
          <FileText size={48} color="#52525b" />
          <Text style={styles.fallbackTitle}>Analysis temporarily unavailable</Text>
          <Text style={styles.fallbackText}>
            {this.state.message || 'The dashboard failed to render.'}
          </Text>
          {this.state.detail ? (
            <Text style={styles.fallbackDebugText}>{this.state.detail}</Text>
          ) : null}
        </View>
      );
    }
    return this.props.children;
  }
}

export default function ScanResultScreen() {
  const { tokens } = useResponsiveTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const appOwnership = Constants.appOwnership;
  const isExpoGo = appOwnership === 'expo' || appOwnership === 'guest';
  const { addScan } = useScanHistory();
  const { session: authSession, setPostAuthRedirect } = useAuth();
  const { onbCompleted, loading: onboardingLoading } = useOnboarding();
  const { addSupplement, savedSupplements, updateSupplement } = useSavedSupplements();
  const premiumAccess = usePremiumAccess();
  const firstScanReveal = useFirstScanReveal();
  const addedRef = useRef(false);
  const lastDosageRef = useRef<string | null>(null);
  const lastBrandRef = useRef<string | null>(null);
  const lastSupplementIdRef = useRef<string | null>(null);
  const firstScanPaywallRequestedRef = useRef<string | null>(null);

  // Get session to retrieve barcode
  const params = useLocalSearchParams<{ sessionId?: string; devBarcode?: string; source?: string }>();
  const [session, setSession] = useState<ScanSession | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [sessionState, setSessionState] = useState<'ok' | 'session_expired'>('ok');
  const barcode = session?.mode === 'barcode' ? session.input.barcode : '';
  const routeSource = typeof params.source === 'string' && params.source.trim().length > 0
    ? params.source.trim()
    : null;
  const sessionSource = typeof session?.source === 'string' && session.source.trim().length > 0
    ? session.source.trim()
    : null;
  const effectiveScanSource = sessionSource ?? routeSource;
  const currentScanId =
    typeof params.sessionId === 'string' && params.sessionId.trim().length > 0
      ? params.sessionId.trim()
      : session?.id ?? null;
  const guestScanSessionId =
    session?.source === 'guest_scan' && typeof session.guestScanSessionId === 'string'
      ? session.guestScanSessionId.trim() || null
      : null;
  const isGuestScan = effectiveScanSource === 'guest_scan' && Boolean(guestScanSessionId);
  const [dashboardRuntimeError, setDashboardRuntimeError] = useState<string | null>(null);
  const dashboardRenderMode: 'full' = resolveDashboardRenderMode(isExpoGo);
  const analysisHeaderScrollY = useSharedValue(0);
  const [headerMiniScore, setHeaderMiniScore] = useState<HeaderMiniScoreState | null>(null);
  const [headerMiniScoreTrigger, setHeaderMiniScoreTrigger] = useState<HeaderMiniScoreTriggerState>(
    DEFAULT_HEADER_MINI_SCORE_TRIGGER,
  );
  const [dashboardCoreReady, setDashboardCoreReady] = useState(false);
  const isOnboardingFirstScan = effectiveScanSource === 'onboarding';
  const isFirstRevealEligibleForCurrentScan =
    !premiumAccess.isPremium
    && onbCompleted
    && currentScanId != null
    && firstScanReveal.reveal.state === 'eligible'
    && (
      !firstScanReveal.firstCompletedScanId
      || firstScanReveal.firstCompletedScanId === currentScanId
    );
  const isFirstRevealPendingGrant =
    !firstScanReveal.loading
    && isOnboardingFirstScan
    && isFirstRevealEligibleForCurrentScan;
  const isFirstRevealActive =
    !premiumAccess.isPremium
    && currentScanId != null
    && firstScanReveal.reveal.state === 'granted'
    && firstScanReveal.reveal.scanId === currentScanId;
  const searchResultSeed = session?.mode === 'barcode' ? session.searchResultSeed ?? null : null;
  const loadingBadgeTimingRef = useRef({
    startedAt: 0,
    seen: false,
    hiddenLogged: false,
  });

  // 🚀 Use the Streaming Hook
  const {
    productInfo,
    efficacy,
    safety,
    usage,
    value,
    social,
    status,
    errorKind,
    reasonCode,
    stage,
    requestId,
    lastSseEventType,
    watchdogReason,
    displayIdentityMode,
    displayIdentitySourceAttribution,
    titleSanitized,
    error,
    analysisMeta,
    snapshot,
    analysisBundle,
  } = useStreamAnalysis(barcode, {
    launchSource: effectiveScanSource,
    searchSeed: searchResultSeed,
    scanSessionId: currentScanId,
    guestScanSessionId,
  });
  const barcodeQuality = useMemo(
    () => getBarcodeQuality({
      status,
      error,
      errorKind,
      sessionState,
    }),
    [error, errorKind, sessionState, status],
  );
  const handleHeaderMiniScoreChange = useCallback((next: HeaderMiniScoreState) => {
    setHeaderMiniScore((prev) => {
      if (
        prev?.overallScore === next.overallScore &&
        prev?.overallBand === next.overallBand &&
        prev?.muted === next.muted
      ) {
        return prev;
      }
      return next;
    });
  }, []);
  const handleHeaderMiniScoreTriggerChange = useCallback((next: HeaderMiniScoreTriggerState) => {
    setHeaderMiniScoreTrigger((prev) => {
      if (prev.start === next.start && prev.range === next.range) {
        return prev;
      }
      return next;
    });
  }, []);
  const handleDashboardCoreReadyChange = useCallback((next: boolean) => {
    setDashboardCoreReady((prev) => (prev === next ? prev : next));
  }, []);
  useEffect(() => {
    analysisHeaderScrollY.value = 0;
    setHeaderMiniScore(null);
    setHeaderMiniScoreTrigger(DEFAULT_HEADER_MINI_SCORE_TRIGGER);
    setDashboardCoreReady(false);
    firstScanPaywallRequestedRef.current = null;
    loadingBadgeTimingRef.current = {
      startedAt: 0,
      seen: false,
      hiddenLogged: false,
    };
  }, [analysisHeaderScrollY, barcode, params.sessionId]);

  const analysisOriginPath = effectiveScanSource === 'search' ? '/search' : '/scan/barcode';
  const canReturnToSearch = effectiveScanSource === 'search';
  const retryActionLabel = canReturnToSearch ? 'Back to Search' : 'Retry Scan';
  const newActionLabel = canReturnToSearch ? 'Back to Search' : 'Start New Scan';

  const navigateToAnalysisOrigin = useCallback(() => {
    if (canReturnToSearch && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(analysisOriginPath);
  }, [analysisOriginPath, canReturnToSearch]);

  const openFirstRevealExitPaywall = useCallback(() => {
    if (!currentScanId || (!isFirstRevealActive && !isFirstRevealPendingGrant)) {
      navigateToAnalysisOrigin();
      return;
    }

    if (firstScanPaywallRequestedRef.current === currentScanId) {
      return;
    }

    firstScanPaywallRequestedRef.current = currentScanId;
    router.replace({
      pathname: '/paywall/official',
      params: {
        source: 'first_scan_result',
        scanId: currentScanId,
        returnTo: analysisOriginPath,
      },
    });
  }, [
    analysisOriginPath,
    currentScanId,
    isFirstRevealActive,
    isFirstRevealPendingGrant,
    navigateToAnalysisOrigin,
  ]);
  const debugPanelNode = SHOW_SCAN_DEBUG ? (
    <DebugScanPanel
      requestId={requestId}
      lastEvent={lastSseEventType}
      reasonCode={reasonCode}
      stage={stage}
      watchdogReason={watchdogReason}
      displayIdentityMode={displayIdentityMode}
      displayIdentitySourceAttribution={displayIdentitySourceAttribution}
      titleSanitized={titleSanitized}
      routeDecision={barcodeQuality.page}
    />
  ) : null;
  const recentScanProductInfo = useMemo<RecentScanProductInfo | null>(() => {
    const bundleIdentity = analysisBundle?.meta?.productIdentity ?? null;
    const snapshotProduct = snapshot?.product ?? null;
    const candidate: RecentScanProductInfo = {
      name: productInfo?.name ?? bundleIdentity?.name ?? snapshotProduct?.name ?? null,
      brand: productInfo?.brand ?? bundleIdentity?.brand ?? snapshotProduct?.brand ?? null,
      category: productInfo?.category ?? snapshotProduct?.category ?? null,
      image: choosePreferredProductImageUrl(productInfo?.image, snapshotProduct?.imageUrl),
    };
    const hasIdentity =
      (typeof candidate.name === 'string' && candidate.name.trim().length > 0) ||
      (typeof candidate.brand === 'string' && candidate.brand.trim().length > 0);
    return hasIdentity ? candidate : null;
  }, [analysisBundle?.meta?.productIdentity, productInfo, snapshot?.product]);
  const bundleRevision =
    typeof analysisBundle?.meta?.revision === 'number' ? analysisBundle.meta.revision : null;
  // Removed legacy full-screen "Analyzing supplement..." interstitial.
  // We now render the dashboard skeleton immediately for a smoother UI.
  const holdDashboardDuringSkeleton = false;
  const isStreaming = status === 'streaming' || status === 'loading';
  const showStreamingBadge = isStreaming && !dashboardCoreReady;

  useEffect(() => {
    if (!__DEV__) return;
    console.log('[ScanResult] route state', {
      sessionId: typeof params.sessionId === 'string' ? params.sessionId : null,
      status,
      errorKind,
      page: barcodeQuality.page,
      sessionState,
      bundleRevision,
      holdDashboardDuringSkeleton,
    });
  }, [
    params.sessionId,
    status,
    errorKind,
    barcodeQuality.page,
    sessionState,
    bundleRevision,
    holdDashboardDuringSkeleton,
  ]);
  useEffect(() => {
    if (showStreamingBadge) {
      if (!loadingBadgeTimingRef.current.seen) {
        loadingBadgeTimingRef.current = {
          startedAt: Date.now(),
          seen: true,
          hiddenLogged: false,
        };
      }
      return;
    }
    if (!loadingBadgeTimingRef.current.seen || loadingBadgeTimingRef.current.hiddenLogged) return;
    loadingBadgeTimingRef.current.hiddenLogged = true;
    emitScanUxMetric('time_to_loading_badge_hidden', {
      sessionId: typeof params.sessionId === 'string' ? params.sessionId : null,
      barcode: barcode || null,
      elapsedMs: Date.now() - loadingBadgeTimingRef.current.startedAt,
      dashboardCoreReady,
      status,
    });
  }, [barcode, dashboardCoreReady, params.sessionId, showStreamingBadge, status]);

  const formatDose = useCallback((value?: number | string | null, unit?: string | null) => {
    if (value == null) return null;
    const cleanValue = typeof value === 'string' ? value.trim() : value;
    if (cleanValue === '') return null;
    const cleanUnit = unit?.trim() ?? '';
    return cleanUnit ? `${cleanValue} ${cleanUnit}` : String(cleanValue);
  }, []);

  const extractDoseFromText = useCallback((text?: string | null) => {
    return formatDoseForPill(text);
  }, []);

  const dashboardDosageText = useMemo(() => {
    const bundleActiveDose = (() => {
      const items = (analysisBundle as any)?.sections?.ingredients?.cover?.items;
      if (!Array.isArray(items)) return null;
      for (const item of items) {
        const raw = typeof item?.dose === 'string' ? item.dose : null;
        const parsed = formatDoseForPill(raw);
        if (parsed) return parsed;
      }
      return null;
    })();
    const primaryDose = formatDoseForPill(
      formatDose(efficacy?.primaryActive?.dosageValue ?? null, efficacy?.primaryActive?.dosageUnit ?? null),
    );
    const ingredientDose = (() => {
      const firstWithDose = efficacy?.ingredients?.find(
        (ingredient) => ingredient.dosageValue != null,
      );
      const raw = formatDose(firstWithDose?.dosageValue ?? null, firstWithDose?.dosageUnit ?? null);
      return formatDoseForPill(raw);
    })();
    const usageDoseRaw = (usage as { dosage?: string } | null)?.dosage ?? null;
    const usageDose = formatDoseForPill(usageDoseRaw);
    const activeIngredientAmountRaw = efficacy?.activeIngredients?.[0]?.amount ?? null;
    const activeIngredientDose = typeof activeIngredientAmountRaw === 'string'
      ? formatDoseForPill(activeIngredientAmountRaw)
      : null;
    const summaryDose =
      extractDoseFromText((usage as { summary?: string } | null)?.summary ?? null) ??
      extractDoseFromText(efficacy?.overviewSummary ?? null) ??
      extractDoseFromText(efficacy?.overallAssessment ?? null);
    return (
      bundleActiveDose ??
      primaryDose ??
      ingredientDose ??
      activeIngredientDose ??
      summaryDose ??
      usageDose ??
      ''
    );
  }, [analysisBundle, efficacy, extractDoseFromText, formatDose, usage]);

  const dashboardSaveItem = useMemo(() => {
    if (barcodeQuality.page !== 'dashboard' || !recentScanProductInfo) return null;
    return {
      supplementId: snapshot?.product?.entityRefs?.supplementId ?? null,
      barcode: barcode || null,
      productName: recentScanProductInfo.name ?? 'Unknown supplement',
      brandName: recentScanProductInfo.brand ?? 'Unknown brand',
      dosageText: dashboardDosageText,
      imageUrl: recentScanProductInfo.image ?? null,
    };
  }, [barcode, barcodeQuality.page, dashboardDosageText, recentScanProductInfo, snapshot?.product?.entityRefs?.supplementId]);

  const savedKeySet = useMemo(() => {
    const keys = new Set<string>();
    savedSupplements.forEach((item) => {
      getSavedSupplementKeys(item).forEach((key) => keys.add(key));
    });
    return keys;
  }, [savedSupplements]);

  const isDashboardItemSaved = useMemo(() => {
    if (!dashboardSaveItem) return false;
    return getSavedSupplementKeys(dashboardSaveItem).some((key) => savedKeySet.has(key));
  }, [dashboardSaveItem, savedKeySet]);

  const handleSaveFromDashboard = useCallback(() => {
    if (!dashboardSaveItem) return;
    addSupplement({
      supplementId: dashboardSaveItem.supplementId ?? undefined,
      barcode: dashboardSaveItem.barcode ?? null,
      imageUrl: dashboardSaveItem.imageUrl ?? null,
      productName: dashboardSaveItem.productName,
      brandName: dashboardSaveItem.brandName,
      dosageText: dashboardSaveItem.dosageText,
    });
  }, [addSupplement, dashboardSaveItem]);

  const handleKeepGuestResult = useCallback(() => {
    if (!guestScanSessionId || !currentScanId) return;
    const returnTo = `/scan/result?sessionId=${encodeURIComponent(currentScanId)}`;
    const redirectTarget = `/guest-scan/claim?guestScanSessionId=${encodeURIComponent(guestScanSessionId)}&returnTo=${encodeURIComponent(returnTo)}`;

    if (authSession?.user) {
      router.push(redirectTarget as never);
      return;
    }

    setPostAuthRedirect(redirectTarget);
    router.push({
      pathname: '/auth/signup',
      params: {
        redirect: redirectTarget,
      },
    });
  }, [authSession?.user, currentScanId, guestScanSessionId, setPostAuthRedirect]);

  const handleOpenSaved = useCallback(() => {
    router.push({ pathname: '/main/Home-Page', params: { tab: 'saved' } });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSessionResolved(false);
    const routeDevBarcode =
      typeof params.devBarcode === 'string' ? normalizeBarcode(params.devBarcode) : '';
    const envDevBarcode = (process.env.EXPO_PUBLIC_SCAN_RESULT_DEV_BARCODE ?? '').trim();
    const devFixtureBarcode = routeDevBarcode || envDevBarcode;

    const hydrateSession = async () => {
      const consumeResult = await consumeScanSessionWithStatusAsync(
        typeof params.sessionId === 'string' ? params.sessionId : null,
      );
      if (cancelled) return;

      if (consumeResult.status === 'ok') {
        setSession(consumeResult.session);
        setSessionState('ok');
      } else if (__DEV__ && devFixtureBarcode.length > 0) {
        const fallbackSessionId =
          typeof params.sessionId === 'string' && params.sessionId.trim().length > 0
            ? params.sessionId.trim()
            : ensureSessionId();
        const fallbackSession: ScanSession = {
          id: fallbackSessionId,
          mode: 'barcode',
          input: { barcode: devFixtureBarcode },
        };
        if (__DEV__) {
          console.log('[ScanResult] using dev fixture barcode session', {
            sessionId: fallbackSession.id,
            barcode: devFixtureBarcode,
          });
        }
        setSession(fallbackSession);
        setSessionState('ok');
      } else {
        if (__DEV__) {
          console.warn('[ScanResult] session hydrate failed', {
            reasonCode: consumeResult.reasonCode,
            sessionId: typeof params.sessionId === 'string' ? params.sessionId : null,
          });
        }
        setSession(null);
        setSessionState('session_expired');
      }

      setSessionResolved(true);
      addedRef.current = false;
      lastDosageRef.current = null;
      lastSupplementIdRef.current = null;
      setDashboardRuntimeError(null);
    };

    void hydrateSession();

    return () => {
      cancelled = true;
    };
  }, [params.devBarcode, params.sessionId]);

  const handleDashboardRenderError = useCallback((message: string, detail?: string | null) => {
    // Keep users on the modern full dashboard path even if an error is captured.
    // We surface the error banner instead of switching to legacy Lite UI.
    setDashboardRuntimeError(detail ? `${message}\n${detail}` : message);
  }, []);

  useEffect(() => {
    if (!session || session.mode !== 'barcode') {
      return;
    }

    if (barcodeQuality.page !== 'dashboard' || !recentScanProductInfo) return;

    const supplementId = snapshot?.product?.entityRefs?.supplementId ?? null;
    const dosageText = dashboardDosageText;

    if (!addedRef.current) {
      addScan({
        barcode: barcode || null,
        supplementId,
        productName: recentScanProductInfo.name ?? 'Unknown supplement',
        brandName: recentScanProductInfo.brand ?? 'Unknown brand',
        dosageText,
        category: recentScanProductInfo.category ?? null,
        imageUrl: recentScanProductInfo.image ?? null,
      });
      addedRef.current = true;
      lastDosageRef.current = dosageText || null;
      lastSupplementIdRef.current = supplementId;
      return;
    }

    const shouldUpdateDosage = Boolean(dosageText && dosageText !== lastDosageRef.current);
    const shouldUpdateSupplementId = Boolean(supplementId && supplementId !== lastSupplementIdRef.current);

    if (shouldUpdateDosage || shouldUpdateSupplementId) {
      addScan({
        barcode: barcode || null,
        supplementId,
        productName: recentScanProductInfo.name ?? 'Unknown supplement',
        brandName: recentScanProductInfo.brand ?? 'Unknown brand',
        dosageText,
        category: recentScanProductInfo.category ?? null,
        imageUrl: recentScanProductInfo.image ?? null,
      });
      if (shouldUpdateDosage) {
        lastDosageRef.current = dosageText;
      }
      if (shouldUpdateSupplementId) {
        lastSupplementIdRef.current = supplementId;
      }
    }
  }, [
    addScan,
    analysisBundle,
    barcodeQuality.page,
    barcode,
    efficacy,
    extractDoseFromText,
    formatDose,
    recentScanProductInfo,
    session,
    snapshot?.product?.entityRefs?.supplementId,
    status,
    usage,
    dashboardDosageText,
  ]);

  useEffect(() => {
    const brand = recentScanProductInfo?.brand ?? null;
    if (!barcode || !brand) return;
    if (brand === lastBrandRef.current) return;
    const normalizedBarcode = normalizeBarcode(barcode);
    if (!normalizedBarcode) return;
    const matches = savedSupplements.filter(
      item =>
        item.barcode &&
        normalizeBarcode(item.barcode) === normalizedBarcode &&
        item.brandName !== brand,
    );
    if (matches.length === 0) {
      lastBrandRef.current = brand;
      return;
    }
    matches.forEach(item => {
      void updateSupplement(item.id, { brandName: brand });
    });
    lastBrandRef.current = brand;
  }, [barcode, recentScanProductInfo?.brand, savedSupplements, updateSupplement]);

  useEffect(() => {
    if (!__DEV__) return;
    console.log('[ScanResult] dashboard mode', {
      platform: Platform.OS,
      appOwnership,
      isExpoGo,
      renderMode: dashboardRenderMode,
      forceLiteFromEnv: FORCE_LITE_DASHBOARD,
      forceFullFromEnv: FORCE_FULL_DASHBOARD,
      bisectFlagsFromEnv: process.env.EXPO_PUBLIC_SCAN_DASHBOARD_BISECT ?? '',
      bundleRevision,
    });
  }, [appOwnership, bundleRevision, dashboardRenderMode, isExpoGo]);

  useEffect(() => {
    if (onboardingLoading || firstScanReveal.loading) {
      return;
    }

    if (!onbCompleted || premiumAccess.isPremium) {
      return;
    }

    if (session?.mode !== 'barcode' || !currentScanId) {
      return;
    }

    if (barcodeQuality.page !== 'dashboard') {
      return;
    }

    if (!firstScanReveal.firstCompletedScanId) {
      void firstScanReveal.ensureFirstCompletedScanId(currentScanId);
    }
  }, [
    barcodeQuality.page,
    currentScanId,
    firstScanReveal,
    onbCompleted,
    onboardingLoading,
    premiumAccess.isPremium,
    session?.mode,
  ]);

  useEffect(() => {
    if (onboardingLoading || firstScanReveal.loading) {
      return;
    }

    if (!onbCompleted || premiumAccess.isPremium || !currentScanId) {
      return;
    }

    if (firstScanReveal.firstCompletedScanId !== currentScanId) {
      return;
    }

    if (firstScanReveal.reveal.state !== 'eligible') {
      return;
    }

    if (barcodeQuality.page !== 'dashboard') {
      return;
    }

    void firstScanReveal.grantForScan(currentScanId);
  }, [
    barcodeQuality.page,
    currentScanId,
    firstScanReveal,
    onbCompleted,
    onboardingLoading,
    premiumAccess.isPremium,
  ]);

  useEffect(() => {
    if (!isFirstRevealActive && !isFirstRevealPendingGrant) {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      openFirstRevealExitPaywall();
      return true;
    });

    return () => {
      subscription.remove();
    };
  }, [isFirstRevealActive, isFirstRevealPendingGrant, openFirstRevealExitPaywall]);

  const handleBack = () => {
    openFirstRevealExitPaywall();
  };

  if (!sessionResolved) {
    return (
      <ResponsiveScreen contentStyle={styles.screen}>
        <ScanResultHeaderChrome
          onBack={handleBack}
          title="Analysis"
          savePillState="disabled"
        />
        <View style={styles.loadingContainer}>
          <OrganicSpinner size={28} color="#52525b" />
          <Text style={styles.loadingTitle}>Loading scan session…</Text>
        </View>
        {debugPanelNode}
      </ResponsiveScreen>
    );
  }

  if (!session) {
    return (
      <ResponsiveScreen contentStyle={styles.screen}>
        <ScanResultHeaderChrome
          onBack={handleBack}
          title="Analysis"
          savePillState="disabled"
        />
        <View style={styles.fallbackContainer}>
          <FileText size={48} color="#52525b" />
          <Text style={styles.fallbackTitle}>Session Expired</Text>
          <Text style={styles.fallbackText}>
            Your scan session is no longer available. Please scan again.
          </Text>
          <TouchableOpacity style={styles.secondaryActionButton} onPress={navigateToAnalysisOrigin}>
            <Text style={styles.secondaryActionText}>{newActionLabel}</Text>
          </TouchableOpacity>
        </View>
        {debugPanelNode}
      </ResponsiveScreen>
    );
  }

  // 1. Barcode Not Found
  if (barcodeQuality.page === 'not_found') {
    return (
      <ResponsiveScreen contentStyle={styles.screen}>
        <ScanResultHeaderChrome
          onBack={handleBack}
          title="Analysis"
          savePillState="disabled"
        />
        <View style={styles.fallbackContainer}>
          <FileText size={48} color="#52525b" />
          <Text style={styles.fallbackTitle}>Not Found</Text>
          <Text style={styles.fallbackText}>We could not find this product.</Text>
          <Text style={styles.fallbackNote}>
            {error || 'Try a clearer barcode image or scan another package side.'}
          </Text>
          <TouchableOpacity style={styles.secondaryActionButton} onPress={navigateToAnalysisOrigin}>
            <Text style={styles.secondaryActionText}>{retryActionLabel}</Text>
          </TouchableOpacity>
        </View>
        {debugPanelNode}
      </ResponsiveScreen>
    );
  }

  // 2. Recoverable Errors (network/auth/server)
  if (barcodeQuality.page === 'recoverable_error') {
    const reasonCodeMessage = resolveReasonCodeMessage(reasonCode);
    const recoverableTitle =
      barcodeQuality.failureKind === 'unauthorized'
        ? 'Sign In Required'
        : 'Connection Issue';
    const recoverableText =
      barcodeQuality.failureKind === 'unauthorized'
        ? (error || 'Please sign in and retry the scan.')
        : (error || reasonCodeMessage || 'We lost connection while analyzing. Please retry.');
    return (
      <ResponsiveScreen contentStyle={styles.screen}>
        <ScanResultHeaderChrome
          onBack={handleBack}
          title="Analysis"
          savePillState="disabled"
        />
        <View style={styles.fallbackContainer}>
          <FileText size={48} color="#52525b" />
          <Text style={styles.fallbackTitle}>{recoverableTitle}</Text>
          <Text style={styles.fallbackText}>{recoverableText}</Text>
          <TouchableOpacity style={styles.secondaryActionButton} onPress={navigateToAnalysisOrigin}>
            <Text style={styles.secondaryActionText}>{retryActionLabel}</Text>
          </TouchableOpacity>
        </View>
        {debugPanelNode}
      </ResponsiveScreen>
    );
  }

  // 3. Session Expired (defensive fallback)
  if (barcodeQuality.page === 'session_expired') {
    return (
      <ResponsiveScreen contentStyle={styles.screen}>
        <ScanResultHeaderChrome
          onBack={handleBack}
          title="Analysis"
          savePillState="disabled"
        />
        <View style={styles.fallbackContainer}>
          <FileText size={48} color="#52525b" />
          <Text style={styles.fallbackTitle}>Session Expired</Text>
          <Text style={styles.fallbackText}>Please start a new scan.</Text>
          <TouchableOpacity style={styles.secondaryActionButton} onPress={navigateToAnalysisOrigin}>
            <Text style={styles.secondaryActionText}>{newActionLabel}</Text>
          </TouchableOpacity>
        </View>
        {debugPanelNode}
      </ResponsiveScreen>
    );
  }

  // 4. Removed intermediate "Searching..." screen - go directly to dashboard
  // The AnalysisDashboard will show skeleton loading states for each section

  // 5. Construct the composite analysis object for the Dashboard
  // The Dashboard will handle nulls/missing fields gracefully by showing defaults or skeletons
  const safeProductInfo = productInfo ?? {
    brand: null,
    name: null,
    category: null,
    image: null,
  };
  const compositeAnalysis = {
    productInfo: safeProductInfo,
    barcode: barcode || null,
    efficacy: efficacy || {}, // Empty obj means "loading" inside dashboard components if checked
    safety: safety || {},
    usage: usage || {},
    value: value || {},
    social: social || {},
    // Meta is tricky, we might compute it or mock it. 
    // For now, let's pass a basic meta if efficacy exists to allow score calculation
    meta: {
      analysisStatus: analysisMeta?.status ?? null,
      analysisVersion: analysisMeta?.version ?? null,
      labelExtraction: analysisMeta?.labelExtraction ?? null,
      actualDoseMg: efficacy?.activeIngredients?.[0]?.amount ? parseFloat(efficacy.activeIngredients[0].amount) : 0,
    },
    status: 'success'
  };

  // Pass a loading flag so Dashboard knows stream is active

  return (
    <ResponsiveScreen
      contentStyle={styles.screen}
      style={styles.safeArea}
      gutter={0}
    >
      <Stack.Screen
        options={{
          title: 'Analysis',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: '#F2F2F7' },
          contentStyle: { backgroundColor: '#F2F2F7' },
          presentation: 'card',
        }}
      />
      <StatusBar style="dark" />
      <ScanResultHeaderChrome
        onBack={handleBack}
        title="Analysis"
        miniScore={headerMiniScore ? { ...headerMiniScore, scrollY: analysisHeaderScrollY } : null}
        savePillState={
          isGuestScan
            ? 'save'
            : dashboardSaveItem
              ? (isDashboardItemSaved ? 'saved' : 'save')
              : 'disabled'
        }
        onSavePress={isGuestScan ? handleKeepGuestResult : handleSaveFromDashboard}
        onOpenSaved={handleOpenSaved}
        miniScoreThresholdStart={headerMiniScoreTrigger.start}
        miniScoreThresholdRange={headerMiniScoreTrigger.range}
      />

      {isGuestScan ? (
        <View style={styles.guestKeepBanner}>
          <Text style={styles.guestKeepText}>
            Save this scan to your account so your goals and allergies stay connected.
          </Text>
          <TouchableOpacity
            onPress={handleKeepGuestResult}
            style={styles.guestKeepButton}
            accessibilityRole="button"
            accessibilityLabel="Keep this result"
          >
            <Text style={styles.guestKeepButtonText}>Keep this result</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* We render dashboard immediately. 
        As 'efficacy', 'safety' etc. arrive, this component re-renders and fills in the blanks.
      */}
      <DashboardErrorBoundary onError={handleDashboardRenderError}>
        <AnalysisDashboard
          analysis={compositeAnalysis}
          isStreaming={showStreamingBadge}
          accessLevel={
            isGuestScan ? 'full' : premiumAccess.isPremium || isFirstRevealActive || isFirstRevealPendingGrant
              ? 'full'
              : 'preview_locked'
          }
          sourceType="barcode"
          scanSessionId={currentScanId}
          guestScanSessionId={guestScanSessionId}
          analysisBundle={analysisBundle}
          onboardingDraftOverride={session?.onboardingDraftSnapshot ?? null}
          externalScrollY={analysisHeaderScrollY}
          miniHeaderMode="header"
          onMiniScoreMetaChange={handleHeaderMiniScoreChange}
          onMiniScoreTriggerChange={handleHeaderMiniScoreTriggerChange}
          onCoreReadyChange={handleDashboardCoreReadyChange}
          saveItem={dashboardSaveItem}
        />
      </DashboardErrorBoundary>

      {dashboardRuntimeError ? (
        <View style={styles.dashboardErrorBanner}>
          <Text style={styles.dashboardErrorBannerText}>
            Dashboard error captured: {dashboardRuntimeError}
          </Text>
        </View>
      ) : null}
      {debugPanelNode}

      {/* Optional: A small global spinner in the corner if streaming */}
      {showStreamingBadge && (
        <BlurView intensity={40} tint="dark" style={styles.streamingBadge}>
          <OrganicSpinner size={24} color="rgba(255,255,255,0.9)" />
          <View style={{ top: 3 }}>
            <ShinyText
              text="Analyzing Your Supplement..."
              speed={2}
              style={{ ...styles.streamingText, color: '#FFFFFF' }}
            />
          </View>
        </BlurView>
      )}
    </ResponsiveScreen>
  );
}

function DebugScanPanel({
  requestId,
  lastEvent,
  reasonCode,
  stage,
  watchdogReason,
  displayIdentityMode,
  displayIdentitySourceAttribution,
  titleSanitized,
  routeDecision,
}: {
  requestId: string | null;
  lastEvent: string | null;
  reasonCode: string | null;
  stage: string | null;
  watchdogReason: string | null;
  displayIdentityMode: string | null;
  displayIdentitySourceAttribution: string | null;
  titleSanitized: boolean;
  routeDecision: string;
}) {
  return (
    <View style={styles.debugPanel} testID="scan-debug-panel">
      <Text style={styles.debugTitle}>Scan Debug</Text>
      <Text style={styles.debugLine}>requestId: {requestId ?? 'missing'}</Text>
      <Text style={styles.debugLine}>lastEvent: {lastEvent ?? 'missing'}</Text>
      <Text style={styles.debugLine}>reasonCode: {reasonCode ?? 'none'}</Text>
      <Text style={styles.debugLine}>stage: {stage ?? 'unknown'}</Text>
      <Text style={styles.debugLine}>watchdogReason: {watchdogReason ?? 'none'}</Text>
      <Text style={styles.debugLine}>displayIdentityMode: {displayIdentityMode ?? 'unknown'}</Text>
      <Text style={styles.debugLine}>displayIdentitySource: {displayIdentitySourceAttribution ?? 'unknown'}</Text>
      <Text style={styles.debugLine}>titleSanitized: {titleSanitized ? 'true' : 'false'}</Text>
      <Text style={styles.debugLine}>route: {routeDecision}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // ... (Keep existing styles) ...
  screen: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    width: '100%',
    alignSelf: 'stretch',
    maxWidth: '100%',
    paddingHorizontal: 0,
  },
  safeArea: {
    backgroundColor: '#F2F2F7',
    width: '100%',
    alignSelf: 'stretch',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: '#F2F2F7',
    zIndex: 10,
  },
  headerCenterSlot: {
    position: 'absolute',
    left: 76,
    right: 76,
    top: 16,
    bottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleLayer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMiniScoreLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f4f4f5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e4e4e7',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  headerMiniScoreShell: {
    width: 58,
    height: 58,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#111827',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  headerMiniScoreShellMuted: {
    borderColor: 'rgba(148,163,184,0.18)',
  },
  headerMiniScoreCore: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMiniScoreCoreMuted: {
    borderColor: 'rgba(148,163,184,0.14)',
    backgroundColor: 'rgba(255,255,255,0.48)',
  },
  headerMiniScoreText: {
    fontSize: 21,
    fontWeight: '900',
    color: '#111827',
  },
  headerMiniScoreTextMuted: {
    color: '#64748b',
  },
  loadingContainer: { flex: 1, backgroundColor: '#F2F2F7', justifyContent: 'center', alignItems: 'center' },
  loadingTitle: { fontSize: 18, fontWeight: '600', color: '#52525b' },
  fallbackContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  fallbackTitle: { fontSize: 24, fontWeight: 'bold', color: '#000', marginTop: 20 },
  fallbackText: { fontSize: 16, color: '#52525b', marginTop: 10, textAlign: 'center' },
  fallbackDebugText: {
    fontSize: 11,
    color: '#71717a',
    marginTop: 14,
    textAlign: 'left',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    width: '100%',
  },
  fallbackNote: { fontSize: 14, color: '#71717a', marginTop: 12, textAlign: 'center' },
  secondaryActionButton: {
    marginTop: 4,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d4d4d8',
    alignItems: 'center',
  },
  secondaryActionText: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '600',
  },
  guestKeepBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  guestKeepText: {
    color: '#1E3A8A',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  guestKeepButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  guestKeepButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  // New style for the floating badge
  streamingBadge: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    overflow: 'hidden',
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  streamingText: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 0.5,
    lineHeight: 16,
  },
  dashboardErrorBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    backgroundColor: 'rgba(153, 27, 27, 0.92)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dashboardErrorBannerText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  debugPanel: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  debugTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: '#1e3a8a',
    marginBottom: 2,
  },
  debugLine: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    color: '#1d4ed8',
  },
});

const createStyles = (tokens: any) => styles;
