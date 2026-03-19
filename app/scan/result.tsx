import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, FileText } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import { OrganicSpinner } from '@/components/ui/OrganicSpinner';
import { ShinyText } from '@/components/ui/ShinyText';
import { useScanHistory } from '@/contexts/ScanHistoryContext';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';
import { useStreamAnalysis } from '@/hooks/useStreamAnalysis';
import { useSavedSupplements } from '@/contexts/SavedSupplementsContext';
import { consumeScanSessionWithStatusAsync, ensureSessionId, type ScanSession } from '@/lib/scan/session';
import { requestLabelAnalysis } from '@/lib/scan/service';
import { resolveReasonCodeMessage } from '@/lib/scan/streamStateMachine';
import { getBarcodeQuality, getLabelDraftQuality } from '@/lib/scan/quality';
import { buildLabelInsights } from '@/lib/scan/labelInsights';
import { formatDoseForPill } from '@/lib/supplementDisplay';
import type { LabelDraft } from '@/backend/src/labelAnalysis';
import { AnalysisDashboard } from '@/components/scan/AnalysisDashboard';

type LabelAnalysisStatus = 'complete' | 'partial' | 'skipped' | 'pending' | 'unavailable' | 'failed' | null;
type LabelInsightsSnapshot = ReturnType<typeof buildLabelInsights> | null;

type LabelIngredientEntry = {
  name: string;
  dosageValue: number | null;
  dosageUnit: string | null;
};

type HeaderMiniScoreState = {
  overallScore: number;
  overallBand: string | null;
  muted: boolean;
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
const FREEZE_SHADOW_ONLY =
  process.env.EXPO_PUBLIC_FREEZE_SHADOW_ONLY == null
    ? true
    : !(
      process.env.EXPO_PUBLIC_FREEZE_SHADOW_ONLY === '0' ||
      process.env.EXPO_PUBLIC_FREEZE_SHADOW_ONLY === 'false'
    );
const HEADER_MINI_SCORE_START = 210;
const HEADER_MINI_SCORE_RANGE = 70;

const emitScanUxMetric = (event: string, payload: Record<string, unknown> = {}) => {
  console.info('[scan-ux-metric]', { event, ...payload });
};

const getHeaderOverallBandLabel = (score: number, explicitBand?: string | null): string => {
  const normalized = typeof explicitBand === 'string' ? explicitBand.trim() : '';
  if (normalized) return normalized;
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Strong';
  if (score >= 70) return 'Good';
  if (score >= 60) return 'Fair';
  if (score >= 45) return 'Limited';
  return 'Weak';
};

const getHeaderOverallBandTone = (score: number, explicitBand?: string | null) => {
  const band = getHeaderOverallBandLabel(score, explicitBand).toLowerCase();
  if (band === 'excellent') {
    return {
      bubbleBorder: 'rgba(21,128,61,0.24)',
      bubbleFill: 'rgba(21,128,61,0.16)',
      bubbleText: '#166534',
    };
  }
  if (band === 'strong') {
    return {
      bubbleBorder: 'rgba(22,163,74,0.24)',
      bubbleFill: 'rgba(22,163,74,0.16)',
      bubbleText: '#166534',
    };
  }
  if (band === 'good') {
    return {
      bubbleBorder: 'rgba(101,163,13,0.24)',
      bubbleFill: 'rgba(101,163,13,0.16)',
      bubbleText: '#4D7C0F',
    };
  }
  if (band === 'fair') {
    return {
      bubbleBorder: 'rgba(217,119,6,0.24)',
      bubbleFill: 'rgba(217,119,6,0.16)',
      bubbleText: '#B45309',
    };
  }
  if (band === 'limited') {
    return {
      bubbleBorder: 'rgba(234,88,12,0.24)',
      bubbleFill: 'rgba(234,88,12,0.16)',
      bubbleText: '#C2410C',
    };
  }
  return {
    bubbleBorder: 'rgba(220,38,38,0.24)',
    bubbleFill: 'rgba(220,38,38,0.16)',
    bubbleText: '#B91C1C',
  };
};

const resolveDashboardRenderMode = (_isExpoGo: boolean): 'full' => {
  // Hard-lock to full dashboard so we never regress to legacy Lite UI during runtime.
  return 'full';
};

const DV_UNIT = '% DV';
const normalizeBarcode = (value?: string | null) => {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length >= 14) return digits.slice(-14);
  if (digits.length >= 8) return digits.padStart(14, '0');
  return digits;
};

type DashboardErrorBoundaryProps = {
  children: React.ReactNode;
  onError?: (message: string) => void;
};

type DashboardErrorBoundaryState = {
  hasError: boolean;
  message: string | null;
};

class DashboardErrorBoundary extends React.Component<
  DashboardErrorBoundaryProps,
  DashboardErrorBoundaryState
