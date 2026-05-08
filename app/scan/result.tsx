import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { FileText } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import { ScanResultHeaderChrome } from '@/components/scan/ScanResultHeaderChrome';
import { OrganicSpinner } from '@/components/ui/OrganicSpinner';
import { ShinyText } from '@/components/ui/ShinyText';
import { Config } from '@/constants/Config';
import { useAuth } from '@/contexts/AuthContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useScanHistory } from '@/contexts/ScanHistoryContext';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';
import { useStreamAnalysis } from '@/hooks/useStreamAnalysis';
import { useSavedSupplements } from '@/contexts/SavedSupplementsContext';
import {
  NUTRI_ACTIVATION_DEFINITION,
  trackOnboardingEvent,
} from '@/lib/analytics/onboarding';
import { choosePreferredProductImageUrl } from '@/lib/productImagePreference';
import { getGuestScanSession } from '@/lib/scan/guestSession';
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
const POST_SCAN_CONTINUE_REVEAL_DISTANCE = 160;
const POST_SCAN_CONTINUE_TRANSLATE_Y = 96;
const POST_SCAN_CONTINUE_BOTTOM_SPACE = 136;
const POST_SCAN_CONTINUE_SPRING = {
  damping: 18,
  stiffness: 180,
  mass: 0.85,
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
  const { session: authSession, setPostAuthRedirect } = useAuth();
  const {
    draft: onboardingDraft,
    loading: onboardingLoading,
    progress: onboardingProgress,
  } = useOnboarding();
  const { addScan } = useScanHistory();
  const { addSupplement, savedSupplements, updateSupplement } = useSavedSupplements();
  const addedRef = useRef(false);
  const lastDosageRef = useRef<string | null>(null);
  const lastBrandRef = useRef<string | null>(null);
  const lastSupplementIdRef = useRef<string | null>(null);
  const resultReadyTrackedRef = useRef<string | null>(null);
  const guestResultStartedTrackedRef = useRef<string | null>(null);

  // Get session to retrieve barcode
  const params = useLocalSearchParams<{ sessionId?: string; devBarcode?: string; source?: string; guestScanSessionId?: string }>();
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
    effectiveScanSource === 'guest_scan' && Config.guestScanEnabled
      ? (
        typeof session?.guestScanSessionId === 'string' && session.guestScanSessionId.trim().length > 0
          ? session.guestScanSessionId.trim()
          : typeof params.guestScanSessionId === 'string' && params.guestScanSessionId.trim().length > 0
            ? params.guestScanSessionId.trim()
            : null
      )
      : null;
  const isGuestScan = Boolean(guestScanSessionId);
  const [guestScanClaimed, setGuestScanClaimed] = useState(false);
  const [dashboardRuntimeError, setDashboardRuntimeError] = useState<string | null>(null);
  const dashboardRenderMode: 'full' = resolveDashboardRenderMode(isExpoGo);
  const analysisHeaderScrollY = useSharedValue(0);
  const [headerMiniScore, setHeaderMiniScore] = useState<HeaderMiniScoreState | null>(null);
  const [headerMiniScoreTrigger, setHeaderMiniScoreTrigger] = useState<HeaderMiniScoreTriggerState>(
    DEFAULT_HEADER_MINI_SCORE_TRIGGER,
  );
  const [dashboardCoreReady, setDashboardCoreReady] = useState(false);
  const dashboardContentHeight = useSharedValue(0);
  const dashboardViewportHeight = useSharedValue(0);
  const postScanContinueReady = useSharedValue(0);
  const postScanContinueUnlocked = useSharedValue(0);
  const [postScanContinueVisible, setPostScanContinueVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!guestScanSessionId) {
      setGuestScanClaimed(false);
      return () => {
        cancelled = true;
      };
    }

    void getGuestScanSession(guestScanSessionId)
      .then((guestSession) => {
        if (cancelled) return;
        setGuestScanClaimed(guestSession?.status === 'claimed');
      })
      .catch(() => {
        if (cancelled) return;
        setGuestScanClaimed(false);
      });

    return () => {
      cancelled = true;
    };
  }, [guestScanSessionId]);

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
    dashboardContentHeight.value = 0;
    dashboardViewportHeight.value = 0;
    postScanContinueReady.value = 0;
    postScanContinueUnlocked.value = 0;
    setPostScanContinueVisible(false);
    setHeaderMiniScore(null);
    setHeaderMiniScoreTrigger(DEFAULT_HEADER_MINI_SCORE_TRIGGER);
    setDashboardCoreReady(false);
    loadingBadgeTimingRef.current = {
      startedAt: 0,
      seen: false,
      hiddenLogged: false,
    };
  }, [
    analysisHeaderScrollY,
    barcode,
    dashboardContentHeight,
    dashboardViewportHeight,
    params.sessionId,
    postScanContinueReady,
    postScanContinueUnlocked,
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
  const resultReadyForActivation =
    dashboardCoreReady || (status === 'complete' && barcodeQuality.page === 'dashboard');
  const postScanQuestionsComplete = onboardingProgress >= 4;
  const shouldShowGuestPostScanContinue =
    isGuestScan &&
    !guestScanClaimed &&
    !onboardingLoading &&
    resultReadyForActivation &&
    barcodeQuality.page === 'dashboard' &&
    !postScanQuestionsComplete &&
    Boolean(currentScanId && guestScanSessionId);
  const effectiveDashboardOnboardingDraft = onboardingDraft ?? session?.onboardingDraftSnapshot ?? null;
  const shouldRouteSaveThroughGuestClaim = isGuestScan && !guestScanClaimed;

  const handleDashboardScrollViewportMetricsChange = useCallback((metrics: {
    contentHeight: number;
    viewportHeight: number;
  }) => {
    dashboardContentHeight.value = metrics.contentHeight;
    dashboardViewportHeight.value = metrics.viewportHeight;
  }, [dashboardContentHeight, dashboardViewportHeight]);

  const buildGuestScanResultReturnTo = useCallback(() => {
    if (!currentScanId || !guestScanSessionId) return null;
    const query = new URLSearchParams({
      sessionId: currentScanId,
      source: 'guest_scan',
      guestScanSessionId,
    });
    const routeDevBarcode = typeof params.devBarcode === 'string' ? params.devBarcode.trim() : '';
    if (__DEV__ && routeDevBarcode.length > 0) {
      query.set('devBarcode', routeDevBarcode);
    }
    return `/scan/result?${query.toString()}`;
  }, [currentScanId, guestScanSessionId, params.devBarcode]);

  const handlePostScanContinue = useCallback(() => {
    const returnTo = buildGuestScanResultReturnTo();
    if (!returnTo || !guestScanSessionId || !currentScanId) return;

    router.push({
      pathname: '/onboarding/data-trust',
      params: {
        mode: 'post_scan',
        returnTo,
      },
    });
  }, [buildGuestScanResultReturnTo, currentScanId, guestScanSessionId]);

  useEffect(() => {
    postScanContinueReady.value = shouldShowGuestPostScanContinue ? 1 : 0;
    if (!shouldShowGuestPostScanContinue) {
      postScanContinueUnlocked.value = 0;
      setPostScanContinueVisible(false);
    }
  }, [postScanContinueReady, postScanContinueUnlocked, shouldShowGuestPostScanContinue]);

  useAnimatedReaction(
    () => {
      if (postScanContinueReady.value !== 1) return false;
      const contentHeight = dashboardContentHeight.value;
      const viewportHeight = dashboardViewportHeight.value;
      if (contentHeight <= 0 || viewportHeight <= 0) return false;

      const meaningfulContentHeight = Math.max(0, contentHeight - POST_SCAN_CONTINUE_BOTTOM_SPACE);
      const maxScrollY = Math.max(meaningfulContentHeight - viewportHeight, 0);
      if (maxScrollY <= 1) return true;

      const remainingScrollDistance = meaningfulContentHeight - (analysisHeaderScrollY.value + viewportHeight);
      return remainingScrollDistance < POST_SCAN_CONTINUE_REVEAL_DISTANCE;
    },
    (shouldReveal, wasRevealed) => {
      if (shouldReveal && !wasRevealed && postScanContinueUnlocked.value < 1) {
        postScanContinueUnlocked.value = withSpring(1, POST_SCAN_CONTINUE_SPRING);
        runOnJS(setPostScanContinueVisible)(true);
      }
    },
  );

  const postScanContinueAnimatedStyle = useAnimatedStyle(() => {
    const progress = postScanContinueUnlocked.value;
    return {
      opacity: progress,
      transform: [
        { translateY: (1 - progress) * POST_SCAN_CONTINUE_TRANSLATE_Y },
        { scale: 0.96 + progress * 0.04 },
      ],
    };
  });

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

  useEffect(() => {
    if (!isGuestScan || !guestScanSessionId || !currentScanId || !barcode) return;
    if (guestResultStartedTrackedRef.current === currentScanId) return;

    guestResultStartedTrackedRef.current = currentScanId;
    trackOnboardingEvent('guest_scan_result_started', {
      source: 'scan_result',
      guestScanSessionId,
      scanSessionId: currentScanId,
      barcodeLength: barcode.length,
    });
  }, [barcode, currentScanId, guestScanSessionId, isGuestScan]);

  useEffect(() => {
    if (!resultReadyForActivation || !currentScanId || status === 'error') return;
    if (resultReadyTrackedRef.current === currentScanId) return;

    resultReadyTrackedRef.current = currentScanId;
    trackOnboardingEvent('result_ready', {
      activationDefinition: NUTRI_ACTIVATION_DEFINITION.id,
      source: effectiveScanSource ?? 'scan_result',
      scanSessionId: currentScanId,
      routeDecision: barcodeQuality.page,
      guest: isGuestScan,
      barcodeLength: barcode ? barcode.length : 0,
    });
    if (isGuestScan) {
      trackOnboardingEvent('guest_scan_result_ready', {
        source: 'scan_result',
        guestScanSessionId,
        scanSessionId: currentScanId,
        routeDecision: barcodeQuality.page,
      });
    }
  }, [
    barcode,
    barcodeQuality.page,
    currentScanId,
    effectiveScanSource,
    guestScanSessionId,
    isGuestScan,
    resultReadyForActivation,
    status,
  ]);

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

  const activationSaveItem = useMemo(() => {
    if (barcodeQuality.page !== 'dashboard') return null;
    const productIdentity = analysisBundle?.meta?.productIdentity ?? null;
    const snapshotProduct = snapshot?.product ?? null;
    const productName =
      recentScanProductInfo?.name ??
      productInfo?.name ??
      productIdentity?.name ??
      snapshotProduct?.name ??
      'Scanned supplement';
    const brandName =
      recentScanProductInfo?.brand ??
      productInfo?.brand ??
      productIdentity?.brand ??
      snapshotProduct?.brand ??
      'Unknown brand';

    return {
      supplementId: snapshot?.product?.entityRefs?.supplementId ?? null,
      barcode: barcode || null,
      productName,
      brandName,
      dosageText: dashboardDosageText,
      imageUrl: choosePreferredProductImageUrl(
        recentScanProductInfo?.image,
        productInfo?.image,
        snapshotProduct?.imageUrl,
      ),
    };
  }, [
    analysisBundle?.meta?.productIdentity,
    barcode,
    barcodeQuality.page,
    dashboardDosageText,
    productInfo,
    recentScanProductInfo,
    snapshot?.product,
  ]);

  const savedKeySet = useMemo(() => {
    const keys = new Set<string>();
    savedSupplements.forEach((item) => {
      getSavedSupplementKeys(item).forEach((key) => keys.add(key));
    });
    return keys;
  }, [savedSupplements]);

  const isActivationItemSaved = useMemo(() => {
    if (!activationSaveItem) return false;
    return getSavedSupplementKeys(activationSaveItem).some((key) => savedKeySet.has(key));
  }, [activationSaveItem, savedKeySet]);

  const handleSaveFromDashboard = useCallback(() => {
    if (!activationSaveItem) return;
    const added = addSupplement({
      supplementId: activationSaveItem.supplementId ?? undefined,
      barcode: activationSaveItem.barcode ?? null,
      imageUrl: activationSaveItem.imageUrl ?? null,
      productName: activationSaveItem.productName,
      brandName: activationSaveItem.brandName,
      dosageText: activationSaveItem.dosageText,
    });
    if (!added) return;

    const activationPayload = {
      activationDefinition: NUTRI_ACTIVATION_DEFINITION.id,
      source: 'scan_result_primary_action',
      launchSource: effectiveScanSource ?? 'scan_result',
      scanSessionId: currentScanId,
      supplementId: activationSaveItem.supplementId ?? null,
      hasBarcode: Boolean(activationSaveItem.barcode),
    };
    trackOnboardingEvent('saved_to_stack', activationPayload);
    if (added.syncedToCheckIn !== false) {
      trackOnboardingEvent('check_in_started', activationPayload);
    }
  }, [activationSaveItem, addSupplement, currentScanId, effectiveScanSource]);

  const handleKeepGuestResult = useCallback(() => {
    if (!guestScanSessionId || !currentScanId) return;

    const returnTo = `/scan/result?sessionId=${encodeURIComponent(currentScanId)}&source=guest_scan&guestScanSessionId=${encodeURIComponent(guestScanSessionId)}`;
    const redirectTarget = `/guest-scan/claim?guestScanSessionId=${encodeURIComponent(guestScanSessionId)}&returnTo=${encodeURIComponent(returnTo)}`;
    trackOnboardingEvent('guest_scan_keep_tapped', {
      source: 'scan_result',
      guestScanSessionId,
      scanSessionId: currentScanId,
    });

    if (authSession?.user) {
      router.push(redirectTarget as never);
      return;
    }

    trackOnboardingEvent('guest_scan_auth_started', {
      source: 'scan_result',
      guestScanSessionId,
      scanSessionId: currentScanId,
    });
    setPostAuthRedirect(redirectTarget);
    router.push({
      pathname: '/auth/signup',
      params: { redirect: redirectTarget },
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

  const handleBack = () => {
    router.replace('/scan/barcode');
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
          <TouchableOpacity style={styles.secondaryActionButton} onPress={() => router.replace('/scan/barcode')}>
            <Text style={styles.secondaryActionText}>Start New Scan</Text>
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
          <TouchableOpacity style={styles.secondaryActionButton} onPress={() => router.replace('/scan/barcode')}>
            <Text style={styles.secondaryActionText}>Retry Scan</Text>
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
          <TouchableOpacity style={styles.secondaryActionButton} onPress={() => router.replace('/scan/barcode')}>
            <Text style={styles.secondaryActionText}>Retry Scan</Text>
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
          <TouchableOpacity style={styles.secondaryActionButton} onPress={() => router.replace('/scan/barcode')}>
            <Text style={styles.secondaryActionText}>Start New Scan</Text>
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
  const activationActionNode = !isGuestScan && !shouldShowGuestPostScanContinue && activationSaveItem && !isActivationItemSaved ? (
    <View style={styles.activationActionBanner}>
      <View style={styles.activationActionCopy}>
        <Text style={styles.activationActionEyebrow}>Next step</Text>
        <Text style={styles.activationActionTitle}>Save this supplement to your stack</Text>
        <Text style={styles.activationActionText}>
          Save it for Daily Check-in when you are ready.
        </Text>
      </View>
      <TouchableOpacity
        onPress={shouldRouteSaveThroughGuestClaim ? handleKeepGuestResult : handleSaveFromDashboard}
        style={styles.activationActionButton}
        accessibilityRole="button"
        accessibilityLabel="Save to my stack"
        testID="scan-result-save-to-stack-action"
      >
        <Text style={styles.activationActionButtonText}>Save to my stack</Text>
      </TouchableOpacity>
    </View>
  ) : null;

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
          shouldShowGuestPostScanContinue
            ? 'disabled'
            : activationSaveItem
              ? (isActivationItemSaved ? 'saved' : 'save')
              : 'disabled'
        }
        onSavePress={shouldRouteSaveThroughGuestClaim ? handleKeepGuestResult : handleSaveFromDashboard}
        onOpenSaved={handleOpenSaved}
        miniScoreThresholdStart={headerMiniScoreTrigger.start}
        miniScoreThresholdRange={headerMiniScoreTrigger.range}
      />

      {/* We render dashboard immediately. 
        As 'efficacy', 'safety' etc. arrive, this component re-renders and fills in the blanks.
      */}
      <DashboardErrorBoundary onError={handleDashboardRenderError}>
        <AnalysisDashboard
          analysis={compositeAnalysis}
          isStreaming={showStreamingBadge}
          sourceType="barcode"
          scanSessionId={currentScanId}
          guestScanSessionId={guestScanSessionId}
          analysisBundle={analysisBundle}
          onboardingDraftOverride={effectiveDashboardOnboardingDraft}
          externalScrollY={analysisHeaderScrollY}
          contentBottomInset={shouldShowGuestPostScanContinue ? POST_SCAN_CONTINUE_BOTTOM_SPACE : 0}
          miniHeaderMode="header"
          onMiniScoreMetaChange={handleHeaderMiniScoreChange}
          onMiniScoreTriggerChange={handleHeaderMiniScoreTriggerChange}
          onCoreReadyChange={handleDashboardCoreReadyChange}
          onScrollViewportMetricsChange={handleDashboardScrollViewportMetricsChange}
          saveItem={activationSaveItem}
          topAccessory={activationActionNode}
        />
      </DashboardErrorBoundary>

      {shouldShowGuestPostScanContinue ? (
        <Animated.View
          pointerEvents={postScanContinueVisible ? 'box-none' : 'none'}
          style={[
            styles.postScanContinueFloating,
            postScanContinueAnimatedStyle,
          ]}
        >
          <View style={styles.postScanContinueCard}>
            <TouchableOpacity
              onPress={handlePostScanContinue}
              style={styles.postScanContinueButton}
              accessibilityRole="button"
              accessibilityLabel="Continue to goals and allergy check"
              testID="scan-result-post-scan-continue"
            >
              <Text style={styles.postScanContinueButtonText}>Continue</Text>
            </TouchableOpacity>
            <Text style={styles.postScanContinueHint}>
              Next: 2 quick questions for Goal fit and Allergy check.
            </Text>
            <Text style={styles.postScanContinueArrow}>↑</Text>
          </View>
        </Animated.View>
      ) : null}

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
  postScanContinueFloating: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 18,
    alignItems: 'center',
    paddingHorizontal: 30,
    zIndex: 24,
  },
  postScanContinueCard: {
    width: '100%',
    maxWidth: 520,
    alignItems: 'center',
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    shadowColor: '#2563EB',
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  postScanContinueButton: {
    width: '100%',
    minHeight: 60,
    borderRadius: 999,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563EB',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  postScanContinueButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },
  postScanContinueHint: {
    marginTop: 10,
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  postScanContinueArrow: {
    marginTop: 6,
    color: '#CBD5E1',
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '400',
  },
  activationActionBanner: {
    marginBottom: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(37,99,235,0.20)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#2563EB',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  activationActionCopy: {
    flex: 1,
    minWidth: 0,
  },
  activationActionEyebrow: {
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  activationActionTitle: {
    color: '#0F172A',
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
  },
  activationActionText: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    marginTop: 3,
  },
  activationActionButton: {
    flexShrink: 0,
    borderRadius: 999,
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  activationActionButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
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