> {
  state: DashboardErrorBoundaryState = {
    hasError: false,
    message: null,
  };

  static getDerivedStateFromError(error: unknown): DashboardErrorBoundaryState {
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Dashboard render failed';
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown) {
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Dashboard render failed';
    console.error('[ScanResult][DashboardErrorBoundary]', error);
    this.props.onError?.(message);
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
        </View>
      );
    }
    return this.props.children;
  }
}

function buildLabelIngredientEntries(
  labelInsights: LabelInsightsSnapshot,
  labelDraft: LabelDraft | null
): LabelIngredientEntry[] {
  const draftIngredients = labelDraft?.ingredients ?? [];
  const draftByName = new Map<string, LabelDraft['ingredients'][number]>();
  for (const ingredient of draftIngredients) {
    const name = ingredient.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!draftByName.has(key)) {
      draftByName.set(key, ingredient);
    }
  }

  const entries: LabelIngredientEntry[] = [];
  const seen = new Set<string>();
  const addEntry = (name: string, ingredient?: LabelDraft['ingredients'][number]) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const dosageValue = ingredient?.amount ?? ingredient?.dvPercent ?? null;
    const dosageUnit = ingredient?.amount != null
      ? ingredient?.unit ?? null
      : ingredient?.dvPercent != null
        ? DV_UNIT
        : null;
    entries.push({ name, dosageValue, dosageUnit });
  };

  if (labelInsights?.fullActives?.length) {
    labelInsights.fullActives.forEach((active) => {
      const name = active.name.trim();
      addEntry(name, draftByName.get(name.toLowerCase()));
    });
  } else {
    draftIngredients.forEach((ingredient) => {
      const name = ingredient.name?.trim();
      if (!name) return;
      addEntry(name, ingredient);
    });
  }

  return entries;
}

function buildLabelCoreBenefits(labelInsights: LabelInsightsSnapshot, entries: LabelIngredientEntry[]): string[] {
  if (labelInsights?.highlights?.length) return labelInsights.highlights.slice(0, 3);
  if (labelInsights?.detailHighlights?.length) return labelInsights.detailHighlights.slice(0, 3);
  if (entries.length) {
    return entries.slice(0, 3).map((entry) => {
      if (entry.dosageValue != null && entry.dosageUnit) {
        return `${entry.name} ${entry.dosageValue} ${entry.dosageUnit}`;
      }
      return entry.name;
    });
  }
  if (labelInsights?.totalActives) {
    return [`${labelInsights.totalActives} actives detected`];
  }
  return ['Label evidence captured'];
}

function buildLabelFallbackAnalysis(labelInsights: LabelInsightsSnapshot, labelDraft: LabelDraft | null) {
  if (!labelInsights && !labelDraft) return null;

  const entries = buildLabelIngredientEntries(labelInsights, labelDraft);
  const primary = entries.find((entry) => entry.dosageValue != null && entry.dosageUnit) ?? entries[0] ?? null;
  const coreBenefits = buildLabelCoreBenefits(labelInsights, entries);

  const overviewParts = [
    labelInsights?.profileLine,
    labelInsights?.completenessLine,
    labelInsights?.metaLine ? `Evidence: ${labelInsights.metaLine}` : null,
  ].filter(Boolean);
  const overviewSummary = overviewParts.join(' ').trim();

  const verdict =
    labelInsights?.metaLine
      ? `Label evidence: ${labelInsights.metaLine}`
      : labelInsights?.profileLine ||
        (entries.length ? `Detected ${entries.length} actives from label evidence.` : 'Label evidence captured.');

  const transparencyNote = labelInsights?.hasProprietaryBlend
    ? 'Proprietary blend detected; doses may be incomplete.'
    : labelInsights?.missingDoseCount
      ? `${labelInsights.missingDoseCount} actives missing dose information.`
      : labelInsights?.duplicateCount
        ? 'Possible bilingual duplicates detected on label.'
        : '';

  const overallAssessment = labelInsights?.completenessLine
    ? `Dose completeness: ${labelInsights.completenessLine}`
    : '';

  const usageSummary = labelDraft?.servingSize
    ? `Serving size: ${labelDraft.servingSize}. Follow label directions.`
    : 'Follow label directions for timing and duration.';
  const usageDosage = labelDraft?.servingSize ? `Serving size: ${labelDraft.servingSize}` : undefined;

  const safetyVerdict =
    labelInsights?.watchout ||
    (labelInsights?.missingDoseCount
      ? `${labelInsights.missingDoseCount} actives missing dose; review label for completeness.`
      : '');

  const safetyFlags = safetyVerdict ? [safetyVerdict] : undefined;

  return {
    efficacy: {
      verdict,
      overviewSummary: overviewSummary || null,
      coreBenefits,
      benefits: coreBenefits,
      primaryActive: primary
        ? {
            name: primary.name,
            form: null,
            formQuality: 'unknown',
            formNote: null,
            dosageValue: primary.dosageValue,
            dosageUnit: primary.dosageUnit,
            evidenceLevel: 'none',
            evidenceSummary: null,
          }
        : null,
      ingredients: entries.map((entry) => ({
        name: entry.name,
        form: null,
        formQuality: 'unknown',
        formNote: null,
        dosageValue: entry.dosageValue,
        dosageUnit: entry.dosageUnit,
        dosageAssessment: 'unknown',
        evidenceLevel: 'none',
      })),
      overallAssessment: overallAssessment || null,
      marketingVsReality: transparencyNote || labelInsights?.watchout || null,
    },
    safety: {
      verdict: safetyVerdict || null,
      redFlags: safetyFlags,
      risks: safetyFlags,
    },
    usage: {
      summary: usageSummary,
      dosage: usageDosage,
      timing: null,
      withFood: null,
    },
    value: {
      verdict: transparencyNote || 'Formula quality estimated from label ingredients.',
      analysis: labelInsights?.metaLine ? `Extraction detail: ${labelInsights.metaLine}.` : '',
    },
  };
}

function mergeLabelAnalysis(base: any, fallback: any, productName: string) {
  if (!fallback) {
    return {
      ...base,
      productInfo: {
        ...(base?.productInfo ?? {}),
        name: productName || base?.productInfo?.name || 'Supplement',
        category: base?.productInfo?.category ?? 'supplement',
      },
    };
  }

  const pickText = (value?: string | null, fallbackValue?: string | null) => {
    if (typeof value === 'string' && value.trim()) return value;
    return fallbackValue ?? value ?? null;
  };
  const pickArray = <T,>(value?: T[] | null, fallbackValue?: T[]) => {
    if (Array.isArray(value) && value.length) return value;
    return fallbackValue;
  };

  const baseEfficacy = base?.efficacy ?? {};
  const fallbackEfficacy = fallback?.efficacy ?? {};
  const efficacy = {
    ...fallbackEfficacy,
    ...baseEfficacy,
    verdict: pickText(baseEfficacy.verdict, fallbackEfficacy.verdict),
    overviewSummary: pickText(baseEfficacy.overviewSummary, fallbackEfficacy.overviewSummary),
    coreBenefits: pickArray(baseEfficacy.coreBenefits, fallbackEfficacy.coreBenefits),
    benefits: pickArray(baseEfficacy.benefits, fallbackEfficacy.benefits),
    ingredients: pickArray(baseEfficacy.ingredients, fallbackEfficacy.ingredients),
    primaryActive: baseEfficacy.primaryActive ?? fallbackEfficacy.primaryActive ?? null,
    overallAssessment: pickText(baseEfficacy.overallAssessment, fallbackEfficacy.overallAssessment),
    marketingVsReality: pickText(baseEfficacy.marketingVsReality, fallbackEfficacy.marketingVsReality),
  };

  const baseSafety = base?.safety ?? {};
  const fallbackSafety = fallback?.safety ?? {};
  const safety = {
    ...fallbackSafety,
    ...baseSafety,
    verdict: pickText(baseSafety.verdict, fallbackSafety.verdict),
    redFlags: pickArray(baseSafety.redFlags, fallbackSafety.redFlags),
    risks: pickArray(baseSafety.risks, fallbackSafety.risks),
    recommendation: pickText(baseSafety.recommendation, fallbackSafety.recommendation),
  };

  const baseUsage = base?.usage ?? {};
  const fallbackUsage = fallback?.usage ?? {};
  const usage = {
    ...fallbackUsage,
    ...baseUsage,
    summary: pickText(baseUsage.summary, fallbackUsage.summary),
    dosage: pickText(baseUsage.dosage, fallbackUsage.dosage),
    frequency: pickText(baseUsage.frequency, fallbackUsage.frequency),
    timing: pickText(baseUsage.timing, fallbackUsage.timing),
    bestFor: pickText(baseUsage.bestFor, fallbackUsage.bestFor),
    target: pickText(baseUsage.target, fallbackUsage.target),
    who: pickText(baseUsage.who, fallbackUsage.who),
  };

  const baseValue = base?.value ?? {};
  const fallbackValue = fallback?.value ?? {};
  const value = {
    ...fallbackValue,
    ...baseValue,
    verdict: pickText(baseValue.verdict, fallbackValue.verdict),
    analysis: pickText(baseValue.analysis, fallbackValue.analysis),
  };

  const baseSocial = base?.social ?? {};
  const fallbackSocial = fallback?.social ?? {};
  const social = {
    ...fallbackSocial,
    ...baseSocial,
    summary: pickText(baseSocial.summary, fallbackSocial.summary),
  };

  return {
    ...base,
    productInfo: {
      ...(fallback?.productInfo ?? {}),
      ...(base?.productInfo ?? {}),
      name: productName || base?.productInfo?.name || fallback?.productInfo?.name || 'Supplement',
      category: base?.productInfo?.category ?? fallback?.productInfo?.category ?? 'supplement',
    },
    efficacy,
    safety,
    usage,
    value,
    social,
  };
}

export default function ScanResultScreen() {
  const { tokens } = useResponsiveTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const appOwnership = Constants.appOwnership;
  const isExpoGo = appOwnership === 'expo' || appOwnership === 'guest';
  const { addScan } = useScanHistory();
  const { savedSupplements, updateSupplement } = useSavedSupplements();
  const addedRef = useRef(false);
  const lastDosageRef = useRef<string | null>(null);
  const lastBrandRef = useRef<string | null>(null);
  const lastSupplementIdRef = useRef<string | null>(null);
  const analysisRequestedRef = useRef(false);

  // Get session to retrieve barcode
  const params = useLocalSearchParams<{ sessionId?: string; devBarcode?: string }>();
  const [session, setSession] = useState<ScanSession | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [sessionState, setSessionState] = useState<'ok' | 'session_expired'>('ok');
  const isLabel = session?.mode === 'label';
  const labelResult = isLabel ? session.result : null;
  const barcode = session?.mode === 'barcode' ? session.input.barcode : '';
  const [labelAnalysis, setLabelAnalysis] = useState(labelResult?.analysis ?? null);
  const [labelAnalysisLoading, setLabelAnalysisLoading] = useState(false);
  const [labelAnalysisError, setLabelAnalysisError] = useState<string | null>(null);
  const [labelAnalysisStatus, setLabelAnalysisStatus] = useState<LabelAnalysisStatus>(
    labelResult?.analysisStatus ?? (labelResult?.analysis ? 'complete' : null)
  );
  const [dashboardRuntimeError, setDashboardRuntimeError] = useState<string | null>(null);
  const dashboardRenderMode: 'full' = resolveDashboardRenderMode(isExpoGo);
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const analysisHeaderScrollY = useSharedValue(0);
  const [headerMiniScore, setHeaderMiniScore] = useState<HeaderMiniScoreState | null>(null);
  const [dashboardCoreReady, setDashboardCoreReady] = useState(false);
  const loadingBadgeTimingRef = useRef({
    startedAt: 0,
    seen: false,
    hiddenLogged: false,
  });
  const resolvedLabelAnalysis = labelAnalysis ?? labelResult?.analysis ?? null;
  const labelDraft = labelResult?.draft ?? null;
  const labelIssues = useMemo(
    () => labelResult?.issues ?? labelDraft?.issues ?? [],
    [labelDraft?.issues, labelResult?.issues]
  );
  const labelQuality = isLabel ? getLabelDraftQuality(labelDraft, labelIssues) : null;
  const needsReview = labelQuality?.reviewRecommended ?? false;
  const analysisName = resolvedLabelAnalysis?.productInfo?.name ?? labelResult?.analysis?.productInfo?.name ?? null;
  const labelInsights = useMemo(
    () => (isLabel ? buildLabelInsights({ draft: labelDraft, issues: labelIssues, analysisName }) : null),
    [analysisName, isLabel, labelDraft, labelIssues]
  );
  const ingredientsToShow = isLabel ? (labelInsights?.fullActives ?? []) : [];
  const labelTopHighlight = isLabel ? (labelInsights?.highlights?.[0] ?? null) : null;
  const labelProductName = isLabel ? (labelInsights?.productName ?? 'Label Scan Result') : 'Supplement';

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
  } = useStreamAnalysis(barcode);
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
  const handleDashboardCoreReadyChange = useCallback((next: boolean) => {
    setDashboardCoreReady((prev) => (prev === next ? prev : next));
  }, []);
  useEffect(() => {
    analysisHeaderScrollY.value = 0;
    setHeaderMiniScore(null);
    setDashboardCoreReady(false);
    loadingBadgeTimingRef.current = {
      startedAt: 0,
      seen: false,
      hiddenLogged: false,
    };
  }, [analysisHeaderScrollY, barcode, isLabel, params.sessionId]);
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
      image: productInfo?.image ?? snapshotProduct?.imageUrl ?? null,
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

  const formatDraftIngredient = (ingredient: LabelDraft['ingredients'][number]) => {
    let line = ingredient.name;
    if (ingredient.amount != null && ingredient.unit) {
      line += `: ${ingredient.amount} ${ingredient.unit}`;
    }
    if (ingredient.dvPercent != null) {
      line += ` (${ingredient.dvPercent}% DV)`;
    }
    return line;
  };

  const getDraftDose = (draft?: LabelDraft | null) => {
    if (!draft?.ingredients?.length) return null;
    const withDose = draft.ingredients.find((ingredient) => ingredient.amount != null && ingredient.unit);
    if (!withDose) return null;
    return `${withDose.amount} ${withDose.unit}`;
  };

  const labelImageBase64 = session?.mode === 'label' ? session.input.imageBase64 : undefined;

  const handleGenerateAnalysis = useCallback(async () => {
    if (!labelResult || labelAnalysisLoading) return;
    setLabelAnalysisError(null);
    setLabelAnalysisLoading(true);
    setLabelAnalysisStatus('pending');
    try {
      const response = await requestLabelAnalysis({
        imageHash: labelResult.imageHash,
        imageBase64: labelImageBase64,
      });
      if (response.analysis) {
        setLabelAnalysis(response.analysis);
        setLabelAnalysisStatus(response.analysisStatus ?? 'complete');
      } else {
        const nextStatus = response.analysisStatus ?? 'skipped';
        setLabelAnalysisStatus(nextStatus);
        if (nextStatus === 'unavailable') {
          setLabelAnalysisError(response.message ?? 'Analysis service unavailable.');
        }
      }
    } catch {
      setLabelAnalysisError('Unable to generate analysis. Please try again.');
      setLabelAnalysisStatus('failed');
    } finally {
      setLabelAnalysisLoading(false);
    }
  }, [labelAnalysisLoading, labelResult, labelImageBase64]);

  useEffect(() => {
    if (!isLabel || !labelResult) return;
    if (labelResult.status === 'failed') return;
    if (resolvedLabelAnalysis || labelAnalysisLoading) return;
    if (analysisRequestedRef.current) return;
    const shouldAutoAnalyze = labelQuality?.labelOnlyScoreEligible ?? false;
    if (!shouldAutoAnalyze) return;
    analysisRequestedRef.current = true;
    handleGenerateAnalysis();
  }, [handleGenerateAnalysis, isLabel, labelAnalysisLoading, labelResult, labelQuality, resolvedLabelAnalysis]);

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
      analysisRequestedRef.current = false;
      addedRef.current = false;
      lastDosageRef.current = null;
      lastSupplementIdRef.current = null;
      setLabelAnalysis(null);
      setLabelAnalysisError(null);
      setLabelAnalysisLoading(false);
      setDashboardRuntimeError(null);
      setEvidenceExpanded(false);
      const nextLabelResult = consumeResult.status === 'ok' && consumeResult.session.mode === 'label'
        ? consumeResult.session.result
        : null;
      setLabelAnalysisStatus(nextLabelResult?.analysisStatus ?? (nextLabelResult?.analysis ? 'complete' : null));
    };

    void hydrateSession();

    return () => {
      cancelled = true;
    };
  }, [params.devBarcode, params.sessionId]);

  useEffect(() => {
    if (needsReview) {
      setEvidenceExpanded(true);
    }
  }, [needsReview]);

  const handleDashboardRenderError = useCallback((message: string) => {
    // Keep users on the modern full dashboard path even if an error is captured.
    // We surface the error banner instead of switching to legacy Lite UI.
    setDashboardRuntimeError(message);
  }, []);

  useEffect(() => {
    if (!session) return;

    if (session.mode === 'label') {
      if (addedRef.current) return;
      const analysis = resolvedLabelAnalysis;
      if (!analysis || analysis.status !== 'success') return;

      const productInfo = analysis.productInfo ?? {};
      const labelName = labelProductName;
      const labelDose =
        formatDoseForPill(getDraftDose(session.result.draft)) ??
        extractDoseFromText(productInfo.name ?? null) ??
        null;

      addScan({
        barcode: analysis.barcode ?? null,
        productName: labelName,
        brandName: productInfo.brand ?? 'Unknown brand',
        dosageText: labelDose ?? '',
        category: productInfo.category ?? null,
        imageUrl: productInfo.image ?? null,
      });
      addedRef.current = true;
      return;
    }

    if (barcodeQuality.page !== 'dashboard' || !recentScanProductInfo) return;

    const supplementId = snapshot?.product?.entityRefs?.supplementId ?? null;
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
    const dosageText =
      bundleActiveDose ??
      primaryDose ??
      ingredientDose ??
      activeIngredientDose ??
      summaryDose ??
      usageDose ??
      '';

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
    labelProductName,
    recentScanProductInfo,
    resolvedLabelAnalysis,
    session,
    snapshot?.product?.entityRefs?.supplementId,
    status,
    usage,
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
    if (session?.mode === 'barcode') {
      router.replace('/scan/barcode');
    } else {
      router.replace('/scan/label');
    }
  };

  if (!sessionResolved) {
    return (
      <ResponsiveScreen contentStyle={styles.screen}>
        <Header onBack={handleBack} title="Scan Result" />
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
        <Header onBack={handleBack} title="Scan Result" />
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

  if (isLabel && labelResult) {
    const draft = labelDraft;
    const issues = labelIssues;
    const quality = labelQuality ?? getLabelDraftQuality(draft, issues);
    const evidenceSummary = labelInsights
      ? `Label evidence: ${labelInsights.metaLine}`
      : `Label evidence: ${ingredientsToShow.length} ingredients • ${quality.extractionQuality} (${Math.round((draft?.confidenceScore ?? 0) * 100)}%)`;
    const isFailed = labelResult.status === 'failed';
    const fallbackTitle = labelResult.status === 'failed' ? 'Scan Failed' : 'Review Required';
    const fallbackMessage =
      labelResult.message ??
      (labelResult.status === 'failed'
        ? 'We could not read the label.'
        : 'Please review the extracted ingredients.');

    if (isFailed) {
      return (
        <ResponsiveScreen
          contentStyle={styles.screen}
          style={styles.safeArea}
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
          <Header onBack={handleBack} title="Label Scan" />

          <ScrollView contentContainerStyle={styles.labelFallbackContent}>
            <View style={styles.labelFallbackHeader}>
              <FileText size={48} color="#52525b" />
              <Text style={styles.fallbackTitle}>{fallbackTitle}</Text>
              <Text style={styles.fallbackText}>{fallbackMessage}</Text>
              {labelResult.suggestion ? (
                <Text style={styles.fallbackNote}>{labelResult.suggestion}</Text>
              ) : null}
            </View>

            {draft ? (
              <View style={styles.labelCard}>
                <Text style={styles.labelCardTitle}>Extracted Ingredients</Text>
                {draft.servingSize ? (
                  <Text style={styles.labelMeta}>Serving Size: {draft.servingSize}</Text>
                ) : null}
                {draft.ingredients.length > 0 ? (
                  <View style={styles.labelList}>
                    {draft.ingredients.map((ingredient, index) => (
                      <Text key={`${ingredient.name}-${index}`} style={styles.labelItem}>
                        {formatDraftIngredient(ingredient)}
                      </Text>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.labelEmpty}>No ingredients detected.</Text>
                )}
              </View>
            ) : null}

            {issues.length > 0 ? (
              <View style={styles.labelCard}>
                <Text style={styles.labelCardTitle}>Issues Detected</Text>
                <View style={styles.labelList}>
                  {issues.map((issue, index) => (
                    <Text key={`${issue.type}-${index}`} style={styles.labelItem}>
                      {issue.message}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>
        </ResponsiveScreen>
      );
    }

    const analysisFallback = {
      productInfo: {
        brand: null,
        name: 'Label Scan Result',
        category: 'supplement',
        image: null,
      },
      efficacy: {},
      safety: {},
      usage: {},
      value: {},
      social: {},
      meta: { actualDoseMg: 0 },
      status: 'loading',
    };
    const analysisForDisplay = resolvedLabelAnalysis ?? analysisFallback;
    const labelFallback = buildLabelFallbackAnalysis(labelInsights, labelDraft ?? null);
    const analysisWithLabelName = mergeLabelAnalysis(analysisForDisplay, labelFallback, labelProductName);
    const isLabelStreaming = labelAnalysisStatus === 'pending' || labelAnalysisLoading;
    const analysisComplete =
      resolvedLabelAnalysis?.status === 'success' && labelAnalysisStatus !== 'partial';
    const scoreState: 'active' | 'muted' = analysisComplete && !quality.mutedScore ? 'active' : 'muted';
    const showGenerateActions = !analysisComplete && !isLabelStreaming;

    return (
      <ResponsiveScreen
        contentStyle={styles.screen}
        style={styles.safeArea}
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
        <Header
          onBack={handleBack}
          title="Analysis"
          miniScore={headerMiniScore ? { ...headerMiniScore, scrollY: analysisHeaderScrollY } : null}
        />

        <AnalysisDashboard
          analysis={analysisWithLabelName as any}
          isStreaming={isLabelStreaming && !dashboardCoreReady}
          scoreBadge="Label-only estimate"
          scoreState={scoreState}
          sourceType="label_scan"
          scanSessionId={typeof params.sessionId === 'string' ? params.sessionId : null}
          analysisBundle={analysisBundle}
          externalScrollY={analysisHeaderScrollY}
          miniHeaderMode="header"
          onMiniScoreMetaChange={handleHeaderMiniScoreChange}
          onCoreReadyChange={handleDashboardCoreReadyChange}
        />

        {!analysisComplete ? (
          <View style={styles.labelCard}>
            <Text style={styles.labelCardTitle}>Analysis</Text>
            <Text style={styles.labelMeta}>
              {labelAnalysisStatus === 'pending'
                ? 'Analyzing label...'
                : labelAnalysisStatus === 'partial'
                  ? 'Analysis partially available. Some sections could not be generated.'
                : labelAnalysisStatus === 'unavailable'
                  ? 'Analysis service is unavailable right now.'
                  : 'Analysis is not generated yet.'}
            </Text>
            {labelAnalysisError ? (
              <Text style={styles.analysisErrorText}>{labelAnalysisError}</Text>
            ) : null}
            {showGenerateActions ? (
              <View style={styles.analysisActionRow}>
                <TouchableOpacity
                  style={[styles.analysisButton, labelAnalysisLoading ? styles.analysisButtonDisabled : null]}
                  onPress={handleGenerateAnalysis}
                  disabled={labelAnalysisLoading}
                >
                  <Text style={styles.analysisButtonText}>
                    {labelAnalysisStatus === 'partial'
                      ? 'Retry analysis'
                      : needsReview
                        ? 'Confirm & Generate'
                        : 'Generate analysis'}
                  </Text>
                </TouchableOpacity>
                {needsReview ? (
                  <TouchableOpacity
                    style={[styles.secondaryActionButton, labelAnalysisLoading ? styles.analysisButtonDisabled : null]}
                    onPress={handleGenerateAnalysis}
                    disabled={labelAnalysisLoading}
                  >
                    <Text style={styles.secondaryActionText}>Generate anyway</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.labelCard}>
          <View style={styles.evidenceHeader}>
            <Text style={styles.labelCardTitle}>Label Evidence</Text>
            <TouchableOpacity
              onPress={() => setEvidenceExpanded((prev) => !prev)}
              activeOpacity={0.7}
            >
              <Text style={styles.evidenceToggle}>
                {evidenceExpanded ? 'Hide' : 'View'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.evidenceSummary}>{evidenceSummary}</Text>
          {needsReview ? (
            <Text style={styles.evidenceWarning}>
              Review recommended. Extraction quality is low; confirm evidence before relying on AI analysis.
            </Text>
          ) : null}
          {evidenceExpanded ? (
            <View style={styles.labelMetaGroup}>
              <Text style={styles.labelMetaTight}>Product: {labelProductName}</Text>
              {labelTopHighlight ? (
                <Text style={styles.labelMetaTight}>Top highlight: {labelTopHighlight}</Text>
              ) : null}
              {draft?.servingSize ? (
                <Text style={styles.labelMetaTight}>Serving Size: {draft.servingSize}</Text>
              ) : (
                <Text style={styles.labelMetaTight}>Serving Size: Not detected</Text>
              )}
            <Text style={styles.labelMetaTight}>
              Extraction Quality: {quality.extractionQuality} ({Math.round((draft?.confidenceScore ?? 0) * 100)}%)
            </Text>
            <Text style={styles.labelMetaTight}>
              Coverage: {Math.round((draft?.parseCoverage ?? 0) * 100)}% | {quality.validCount} valid ingredients
            </Text>
            {labelInsights ? (
              <Text style={styles.labelMetaTight}>
                Missing dose: {labelInsights.missingDoseCount} • Duplicates: {labelInsights.duplicateCount}
              </Text>
            ) : null}
            {labelInsights?.hasProprietaryBlend ? (
              <Text style={styles.labelMetaTight}>Proprietary blend detected</Text>
            ) : null}
              {ingredientsToShow.length > 0 ? (
                <View style={styles.labelList}>
                  {ingredientsToShow.map((ingredient, index) => (
                    <Text key={`${ingredient.name}-${index}`} style={styles.labelItem}>
                      {ingredient.name}: {ingredient.doseText}
                    </Text>
                  ))}
                </View>
              ) : (
                <Text style={styles.labelEmpty}>No ingredients detected.</Text>
              )}
              {issues.length > 0 ? (
                <View style={styles.labelIssues}>
                  <Text style={styles.labelCardTitle}>Issues Detected</Text>
                  {issues.map((issue, index) => (
                    <Text key={`${issue.type}-${index}`} style={styles.labelItem}>
                      {issue.message}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

      {isLabelStreaming && !labelAnalysisError && !dashboardCoreReady ? (
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
        ) : null}
      </ResponsiveScreen>
    );
  }

  // 1. Barcode Not Found
  if (barcodeQuality.page === 'not_found') {
    return (
      <ResponsiveScreen contentStyle={styles.screen}>
        <Header onBack={handleBack} title="Scan Result" />
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
        <Header onBack={handleBack} title="Scan Result" />
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
        <Header onBack={handleBack} title="Scan Result" />
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
      <Header
        onBack={handleBack}
        title="Analysis"
        miniScore={headerMiniScore ? { ...headerMiniScore, scrollY: analysisHeaderScrollY } : null}
      />

      {/* We render dashboard immediately. 
        As 'efficacy', 'safety' etc. arrive, this component re-renders and fills in the blanks.
      */}
      <DashboardErrorBoundary onError={handleDashboardRenderError}>
        <AnalysisDashboard
          analysis={compositeAnalysis}
          isStreaming={showStreamingBadge}
          sourceType="barcode"
          scanSessionId={typeof params.sessionId === 'string' ? params.sessionId : null}
          analysisBundle={analysisBundle}
          externalScrollY={analysisHeaderScrollY}
          miniHeaderMode="header"
          onMiniScoreMetaChange={handleHeaderMiniScoreChange}
          onCoreReadyChange={handleDashboardCoreReadyChange}
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

function Header({
  onBack,
  title,
  miniScore,
}: {
  onBack: () => void,
  title: string,
  miniScore?: (HeaderMiniScoreState & { scrollY: SharedValue<number> }) | null,
}) {
  const miniScoreTone = useMemo(
    () => (miniScore ? getHeaderOverallBandTone(miniScore.overallScore, miniScore.overallBand) : null),
    [miniScore?.overallBand, miniScore?.overallScore]
  );
  const titleAnimatedStyle = useAnimatedStyle(() => {
    const progress = miniScore
      ? Math.max(0, Math.min(1, (miniScore.scrollY.value - HEADER_MINI_SCORE_START) / HEADER_MINI_SCORE_RANGE))
      : 0;
    return {
      opacity: 1 - progress,
      transform: [
        { translateY: progress * 8 },
        { scale: 1 - progress * 0.06 },
      ],
    };
  }, [miniScore]);
  const miniScoreAnimatedStyle = useAnimatedStyle(() => {
    const progress = miniScore
      ? Math.max(0, Math.min(1, (miniScore.scrollY.value - HEADER_MINI_SCORE_START) / HEADER_MINI_SCORE_RANGE))
      : 0;
    return {
      opacity: progress,
      transform: [
        { translateY: (1 - progress) * 10 },
        { scale: 0.82 + progress * 0.18 },
      ],
    };
  }, [miniScore]);

  return (
    <View style={styles.header}>
      <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
        <ArrowLeft size={20} color="#000" />
      </TouchableOpacity>
      <View style={styles.headerCenterSlot} pointerEvents="none">
        <Animated.View style={[styles.headerTitleLayer, titleAnimatedStyle]}>
          <Text style={styles.headerTitle}>{title}</Text>
        </Animated.View>
        {miniScore && miniScoreTone ? (
          <Animated.View style={[styles.headerMiniScoreLayer, miniScoreAnimatedStyle]}>
            <LinearGradient
              colors={
                miniScore.muted
                  ? ['rgba(255,255,255,0.94)', 'rgba(241,245,249,0.78)']
                  : ['rgba(255,255,255,0.96)', miniScoreTone.bubbleFill]
              }
              locations={[0, 1]}
              start={{ x: 0.15, y: 0.05 }}
              end={{ x: 0.85, y: 1 }}
              style={[
                styles.headerMiniScoreShell,
                miniScore.muted ? styles.headerMiniScoreShellMuted : { borderColor: miniScoreTone.bubbleBorder },
              ]}
            >
              <View
                style={[
                  styles.headerMiniScoreCore,
                  miniScore.muted
                    ? styles.headerMiniScoreCoreMuted
                    : { borderColor: miniScoreTone.bubbleBorder, backgroundColor: 'rgba(255,255,255,0.34)' },
                ]}
              >
                <Text
                  style={[
                    styles.headerMiniScoreText,
                    miniScore.muted ? styles.headerMiniScoreTextMuted : { color: miniScoreTone.bubbleText },
                  ]}
                >
                  {miniScore.muted ? '--' : Math.round(miniScore.overallScore)}
                </Text>
              </View>
            </LinearGradient>
          </Animated.View>
        ) : null}
      </View>
      <View style={styles.headerSpacer} />
    </View>
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
  fallbackNote: { fontSize: 14, color: '#71717a', marginTop: 12, textAlign: 'center' },
  labelFallbackContent: { padding: 24, paddingBottom: 40 },
  labelFallbackHeader: { alignItems: 'center', paddingVertical: 24 },
  labelCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#e4e4e7',
  },
  labelCardTitle: { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 8 },
  labelMeta: { fontSize: 13, color: '#6b7280', marginBottom: 12 },
  labelMetaTight: { fontSize: 13, color: '#6b7280' },
  labelMetaGroup: { gap: 4, marginBottom: 12 },
  labelList: { marginTop: 4 },
  labelItem: { fontSize: 14, color: '#111827', marginBottom: 6, lineHeight: 20 },
  labelEmpty: { fontSize: 14, color: '#6b7280' },
  labelIssues: { marginTop: 16 },
  evidenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  evidenceToggle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563eb',
  },
  evidenceSummary: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 12,
  },
  evidenceWarning: {
    fontSize: 12,
    color: '#b91c1c',
    marginBottom: 12,
  },
  analysisButton: {
    marginTop: 8,
    backgroundColor: '#111827',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  analysisActionRow: {
    marginTop: 8,
    gap: 8,
  },
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
  analysisButtonDisabled: {
    backgroundColor: '#6b7280',
    borderColor: '#6b7280',
  },
  analysisButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  analysisErrorText: {
    marginTop: 8,
    color: '#b91c1c',
    fontSize: 13,
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
