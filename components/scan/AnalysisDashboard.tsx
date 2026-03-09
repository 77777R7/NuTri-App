import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
    Activity,
    BarChart3,
    CheckCircle2,
    ChevronRight,
    Clock,
    Pill,
    Shield,
    TrendingUp,
    X,
    Zap,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    InteractionManager,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
    type DimensionValue,
    type LayoutChangeEvent,
    type StyleProp,
    type ViewStyle,
} from 'react-native';
import Animated, {
    Easing,
    FadeInUp,
    FadeOutDown,
    useAnimatedReaction,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    type SharedValue,
} from 'react-native-reanimated';

import { OdsFoundationPanel } from '@/components/ods/OdsFoundationPanel';
import { InteractiveScoreRing } from '@/components/ui/InteractiveScoreRing';
import { ContentSection } from '@/components/ui/ScoreDetailCard';
import { SkeletonLoader } from '@/components/ui/SkeletonLoader';
import { Config } from '@/constants/Config';
import { withAuthHeaders } from '@/lib/auth-token';
import { useTranslation } from '@/lib/i18n';
import { lookupFoundationForIngredient, summarizeFoundationHits } from '@/lib/knowledge/foundationLookup';
import { resolveDataCeilingSignal } from '@/lib/scan/dataCeiling';
import { buildGapActionSentences } from '@/lib/scan/gapActionSentenceLibrary';
import { isNutritionLabelLikeIngredient } from '@/lib/scan/isNutritionLabelLikeIngredient';
import { assembleInsightsDTO, buildWhyBullets } from '@/lib/scan/insightsAssembler';
import { enforceNeverBlank, isPlaceholderText, sanitizeCoverBullets, sanitizeCoverLine } from '@/lib/scan/neverBlank';
import { buildRecordFactsViewModel } from '@/lib/scan/recordFactsViewModel';
import { mergeScienceIngredientCandidates } from '@/lib/scan/scienceIngredientSnapshot';
import { buildSafetySignalPack } from '@/lib/scan/safetySignalPack';
import { resolveTrustedDisplayIdentity } from '@/lib/scan/resolveTrustedDisplayIdentity';
import { buildVerificationPresentation } from '@/lib/scan/verificationPresentation';
import { resolveReasonCodeMessage } from '@/lib/scan/streamStateMachine';
import { computeSmartScores, type AnalysisInput } from '@/lib/scoring';
import { formatBrandForPill } from '@/lib/supplementDisplay';
import type {
    IngredientOverviewBlock,
    IngredientOverviewResponse,
    ScientificBackgroundBlock,
    ScientificBackgroundResponse,
} from '@/shared/types/ingredientScience';
import type { FactsDTO } from '@/shared/types/scan-insights';
import type {
    AnalysisBundle,
    AnalysisBundleV4,
    BasisTag,
    DataStatus,
    IngredientsDetail,
    IngredientsDetailItemV3,
    IngredientsDetailItemV4,
    IngredientsDetailV3,
    IngredientsDetailV4
} from '@/types/analysisBundle';
import type { ScoreBundleResponse, ScoreBundleV4 } from '@/types/scoreBundle';
type Analysis = any;
type ScoreState = 'active' | 'muted' | 'loading';
type SourceType = 'barcode' | 'label_scan';

type TileType = 'overview' | 'science' | 'usage' | 'safety';

type CoverStatus = 'complete' | 'partial' | 'limited';

type MissingReason =
    | 'MISSING_PRIMARY_ACTIVE'
    | 'MISSING_EVIDENCE_MAPPING'
    | 'MISSING_FORM_QUALITY'
    | 'MISSING_OVERVIEW_SUMMARY'
    | 'MISSING_OVERVIEW_BENEFITS'
    | 'MISSING_USAGE_GUIDANCE'
    | 'MISSING_BEST_FOR'
    | 'MISSING_SAFETY_WARNING'
    | 'MISSING_SAFETY_TIP'
    | 'MISSING_DOSE_RANGE';

type SourceRef = {
    type: 'pubmed' | 'cochrane' | 'ods' | 'label' | 'other';
    id?: string;
    url?: string;
    title?: string;
};

type ScoreBundleV4State = {
    status: 'idle' | 'loading' | 'ready' | 'error';
    response: ScoreBundleResponse | null;
    error: string | null;
};

type FactsDtoState = {
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: FactsDTO | null;
    error: string | null;
};

type DecisionSupportState = {
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: Record<string, unknown> | null;
    error: string | null;
    autoRetryUsed: boolean;
};

type DecisionChecklistStatus = 'verified' | 'missing' | 'unknown';
type DecisionChecklistRow = {
    key: string;
    label: string;
    status: DecisionChecklistStatus;
    sourceTier: 'official_record' | 'scanned_label' | 'overlay_iherb' | 'general_science' | 'inferred' | 'missing';
    why?: string | null;
};
type DecisionScoreCardV2ChecklistItem = {
    key: string;
    label: string;
    state: DecisionChecklistStatus;
    sourceTier: 'official_record' | 'scanned_label' | 'overlay_iherb' | 'general_science' | 'inferred' | 'missing';
    evidenceStrength?:
        | 'official'
        | 'scanned_label'
        | 'overlay_label_transcription'
        | 'overlay_claim'
        | 'cert_page_verified'
        | 'general_science'
        | 'inferred';
    evidenceRef?: string | null;
    note?: string | null;
    weight?: number;
    role?: 'score' | 'info';
    critical?: boolean;
    proofClass?:
        | 'official_like'
        | 'overlay_transcription'
        | 'claim_only'
        | 'independent_verifier'
        | 'science_only';
    scoreEligible?: boolean;
};
type DecisionScoreCardV2Module = {
    id:
        | 'ingredient_safety'
        | 'formula_transparency'
        | 'label_clarity'
        | 'manufacturing_standards'
        | 'testing_verification'
        | 'product_quality';
    title: string;
    score: number;
    status: 'high' | 'moderate' | 'limited' | 'low' | 'medium' | 'unknown';
    band?: 'High' | 'Moderate' | 'Limited' | 'Low';
    checklist: DecisionScoreCardV2ChecklistItem[];
};
type DecisionSupportTemplatePayload = {
    digest?: string;
    nutriScoreCard?: {
        score?: number;
        confidenceCoverage?: number;
        rows?: Array<{ id: 'effectiveness' | 'safety' | 'integrity'; label: string; score: number }>;
        checklistsByRow?: Record<'effectiveness' | 'safety' | 'integrity', DecisionChecklistRow[]>;
    };
    nutriScoreCardV2?: {
        overallScore?: number;
        overallBand?: 'Excellent' | 'Strong' | 'Good' | 'Fair' | 'Limited' | 'Weak';
        confidencePct?: number;
        modules?: DecisionScoreCardV2Module[];
    };
    overviewBlock?: {
        sourceStrip?: string[];
        bestForBullets?: string[];
        providesVerified?: {
            servingSize?: string | null;
            servingsPerContainer?: number | null;
            keyIngredients?: Array<{ name: string; dose?: string | null }>;
            dosageForm?: string | null;
            count?: string | null;
        };
        missingInfo?: string[];
        singleCta?: { label?: string; id?: string } | null;
    };
    scienceBlock?: {
        ingredientSourceTier?: 'overlay_iherb' | 'official_record';
        ingredientRows?: Array<{ name: string; dose?: string | null }>;
        ingredientSnapshotNames?: string[];
        formMatters?: { ingredientChemicalForm?: string | null; dosageForm?: string | null };
        odsGeneralScienceBullets?: string[];
        aiSummaryContract3?: [string, string, string];
    };
    usageBlock?: {
        directions?: {
            text?: string;
            lines?: string[];
            sourceTier?: 'official_record' | 'scanned_label' | 'overlay_iherb' | 'missing';
            hasDirectionsTextVisible?: boolean;
        };
        timingTip?: string;
        conservativeGuidance?: string;
    };
    safetyBlock?: {
        labelWarnings?: string[];
        ulGuidance?: string[];
        generalWatchouts?: string[];
        dataStatusRef?: string;
    };
    topBlockers?: Array<{
        code?: string;
        title?: string;
        why?: string;
        severity?: 'high' | 'medium' | 'low' | string;
        affectsCoreVerdict?: boolean;
    }>;
    qualityMark?: {
        status?: 'detected' | 'not_detected' | 'unknown';
        checked?: boolean;
        evidenceRef?: string | null;
        sourcesTried?: string[];
        checkedMode?: 'search_only' | 'page_fetch' | null;
        pagesFetchedCount?: number;
        searchPagesFetchedCount?: number;
        evidenceType?: 'page' | 'search' | null;
        note?: string;
    };
};

type ProductOverviewAiPayload = {
    mode: 'short' | 'rich';
    lead: string;
    whatItIs: string;
    whyPeopleTakeIt: string;
    promptVersion?: string;
};

type ProductOverviewAiRequestPayload = {
    digest: string;
    productName: string;
    brandName: string | null;
    productTypeHint: string | null;
    primaryIngredient: string | null;
    keyIngredients: Array<{
        name: string;
        dose: string | null;
    }>;
    sourceContextHint: string | null;
    chemicalFormHint: string | null;
    strengthClaim: string | null;
    servingStrength: string | null;
    form: string | null;
    count: string | null;
    isLikelySingleIngredient: boolean;
};

type CoverLine = {
    text: string;
    isPlaceholder?: boolean;
    showInfo?: boolean;
    missingReason?: MissingReason;
};

type BulletItem = {
    text: string;
    isPlaceholder?: boolean;
    showInfo?: boolean;
    missingReason?: MissingReason;
};

type Mechanism = {
    name: string;
    amount: string;
    fill: number;
    mode?: 'actual' | 'unknown';
    showInfo?: boolean;
    missingReason?: MissingReason;
};

type TileConfig = {
    id: number;
    type: TileType;
    title: string;
    modalTitle: string;
    icon: React.ComponentType<{ size?: number; color?: string }>;
    accentColor: string;
    backgroundColor: string;
    textColor?: string;
    labelColor?: string;
    viewLabel?: string;
    eyebrow: string;
    summary?: CoverLine;
    summaryLines?: number;
    bullets?: BulletItem[];
    bulletLimit?: number;
    bulletLines?: number;
    footerText?: string;
    footerLines?: number;
    mechanisms?: Mechanism[];
    routineLine?: CoverLine;
    bestFor?: CoverLine;
    bestForLabel?: string;
    warning?: CoverLine;
    tip?: CoverLine;
    tipLabel?: string;
    loading?: boolean;
    dataStatus?: {
        status: CoverStatus;
        missingReasons: string[];
        sources: SourceRef[];
        notes?: string[];
    };
    trustPanel?: {
        verifiedFrom: string;
        retrievedOn: string;
        webEvidence: 'used' | 'not used' | 'unknown';
        trustLevel: 'High' | 'Medium' | 'Limited';
        verifiedSummary: string;
        missingSummary: string;
        reason: string;
        sources: Array<{
            label: string;
            value: string;
            tag: 'Product-specific' | 'General reference' | 'User scan evidence' | 'Web evidence';
            url?: string | null;
        }>;
    };
    showDataStatusCard?: boolean;
    content: React.ReactNode;
};

type WidgetTileProps = {
    tile: TileConfig;
    onPress: () => void;
};

const FORCE_FULL_DASHBOARD_EFFECTS =
    process.env.EXPO_PUBLIC_FORCE_FULL_DASHBOARD_EFFECTS === 'true' ||
    process.env.EXPO_PUBLIC_FORCE_FULL_DASHBOARD_EFFECTS === '1';
const PRODUCT_OVERVIEW_AI_TIMEOUT_MS = 4_800;
const PRODUCT_OVERVIEW_AI_WATCHDOG_MS = 5_400;
const SHOW_SCAN_DEBUG =
    process.env.EXPO_PUBLIC_SHOW_SCAN_DEBUG === 'true' ||
    process.env.EXPO_PUBLIC_SHOW_SCAN_DEBUG === '1';
// Hard-disable legacy section APIs in v1.6.16+ to prevent old-detail overrides.
const ENABLE_LEGACY_SECTION_API = false;
const SCAN_UX_VIEW_MODE: 'details' = 'details';
const SCAN_UX_VARIANT = (() => {
    const raw = String(process.env.EXPO_PUBLIC_SCAN_UX_VARIANT ?? 'full').trim().toLowerCase();
    if (raw === 'shadow' || raw === 'canary' || raw === 'full') return raw;
    return 'full';
})();
const FREEZE_SHADOW_ONLY =
    process.env.EXPO_PUBLIC_FREEZE_SHADOW_ONLY == null
        ? true
        : !(
            process.env.EXPO_PUBLIC_FREEZE_SHADOW_ONLY === '0'
            || process.env.EXPO_PUBLIC_FREEZE_SHADOW_ONLY === 'false'
        );
const normalizeTaxonomyLabel = (value?: string | null): string =>
    normalizeText(value)
        .toLowerCase()
        .replace(/[.。:：]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
const normalizeBarcodeForDecision = (value?: string | null): string | null => {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (digits.length < 8) return null;
    return digits.length > 14 ? digits.slice(-14) : digits.padStart(14, '0');
};
const SIMPLE_TAXONOMY_WHITELIST = new Set(
    [
        'iHerb',
        'Official record',
        'Scanned label',
        'Scanned label (patch/label)',
        'Official + supplemental label data',
        'Supplemental label data',
        'Verified',
        'General science',
        'General science (NIH ODS)',
        'AI summary',
    ].map((label) => normalizeTaxonomyLabel(label)),
);
const decisionSupportWarmCache = new Map<string, Record<string, unknown>>();

const getPayloadSourceType = (payload: Record<string, unknown> | null | undefined): string =>
    normalizeText(payload && typeof payload.sourceType === 'string' ? payload.sourceType : null).toLowerCase();

const getDecisionPayloadFactsDigestHash = (payload: Record<string, unknown> | null | undefined): string =>
    normalizeText(payload && typeof payload.factsDigestHash === 'string' ? payload.factsDigestHash : null);

const getDecisionPayloadDigest = (payload: Record<string, unknown> | null | undefined): string =>
    normalizeText(payload && typeof payload.digest === 'string' ? payload.digest : null);

const isDecisionPayloadExplicitlyStale = (payload: Record<string, unknown> | null | undefined): boolean =>
    Boolean(payload && typeof payload === 'object' && payload.staleDigest === true);

const getV2ModulesFromPayload = (payload: Record<string, unknown> | null | undefined): Record<string, unknown>[] => {
    const card = payload?.nutriScoreCardV2;
    if (!card || typeof card !== 'object') return [];
    const modules = (card as { modules?: unknown }).modules;
    return Array.isArray(modules) ? (modules as Record<string, unknown>[]) : [];
};

const hasRenderableDecisionTemplate = (payload: Record<string, unknown> | null | undefined): boolean => {
    if (!payload || typeof payload !== 'object') return false;
    const modules = getV2ModulesFromPayload(payload);
    const hasScoreShape = modules.length === 6;
    const hasBlocks =
        typeof payload.overviewBlock === 'object'
        && typeof payload.scienceBlock === 'object'
        && typeof payload.usageBlock === 'object'
        && typeof payload.safetyBlock === 'object';
    return hasScoreShape && hasBlocks;
};

const computeDecisionPayloadStrength = (payload: Record<string, unknown> | null | undefined): number => {
    if (!payload || typeof payload !== 'object') return -1;
    const sourceType = getPayloadSourceType(payload);
    let strength = 0;
    if (sourceType === 'dsld' || sourceType === 'lnhpd') strength += 120;
    else if (sourceType === 'web') strength += 10;

    const modules = getV2ModulesFromPayload(payload);
    if (modules.length === 6) {
        const scored = modules
            .map((module) => Number(module?.score))
            .filter((score) => Number.isFinite(score)) as number[];
        const avgScore = scored.length > 0
            ? scored.reduce((sum, score) => sum + score, 0) / scored.length
            : 0;
        strength += 20 + avgScore;
    }

    if (typeof payload.overviewBlock === 'object') strength += 5;
    if (typeof payload.usageBlock === 'object') strength += 5;
    const directionTier = normalizeText(
        (payload.usageBlock as { directions?: { sourceTier?: string | null } | null } | undefined)?.directions?.sourceTier ?? null,
    ).toLowerCase();
    if (directionTier === 'overlay_iherb' || directionTier === 'scanned_label') strength += 10;
    if (hasRenderableDecisionTemplate(payload)) strength += 20;

    return strength;
};

const pickStrongerDecisionPayload = (
    currentPayload: Record<string, unknown> | null | undefined,
    candidatePayload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null => {
    if (!candidatePayload) return currentPayload ?? null;
    if (!currentPayload) return candidatePayload;
    const currentFactsDigestHash = getDecisionPayloadFactsDigestHash(currentPayload);
    const candidateFactsDigestHash = getDecisionPayloadFactsDigestHash(candidatePayload);
    if (candidateFactsDigestHash && currentFactsDigestHash && candidateFactsDigestHash !== currentFactsDigestHash) {
        return candidatePayload;
    }
    const currentStrength = computeDecisionPayloadStrength(currentPayload);
    const candidateStrength = computeDecisionPayloadStrength(candidatePayload);
    return candidateStrength >= currentStrength ? candidatePayload : currentPayload;
};

const pickFreshDecisionPayloadForFacts = (
    factsDigestHash: string | null | undefined,
    decisionDigest: string | null | undefined,
    ...payloads: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown> | null => {
    const normalizedFactsDigestHash = normalizeText(factsDigestHash);
    const normalizedDecisionDigest = normalizeText(decisionDigest);
    let best: Record<string, unknown> | null = null;
    payloads.forEach((payload) => {
        if (!payload || typeof payload !== 'object') return;
        if (isDecisionPayloadExplicitlyStale(payload)) return;
        if (normalizedDecisionDigest) {
            const payloadDecisionDigest = getDecisionPayloadDigest(payload);
            if (!payloadDecisionDigest || payloadDecisionDigest !== normalizedDecisionDigest) {
                return;
            }
        }
        if (normalizedFactsDigestHash) {
            const payloadFactsDigestHash = getDecisionPayloadFactsDigestHash(payload);
            if (!payloadFactsDigestHash || payloadFactsDigestHash !== normalizedFactsDigestHash) {
                return;
            }
        }
        best = pickStrongerDecisionPayload(best, payload);
    });
    return best;
};

const upsertDecisionPayloadByBarcode = (
    cache: Map<string, Record<string, unknown>>,
    barcode: string,
    payload: Record<string, unknown>,
): Record<string, unknown> => {
    const existing = cache.get(barcode) ?? null;
    const selected = pickStrongerDecisionPayload(existing, payload);
    if (selected) {
        cache.set(barcode, selected);
        return selected;
    }
    return payload;
};

if (__DEV__) {
    console.log('[dashboard-version] PR1PR2_SAFE_MERGE');
}

const appOwnership = Constants.appOwnership;
const isExpoGo = appOwnership === 'expo' || appOwnership === 'guest';
const isIosDevClientBuild = __DEV__ && Platform.OS === 'ios' && appOwnership == null;
const FORCE_IOS_DEV_SCORE_RING =
    process.env.EXPO_PUBLIC_FORCE_IOS_DEV_SCORE_RING === 'true' ||
    process.env.EXPO_PUBLIC_FORCE_IOS_DEV_SCORE_RING === '1';
const FORCE_IOS_DEV_DASHBOARD_ANIMATIONS =
    process.env.EXPO_PUBLIC_FORCE_IOS_DEV_DASHBOARD_ANIMATIONS === 'true' ||
    process.env.EXPO_PUBLIC_FORCE_IOS_DEV_DASHBOARD_ANIMATIONS === '1';
const expoGoDashboardCompatMode = isExpoGo && !FORCE_FULL_DASHBOARD_EFFECTS;
const DASHBOARD_BISECT_RAW = (process.env.EXPO_PUBLIC_SCAN_DASHBOARD_BISECT ?? '').trim();
const DASHBOARD_BISECT_FLAGS = new Set(
    DASHBOARD_BISECT_RAW
        .split(',')
        .map((flag: string) => flag.trim().toLowerCase())
        .filter(Boolean),
);
const hasDashboardBisectFlag = (flag: string) => DASHBOARD_BISECT_FLAGS.has(flag);
const safeRuntimeForAnimatedDashboard = !isExpoGo && !isIosDevClientBuild;
const enableAnimatedDashboard =
    FORCE_FULL_DASHBOARD_EFFECTS &&
    safeRuntimeForAnimatedDashboard &&
    !hasDashboardBisectFlag('force_static_dashboard');
const disableDashboardBlur = expoGoDashboardCompatMode || hasDashboardBisectFlag('no_blur');
const disableIosDevDashboardAnimations = isIosDevClientBuild && !FORCE_IOS_DEV_DASHBOARD_ANIMATIONS;
const disableTileAnimation = !enableAnimatedDashboard || disableIosDevDashboardAnimations || hasDashboardBisectFlag('no_tile_anim');
const disableReanimatedScroll = !enableAnimatedDashboard || disableIosDevDashboardAnimations || hasDashboardBisectFlag('no_reanimated_scroll');
const disableMiniHeader = !enableAnimatedDashboard || disableIosDevDashboardAnimations || hasDashboardBisectFlag('no_mini_header');
const disableHeroHeader = hasDashboardBisectFlag('no_hero');
const disableScoreRingByBisect = hasDashboardBisectFlag('no_ring') && !FORCE_IOS_DEV_SCORE_RING;
const disableScoreRing = disableScoreRingByBisect;
const disableInsightDeck = hasDashboardBisectFlag('no_insight_deck');
const disableTilesGrid = hasDashboardBisectFlag('no_tiles');
const disableModalPane = expoGoDashboardCompatMode || hasDashboardBisectFlag('no_modal');
const scoreRingDisableNotice = (() => {
    if (disableScoreRingByBisect) {
        return 'Set by `no_ring` in `EXPO_PUBLIC_SCAN_DASHBOARD_BISECT`.';
    }
    return 'Disabled by dashboard compatibility mode.';
})();
const disableOdsPanel = hasDashboardBisectFlag('no_ods_panel');
const TILE_GLASS_TINT: React.ComponentProps<typeof BlurView>['tint'] = expoGoDashboardCompatMode
    ? 'light'
    : 'systemUltraThinMaterialLight';

const DashboardBlur: React.FC<React.ComponentProps<typeof BlurView>> = ({
    children,
    style,
    pointerEvents,
    ...props
}) => {
    if (disableDashboardBlur) {
        return (
            <View style={style} pointerEvents={pointerEvents}>
                {children}
            </View>
        );
    }
    return (
        <BlurView style={style} pointerEvents={pointerEvents} {...props}>
            {children}
        </BlurView>
    );
};

const AnimatedTile: React.FC<{
    tile: TileConfig;
    onPress: () => void;
    scrollY: SharedValue<number>;
    viewportHeight: number;
    tileWidth: DimensionValue;
    style?: StyleProp<ViewStyle>;
}> = ({ tile, onPress, scrollY, viewportHeight, tileWidth, style }) => {
    const layoutY = useSharedValue(0);
    const layoutH = useSharedValue(0);
    const visibleProgress = useSharedValue(0);
    const hasAnimated = useSharedValue(false);

    useAnimatedReaction(
        () => {
            if (layoutH.value === 0) return false;
            const viewTop = scrollY.value;
            const triggerLine = viewTop + viewportHeight * 0.7; // 70% down the screen
            const cardTop = layoutY.value;
            const cardBottom = layoutY.value + layoutH.value;
            const entersTriggerZone = cardTop < triggerLine && cardBottom > viewTop + viewportHeight * 0.2;
            return entersTriggerZone;
        },
        (shouldAnimate) => {
            if (shouldAnimate && !hasAnimated.value) {
                hasAnimated.value = true;
                visibleProgress.value = withTiming(1, {
                    duration: 520,
                    easing: Easing.out(Easing.cubic),
                });
            }
        },
        [viewportHeight]
    );

    const animatedStyle = useAnimatedStyle(() => {
        const progress = visibleProgress.value;
        const opacity = 0.35 + 0.65 * progress;
        const translateY = 32 * (1 - progress);
        const scale = 0.92 + 0.08 * progress;
        return {
            opacity,
            transform: [{ translateY }, { scale }],
        };
    });

    return (
        <Animated.View
            style={[{ width: tileWidth }, animatedStyle, style]}
            onLayout={(e) => {
                layoutY.value = e.nativeEvent.layout.y;
                layoutH.value = e.nativeEvent.layout.height;
            }}
        >
            <WidgetTile tile={tile} onPress={onPress} />
        </Animated.View>
    );
};

const StaticTile: React.FC<{
    tile: TileConfig;
    onPress: () => void;
    scrollY: SharedValue<number>;
    viewportHeight: number;
    tileWidth: DimensionValue;
    style?: StyleProp<ViewStyle>;
}> = ({ tile, onPress, tileWidth, style }) => {
    return (
        <View style={[{ width: tileWidth }, style]}>
            <WidgetTile tile={tile} onPress={onPress} />
        </View>
    );
};

const colorMap: Record<string, string> = {
    'text-blue-500': '#3B82F6',
    'text-purple-500': '#A855F7',
    'text-orange-500': '#F97316',
    'text-green-500': '#22C55E',
    'text-yellow-500': '#FACC15',
    'text-sky-500': '#0EA5E9',
    'text-amber-500': '#F59E0B',
    'text-rose-500': '#F43F5E',
    'text-zinc-700': '#3F3F46',
};

const TILE_HEIGHT = 252;

function hexToRgb(hex: string) {
    const normalized = hex.replace('#', '').trim();
    const full =
        normalized.length === 3
            ? normalized
                .split('')
                .map((c) => c + c)
                .join('')
            : normalized;

    const int = parseInt(full, 16);
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    return { r, g, b };
}

function luminance(hex: string) {
    const { r, g, b } = hexToRgb(hex);
    const srgb = [r, g, b].map((value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function withAlpha(hex: string, alpha01: number) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha01})`;
}

function inferSourceType(link?: string | null): SourceRef['type'] | null {
    if (!link) return null;
    const normalized = link.toLowerCase();
    if (normalized.includes('pubmed') || normalized.includes('ncbi.nlm.nih.gov')) return 'pubmed';
    if (normalized.includes('cochrane')) return 'cochrane';
    if (normalized.includes('ods.od.nih.gov')) return 'ods';
    return 'other';
}

function buildSourceRefs(
    sources: { title?: string | null; link?: string | null }[],
    sourceType?: SourceType
): SourceRef[] {
    const refs = new Map<string, SourceRef>();
    if (sourceType === 'label_scan') {
        refs.set('label', { type: 'label' });
    }
    sources.forEach((source) => {
        const type = inferSourceType(source.link);
        if (!type) return;
        const key = `${type}:${source.link ?? ''}`;
        if (refs.has(key)) return;
        refs.set(key, {
            type,
            url: source.link ?? undefined,
            title: source.title ?? undefined,
        });
    });
    return Array.from(refs.values());
}

function computeCoverStatus(slotStates: boolean[]): CoverStatus {
    const total = slotStates.length;
    const filled = slotStates.filter(Boolean).length;
    if (filled === 0) return 'limited';
    if (filled === total) return 'complete';
    return 'partial';
}

function normalizeText(value?: string | null) {
    return value?.replace(/\s+/g, ' ').trim() ?? '';
}

const toTitleCaseWords = (value?: string | null): string => {
    const normalized = normalizeText(value);
    if (!normalized) return '';
    return normalized
        .split(/\s+/)
        .map((token) => {
            if (!token) return token;
            if (/^[A-Z0-9-]+$/.test(token)) return token;
            return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
        })
        .join(' ');
};

const singularizeServingUnit = (value?: string | null): string | null => {
    const normalized = normalizeText(value)
        .replace(/^\d+(?:[./]\d+)?\s+/i, '')
        .replace(/\(\s*s\s*\)/gi, 's')
        .replace(/\bservings?\b/gi, '')
        .trim();
    if (!normalized) return null;
    if (/ies$/i.test(normalized)) return `${normalized.slice(0, -3)}y`;
    if (/capsules$/i.test(normalized)) return normalized.replace(/capsules$/i, 'capsule');
    if (/softgels$/i.test(normalized)) return normalized.replace(/softgels$/i, 'softgel');
    if (/tablets$/i.test(normalized)) return normalized.replace(/tablets$/i, 'tablet');
    if (/gummies$/i.test(normalized)) return normalized.replace(/gummies$/i, 'gummy');
    if (/soft chews$/i.test(normalized)) return normalized.replace(/soft chews$/i, 'soft chew');
    if (/s$/i.test(normalized) && !/ss$/i.test(normalized)) return normalized.slice(0, -1);
    return normalized;
};

const pluralizeServingUnit = (value?: string | null): string | null => {
    const singular = singularizeServingUnit(value);
    if (!singular) return null;
    if (/y$/i.test(singular) && !/[aeiou]y$/i.test(singular)) return `${singular.slice(0, -1)}ies`;
    if (/soft chew$/i.test(singular)) return singular.replace(/soft chew$/i, 'soft chews');
    if (/capsule$/i.test(singular)) return `${singular}s`;
    if (/softgel$/i.test(singular)) return `${singular}s`;
    if (/tablet$/i.test(singular)) return `${singular}s`;
    if (/gummy$/i.test(singular)) return `${singular.slice(0, -1)}ies`;
    if (/s$/i.test(singular)) return singular;
    return `${singular}s`;
};

const extractStrengthClaim = (value?: string | null): string | null => {
    const normalized = normalizeText(value);
    if (!normalized) return null;
    const match = normalized.match(
        /\b(triple strength|double strength|extra strength|maximum strength|ultra strength|super strength|high potency|extra potency|maximum potency)\b/i,
    );
    return match?.[1] ? toTitleCaseWords(match[1]) : null;
};

const deriveProductTypeLabel = (params: {
    productTitle: string | null;
    primaryIngredient: string | null;
}): string | null => {
    const haystack = `${normalizeText(params.productTitle)} ${normalizeText(params.primaryIngredient)}`.toLowerCase();
    if (!haystack) return null;
    if (/\b(astaxanthin|carotenoid)\b/.test(haystack)) return 'Antioxidant supplement';
    if (/\b(omega[\s-]*3|fish oil|epa|dha|pollock|krill)\b/.test(haystack)) return 'Omega-3 supplement';
    if (/\b(probiotic|phage)\b/.test(haystack)) return 'Probiotic supplement';
    if (/\bvitamin c\b|\bascorbic acid\b/.test(haystack)) return 'Vitamin C supplement';
    if (/\bmagnesium\b/.test(haystack)) return 'Magnesium supplement';
    if (/\bmelatonin\b/.test(haystack)) return 'Melatonin supplement';
    if (/\bvitamin d\b|\bd3\b|\bd2\b/.test(haystack)) return 'Vitamin D supplement';
    if (/\bzinc\b/.test(haystack)) return 'Zinc supplement';
    if (normalizeText(params.primaryIngredient) && normalizeText(params.primaryIngredient) !== 'Multi-ingredient formula') {
        return `${normalizeText(params.primaryIngredient)} supplement`;
    }
    return 'Dietary supplement';
};

function ensurePeriod(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function formatDateYmd(value?: string | null): string | null {
    const normalized = normalizeText(value);
    if (!normalized) return null;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
}

function buildOfficialRecordUrl(source: 'lnhpd' | 'dsld' | 'web' | 'unknown', sourceId: string | null): string | null {
    const normalizedSourceId = normalizeText(sourceId);
    if (!normalizedSourceId) return null;
    if (source === 'lnhpd') {
        return `https://health-products.canada.ca/lnhpd-bdpsnh/info?licence=${encodeURIComponent(normalizedSourceId)}`;
    }
    if (source === 'dsld') {
        return `https://dsld.od.nih.gov/label/${encodeURIComponent(normalizedSourceId)}`;
    }
    return null;
}

const CUSTOMER_TECHNICAL_LINE_PATTERN =
    /match score|rbf|band thresholds|within_typical|below_typical|above_typical|reviewed[_\s]package|form match|evidence grade|confidence\s*\d|needs_capture|needs_edit|review_status/i;
const CUSTOMER_USAGE_TECHNICAL_PATTERN =
    /\boverlay_iherb\b|\bscanned_label\b|\bofficial_record\b|!=|sourceTier|patch_/i;
const OMEGA_FORM_ALLOWED_PATTERN =
    /\btriglyceride\b|\btg\b|\brtg\b|re-esterified triglyceride|ethyl ester|phospholipid/i;
const OMEGA_FORM_DISALLOWED_PATTERN =
    /\bepa\b|eicosapentaenoic|\bdha\b|docosahexaenoic/i;

function sanitizeCustomerFacingLine(value?: string | null): string | null {
    const normalized = normalizeText(value);
    if (!normalized) return null;
    if (CUSTOMER_TECHNICAL_LINE_PATTERN.test(normalized)) return null;
    return ensurePeriod(normalized);
}

function humanizeUsageLine(value?: string | null): string | null {
    const normalized = normalizeText(value);
    if (!normalized) return null;

    let line = normalized;

    line = line
        .replace(/\boverlay_iherb\b/gi, 'supplemental product-page label data')
        .replace(/\bscanned_label\b/gi, 'scanned label data')
        .replace(/\bofficial_record\b/gi, 'official record')
        .replace(/serving\s*[!≠]=+\s*daily dose/gi, 'a serving is not the same as the daily amount')
        .replace(/\bsourceTier\b/gi, 'source')
        .replace(/\bpatch[_-]?[a-z0-9_]+\b/gi, '')
        .replace(/\(patched\)/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (/^source:\s*supplemental product-page label data/i.test(line)) {
        return 'Based on supplemental product-page label data.';
    }
    if (/^source:\s*scanned label data/i.test(line)) {
        return 'Based on scanned label data.';
    }
    if (/^source:\s*official record/i.test(line)) {
        return 'Based on the official record.';
    }

    line = line
        .replace(/^Directions from supplemental label data:\s*/i, '')
        .replace(/^Directions from supplemental product-page label data:\s*/i, '')
        .replace(/^Directions from scanned label(?: data)?:\s*/i, '')
        .replace(/^Directions from record:\s*/i, '')
        .replace(/^Directions:\s*/i, '')
        .replace(/^Serving cue\s*\(verified\)\s*:/i, 'Serving cue:')
        .replace(/^Adults?\s+take\s+/i, 'Take ')
        .replace(/,\s*or as recommended by .*$/i, '')
        .replace(/\(\s*serving\s*[!≠]=+\s*daily dose\s*\)/gi, '(a serving is not the same as the daily amount)')
        .trim();

    if (CUSTOMER_USAGE_TECHNICAL_PATTERN.test(line)) return null;
    return ensurePeriod(line);
}

function emitScanUxMetric(event: string, payload: Record<string, unknown> = {}) {
    console.info('[scan-ux-metric]', {
        event,
        ...payload,
    });
}

function resolveSimpleTaxonomyLabel(label: string, fallback: string = 'Official record') {
    const normalizedLabel = normalizeText(label);
    const normalizedFallback = normalizeText(fallback) || 'Official record';
    const normalizedKey = normalizeTaxonomyLabel(normalizedLabel);
    if (SIMPLE_TAXONOMY_WHITELIST.has(normalizedKey)) return normalizedLabel;
    // Defensive allow-listing for minor punctuation/spacing variants to avoid noisy fallback.
    if (
        normalizedKey.includes('official + supplemental label data')
        || normalizedKey.includes('supplemental label data')
        || normalizedKey.includes('general science')
        || normalizedKey.includes('official record')
        || normalizedKey.includes('scanned label')
        || normalizedKey.includes('ai summary')
    ) {
        return normalizedLabel;
    }
    if (__DEV__) {
        console.warn('[scan-taxonomy] non-whitelisted badge', { label: normalizedLabel, fallback: normalizedFallback });
    }
    return normalizedFallback;
}

const renderChecklistSymbol = (status: DecisionChecklistStatus): string => {
    if (status === 'verified') return '✅';
    if (status === 'missing') return '⛔';
    return '◻';
};

type ScoreTemplateItemStatus = 'verified' | 'missing' | 'unknown';
type ScoreTemplateSection = {
    title: string;
    items: Array<{
        label: string;
        status: ScoreTemplateItemStatus;
    }>;
};

const resolveChecklistStatusByKey = (
    rows: DecisionChecklistRow[] | null | undefined,
    key: string,
): ScoreTemplateItemStatus => {
    const found = (rows ?? []).find((item) => item.key === key);
    if (!found) return 'unknown';
    if (found.status === 'verified') return 'verified';
    if (found.status === 'missing') return 'missing';
    return 'unknown';
};

const sourceTierLabel = (tier: 'official_record' | 'scanned_label' | 'general_science' | 'inferred' | 'missing' | null | undefined): string => {
    if (tier === 'official_record') return 'Official record (DSLD/LNHPD)';
    if (tier === 'scanned_label') return 'Scanned label (patch/label)';
    if (tier === 'general_science') return 'General science';
    if (tier === 'missing') return 'Missing in official record';
    return 'AI summary (grounded)';
};

const generalScienceBadgeLabel = (isOdsBacked: boolean): string =>
    isOdsBacked ? 'General science (NIH ODS)' : 'General science';

const stripBestForPrefix = (line: string): string =>
    normalizeText(line).replace(/^(Best for|Good if you want|Not ideal if)\s*:\s*/i, '').replace(/[.!?]+$/, '').trim();

const withSinglePeriod = (line: string): string => {
    const stripped = stripBestForPrefix(line);
    return stripped ? ensurePeriod(stripped) : '';
};

const buildBestForContractLines = (params: {
    candidateLines: string[];
    isOmegaLike: boolean;
}): string[] => {
    const { candidateLines, isOmegaLike } = params;
    const contract: { best: string | null; good: string | null; notIdeal: string | null } = {
        best: null,
        good: null,
        notIdeal: null,
    };
    const unlabeled: string[] = [];
    candidateLines.forEach((raw) => {
        const line = normalizeText(raw);
        if (!line) return;
        if (/^Best for\s*:/i.test(line)) {
            contract.best = withSinglePeriod(line);
            return;
        }
        if (/^Good if you want\s*:/i.test(line)) {
            contract.good = withSinglePeriod(line);
            return;
        }
        if (/^Not ideal if\s*:/i.test(line)) {
            contract.notIdeal = withSinglePeriod(line);
            return;
        }
        unlabeled.push(withSinglePeriod(line));
    });
    const nextUnlabeled = unlabeled.filter(Boolean);
    const pullNext = () => nextUnlabeled.shift() ?? null;
    if (!contract.best) contract.best = pullNext();
    if (!contract.good) contract.good = pullNext();
    if (!contract.notIdeal) contract.notIdeal = pullNext();

    const fallback = isOmegaLike
        ? {
            best: 'increasing omega-3 intake as part of a heart/vascular-support routine.',
            good: 'products with clear EPA+DHA per serving (easier to compare strength).',
            notIdeal: "the label doesn't disclose EPA+DHA, because fish-oil mg alone is a weak strength signal.",
        }
        : {
            best: 'comparing products with clear ingredient and serving disclosure.',
            good: 'products that list key actives per serving and clear directions.',
            notIdeal: 'key disclosure is missing, because product-to-product comparison gets weaker.',
        };

    return [
        `Best for: ${stripBestForPrefix(contract.best ?? fallback.best)}.`,
        `Good if you want: ${stripBestForPrefix(contract.good ?? fallback.good)}.`,
        `Not ideal if: ${stripBestForPrefix(contract.notIdeal ?? fallback.notIdeal)}.`,
    ];
};

const getOverallBandLabel = (score: number, explicitBand?: string | null): string => {
    const normalized = normalizeText(explicitBand);
    if (normalized) return normalized;
    if (score >= 90) return 'Excellent';
    if (score >= 80) return 'Strong';
    if (score >= 70) return 'Good';
    if (score >= 60) return 'Fair';
    if (score >= 45) return 'Limited';
    return 'Weak';
};

const getOverallBandTone = (score: number, explicitBand?: string | null) => {
    const band = getOverallBandLabel(score, explicitBand).toLowerCase();
    if (band === 'excellent') {
        return {
            accent: '#15803D',
            bubbleBorder: 'rgba(21,128,61,0.24)',
            bubbleFill: 'rgba(21,128,61,0.14)',
            bubbleText: '#166534',
        };
    }
    if (band === 'strong') {
        return {
            accent: '#16A34A',
            bubbleBorder: 'rgba(22,163,74,0.24)',
            bubbleFill: 'rgba(22,163,74,0.14)',
            bubbleText: '#166534',
        };
    }
    if (band === 'good') {
        return {
            accent: '#65A30D',
            bubbleBorder: 'rgba(101,163,13,0.24)',
            bubbleFill: 'rgba(101,163,13,0.14)',
            bubbleText: '#4D7C0F',
        };
    }
    if (band === 'fair') {
        return {
            accent: '#D97706',
            bubbleBorder: 'rgba(217,119,6,0.24)',
            bubbleFill: 'rgba(217,119,6,0.14)',
            bubbleText: '#B45309',
        };
    }
    if (band === 'limited') {
        return {
            accent: '#EA580C',
            bubbleBorder: 'rgba(234,88,12,0.24)',
            bubbleFill: 'rgba(234,88,12,0.14)',
            bubbleText: '#C2410C',
        };
    }
    return {
        accent: '#DC2626',
        bubbleBorder: 'rgba(220,38,38,0.24)',
        bubbleFill: 'rgba(220,38,38,0.14)',
        bubbleText: '#B91C1C',
    };
};

const moduleStatusLabel = (module: DecisionScoreCardV2Module): string => {
    if (module.band) return module.band;
    if (module.status === 'high') return 'High';
    if (module.status === 'moderate' || module.status === 'medium') return 'Moderate';
    if (module.status === 'limited') return 'Limited';
    return 'Low';
};

const moduleStatusColor = (module: DecisionScoreCardV2Module): string => {
    const band = moduleStatusLabel(module);
    if (band === 'High') return '#16A34A';
    if (band === 'Moderate') return '#D97706';
    if (band === 'Limited') return '#B45309';
    return '#DC2626';
};

type ScoreChecklistChip = 'Verified' | 'Detected' | 'Not verified' | 'Not shown';

const resolveChecklistChip = (item: DecisionScoreCardV2ChecklistItem): ScoreChecklistChip => {
    if (item.state === 'missing') return 'Not shown';
    if (item.state === 'unknown') return 'Not verified';
    if (item.evidenceStrength === 'overlay_claim') return 'Detected';
    if (
        item.evidenceStrength === 'official'
        || item.evidenceStrength === 'scanned_label'
        || item.evidenceStrength === 'overlay_label_transcription'
        || item.evidenceStrength === 'cert_page_verified'
    ) {
        return 'Verified';
    }
    return 'Detected';
};

const NutriScoreCardV2: React.FC<{
    overallScore: number;
    overallBand?: string | null;
    modules: DecisionScoreCardV2Module[];
    muted: boolean;
}> = ({ overallScore, overallBand, modules, muted }) => {
    const [expandedId, setExpandedId] = useState<DecisionScoreCardV2Module['id'] | null>(null);
    const safeModules = Array.isArray(modules) ? modules : [];
    if (safeModules.length === 0) return null;
    const resolvedOverallBand = getOverallBandLabel(overallScore, overallBand);
    const overallBandTone = getOverallBandTone(overallScore, overallBand);

    return (
        <View style={styles.scoreV2Card}>
            <View style={styles.scoreV2Header}>
                <View style={styles.scoreV2HeaderLeft}>
                    <Text style={styles.scoreV2Eyebrow}>NUTRI SCORE</Text>
                    <Text style={styles.scoreV2OverallValue}>
                        {muted ? '--' : Math.round(overallScore)}
                        <Text style={styles.scoreV2OverallOutOf}>/100</Text>
                    </Text>
                    <Text style={[styles.scoreV2OverallBand, muted ? null : { color: overallBandTone.accent }]}>
                        {resolvedOverallBand}
                    </Text>
                </View>
            </View>

            <View style={styles.scoreV2Modules}>
                {safeModules.map((module) => {
                    const expanded = expandedId === module.id;
                    const stateColor = moduleStatusColor(module);
                    const bandLabel = moduleStatusLabel(module);
                    return (
                        <View key={module.id} style={styles.scoreV2ModuleCard}>
                            <Pressable
                                onPress={() => setExpandedId(expanded ? null : module.id)}
                                style={styles.scoreV2ModuleRow}
                            >
                                <View style={styles.scoreV2ModuleTitleWrap}>
                                    <Text style={styles.scoreV2ModuleTitle}>{module.title}</Text>
                                    <Text style={[styles.scoreV2ModuleStatus, { color: stateColor }]}>
                                        {bandLabel}
                                    </Text>
                                </View>
                                <View style={styles.scoreV2ModuleRight}>
                                    <Text style={styles.scoreV2ModuleScore}>{Math.round(module.score)}/100</Text>
                                    <ChevronRight
                                        size={16}
                                        color="#6B7280"
                                        style={expanded ? styles.scoreV2ChevronExpanded : undefined}
                                    />
                                </View>
                            </Pressable>

                            {expanded ? (
                                <View style={styles.scoreV2ChecklistBlock}>
                                    {(module.checklist ?? []).map((item) => {
                                        const chip = resolveChecklistChip(item);
                                        return (
                                            <View key={`${module.id}-${item.key}`} style={styles.scoreV2ChecklistRow}>
                                                <Text style={styles.scoreV2ChecklistLine}>{item.label}</Text>
                                                <View
                                                    style={[
                                                        styles.scoreV2ChecklistChip,
                                                        chip === 'Verified' ? styles.scoreV2ChipVerified : null,
                                                        chip === 'Detected' ? styles.scoreV2ChipDetected : null,
                                                        chip === 'Not verified' ? styles.scoreV2ChipNotVerified : null,
                                                        chip === 'Not shown' ? styles.scoreV2ChipNotShown : null,
                                                    ]}
                                                >
                                                    <Text style={styles.scoreV2ChecklistChipText}>{chip}</Text>
                                                </View>
                                            </View>
                                        );
                                    })}
                                </View>
                            ) : null}
                        </View>
                    );
                })}
            </View>
        </View>
    );
};

function clampText(value?: string | null, maxChars: number = 100) {
    const normalized = normalizeText(value);
    if (!normalized) return '';
    if (normalized.length <= maxChars) return normalized;
    const sliced = normalized.slice(0, maxChars);
    const lastSpace = sliced.lastIndexOf(' ');
    const clipped = lastSpace > 40 ? sliced.slice(0, lastSpace) : sliced;
    return clipped.trim();
}

function clampTextWithEllipsis(value?: string | null, maxChars: number = 100) {
    const normalized = normalizeText(value);
    if (!normalized) return '';
    if (normalized.length <= maxChars) return normalized;
    const clipped = clampText(normalized, Math.max(0, maxChars - 1));
    return clipped ? `${clipped}…` : '';
}

const waitMs = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const DECISION_SUPPORT_RETRY_BACKOFF_MS = [1200, 3000, 6000] as const;

const isTransientDecisionSupportFailure = (message: string, status?: number | null): boolean => {
    if (typeof status === 'number' && (status === 408 || status === 425 || status === 429 || status >= 500)) {
        return true;
    }
    const normalized = message.trim().toLowerCase();
    return (
        normalized.includes('network')
        || normalized.includes('timeout')
        || normalized.includes('timed out')
        || normalized.includes('connection')
        || normalized.includes('failed to fetch')
        || normalized.includes('tunnel unavailable')
        || normalized.includes('unexpected token <')
        || normalized.includes('json parse')
        || normalized.includes('http 502')
        || normalized.includes('http 503')
        || normalized.includes('http 504')
    );
};

const buildIngredientsDetailRequestKey = (bundle: AnalysisBundle) =>
    [
        `${bundle.meta.authoritativeIdentity.type}:${bundle.meta.authoritativeIdentity.value}`,
        'ingredients_detail',
        bundle.meta.locale,
        bundle.meta.promptVersion,
        bundle.meta.factsDigestHash,
    ].join('|');

const isIngredientsDetailReady = (bundle: AnalysisBundle) => {
    const meta = bundle.meta;
    const sourceTypeFinal = meta.sourceTypeFinal !== false;
    const detailReady = meta.detailReady !== false;
    return (
        Number(meta.revision) >= 1 &&
        meta.phase === 'fast_ai' &&
        sourceTypeFinal &&
        detailReady &&
        bundle.sections.ingredients.dataStatus !== 'pending'
    );
};

function shortenCompanyName(value?: string | null) {
    const normalized = normalizeText(value);
    if (!normalized) return null;
    let cleaned = normalized.replace(/\s+dba\b.*$/i, '').trim();
    cleaned = cleaned.replace(/\s*\(.*$/, '').trim();
    cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
    if (!cleaned) cleaned = normalized;
    if (cleaned.length > 48) {
        cleaned = clampTextWithEllipsis(cleaned, 48);
    }
    return cleaned;
}

function capitalizeSentences(value?: string | null) {
    const normalized = normalizeText(value);
    if (!normalized) return '';
    return normalized.replace(/(^[a-z])|([.!?]\s+[a-z])/g, (match) => match.toUpperCase());
}

const WidgetTile: React.FC<WidgetTileProps> = ({ tile, onPress }) => {
    const Icon = tile.icon;
    const accent = colorMap[tile.accentColor] || tile.accentColor || '#3B82F6';
    const base = tile.backgroundColor || '#FFFFFF';
    const tColor = tile.textColor || '#0F172A';
    const label = tile.labelColor || accent;

    const isDarkBase = luminance(base) < 0.28;
    const eyebrowColor =
        tile.type === 'science' || tile.type === 'usage' || tile.type === 'safety'
            ? 'rgba(15, 23, 42, 0.6)'
            : tile.type === 'overview'
                ? 'rgba(255, 255, 255, 0.7)'
                : isDarkBase
                    ? 'rgba(255,255,255,0.7)'
                    : withAlpha(tColor, 0.6);

    const viewPillTextColor =
        tile.type === 'science'
            ? '#ea580c'
            : tile.type === 'overview'
                ? '#FFFFFF'
                : tile.type === 'usage'
                    ? '#000000'
                    : tile.type === 'safety'
                        ? '#6B5B4D'
                        : '#FFFFFF';

    const placeholderColor = withAlpha(tColor, 0.6);

    const renderInfoBadge = (color: string) => (
        <View style={[styles.infoBadge, { borderColor: withAlpha(color, 0.5), backgroundColor: withAlpha(color, 0.12) }]}>
            <Text style={[styles.infoBadgeText, { color }]} numberOfLines={1}>
                i
            </Text>
        </View>
    );

    const footer = tile.footerText ? (
        <Text
            style={[styles.tileFooter, { color: tColor }]}
            numberOfLines={tile.footerLines ?? 1}
            ellipsizeMode="tail"
        >
            {tile.footerText}
        </Text>
    ) : null;
    const visibleScienceMechanisms = tile.type === 'science' ? (tile.mechanisms || []).slice(0, 3) : [];
    const shouldCenterScienceMechanisms =
        tile.type === 'science'
        && !tile.footerText
        && visibleScienceMechanisms.length > 0
        && visibleScienceMechanisms.length < 3;

    const renderContent = () => {
        if (tile.loading) {
            return (
                <View style={styles.tileSection}>
                    <SkeletonLoader width="30%" height={12} style={{ marginBottom: 4, borderCurve: 'continuous' }} />
                    <SkeletonLoader width="100%" height={16} style={{ marginBottom: 2, borderCurve: 'continuous' }} />
                    <SkeletonLoader width="80%" height={16} style={{ marginBottom: 8, borderCurve: 'continuous' }} />
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                        <SkeletonLoader width={16} height={16} borderRadius={999} style={{ borderCurve: 'continuous' }} />
                        <SkeletonLoader width="60%" height={14} style={{ borderCurve: 'continuous' }} />
                    </View>
                </View>
            );
        }

        switch (tile.type) {
            case 'overview':
                return (
                    <View style={styles.tileSection}>
                        {tile.summary && (
                            <Text
                                style={[
                                    styles.tileSummary,
                                    { color: tile.summary.isPlaceholder ? placeholderColor : tColor },
                                ]}
                                numberOfLines={tile.summaryLines ?? 2}
                                ellipsizeMode="tail"
                            >
                                {tile.summary.text}
                            </Text>
                        )}
                        <View style={styles.tileBulletList}>
                            {(tile.bullets || []).slice(0, tile.bulletLimit ?? 2).map((bullet, idx) => (
                                <View key={idx} style={styles.tileBulletRow}>
                                    <View style={styles.bulletIcon}>
                                        <CheckCircle2
                                            size={14}
                                            color={bullet.isPlaceholder ? withAlpha(label, 0.4) : label}
                                        />
                                    </View>
                                    <View style={styles.inlineRow}>
                                        <Text
                                            style={[
                                                styles.tileBulletText,
                                                { color: bullet.isPlaceholder ? placeholderColor : tColor },
                                            ]}
                                            numberOfLines={tile.bulletLines ?? 2}
                                            ellipsizeMode="tail"
                                        >
                                            {bullet.text}
                                        </Text>
                                        {bullet.showInfo ? renderInfoBadge(label) : null}
                                    </View>
                                </View>
                            ))}
                        </View>
                        {footer}
                    </View>
                );
            case 'science':
                return (
                    <View style={[styles.tileSection, shouldCenterScienceMechanisms ? styles.tileSectionCentered : null]}>
                        <View style={[styles.mechList, shouldCenterScienceMechanisms ? styles.mechListCentered : null]}>
                            {visibleScienceMechanisms.map((mechanism, idx) => (
                                <View key={idx} style={styles.mechRow}>
                                    <View style={styles.mechHeader}>
                                        <Text
                                            style={[
                                                styles.mechName,
                                                { color: mechanism.mode === 'unknown' ? placeholderColor : tColor },
                                            ]}
                                            numberOfLines={2}
                                            ellipsizeMode="tail"
                                        >
                                            {mechanism.name}
                                        </Text>
                                        <View style={styles.mechAmountRow}>
                                            <Text
                                                style={[
                                                    styles.mechAmount,
                                                    {
                                                        color: mechanism.mode === 'unknown' ? placeholderColor : label,
                                                    },
                                                ]}
                                                numberOfLines={1}
                                            >
                                                {mechanism.amount}
                                            </Text>
                                            {mechanism.showInfo ? renderInfoBadge(label) : null}
                                        </View>
                                    </View>
                                    <View
                                        style={[
                                            styles.mechBar,
                                            mechanism.mode === 'unknown' ? styles.mechBarUnknown : null,
                                        ]}
                                    >
                                        <View
                                            style={[
                                                styles.mechFill,
                                                {
                                                    backgroundColor:
                                                        mechanism.mode === 'unknown' ? 'rgba(148,163,184,0.4)' : label,
                                                    width: `${Math.min(100, Math.max(12, mechanism.fill ?? 0))}%`,
                                                }
                                            ]}
                                        />
                                    </View>
                                </View>
                            ))}
                        </View>
                        {footer}
                    </View>
                );
            case 'usage':
                return (
                    <View style={styles.tileSection}>
                        {tile.routineLine && (
                            <View style={styles.inlineRow}>
                                <Text
                                    style={[
                                        styles.tileSummary,
                                        { color: tile.routineLine.isPlaceholder ? placeholderColor : tColor },
                                    ]}
                                    numberOfLines={2}
                                >
                                    {tile.routineLine.text}
                                </Text>
                                {tile.routineLine.showInfo ? renderInfoBadge(label) : null}
                            </View>
                        )}
                        {tile.bestFor && (
                            <View style={[styles.bestForCard, { backgroundColor: withAlpha(label, 0.08) }]}>
                                <View style={styles.inlineRow}>
                                    <Text style={[styles.bestForLabel, { color: label }]}>
                                        {tile.bestForLabel ?? 'Best for'}:
                                    </Text>
                                    {tile.bestFor.showInfo ? renderInfoBadge(label) : null}
                                </View>
                                <Text
                                    style={[
                                        styles.bestForText,
                                        { color: tile.bestFor.isPlaceholder ? placeholderColor : tColor },
                                    ]}
                                    numberOfLines={3}
                                >
                                    {tile.bestFor.text}
                                </Text>
                            </View>
                        )}
                        {footer}
                    </View>
                );
            case 'safety':
            default:
                return (
                    <View style={styles.tileSection}>
                        {tile.warning && (
                            <View style={[styles.warningPill, { backgroundColor: withAlpha(label, 0.12) }]}>
                                <View style={styles.inlineRow}>
                                    <Text
                                        style={[
                                            styles.warningText,
                                            { color: tile.warning.isPlaceholder ? placeholderColor : label },
                                        ]}
                                        numberOfLines={3}
                                    >
                                        {tile.warning.text}
                                    </Text>
                                    {tile.warning.showInfo ? renderInfoBadge(label) : null}
                                </View>
                            </View>
                        )}
                        {tile.tip && (
                            <View style={styles.tipBlock}>
                                <Text style={[styles.tipLabel, { color: label }]}>
                                    {tile.tipLabel ?? 'TIP'}
                                </Text>
                                <Text
                                    style={[
                                        styles.tipText,
                                        { color: tile.tip.isPlaceholder ? placeholderColor : tColor },
                                    ]}
                                >
                                    {tile.tip.text}
                                </Text>
                            </View>
                        )}
                        {footer}
                    </View>
                );
        }
    };

    return (
        <View style={[styles.tileShadow, { backgroundColor: base }]}>
            <TouchableOpacity
                activeOpacity={0.85}
                onPress={tile.loading ? undefined : onPress}
                style={[styles.tile, { backgroundColor: base }]}
            >
                <View style={styles.tileOuterPadding}>
                    <DashboardBlur intensity={24} tint={TILE_GLASS_TINT} style={styles.tileGlass}>
                        <View style={styles.tileHeaderRow}>
                            <View style={styles.tileHeaderLeft}>
                                <View style={styles.tileIconShadow}>
                                    <View style={styles.tileIconContainer}>
                                        <DashboardBlur intensity={18} tint={TILE_GLASS_TINT} style={StyleSheet.absoluteFillObject} />
                                        <LinearGradient
                                            pointerEvents="none"
                                            colors={[
                                                'rgba(255,255,255,0.55)',
                                                'rgba(255,255,255,0.18)',
                                                'rgba(255,255,255,0.28)',
                                            ]}
                                            locations={[0, 0.55, 1]}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 1, y: 1 }}
                                            style={StyleSheet.absoluteFillObject}
                                        />
                                        <Icon size={18} color={label} />
                                    </View>
                                </View>

                                <View style={styles.tileHeaderText}>
                                    <Text style={[styles.tileEyebrow, { color: eyebrowColor }]} numberOfLines={1}>
                                        {tile.eyebrow}
                                    </Text>
                                    <Text style={[styles.tileTitle, { color: tColor }]} numberOfLines={1}>
                                        {tile.title}
                                    </Text>
                                </View>
                            </View>

                            {!tile.loading && (
                                <View style={styles.viewPillShadow}>
                                    <View style={styles.viewPill}>
                                        <DashboardBlur intensity={18} tint={TILE_GLASS_TINT} style={StyleSheet.absoluteFillObject} />
                                        <LinearGradient
                                            pointerEvents="none"
                                            colors={[
                                                'rgba(255,255,255,0.42)',
                                                'rgba(255,255,255,0.14)',
                                                'rgba(255,255,255,0.24)',
                                            ]}
                                            locations={[0, 0.55, 1]}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 1, y: 1 }}
                                            style={StyleSheet.absoluteFillObject}
                                        />
                                        <Text style={[styles.viewPillText, { color: viewPillTextColor }]}>
                                            {tile.viewLabel ?? 'View'}
                                        </Text>
                                    </View>
                                </View>
                            )}
                        </View>

                        {renderContent()}
                    </DashboardBlur>
                </View>
            </TouchableOpacity>
        </View>
    );
};

// ---------- Glass UI primitives (iOS-like, frosted) ----------
type PillarStatus = 'good' | 'ok' | 'warn' | 'unknown';

const statusDotColor = (s: PillarStatus) => {
    switch (s) {
        case 'good':
            return '#22C55E';
        case 'ok':
            return '#60A5FA';
        case 'warn':
            return '#F59E0B';
        default:
            return 'rgba(255,255,255,0.35)';
    }
};

const GlassPill: React.FC<{ label: string; accentColor?: string; style?: any }> = ({ label, accentColor, style }) => {
    return (
        <View style={[styles.glassPill, style, accentColor ? { borderColor: `${accentColor}55` } : null]}>
            <Text style={styles.glassPillText}>{label}</Text>
        </View>
    );
};

const PillarTriad: React.FC<{
    effectiveness: PillarStatus;
    safety: PillarStatus;
    integrity: PillarStatus;
}> = ({ effectiveness, safety, integrity }) => {
    const short = (s: PillarStatus) => {
        switch (s) {
            case 'good':
                return 'High';
            case 'ok':
                return 'Med';
            case 'warn':
                return 'Low';
            default:
                return '—';
        }
    };

    const render = (label: string, s: PillarStatus) => (
        <View key={label} style={styles.pillarCol}>
            <Text style={styles.pillarColLabel}>{label}</Text>
            <View style={styles.pillarColValueRow}>
                <View style={[styles.pillarDot, { backgroundColor: statusDotColor(s) }]} />
                <Text style={styles.pillarColValueText}>{short(s)}</Text>
            </View>
        </View>
    );

    return (
        <View style={styles.pillarTriadCols}>
            {render('Effect', effectiveness)}
            {render('Safety', safety)}
            {render('Integrity', integrity)}
        </View>
    );
};

type GlassCardProps = {
    title?: string;
    subtitle?: string;
    right?: React.ReactNode;
    accentColor?: string;
    children?: React.ReactNode;
    style?: any;
    contentStyle?: any;
};

const GlassCard: React.FC<GlassCardProps> = ({ title, subtitle, right, accentColor, children, style, contentStyle }) => {
    return (
        <View
            style={[
                styles.glassCard,
                style,
                accentColor ? { borderColor: `${accentColor}40` } : null,
            ]}
        >
            <DashboardBlur intensity={20} tint="light" style={StyleSheet.absoluteFill} />
            <View style={[styles.glassCardContent, contentStyle]}>
                {(title || subtitle || right) ? (
                    <View style={styles.glassCardHeader}>
                        <View style={styles.glassCardHeaderLeft}>
                            {accentColor ? <View style={[styles.glassAccent, { backgroundColor: accentColor }]} /> : null}
                            <View>
                                {title ? <Text style={styles.glassCardTitle}>{title}</Text> : null}
                                {subtitle ? <Text style={styles.glassCardSubtitle}>{subtitle}</Text> : null}
                            </View>
                        </View>
                        {right ? <View style={styles.glassCardHeaderRight}>{right}</View> : null}
                    </View>
                ) : null}
                {children}
            </View>
        </View>
    );
};

// ---------- Detail modal (refreshed, frosted, modular) ----------
const DashboardModal: React.FC<{
    visible: boolean;
    onClose: () => void;
    tile: TileConfig | null;
    sourceType: string | null;
    sourceTypeFinal: boolean;
}> = ({ visible, onClose, tile, sourceType, sourceTypeFinal }) => {
    const { t } = useTranslation();
    const [sourcesOpen, setSourcesOpen] = useState(false);
    if (!tile) return null;

    const accent = tile.backgroundColor || '#D1D5DB';
    const ModalIcon = tile.icon;
    const statusLine = tile.dataStatus
        ? `Missing: ${formatMissingReasons(tile.dataStatus.missingReasons)}`
        : undefined;
    const sourceLine = formatSourceRefs(tile.dataStatus?.sources);
    const notesLine = tile.dataStatus?.notes?.length ? tile.dataStatus.notes.join(' • ') : null;
    const shouldShowDataStatusCard = SCAN_UX_VIEW_MODE === 'details' && tile.showDataStatusCard !== false;
    const webEvidenceLabel =
        tile.trustPanel?.webEvidence === 'used'
            ? 'used'
            : tile.trustPanel?.webEvidence === 'not used'
                ? 'not used'
                : 'unknown';
    const openedAtRef = useRef<number>(0);
    const maxScrollRatioRef = useRef<number>(0);
    const viewportHeightRef = useRef<number>(1);
    const contentHeightRef = useRef<number>(1);

    const handleClose = useCallback(() => {
        const openedAt = openedAtRef.current;
        const dwellMs = openedAt > 0 ? Math.max(0, Date.now() - openedAt) : 0;
        emitScanUxMetric('scan_sheet_closed', {
            viewMode: SCAN_UX_VIEW_MODE,
            variant: SCAN_UX_VARIANT,
            sheetType: tile.type,
            sourceType,
            sourceTypeFinal,
            dwellMs,
            maxScrollRatio: Number(maxScrollRatioRef.current.toFixed(3)),
            summaryVersion: null,
            guardApplied: null,
            fallbackUsed: null,
        });
        onClose();
    }, [onClose, sourceType, sourceTypeFinal, tile.type]);

    const handleModalScroll = useCallback((event: any) => {
        const y = Number(event?.nativeEvent?.contentOffset?.y ?? 0);
        const viewport = Number(event?.nativeEvent?.layoutMeasurement?.height ?? viewportHeightRef.current ?? 1);
        const content = Number(event?.nativeEvent?.contentSize?.height ?? contentHeightRef.current ?? 1);
        viewportHeightRef.current = Math.max(1, viewport);
        contentHeightRef.current = Math.max(1, content);
        const ratio = Math.max(0, Math.min(1, (y + viewportHeightRef.current) / contentHeightRef.current));
        if (ratio > maxScrollRatioRef.current) {
            maxScrollRatioRef.current = ratio;
        }
    }, []);

    useEffect(() => {
        if (!visible) return;
        setSourcesOpen(false);
        openedAtRef.current = Date.now();
        maxScrollRatioRef.current = 0;
        viewportHeightRef.current = 1;
        contentHeightRef.current = 1;
        emitScanUxMetric('scan_sheet_opened', {
            viewMode: SCAN_UX_VIEW_MODE,
            variant: SCAN_UX_VARIANT,
            sheetType: tile.type,
            sourceType,
            sourceTypeFinal,
            dwellMs: 0,
            maxScrollRatio: 0,
            summaryVersion: null,
            guardApplied: null,
            fallbackUsed: null,
        });
    }, [visible, sourceType, sourceTypeFinal, tile.type]);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onRequestClose={handleClose}
            statusBarTranslucent
        >
            <View style={styles.modalOverlayGlass}>
                {/* Backdrop */}
                <Pressable style={StyleSheet.absoluteFill} onPress={handleClose}>
                    <DashboardBlur intensity={22} tint="dark" style={StyleSheet.absoluteFill} />
                    <View style={styles.modalBackdropTint} />
                </Pressable>

                {/* Sheet */}
                <Animated.View
                    entering={FadeInUp.duration(240).easing(Easing.out(Easing.cubic))}
                    exiting={FadeOutDown.duration(180).easing(Easing.in(Easing.cubic))}
                    style={[
                        styles.modalSheet,
                        { borderColor: `${accent}55` },
                    ]}
                >
                    <DashboardBlur intensity={26} tint="light" style={StyleSheet.absoluteFill} />

                    <View style={styles.modalHandle} />

                    <View style={styles.modalHeaderNew}>
                        <View style={styles.modalHeaderLeftNew}>
                            <View style={[styles.modalIconBubble, { backgroundColor: `${accent}22`, borderColor: `${accent}35` }]}>
                                <ModalIcon size={18} color={accent} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.modalTitleNew}>{tile.title}</Text>
                                <Text style={styles.modalSubtitleNew} numberOfLines={2}>
                                    {tile.summary?.text}
                                </Text>
                            </View>
                        </View>

                        <Pressable style={styles.modalCloseButtonNew} onPress={handleClose} accessibilityLabel="Close">
                            <DashboardBlur intensity={18} tint="light" style={StyleSheet.absoluteFill} />
                            <X size={18} color="#111827" />
                        </Pressable>
                    </View>

                    <ScrollView
                        style={styles.modalScrollNew}
                        contentContainerStyle={styles.modalScrollContentNew}
                        showsVerticalScrollIndicator={false}
                        onScroll={handleModalScroll}
                        scrollEventThrottle={16}
                        onLayout={(event) => {
                            viewportHeightRef.current = Math.max(1, Number(event.nativeEvent.layout.height ?? 1));
                        }}
                        onContentSizeChange={(_w, h) => {
                            contentHeightRef.current = Math.max(1, Number(h ?? 1));
                        }}
                    >
                        {tile.trustPanel ? (
                            <View style={styles.sourceStripCard}>
                                <Text style={styles.sourceStripLine} numberOfLines={1}>
                                    Official record: {tile.trustPanel.verifiedFrom}
                                </Text>
                                <Text style={styles.sourceStripLine} numberOfLines={1}>
                                    Retrieved on: {tile.trustPanel.retrievedOn} · Web evidence: {webEvidenceLabel}
                                </Text>
                                <Text style={styles.sourceStripLine} numberOfLines={1}>
                                    Trust level: {tile.trustPanel.trustLevel} · {tile.trustPanel.reason}
                                </Text>
                                <Text style={styles.sourceStripLine} numberOfLines={1}>
                                    {tile.trustPanel.verifiedSummary}
                                </Text>
                                <Text style={styles.sourceStripLine} numberOfLines={1}>
                                    {tile.trustPanel.missingSummary}
                                </Text>
                                <Pressable
                                    style={styles.sourcesToggleButton}
                                    onPress={() =>
                                        setSourcesOpen((prev) => {
                                            const next = !prev;
                                            if (next) {
                                                emitScanUxMetric('scan_source_drawer_opened', {
                                                    viewMode: SCAN_UX_VIEW_MODE,
                                                    variant: SCAN_UX_VARIANT,
                                                    sheetType: tile.type,
                                                    sourceType,
                                                    sourceTypeFinal,
                                                    dwellMs: 0,
                                                    maxScrollRatio: Number(maxScrollRatioRef.current.toFixed(3)),
                                                    summaryVersion: null,
                                                    guardApplied: null,
                                                    fallbackUsed: null,
                                                });
                                            }
                                            return next;
                                        })
                                    }
                                    accessibilityRole="button"
                                    accessibilityLabel={sourcesOpen ? 'Hide sources' : 'View sources'}
                                >
                                    <Text style={styles.sourcesToggleButtonText}>
                                        {sourcesOpen ? 'Hide sources' : 'View sources'}
                                    </Text>
                                </Pressable>
                                {sourcesOpen ? (
                                    <View style={styles.sourcesDrawerCard}>
                                        <Text style={styles.sourcesDrawerTitle}>Sources</Text>
                                        {tile.trustPanel.sources.map((source, idx) => (
                                            <View key={`trust-source-${idx}`} style={styles.sourceRow}>
                                                <Text style={styles.sourceRowTag}>{source.tag}</Text>
                                                <Text style={styles.sourceRowLabel}>{source.label}: {source.value}</Text>
                                                {source.url ? (
                                                    <Text style={styles.sourceRowUrl}>{source.url}</Text>
                                                ) : null}
                                            </View>
                                        ))}
                                    </View>
                                ) : null}
                            </View>
                        ) : null}

                        {/* Main content */}
                        {tile.content ? (
                            tile.content
                        ) : (
                            <GlassCard
                                title="Detail is loading"
                                subtitle="This section is still resolving data."
                                accentColor={accent}
                            >
                                <Text style={styles.detailBodyText}>
                                    We are preparing this section. If it stays empty, try rescanning with a clear Supplement Facts panel.
                                </Text>
                            </GlassCard>
                        )}

                        {shouldShowDataStatusCard ? (
                            <GlassCard
                                title={`Data status: ${COVER_STATUS_LABELS[tile.dataStatus?.status ?? 'limited']}`}
                                subtitle={statusLine}
                                accentColor={accent}
                                style={{ marginTop: 14 }}
                            >
                                <View style={styles.dataStatusRowNew}>
                                    <Text style={styles.dataStatusSmallNew}>
                                        Sources: {sourceLine}
                                    </Text>
                                </View>
                                {notesLine ? (
                                    <View style={{ marginTop: 8 }}>
                                        <Text style={styles.dataStatusNoteNew}>Notes: {notesLine}</Text>
                                    </View>
                                ) : null}
                                <View style={{ marginTop: 10 }}>
                                    <Text style={styles.dataStatusDisclaimerNew}>{t.analysisIntegrityNote}</Text>
                                </View>
                            </GlassCard>
                        ) : null}

                        <View style={{ height: 24 }} />
                    </ScrollView>
                </Animated.View>
            </View>
        </Modal>
    );
};

type IngredientDetail = {
    name?: string | null;
    dosageValue?: number | null;
    dosageUnit?: string | null;
    form?: string | null;
    formQuality?: string | null;
    evidenceLevel?: string | null;
};

const normalizeIngredientKey = (value?: string | null): string =>
    value?.toLowerCase().replace(/[^a-z0-9]+/g, '').trim() ?? '';

const scoreIngredientDetail = (ingredient: IngredientDetail): number => {
    let score = 0;
    if (typeof ingredient?.dosageValue === 'number') score += 4;
    if (ingredient?.dosageUnit) score += 2;
    if (ingredient?.form) score += 1;
    if (ingredient?.formQuality && ingredient.formQuality !== 'unknown') score += 1;
    if (ingredient?.evidenceLevel && ingredient.evidenceLevel !== 'none') score += 1;
    return score;
};

const dedupeIngredients = (items: IngredientDetail[]): IngredientDetail[] => {
    const map = new Map<string, IngredientDetail>();
    const ordered: IngredientDetail[] = [];
    items.forEach((item) => {
        const key = normalizeIngredientKey(typeof item?.name === 'string' ? item.name : '');
        if (!key) return;
        const existing = map.get(key);
        if (!existing) {
            map.set(key, item);
            ordered.push(item);
            return;
        }
        const existingHasDose = typeof existing?.dosageValue === 'number';
        const nextHasDose = typeof item?.dosageValue === 'number';
        if (existingHasDose && !nextHasDose) return;
        if (!existingHasDose && nextHasDose) {
            map.set(key, item);
            const index = ordered.indexOf(existing);
            if (index >= 0) ordered[index] = item;
            return;
        }
        const existingScore = scoreIngredientDetail(existing);
        const nextScore = scoreIngredientDetail(item);
        if (nextScore > existingScore) {
            map.set(key, item);
            const index = ordered.indexOf(existing);
            if (index >= 0) ordered[index] = item;
        }
    });
    return ordered;
};

const BASIS_TAG_LABELS: Record<BasisTag, string> = {
    label_fact: 'label',
    regulatory_claim: 'reg',
    ingredient_inference: 'inferred',
    web_evidence: 'web',
    general_advice: 'advice',
    not_provided: 'limited source',
    conflict: 'conflict',
};

const formatBasisTags = (tags?: BasisTag[] | null) => {
    if (!tags || tags.length === 0) return '';
    const labels = tags.map(tag => BASIS_TAG_LABELS[tag] ?? tag);
    return labels.join(' · ');
};

const formatTaggedText = (text: string, tags?: BasisTag[] | null) => {
    const tagText = formatBasisTags(tags);
    if (!tagText) return text;
    return `${text} · ${tagText}`;
};

const COVER_STATUS_LABELS: Record<CoverStatus, string> = {
    complete: 'Complete',
    partial: 'Partial',
    limited: 'Limited',
};

const MISSING_REASON_LABELS: Record<MissingReason, string> = {
    MISSING_PRIMARY_ACTIVE: 'Primary active missing',
    MISSING_EVIDENCE_MAPPING: 'Evidence mapping missing',
    MISSING_FORM_QUALITY: 'Form quality missing',
    MISSING_OVERVIEW_SUMMARY: 'Overview summary missing',
    MISSING_OVERVIEW_BENEFITS: 'Overview benefits missing',
    MISSING_USAGE_GUIDANCE: 'Usage guidance missing',
    MISSING_BEST_FOR: 'Best-for guidance missing',
    MISSING_SAFETY_WARNING: 'Safety warning missing',
    MISSING_SAFETY_TIP: 'Safety tip missing',
    MISSING_DOSE_RANGE: 'Dose range missing',
};

const formatMissingReasons = (reasons?: Array<MissingReason | string>) => {
    if (!Array.isArray(reasons) || reasons.length === 0) return 'None';
    return reasons
        .map((reason) => MISSING_REASON_LABELS[reason as MissingReason] ?? reason)
        .join(', ');
};

const formatSourceRefs = (sources?: SourceRef[]) => {
    if (!Array.isArray(sources) || sources.length === 0) return 'Unknown';
    return sources
        .map((source) => source.title || source.id || source.type)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' • ');
};

const toSentence = (value: string | null | undefined): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const resolveFactsSourceFromIdentity = (
    identity: AnalysisBundle['meta']['authoritativeIdentity'],
): { source: 'lnhpd' | 'dsld' | 'web'; sourceId: string } | null => {
    if (!identity?.value) return null;
    if (identity.type === 'npn') return { source: 'lnhpd', sourceId: identity.value };
    if (identity.type === 'dsldLabelId') return { source: 'dsld', sourceId: identity.value };
    return { source: 'web', sourceId: identity.value };
};

const isBundleV4 = (bundle: AnalysisBundle): bundle is AnalysisBundleV4 =>
    bundle.meta.schemaVersion === 4;

const mapBundleStatusToCover = (status: AnalysisBundle['sections']['overview']['dataStatus']): CoverStatus => {
    if (status === 'complete') return 'complete';
    if (status === 'pending') return 'partial';
    return 'limited';
};

const buildBundleSources = (
    sourceType: AnalysisBundle['meta']['sourceType'] | null,
    sourceTypeFinal: boolean,
    opts?: { supplementalLabelDataUsed?: boolean },
): SourceRef[] => {
    if (!sourceTypeFinal || !sourceType) {
        return [];
    }
    const supplementalLabelDataUsed = Boolean(opts?.supplementalLabelDataUsed);
    // Product trust framing: regulatory/label sources count as "connected" even if we didn't use web evidence.
    if (sourceType === 'lnhpd' || sourceType === 'dsld') {
        return [
            { type: 'label' },
            {
                type: 'other',
                title: supplementalLabelDataUsed
                    ? 'Supplemental product-page label data: used'
                    : 'Supplemental product-page label data: not used',
            },
        ];
    }
    if (sourceType === 'web') {
        return [{ type: 'other', title: 'Web evidence' }];
    }
    return [];
};

const buildBundleDataStatus = (
    status: AnalysisBundle['sections']['overview']['dataStatus'],
    sourceType: AnalysisBundle['meta']['sourceType'] | null,
    sourceTypeFinal: boolean,
    notes?: string[],
    opts?: { supplementalLabelDataUsed?: boolean },
) => ({
    status: mapBundleStatusToCover(status),
    missingReasons: [],
    sources: buildBundleSources(sourceType, sourceTypeFinal, opts),
    notes: Array.isArray(notes) && notes.length > 0 ? notes : undefined,
});

type IngredientCoverItemLike = {
    name?: string | null;
    dose?: string | null;
};

type ProductSpecificInsight = {
    formLabel: string | null;
    reasonCode: string | null;
    matchScore: number | null;
    evidenceGrade: string | null;
    effectiveFactor: number | null;
    rbfBand: 'high' | 'normal' | 'low' | 'unknown';
    confidenceTier: 'high' | 'medium' | 'low' | 'none';
    why: string;
    doseSignal:
    | {
        status: string;
        reasonCode: string | null;
        perServingAmount: number | null;
        dailyAmount: number | null;
        unit: string | null;
    }
    | null;

    // Extra fields to support runtime KB + evidence display (optional)
    ingredientId: string | null;
    ingredientCanonicalKey: string | null;
    formKey: string | null;
    candidateText: string | null;
    aliasText: string | null;
};

// Runtime KB (reviewed) notes for a specific ingredient + form
type RuntimeKbNotesState = {
    status: 'idle' | 'loading' | 'ok' | 'not_found' | 'error';
    reason?: string;
    segmentsByBucket?: Record<string, string[]>;
    meta?: {
        source?: string;
        packageSha256?: string;
        reviewedAt?: string;
        formDisplay?: string;
    };
};

const FACTS_STATUS_TO_COVER: Record<string, CoverStatus> = {
    complete: 'complete',
    limited: 'limited',
    not_provided: 'limited',
};

const FACTS_MISSING_REASON_TO_TILE: Record<string, MissingReason> = {
    missing_directions: 'MISSING_USAGE_GUIDANCE',
    missing_warnings: 'MISSING_SAFETY_WARNING',
    missing_amounts: 'MISSING_DOSE_RANGE',
    missing_units: 'MISSING_DOSE_RANGE',
    missing_form: 'MISSING_FORM_QUALITY',
    partial_record: 'MISSING_OVERVIEW_SUMMARY',
};

const mapFactsMissingReasonsToTile = (reasons?: string[] | null): string[] => {
    if (!Array.isArray(reasons) || reasons.length === 0) return [];
    const mapped = reasons
        .map((reason) => FACTS_MISSING_REASON_TO_TILE[reason] ?? reason)
        .filter((reason) => typeof reason === 'string' && reason.trim().length > 0) as string[];
    return Array.from(new Set(mapped));
};

const buildUnifiedTileDataStatus = (
    legacyDataStatus: NonNullable<TileConfig['dataStatus']>,
    factsDataQuality?: FactsDTO['dataQuality'] | null,
): NonNullable<TileConfig['dataStatus']> => {
    if (!factsDataQuality) return legacyDataStatus;
    const factsStatusRaw = typeof factsDataQuality.overallStatus === 'string' ? factsDataQuality.overallStatus : '';
    const status = FACTS_STATUS_TO_COVER[factsStatusRaw] ?? legacyDataStatus.status;
    const missingReasons = mapFactsMissingReasonsToTile(factsDataQuality.missingReasons) || [];
    const notes =
        Array.isArray(factsDataQuality.notes) && factsDataQuality.notes.length > 0
            ? factsDataQuality.notes
            : legacyDataStatus.notes;
    return {
        ...legacyDataStatus,
        status,
        missingReasons: missingReasons.length > 0 ? missingReasons : legacyDataStatus.missingReasons,
        notes,
    };
};

type IngredientOverviewSidecarState = {
    status: 'idle' | 'loading' | 'ok' | 'error';
    source?: 'api' | 'fallback';
    fallbackUsed?: boolean;
    promptVersion?: string;
    data?: IngredientOverviewBlock;
    error?: string;
};

type ScientificBackgroundSidecarState = {
    status: 'idle' | 'loading' | 'ok' | 'error';
    source?: 'api' | 'fallback';
    fallbackUsed?: boolean;
    promptVersion?: string;
    data?: ScientificBackgroundBlock;
    error?: string;
};

type IngredientOverviewSidecarStateUpdater =
    | IngredientOverviewSidecarState
    | ((current: IngredientOverviewSidecarState | undefined) => IngredientOverviewSidecarState | undefined);

type ScientificBackgroundSidecarStateUpdater =
    | ScientificBackgroundSidecarState
    | ((current: ScientificBackgroundSidecarState | undefined) => ScientificBackgroundSidecarState | undefined);

type ProductOverviewAiState = {
    status: 'idle' | 'loading' | 'ok' | 'unavailable' | 'error';
    fingerprint?: string;
    data?: ProductOverviewAiPayload;
    error?: string;
    source?: 'api' | 'client-fallback';
    fallbackUsed?: boolean;
    startedAt?: number;
};

type ProductOverviewAiStateUpdater =
    | ProductOverviewAiState
    | ((current: ProductOverviewAiState | undefined) => ProductOverviewAiState | undefined);

type SafetySummaryState = {
    status: 'idle' | 'loading' | 'ok' | 'error';
    startedAt?: number;
    source?: 'api' | 'fallback';
    phase?: 'instant_fallback' | 'upgraded';
    tldr?: string;
    riskLine?: string;
    contextLine?: string;
    actionLine?: string;
    reasonCode?: string | null;
    error?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const safeBundleRead = <T,>(read: () => T, fallback: T): T => {
    try {
        const value = read();
        return value ?? fallback;
    } catch {
        return fallback;
    }
};

const isIngredientsDetailItemV4 = (
    item: IngredientsDetailItemV3 | IngredientsDetailItemV4 | null | undefined,
): item is IngredientsDetailItemV4 =>
    Boolean(item && typeof item === 'object' && 'chemicalFormExplain' in item);

const normalizeEvidenceGrade = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase();
    return normalized || null;
};

const toRbfBand = (factor: number | null): ProductSpecificInsight['rbfBand'] => {
    if (typeof factor !== 'number' || !Number.isFinite(factor)) return 'unknown';
    if (factor >= 1.1) return 'high';
    if (factor >= 0.9) return 'normal';
    return 'low';
};

const toConfidenceTier = (matchScore: number | null, evidenceGrade: string | null): ProductSpecificInsight['confidenceTier'] => {
    const score = typeof matchScore === 'number' && Number.isFinite(matchScore) ? matchScore : null;
    const grade = normalizeEvidenceGrade(evidenceGrade);
    if (score != null && score >= 0.55 && (grade === 'A' || grade === 'B')) return 'high';
    if ((score != null && score >= 0.4) || grade === 'C') return 'medium';
    if (score != null && score >= 0.35) return 'low';
    return 'none';
};

const isUnspecifiedFormSignal = (formKey?: string | null, reasonCode?: string | null): boolean => {
    const normalizedKey = String(formKey ?? '').trim().toLowerCase();
    const normalizedReason = String(reasonCode ?? '').trim().toUpperCase();
    return normalizedKey === 'unspecified' || normalizedReason === 'FORM_NOT_DISCLOSED';
};

const isSingleCtaAllowed = (sheetType: TileType): boolean => sheetType === 'overview';

const normalizeVitaminDFormSignal = (value?: string | null): 'd2' | 'd3' | null => {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return null;
    if (/\bd2\b|ergocalciferol|vitamin\s*d2/.test(normalized)) return 'd2';
    if (/\bd3\b|cholecalciferol|vitamin\s*d3/.test(normalized)) return 'd3';
    return null;
};

const detectInferredFormConflict = (params: {
    productName?: string | null;
    explicitForm?: string | null;
    inferredForm?: string | null;
}): boolean => {
    const productForm = normalizeVitaminDFormSignal(params.productName);
    const explicitForm = normalizeVitaminDFormSignal(params.explicitForm);
    const inferredForm = normalizeVitaminDFormSignal(params.inferredForm);
    if (!inferredForm) return false;
    if (productForm && productForm !== inferredForm) return true;
    if (explicitForm && explicitForm !== inferredForm) return true;
    return false;
};

const extractProductSpecificInsights = (bundle: ScoreBundleV4 | null): Map<string, ProductSpecificInsight> => {
    const byIngredient = new Map<string, ProductSpecificInsight>();
    if (!bundle || !isRecord(bundle.explain)) return byIngredient;
    const evidence = isRecord(bundle.explain.evidence) ? bundle.explain.evidence : null;
    if (!evidence) return byIngredient;

    const rawDoseSignals = Array.isArray(evidence.ingredientDoseSignals) ? evidence.ingredientDoseSignals : [];
    const doseByIngredient = new Map<
        string,
        {
            status: string;
            reasonCode: string | null;
            perServingAmount: number | null;
            dailyAmount: number | null;
            unit: string | null;
        }
    >();
    rawDoseSignals.forEach((row) => {
        if (!isRecord(row)) return;
        const ingredientName = typeof row.ingredientName === 'string' ? row.ingredientName : '';
        const key = normalizeIngredientNameForBackground(ingredientName);
        if (!key) return;
        doseByIngredient.set(key, {
            status: typeof row.status === 'string' ? row.status : 'unknown',
            reasonCode: typeof row.reasonCode === 'string' ? row.reasonCode : null,
            perServingAmount:
                typeof row.perServingAmount === 'number' && Number.isFinite(row.perServingAmount)
                    ? row.perServingAmount
                    : null,
            dailyAmount:
                typeof row.dailyAmount === 'number' && Number.isFinite(row.dailyAmount) ? row.dailyAmount : null,
            unit: typeof row.unit === 'string' ? row.unit : null,
        });
    });

    const rawFormSignals = Array.isArray(evidence.formSignals) ? evidence.formSignals : [];
    rawFormSignals.forEach((row) => {
        if (!isRecord(row)) return;
        const ingredientName = typeof row.ingredientName === 'string' ? row.ingredientName : '';
        const key = normalizeIngredientNameForBackground(ingredientName);
        if (!key) return;

        const matchScore =
            typeof row.matchScore === 'number' && Number.isFinite(row.matchScore) ? row.matchScore : null;
        const effectiveFactor =
            typeof row.effectiveFactor === 'number' && Number.isFinite(row.effectiveFactor)
                ? row.effectiveFactor
                : null;
        const evidenceGrade = normalizeEvidenceGrade(row.evidenceGrade);
        const confidenceTier = toConfidenceTier(matchScore, evidenceGrade);
        const rbfBand = toRbfBand(effectiveFactor);
        const formKey = typeof row.formKey === 'string' ? row.formKey : null;
        const reasonCode = typeof row.reasonCode === 'string' ? row.reasonCode : null;
        const isUnspecified = isUnspecifiedFormSignal(formKey, reasonCode);
        const rawFormLabel = typeof row.formLabel === 'string' ? row.formLabel : null;
        const reasonPieces = [
            effectiveFactor != null ? `effectiveFactor=${effectiveFactor.toFixed(2)}` : null,
            rbfBand !== 'unknown'
                ? rbfBand === 'high'
                    ? '>= 1.10 threshold'
                    : rbfBand === 'normal'
                        ? '0.90-1.09 threshold'
                        : '< 0.90 threshold'
                : null,
            matchScore != null ? `matchScore=${matchScore.toFixed(2)}` : null,
            evidenceGrade ? `grade=${evidenceGrade}` : null,
        ].filter(Boolean);
        const why = isUnspecified
            ? 'Form not disclosed on label; scoring uses a conservative neutral form assumption.'
            : reasonPieces.length
                ? `Dataset-derived form signal (${reasonPieces.join(', ')}).`
                : 'No verified form signal available from dataset evidence.';

        const nextInsight: ProductSpecificInsight = {
            formLabel: isUnspecified ? null : rawFormLabel,
            reasonCode,
            matchScore,
            evidenceGrade,
            effectiveFactor,
            rbfBand,
            confidenceTier,
            why,
            doseSignal: doseByIngredient.get(key) ?? null,
            ingredientId: typeof row.ingredientId === 'string' ? row.ingredientId : null,
            ingredientCanonicalKey:
                typeof row.ingredientCanonicalKey === 'string' ? row.ingredientCanonicalKey : null,
            formKey,
            candidateText: typeof row.candidateText === 'string' ? row.candidateText : null,
            aliasText: typeof row.aliasText === 'string' ? row.aliasText : null,
        };

        const existing = byIngredient.get(key);
        if (!existing) {
            byIngredient.set(key, nextInsight);
            return;
        }
        const existingScore = existing.matchScore ?? -1;
        const nextScore = nextInsight.matchScore ?? -1;
        if (nextScore > existingScore) {
            byIngredient.set(key, nextInsight);
        }
    });

    return byIngredient;
};

const normalizeIngredientNameForBackground = (value?: string | null): string => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    // Ingredient labels in UI can include display decorations (e.g. "Vitamin C — 1000 mg · label").
    // Strip trailing metadata so lookup keys stay stable across cover/detail views.
    const withoutSourceTag = raw.split(/\s+·\s+/)[0] ?? raw;
    const withoutDoseDash = withoutSourceTag.split(/\s+[—–-]\s+/)[0] ?? withoutSourceTag;
    return withoutDoseDash
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .trim();
};

const isBlendLikeName = (name: string): boolean =>
    /\b(proprietary|blend|matrix|complex)\b/i.test(name);

const isOmega3TotalLineName = (name: string): boolean =>
    /\btotal\b.*\bomega\s*-?\s*3\b|\bomega\s*-?\s*3\b.*\btotal\b/i.test(name);

const isOmega3SourceLineName = (name: string): boolean =>
    /\bfish\s*oil\b|\bkrill\s*oil\b|\balgal\s*oil\b|\boil\s*concentrate\b/i.test(name);

const isOmega3BreakdownLineName = (name: string): boolean =>
    /\bepa\b|\bdha\b|eicosapentaenoic|docosahexaenoic/i.test(name);

type ScienceSidecarIngredientRow = {
    key: string;
    name: string;
    dose: string | null;
};

const buildIngredientOverviewFallbackClient = (
    rows: ScienceSidecarIngredientRow[],
): IngredientOverviewBlock => {
    const anchor = rows[0] ?? null;
    const hasOpaqueBlend = rows.some((row) => isBlendLikeName(row.name));
    const hasOmega3Breakdown = rows.some((row) => isOmega3BreakdownLineName(row.name));
    const formulaMode: IngredientOverviewBlock['mode'] =
        rows.length <= 1 && !hasOpaqueBlend
            ? 'single_anchor'
            : hasOpaqueBlend
                ? 'blend_anchor'
                : 'multi_anchor';

    if (formulaMode === 'single_anchor') {
        return {
            mode: 'single_anchor',
            titleLine: anchor?.name ?? 'Ingredient',
            paragraph1: `${anchor?.name ?? 'This ingredient'} is the main disclosed active in this product rather than one part of a broader multi-ingredient formula.`,
            paragraph2: 'That makes the label easier to read because the core ingredient identity stands on its own instead of being buried inside a blend or total line.',
            compareHint: 'When comparing products, focus on the named ingredient, the stated amount per serving, and whether the label clearly states the form or source.',
        };
    }

    if (formulaMode === 'multi_anchor') {
        if (rows.some((row) => isOmega3SourceLineName(row.name)) && hasOmega3Breakdown) {
            return {
                mode: 'multi_anchor',
                titleLine: 'Omega-3 formula',
                paragraph1: 'This omega-3 formula is organized around a source-oil line plus separate rows that break out the specific fatty acids underneath it.',
                paragraph2: 'That structure helps distinguish the source material from the EPA and DHA amounts that matter most when comparing products side by side.',
                compareHint: 'When comparing omega-3 products, focus on total omega-3 plus the stated EPA and DHA amounts, not just the fish-oil total.',
            };
        }
        return {
            mode: 'multi_anchor',
            titleLine: anchor?.name ?? 'Multi-ingredient formula',
            paragraph1: 'This product uses a multi-part formula instead of relying on only one disclosed active ingredient.',
            paragraph2: 'Some rows identify the main actives, while others add supporting nutrients or extra disclosure that helps explain how the formula is structured.',
            compareHint: 'When comparing products, focus on the named primary actives first and then check whether the rest of the formula is itemized clearly enough to compare.',
        };
    }

    return {
        mode: 'blend_anchor',
        titleLine: 'Blend-style formula',
        paragraph1: 'This product is organized around broad blend-style label lines rather than a fully itemized ingredient list.',
        paragraph2: 'That can describe the formula category at a glance, but it gives less precision about which components are doing the work and in what amounts.',
        compareHint: 'When comparing products, look for item-level naming and whether the label provides more than a single broad blend total.',
    };
};

const buildProductOverviewFallbackClient = (
    payload: ProductOverviewAiRequestPayload,
): ProductOverviewAiPayload => {
    const normalizeOverviewToken = (value?: string | null): string => normalizeText(value ?? null).toLowerCase();
    const dedupeStrings = (values: Array<string | null | undefined>): string[] => {
        const out: string[] = [];
        const seen = new Set<string>();
        values.forEach((value) => {
            const normalized = normalizeText(value ?? null);
            if (!normalized) return;
            const key = normalized.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            out.push(normalized);
        });
        return out;
    };
    const listToEnglish = (values: string[]): string => {
        if (values.length === 0) return '';
        if (values.length === 1) return values[0];
        if (values.length === 2) return `${values[0]} and ${values[1]}`;
        return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
    };

    const productNameToken = normalizeOverviewToken(payload.productName);
    const productTypeToken = normalizeOverviewToken(payload.productTypeHint);
    const ingredientTokens = dedupeStrings([
        payload.primaryIngredient,
        ...payload.keyIngredients.map((item) => item.name),
    ]).map((item) => item.toLowerCase());

    if (payload.isLikelySingleIngredient) {
        if (ingredientTokens.some((token) => token.includes('astaxanthin'))) {
            return {
                mode: 'rich',
                lead: 'Astaxanthin is a carotenoid supplement ingredient commonly used in antioxidant-focused products.',
                whatItIs: toSentence(
                    payload.sourceContextHint
                        ? `It is presented here with source context from ${payload.sourceContextHint} and appears as the main named active in the formula`
                        : 'It appears here as the main named active in a straightforward single-ingredient formula',
                ) ?? '',
                whyPeopleTakeIt:
                    'People usually choose astaxanthin products to compare the named ingredient, the source context on the label, and how clearly the formula stays focused on one active.',
            };
        }

        if (ingredientTokens.some((token) => token.includes('vitamin c')) || productTypeToken.includes('vitamin c')) {
            return {
                mode: 'rich',
                lead: 'This is a vitamin C supplement built around a clearly named vitamin ingredient.',
                whatItIs:
                    'It belongs to the straightforward vitamin-supplement category and may also include companion nutrients that sit alongside the main vitamin line on the label.',
                whyPeopleTakeIt:
                    'People usually choose products like this for direct vitamin C supplementation and to compare the named ingredient, label clarity, and any supporting nutrients included in the formula.',
            };
        }

        const primaryIngredient = normalizeText(payload.primaryIngredient ?? payload.keyIngredients[0]?.name ?? payload.productName) ?? 'This product';
        const productTypeHint = normalizeText(payload.productTypeHint)?.replace(/\bsupport supplement\b/i, 'supplement') ?? 'single-ingredient supplement';
        const sourceContext = normalizeText(payload.sourceContextHint);
        const chemicalForm = normalizeText(payload.chemicalFormHint);
        return {
            mode: 'rich',
            lead: `${primaryIngredient} is a supplement ingredient used in ${productTypeHint.toLowerCase()} products.`,
            whatItIs:
                sourceContext
                    ? `It is presented here with source context from ${sourceContext}.`
                    : chemicalForm
                        ? `It is presented here with a disclosed ingredient form of ${chemicalForm}.`
                        : 'It appears here as the main named active in a straightforward single-ingredient formula.',
            whyPeopleTakeIt:
                'People usually choose products like this to compare the named ingredient, the disclosed label context, and how clearly the formula stays focused on one main active.',
        };
    }

    if (
        productTypeToken.includes('omega-3')
        || productNameToken.includes('omega-3')
        || ingredientTokens.some((token) => token.includes('epa') || token.includes('dha') || token.includes('fish oil'))
    ) {
        const names = dedupeStrings(payload.keyIngredients.map((item) => item.name));
        const namedBreakdown = [
            names.some((name) => /\bepa\b/i.test(name)) ? 'EPA' : null,
            names.some((name) => /\bdha\b/i.test(name)) ? 'DHA' : null,
        ].filter(Boolean) as string[];
        return {
            mode: 'short',
            lead: 'This is an omega-3 supplement built around fish-oil-derived fatty acids.',
            whatItIs:
                namedBreakdown.length > 0
                    ? `The label separates the source oil from specific omega-3 components such as ${listToEnglish(namedBreakdown)}, which are the lines shoppers usually compare most closely.`
                    : 'The label presents omega-3s as a fish-oil-based formula rather than as a single isolated ingredient.',
            whyPeopleTakeIt:
                'People usually choose products like this for general omega-3 intake and to compare how clearly the EPA and DHA breakdown is disclosed.',
        };
    }

    if (
        productTypeToken.includes('probiotic')
        || productNameToken.includes('probiotic')
        || ingredientTokens.some((token) => token.includes('probiotic') || token.includes('phage') || token.includes('blend'))
    ) {
        return {
            mode: 'short',
            lead: 'This is a probiotic-style supplement organized around a blend-based formula.',
            whatItIs:
                'The label combines named blend lines rather than a fully itemized ingredient list, so the product is best understood as a formula with partially disclosed components.',
            whyPeopleTakeIt:
                'People usually choose products like this to compare how clearly the blend is described and whether the label gives enough detail to judge what is inside.',
        };
    }

    const productTypeHint = normalizeText(payload.productTypeHint)?.replace(/\bsupport supplement\b/i, 'supplement') ?? 'multi-ingredient supplement';
    const names = dedupeStrings(payload.keyIngredients.map((item) => item.name)).slice(0, 3);
    const namedContext = names.length > 0 ? ` with named components such as ${listToEnglish(names)}` : '';
    return {
        mode: 'short',
        lead: `This is a ${productTypeHint.toLowerCase()} with more than one disclosed ingredient.`,
        whatItIs: `The formula is organized as a structured label${namedContext}, so shoppers need to distinguish the main active from supporting or context lines.`,
        whyPeopleTakeIt:
            'People usually choose products like this to compare the named ingredients and how clearly the label separates the main active from supporting components.',
    };
};

const inferScientificBackgroundFamilyClient = (
    selectedIngredientName: string,
    rows: ScienceSidecarIngredientRow[],
): 'astaxanthin' | 'vitamin_c' | 'zinc' | 'omega_3' | 'probiotic_or_blend' | 'generic' => {
    const combined = [selectedIngredientName, ...rows.map((row) => row.name)].join(' ').toLowerCase();
    if (/astaxanthin|carotenoid/.test(combined)) return 'astaxanthin';
    if (/\bvitamin\s*c\b|\bascorbic\b|\bester\s*c\b/.test(combined)) return 'vitamin_c';
    if (/\bzinc\b/.test(combined)) return 'zinc';
    if (/\bfish\s*oil\b|\bomega\s*-?\s*3\b|\bepa\b|\bdha\b|\bkrill\b/.test(combined)) return 'omega_3';
    if (/probiotic|lactobacillus|bifidobacterium|saccharomyces|microbiome|phage/.test(combined) || rows.some((row) => isBlendLikeName(row.name))) {
        return 'probiotic_or_blend';
    }
    return 'generic';
};

const buildScientificBackgroundFallbackClient = (
    selectedIngredientName: string,
    rows: ScienceSidecarIngredientRow[],
): ScientificBackgroundBlock => {
    const selectedRow = rows.find((row) => row.key === normalizeIngredientNameForBackground(selectedIngredientName)) ?? rows[0] ?? null;
    const selectedLabel = selectedRow?.name ?? selectedIngredientName;
    const selectedDose = selectedRow?.dose ?? null;
    const hasOmega3Breakdown = rows.some((row) => isOmega3BreakdownLineName(row.name));
    const isLabelContextMode =
        isBlendLikeName(selectedLabel)
        || isOmega3TotalLineName(selectedLabel)
        || (isOmega3SourceLineName(selectedLabel) && hasOmega3Breakdown);

    if (isLabelContextMode) {
        return {
            mode: 'label_context_mode',
            selectedLabel,
            selectedDose,
            introLine: selectedDose ? `${selectedLabel} • ${selectedDose}` : selectedLabel,
            closingNote: 'Read this line as label context first, then compare it with the more specific ingredient rows that carry the strongest decision value.',
            sections: [
                {
                    heading: 'What this line means on the label',
                    summary: isOmega3TotalLineName(selectedLabel)
                        ? 'This line reports the total omega-3 pool in the serving rather than one stand-alone fatty acid with its own separate research story.'
                        : isOmega3SourceLineName(selectedLabel)
                            ? 'This line identifies the source oil in the formula, which tells you where the omega-3s come from but not the full active fatty-acid breakdown by itself.'
                            : 'This selected line is better understood as part of the label structure than as a stand-alone research target.',
                    bullets: [
                        isOmega3TotalLineName(selectedLabel)
                            ? 'It combines more than one omega-3 component into a single disclosure line.'
                            : 'It provides context about how the formula is described.',
                        isOmega3TotalLineName(selectedLabel)
                            ? 'It does not replace the specific EPA and DHA rows.'
                            : 'It is not always the row that carries the most research value by itself.',
                    ],
                    evidenceRead: 'This is mainly a label-reading and comparison line rather than the cleanest stand-alone research target.',
                    shopperMeaning: 'Use it to understand how the formula is organized, then move to the more specific active lines before comparing products.',
                },
            ],
        };
    }

    const family = inferScientificBackgroundFamilyClient(selectedLabel, rows);
    const sections =
        family === 'astaxanthin'
            ? [
                {
                    heading: 'Antioxidant activity',
                    summary: `${selectedLabel} is most often discussed in research on oxidative stress and antioxidant-related markers, where studies look at how it may help limit oxidative damage under specific conditions.`,
                    bullets: [
                        'Oxidative-stress marker studies are the clearest research lane here.',
                        'Mechanistic work often focuses on antioxidant response and cellular stress pathways.',
                        'Results can still vary by dose, population, and study design.',
                    ],
                    evidenceRead: 'This is one of the stronger research directions for this ingredient, but the evidence is still outcome-specific rather than universally definitive.',
                    shopperMeaning: 'This supports antioxidant positioning more than broad all-purpose wellness claims.',
                },
                {
                    heading: 'Eye and skin context',
                    summary: `${selectedLabel} also appears in research touching eye comfort and skin-related outcomes, especially in settings where oxidative stress or environmental exposure is part of the discussion.`,
                    bullets: [
                        'Eye-comfort and visual-fatigue contexts appear in some studies.',
                        'Skin hydration, elasticity, and appearance outcomes are also discussed.',
                        'These findings are usually more supportive than definitive.',
                    ],
                    evidenceRead: 'This is a meaningful but more context-dependent lane than the broad antioxidant story.',
                    shopperMeaning: 'It is reasonable as a secondary positioning area, but not the main evidence anchor for comparison.',
                },
            ]
            : family === 'vitamin_c'
                ? [
                    {
                        heading: 'Antioxidant and immune research',
                        summary: `${selectedLabel} is commonly discussed in antioxidant and immune-related research, but the cleanest interpretation depends on the exact outcome being measured.`,
                        bullets: [
                            'Antioxidant marker contexts are common.',
                            'Immune-function discussions appear often, but they should not be read as disease-treatment claims.',
                            'Broad immune language is usually wider than the most specific research endpoints.',
                        ],
                        evidenceRead: 'Evidence is real but outcome-specific, so broad marketing language can run ahead of the clearest data.',
                        shopperMeaning: 'This ingredient fits an immune-positioned product, but comparison should stay anchored to the exact ingredient, dose, and form rather than to broad claims alone.',
                    },
                    {
                        heading: 'Collagen and tissue support',
                        summary: `${selectedLabel} also appears in research tied to collagen formation and tissue-related functions, which is why it often shows up in structure- or recovery-oriented formulas.`,
                        bullets: [
                            'Collagen-related contexts are a common research lane.',
                            'Tissue-support relevance is usually discussed in function-specific settings.',
                            'Applicability still depends on the broader product context.',
                        ],
                        evidenceRead: 'This is a useful secondary research lane, but it should still be read in a context-specific way.',
                        shopperMeaning: 'It helps explain why vitamin C appears in more than one category of supplement, not just immune-positioned products.',
                    },
                ]
                : family === 'zinc'
                    ? [
                        {
                            heading: 'Immune function context',
                            summary: `${selectedLabel} is most often discussed in immune-function contexts, although the meaning of that evidence still depends on dose, population, and the exact outcome being studied.`,
                            bullets: [
                                'Immune-related positioning is common for this ingredient.',
                                'Outcome interpretation can shift by dose and population.',
                                'Broad language can easily outrun the exact evidence lane.',
                            ],
                            evidenceRead: 'This is a legitimate research lane, but it should still be read more narrowly than broad marketing copy implies.',
                            shopperMeaning: 'This makes zinc easy to position, but shoppers should still compare the actual disclosed amount and product context.',
                        },
                    ]
                    : family === 'omega_3'
                        ? [
                            {
                                heading: isOmega3BreakdownLineName(selectedLabel) && /\bepa\b|eicosapentaenoic/i.test(selectedLabel)
                                    ? 'Lipid and triglyceride research'
                                    : isOmega3BreakdownLineName(selectedLabel) && /\bdha\b|docosahexaenoic/i.test(selectedLabel)
                                        ? 'Brain and eye context'
                                        : 'Most studied: lipid-related endpoints',
                                summary: isOmega3BreakdownLineName(selectedLabel) && /\bepa\b|eicosapentaenoic/i.test(selectedLabel)
                                    ? `${selectedLabel} is most strongly associated with triglyceride and lipid-marker research, which makes this the clearest evidence lane for interpreting it.`
                                    : isOmega3BreakdownLineName(selectedLabel) && /\bdha\b|docosahexaenoic/i.test(selectedLabel)
                                        ? `${selectedLabel} is more often discussed in brain and eye-related contexts than in the lipid-heavy language commonly attached to EPA.`
                                        : `${selectedLabel} is most useful as part of the product's lipid and triglyceride context, which is where omega-3 evidence is usually easiest to interpret.`,
                                bullets: isOmega3BreakdownLineName(selectedLabel) && /\bdha\b|docosahexaenoic/i.test(selectedLabel)
                                    ? [
                                        'Eye and retinal context is especially relevant here.',
                                        'Brain-related positioning is common, but broad cognition claims should still be read carefully.',
                                        'This research lane is not the same as EPA’s main endpoint profile.',
                                    ]
                                    : [
                                        'Triglyceride and lipid endpoints are the most concrete comparison lane here.',
                                        'This is more specific than vague omega-3 marketing language.',
                                        'Dose and study design still shape how findings apply.',
                                    ],
                                evidenceRead: isOmega3BreakdownLineName(selectedLabel) && /\bdha\b|docosahexaenoic/i.test(selectedLabel)
                                    ? 'This is a meaningful lane, but it still contains more nuance than a simple brain-health slogan suggests.'
                                    : 'This is the most practical and decision-useful evidence lane for interpreting omega-3 actives.',
                                shopperMeaning: isOmega3BreakdownLineName(selectedLabel) && /\bdha\b|docosahexaenoic/i.test(selectedLabel)
                                    ? 'It helps explain why DHA and EPA should not be treated as interchangeable on the label.'
                                    : 'Use this as the main context for comparison before giving much weight to broader claims.',
                            },
                        ]
                        : [
                            {
                                heading: 'Most studied roles',
                                summary: `${selectedLabel} appears in several research directions, but some outcomes are usually more central than others depending on the exact ingredient identity and dose.`,
                                bullets: [
                                    'Research emphasis changes with the exact ingredient and formula setting.',
                                    'Not every broad claim is equally central to the evidence.',
                                ],
                                evidenceRead: 'This is a useful orientation section, but it should not be read as a blanket endorsement of every possible claim.',
                                shopperMeaning: 'It helps the shopper distinguish core positioning from more peripheral marketing language.',
                            },
                        ];

    return {
        mode: 'research_mode',
        selectedLabel,
        selectedDose,
        introLine: selectedDose ? `${selectedLabel} • ${selectedDose}` : selectedLabel,
        sections,
        closingNote: 'Read the research context as outcome-specific guidance, not as a blanket promise for every claim on the label.',
    };
};

const isResearchModeScienceRow = (
    row: ScienceSidecarIngredientRow,
    rows: ScienceSidecarIngredientRow[],
): boolean => {
    if (isBlendLikeName(row.name)) return false;
    if (isOmega3TotalLineName(row.name)) return false;
    if (isOmega3SourceLineName(row.name) && rows.some((candidate) => isOmega3BreakdownLineName(candidate.name))) {
        return false;
    }
    return true;
};

const pickResearchModeScienceRows = (
    rows: ScienceSidecarIngredientRow[],
): ScienceSidecarIngredientRow[] => {
    const filtered = rows.filter((row) => isResearchModeScienceRow(row, rows));
    return filtered.length > 0 ? filtered : rows;
};

const pickKeyIngredientsForBackground = (items: IngredientCoverItemLike[] | null | undefined): string[] => {
    const list = Array.isArray(items) ? items : [];
    const seen = new Set<string>();
    const scored: {
        idx: number;
        name: string;
        key: string;
        isBlend: boolean;
        hasDose: boolean;
    }[] = [];

    for (let idx = 0; idx < list.length; idx += 1) {
        const item = list[idx];
        const name = typeof item?.name === 'string' ? item.name.trim() : '';
        if (!name) continue;
        const key = normalizeIngredientNameForBackground(name);
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);

        const dose = typeof item?.dose === 'string' ? item.dose.trim() : '';
        scored.push({
            idx,
            name,
            key,
            isBlend: isBlendLikeName(name),
            hasDose: Boolean(dose),
        });
    }

    scored.sort((a, b) => {
        if (a.isBlend !== b.isBlend) return a.isBlend ? 1 : -1; // downweight blends
        if (a.hasDose !== b.hasDose) return a.hasDose ? -1 : 1; // prefer labeled dose
        return a.idx - b.idx; // stable order
    });

    return scored.map((row) => row.name);
};

const MiniScoreHeader: React.FC<{
    scrollY: SharedValue<number>;
    overallScore: number;
    overallBand?: string | null;
    muted?: boolean;
}> = ({ scrollY, overallScore, overallBand, muted }) => {
    const animatedStyle = useAnimatedStyle(() => {
        const progress = (scrollY.value - 210) / 70;
        const p = Math.max(0, Math.min(1, progress)); // appears after user scrolls a bit
        return {
            opacity: p,
            transform: [
                { translateY: (1 - p) * -18 },
                { scale: 0.88 + p * 0.12 },
            ],
        };
    }, []);
    const overallBandTone = getOverallBandTone(overallScore, overallBand);

    return (
        <Animated.View style={[styles.miniHeader, animatedStyle]} pointerEvents="none">
            <LinearGradient
                colors={
                    muted
                        ? ['rgba(255,255,255,0.76)', 'rgba(255,255,255,0.46)']
                        : ['rgba(255,255,255,0.94)', overallBandTone.bubbleFill]
                }
                locations={[0, 1]}
                start={{ x: 0.15, y: 0.05 }}
                end={{ x: 0.85, y: 1 }}
                style={StyleSheet.absoluteFillObject}
            />
            <DashboardBlur intensity={24} tint="light" style={StyleSheet.absoluteFill} />
            <View style={styles.miniHeaderTint} />

            <View
                style={[
                    styles.miniScoreBubble,
                    muted
                        ? styles.miniScoreBubbleMuted
                        : {
                            borderColor: overallBandTone.bubbleBorder,
                            backgroundColor: 'rgba(255,255,255,0.26)',
                        },
                ]}
            >
                <Text style={[styles.miniScoreText, muted ? null : { color: overallBandTone.bubbleText }]}>
                    {muted ? '--' : Math.round(overallScore)}
                </Text>
            </View>
        </Animated.View>
    );
};

const AnalysisBundleDashboard: React.FC<{
    bundle: AnalysisBundle;
    analysis: Analysis;
    isStreaming?: boolean;
    scoreBadge?: string;
    scoreState?: ScoreState;
    sourceType?: SourceType;
    scanSessionId?: string | null;
    scoreBundleV4State?: ScoreBundleV4State;
    onRetryScore?: () => void;
    externalScrollY?: SharedValue<number>;
    miniHeaderMode?: 'inline' | 'header';
    onMiniScoreMetaChange?: (meta: { overallScore: number; overallBand: string | null; muted: boolean }) => void;
}> = ({
    bundle,
    analysis,
    isStreaming = false,
    scoreBadge,
    scoreState = 'active',
    sourceType = 'barcode',
    scanSessionId = null,
    scoreBundleV4State,
    onRetryScore,
    externalScrollY,
    miniHeaderMode = 'inline',
    onMiniScoreMetaChange,
}) => {
    const { t } = useTranslation();
    const [selectedTileType, setSelectedTileType] = useState<TileType | null>(null);
    const [bundleState, setBundleState] = useState<AnalysisBundle>(bundle);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [factsDtoState, setFactsDtoState] = useState<FactsDtoState>({
        status: 'idle',
        data: null,
        error: null,
    });
    const [decisionSupportState, setDecisionSupportState] = useState<DecisionSupportState>({
        status: 'idle',
        data: null,
        error: null,
        autoRetryUsed: false,
    });
    const [productOverviewAiByDigest, setProductOverviewAiByDigest] = useState<Record<string, ProductOverviewAiState>>({});
    const [ingredientOverviewByRequestKey, setIngredientOverviewByRequestKey] = useState<Record<string, IngredientOverviewSidecarState>>({});
    const [scientificBackgroundByRequestKey, setScientificBackgroundByRequestKey] = useState<Record<string, ScientificBackgroundSidecarState>>({});
    const productOverviewAiStateRef = useRef<Record<string, ProductOverviewAiState>>({});
    const ingredientOverviewStateRef = useRef<Record<string, IngredientOverviewSidecarState>>({});
    const scientificBackgroundStateRef = useRef<Record<string, ScientificBackgroundSidecarState>>({});
    const decisionSupportCacheRef = useRef<Map<string, Record<string, unknown>>>(new Map());
    const decisionSupportByBarcodeRef = useRef<Map<string, Record<string, unknown>>>(decisionSupportWarmCache);
    const [simpleSourcesOpen, setSimpleSourcesOpen] = useState(false);
    const [expandedScoreRow, setExpandedScoreRow] = useState<'effectiveness' | 'safety' | 'integrity' | null>(null);
    const detailLoadingRef = useRef(false);
    const detailInFlightKeyRef = useRef<string | null>(null);
    const decisionSupportFetchKeyRef = useRef<string | null>(null);
    const decisionSupportRequestSeqRef = useRef(0);
    const foundationMetricLoggedRef = useRef<Set<string>>(new Set());
    const overlayConsumerMetricLoggedRef = useRef<Set<string>>(new Set());
    const currentRunKeyRef = useRef<string | null>(null);
    const setProductOverviewAiState = useCallback(
        (digest: string, nextEntry: ProductOverviewAiStateUpdater) => {
            setProductOverviewAiByDigest((prev) => {
                const current = prev[digest];
                const resolved = typeof nextEntry === 'function'
                    ? nextEntry(current)
                    : nextEntry;
                if (resolved === current) return prev;
                const next = { ...prev };
                if (resolved) next[digest] = resolved;
                else delete next[digest];
                productOverviewAiStateRef.current = next;
                return next;
            });
        },
        [],
    );
    useEffect(() => {
        productOverviewAiStateRef.current = productOverviewAiByDigest;
    }, [productOverviewAiByDigest]);
    const setIngredientOverviewSidecarState = useCallback(
        (requestKey: string, nextEntry: IngredientOverviewSidecarStateUpdater) => {
            setIngredientOverviewByRequestKey((prev) => {
                const current = prev[requestKey];
                const resolved = typeof nextEntry === 'function'
                    ? nextEntry(current)
                    : nextEntry;
                if (resolved === current) return prev;
                const next = { ...prev };
                if (resolved) next[requestKey] = resolved;
                else delete next[requestKey];
                ingredientOverviewStateRef.current = next;
                return next;
            });
        },
        [],
    );
    useEffect(() => {
        ingredientOverviewStateRef.current = ingredientOverviewByRequestKey;
    }, [ingredientOverviewByRequestKey]);
    const setScientificBackgroundSidecarState = useCallback(
        (requestKey: string, nextEntry: ScientificBackgroundSidecarStateUpdater) => {
            setScientificBackgroundByRequestKey((prev) => {
                const current = prev[requestKey];
                const resolved = typeof nextEntry === 'function'
                    ? nextEntry(current)
                    : nextEntry;
                if (resolved === current) return prev;
                const next = { ...prev };
                if (resolved) next[requestKey] = resolved;
                else delete next[requestKey];
                scientificBackgroundStateRef.current = next;
                return next;
            });
        },
        [],
    );
    useEffect(() => {
        scientificBackgroundStateRef.current = scientificBackgroundByRequestKey;
    }, [scientificBackgroundByRequestKey]);
    const incomingBundleRunKey = useMemo(() => {
        const normalizedSessionId = normalizeText(scanSessionId);
        if (normalizedSessionId) {
            return `session:${normalizedSessionId}`;
        }

        const explicitBundleId = normalizeText((bundle.meta as { bundleId?: string | null })?.bundleId ?? null);
        if (explicitBundleId) {
            return `bundle:${explicitBundleId}`;
        }

        // Fallback key when no explicit session/bundle id is present.
        // Keep this stable across phase changes (skeleton -> fast_ai -> full_ai)
        // to avoid wiping decision-support state mid-stream.
        return [
            `${bundle.meta.authoritativeIdentity?.type ?? 'unknown'}:${bundle.meta.authoritativeIdentity?.value ?? 'unknown'}`,
            normalizeText(bundle.meta.factsDigestHash ?? null) || 'no_digest',
        ].join('|');
    }, [
        bundle.meta.authoritativeIdentity?.type,
        bundle.meta.authoritativeIdentity?.value,
        bundle.meta.factsDigestHash,
        (bundle.meta as { bundleId?: string | null })?.bundleId,
        scanSessionId,
    ]);
    const internalScrollY = useSharedValue(0);
    const scrollY = externalScrollY ?? internalScrollY;
    const scrollHandler = useAnimatedScrollHandler((event) => {
        scrollY.value = event.contentOffset.y;
    });
    const { height: viewportHeight } = useWindowDimensions();
    const [tilesContainerW, setTilesContainerW] = useState(0);
    const TILE_GAP = 12;
    const tileWidth: DimensionValue = tilesContainerW > 0 ? tilesContainerW : '100%';
    const TileRenderer = disableTileAnimation ? StaticTile : AnimatedTile;
    const ScrollContainer: any = disableReanimatedScroll ? ScrollView : Animated.ScrollView;
    const handlePlainScroll = useCallback((event: any) => {
        scrollY.value = event.nativeEvent.contentOffset.y;
    }, [scrollY]);
    const scrollProps = disableReanimatedScroll
        ? { onScroll: handlePlainScroll }
        : { onScroll: scrollHandler };

    useEffect(() => {
        if (!__DEV__) return;
        console.log('[AnalysisDashboard] render mode', {
            appOwnership,
            isExpoGo,
            compatMode: expoGoDashboardCompatMode,
            forceFullDashboardEffects: FORCE_FULL_DASHBOARD_EFFECTS,
            disableMiniHeader,
            disableScoreRing,
            disableInsightDeck,
            disableModalPane,
            renderMode: 'modern',
            bisectRaw: DASHBOARD_BISECT_RAW,
            bisectFlags: Array.from(DASHBOARD_BISECT_FLAGS),
        });
    }, []);

    useEffect(() => {
        if (currentRunKeyRef.current === incomingBundleRunKey) return;
        currentRunKeyRef.current = incomingBundleRunKey;
        detailLoadingRef.current = false;
        detailInFlightKeyRef.current = null;
        decisionSupportFetchKeyRef.current = null;
        foundationMetricLoggedRef.current = new Set();
        overlayConsumerMetricLoggedRef.current = new Set();
        const incomingIdentity = bundle.meta.authoritativeIdentity;
        const incomingBarcode = incomingIdentity?.type === 'gtin14'
            ? normalizeBarcodeForDecision(String(incomingIdentity.value ?? ''))
            : normalizeBarcodeForDecision((analysis as { barcode?: string | null })?.barcode ?? null);
        const incomingFactsDigestHash = normalizeText(bundle.meta.factsDigestHash ?? null) || null;
        const incomingDecisionDigest =
            typeof (bundle.meta as { decisionSupportDigest?: unknown })?.decisionSupportDigest === 'string'
                ? String((bundle.meta as { decisionSupportDigest?: string }).decisionSupportDigest)
                : null;
        const seededDecision = incomingBarcode
            ? pickFreshDecisionPayloadForFacts(
                incomingFactsDigestHash,
                incomingDecisionDigest,
                decisionSupportByBarcodeRef.current.get(incomingBarcode) ?? null,
            )
            : null;
        setBundleState(bundle);
        setDecisionSupportState(
            seededDecision
                ? {
                    status: 'ready',
                    data: seededDecision,
                    error: null,
                    autoRetryUsed: false,
                }
                : {
                    status: 'idle',
                    data: null,
                    error: null,
                    autoRetryUsed: false,
                }
        );
        setDetailError(null);
        setDetailLoading(false);
        setExpandedScoreRow(null);
        setSimpleSourcesOpen(false);
    }, [analysis, bundle, incomingBundleRunKey]);

    useEffect(() => {
        // Never clobber on-demand detail fields (e.g. ingredients.detail) when a newer analysis_bundle
        // arrives over SSE. The SSE bundle typically carries cover + meta only, while detail is fetched
        // separately via /api/analysis-section. If we overwrite state here, we can re-trigger the
        // auto-fetch loop and hit backend 429s.
        setBundleState((prev) => {
            // v4 path
            if (isBundleV4(prev) && isBundleV4(bundle)) {
                const sameKey =
                    prev.meta.bundleId === bundle.meta.bundleId &&
                    prev.meta.factsDigestHash === bundle.meta.factsDigestHash &&
                    prev.meta.promptVersion === bundle.meta.promptVersion &&
                    prev.meta.locale === bundle.meta.locale &&
                    prev.meta.authoritativeIdentity.type === bundle.meta.authoritativeIdentity.type &&
                    prev.meta.authoritativeIdentity.value === bundle.meta.authoritativeIdentity.value;
                if (!sameKey) return bundle;

                const prevIngredients = prev.sections.ingredients;
                const nextIngredients = bundle.sections.ingredients;
                const shouldPreserveIngredientsDetail =
                    nextIngredients.detail == null && prevIngredients.detail != null;

                const mergedIngredients = shouldPreserveIngredientsDetail
                    ? {
                        ...nextIngredients,
                        detail: prevIngredients.detail,
                        // Preserve the terminal status so we don't auto-refetch on every SSE update.
                        dataStatus: prevIngredients.dataStatus ?? nextIngredients.dataStatus,
                    }
                    : nextIngredients;

                return {
                    ...bundle,
                    sections: {
                        ...bundle.sections,
                        ingredients: mergedIngredients,
                    },
                };
            }

            // v3 path (kept for backwards compatibility with older servers)
            if (!isBundleV4(prev) && !isBundleV4(bundle)) {
                const sameKey =
                    prev.meta.bundleId === bundle.meta.bundleId &&
                    prev.meta.factsDigestHash === bundle.meta.factsDigestHash &&
                    prev.meta.promptVersion === bundle.meta.promptVersion &&
                    prev.meta.locale === bundle.meta.locale &&
                    prev.meta.authoritativeIdentity.type === bundle.meta.authoritativeIdentity.type &&
                    prev.meta.authoritativeIdentity.value === bundle.meta.authoritativeIdentity.value;
                if (!sameKey) return bundle;

                const prevIngredients = prev.sections.ingredients;
                const nextIngredients = bundle.sections.ingredients;
                const shouldPreserveIngredientsDetail =
                    nextIngredients.detail == null && prevIngredients.detail != null;

                const mergedIngredients = shouldPreserveIngredientsDetail
                    ? {
                        ...nextIngredients,
                        detail: prevIngredients.detail,
                        dataStatus: prevIngredients.dataStatus ?? nextIngredients.dataStatus,
                    }
                    : nextIngredients;

                return {
                    ...bundle,
                    sections: {
                        ...bundle.sections,
                        ingredients: mergedIngredients,
                    },
                };
            }

            // Schema mismatch: accept the new bundle as-is.
            return bundle;
        });
    }, [bundle]);

    useEffect(() => {
        const sourceTarget = resolveFactsSourceFromIdentity(bundleState.meta.authoritativeIdentity);
        if (!sourceTarget) {
            setFactsDtoState({ status: 'error', data: null, error: 'Missing authoritative identity' });
            return;
        }

        let cancelled = false;
        const run = async () => {
            setFactsDtoState((prev) => ({
                status: 'loading',
                data: prev.data,
                error: null,
            }));
            try {
                const baseUrl = String(Config.searchApiBaseUrl).replace(/\/$/, '');
                const headers = await withAuthHeaders();
                const res = await fetch(
                    `${baseUrl}/api/scan-facts/v1/${encodeURIComponent(sourceTarget.source)}/${encodeURIComponent(sourceTarget.sourceId)}`,
                    {
                        method: 'GET',
                        headers,
                    },
                );
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const payload = await res.json();
                if (cancelled) return;
                if (payload?.status !== 'ok' || !payload?.facts) {
                    setFactsDtoState({
                        status: 'error',
                        data: null,
                        error: typeof payload?.message === 'string' ? payload.message : 'Facts unavailable',
                    });
                    return;
                }
                setFactsDtoState({
                    status: 'ready',
                    data: payload.facts as FactsDTO,
                    error: null,
                });
            } catch (error) {
                if (cancelled) return;
                const message = error instanceof Error ? error.message : 'Facts unavailable';
                setFactsDtoState({ status: 'error', data: null, error: message });
            }
        };
        run();

        return () => {
            cancelled = true;
        };
    }, [
        bundleState.meta.authoritativeIdentity.type,
        bundleState.meta.authoritativeIdentity.value,
    ]);

    const analysisBarcodeRaw = normalizeText((analysis as { barcode?: string | null })?.barcode ?? null);
    const analysisBarcodeDigits = useMemo(() => {
        const digits = analysisBarcodeRaw.replace(/\D/g, '');
        if (digits.length < 8) return null;
        return digits.length > 14 ? digits.slice(-14) : digits.padStart(14, '0');
    }, [analysisBarcodeRaw]);

    useEffect(() => {
        const resolvedBarcode = (() => {
            const identity = bundleState.meta.authoritativeIdentity;
            if (identity?.type === 'gtin14') {
                const digits = String(identity.value ?? '').replace(/\D/g, '');
                if (digits.length >= 8) return digits.length > 14 ? digits.slice(-14) : digits.padStart(14, '0');
            }
            return analysisBarcodeDigits;
        })();
        if (!resolvedBarcode) return;
        const digestHint =
            typeof (bundleState.meta as { decisionSupportDigest?: unknown })?.decisionSupportDigest === 'string'
                ? String((bundleState.meta as { decisionSupportDigest?: string }).decisionSupportDigest)
                : null;
        const currentFactsDigestHash = normalizeText(bundleState.meta.factsDigestHash ?? null) || null;
        const scanInstanceKey = `${normalizeText((bundleState.meta as { bundleId?: string | null })?.bundleId ?? '')}|${String(bundleState.meta.revision ?? '')}`;
        const sourceType = normalizeText(bundleState.meta.sourceType ?? null).toLowerCase();
        const sourceTypeFinal = bundleState.meta.sourceTypeFinal === true;
        const isWebSkeletonPhase =
            sourceType === 'web'
            && !sourceTypeFinal
            && (bundleState.meta.phase === 'skeleton' || isStreaming);
        const decisionCacheKey = [
            resolvedBarcode,
            `${bundleState.meta.authoritativeIdentity.type}:${bundleState.meta.authoritativeIdentity.value}`,
            digestHint ?? 'no_digest',
            sourceType || 'unknown',
            sourceTypeFinal ? 'final' : 'nonfinal',
            SCAN_UX_VIEW_MODE,
        ].join('|');
        const normalizedSessionId = normalizeText(scanSessionId) || 'session_unknown';
        const fetchKey = `${normalizedSessionId}|${decisionCacheKey}|${scanInstanceKey}`;
        if (decisionSupportFetchKeyRef.current === fetchKey) return;
        decisionSupportFetchKeyRef.current = fetchKey;
        const requestSeq = ++decisionSupportRequestSeqRef.current;

        let cancelled = false;
        let autoRetryUsed = false;
        const cachedPayload = decisionSupportCacheRef.current.get(decisionCacheKey) ?? null;
        const inlinePayloadRaw =
            (bundleState.meta as { decisionSupportInline?: Record<string, unknown> | null }).decisionSupportInline ?? null;
        const inlineFallback =
            inlinePayloadRaw && typeof inlinePayloadRaw === 'object'
                ? {
                    ...inlinePayloadRaw,
                    factsDigestHash: currentFactsDigestHash ?? getDecisionPayloadFactsDigestHash(inlinePayloadRaw),
                    digest: normalizeText(
                        typeof inlinePayloadRaw.digest === 'string'
                            ? inlinePayloadRaw.digest
                            : digestHint,
                    ) || undefined,
                    sourceType: normalizeText(
                        typeof inlinePayloadRaw.sourceType === 'string'
                            ? inlinePayloadRaw.sourceType
                            : bundleState.meta.sourceType,
                    ) || undefined,
                  }
                : null;
        const seededPayload = pickFreshDecisionPayloadForFacts(
            currentFactsDigestHash,
            digestHint,
            decisionSupportByBarcodeRef.current.get(resolvedBarcode) ?? null,
            inlineFallback ?? null,
            cachedPayload,
        );
        if (!cancelled && seededPayload) {
            upsertDecisionPayloadByBarcode(decisionSupportByBarcodeRef.current, resolvedBarcode, seededPayload);
            setDecisionSupportState((prev) => ({
                status: 'ready',
                data: seededPayload,
                error: null,
                autoRetryUsed: prev.autoRetryUsed,
            }));
        }
        if (isWebSkeletonPhase) {
            setDecisionSupportState((prev) => ({
                status: prev.data ? 'ready' : 'loading',
                data: prev.data,
                error: null,
                autoRetryUsed: prev.autoRetryUsed,
            }));
            // Keep fetching authoritative decision-support even during a transient
            // web skeleton phase so release builds do not get stuck on placeholders
            // when rev1 never upgrades the stream in time.
        }
        const run = async (
            digestParam: string | null,
            canDigestRetry: boolean,
            retryAttempt: number = 0,
        ): Promise<void> => {
            try {
                if (!cancelled) {
                    setDecisionSupportState((prev) => ({
                        status: (seededPayload ?? prev.data) ? 'ready' : 'loading',
                        data: (seededPayload ?? prev.data) || null,
                        error: null,
                        autoRetryUsed,
                    }));
                }
                const baseUrl = String(Config.searchApiBaseUrl).replace(/\/$/, '');
                const params = new URLSearchParams({
                    barcode: resolvedBarcode,
                    viewMode: SCAN_UX_VIEW_MODE,
                });
                if (digestParam) params.set('digest', digestParam);
                const res = await fetch(`${baseUrl}/api/decision-support/v1?${params.toString()}`, {
                    method: 'GET',
                    headers: await withAuthHeaders(),
                });
                if (cancelled || requestSeq !== decisionSupportRequestSeqRef.current) return;

                if (res.status === 409) {
                    const mismatchPayload = await res.json().catch(() => null);
                    const latestDigest = typeof mismatchPayload?.latestDigest === 'string' ? mismatchPayload.latestDigest : null;
                    if (canDigestRetry && latestDigest && latestDigest !== digestParam) {
                        autoRetryUsed = true;
                        return run(latestDigest, false, retryAttempt);
                    }
                    if (!cancelled) {
                        const fallbackData = pickFreshDecisionPayloadForFacts(
                            currentFactsDigestHash,
                            digestHint,
                            decisionSupportByBarcodeRef.current.get(resolvedBarcode) ?? null,
                            inlineFallback ?? null,
                            cachedPayload,
                        );
                        if (fallbackData) {
                            upsertDecisionPayloadByBarcode(decisionSupportByBarcodeRef.current, resolvedBarcode, fallbackData);
                        }
                        setDecisionSupportState({
                            status: fallbackData ? 'ready' : 'error',
                            data: fallbackData
                                ? {
                                    ...fallbackData,
                                    staleDigest: true,
                                    latestDigest,
                                }
                                : null,
                            error: fallbackData ? null : 'Decision support content updated. Refresh required.',
                            autoRetryUsed,
                        });
                    }
                    return;
                }

                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }

                const payload = await res.json();
                if (cancelled || requestSeq !== decisionSupportRequestSeqRef.current) return;
                if (payload && typeof payload === 'object') {
                    const objectPayload = payload as Record<string, unknown>;
                    decisionSupportCacheRef.current.set(decisionCacheKey, objectPayload);
                    upsertDecisionPayloadByBarcode(
                        decisionSupportByBarcodeRef.current,
                        resolvedBarcode,
                        objectPayload,
                    );
                    const selectedPayload = pickFreshDecisionPayloadForFacts(
                        currentFactsDigestHash,
                        digestHint,
                        objectPayload,
                        inlineFallback ?? null,
                        decisionSupportByBarcodeRef.current.get(resolvedBarcode) ?? null,
                        decisionSupportCacheRef.current.get(decisionCacheKey) ?? null,
                    );
                    setDecisionSupportState({
                        status: selectedPayload ? 'ready' : 'error',
                        data: selectedPayload,
                        error: selectedPayload ? null : 'Verified details did not match the latest scan.',
                        autoRetryUsed,
                    });
                    return;
                }
                setDecisionSupportState({
                    status: 'ready',
                    data: payload && typeof payload === 'object' ? payload : null,
                    error: null,
                    autoRetryUsed,
                });
            } catch (error) {
                if (cancelled || requestSeq !== decisionSupportRequestSeqRef.current) return;
                const message = error instanceof Error ? error.message : 'Decision support unavailable';
                const statusMatch = message.match(/HTTP\s+(\d{3})/i);
                const httpStatus = statusMatch ? Number.parseInt(statusMatch[1] ?? '', 10) : null;
                const shouldRetry =
                    retryAttempt < DECISION_SUPPORT_RETRY_BACKOFF_MS.length
                    && isTransientDecisionSupportFailure(message, Number.isFinite(httpStatus) ? httpStatus : null);
                if (shouldRetry) {
                    const delayMs = DECISION_SUPPORT_RETRY_BACKOFF_MS[retryAttempt] ?? 0;
                    if (!cancelled) {
                        setDecisionSupportState((prev) => ({
                            status: prev.data ? 'ready' : 'loading',
                            data: prev.data,
                            error: prev.data ? prev.error : `Retrying verified details… (${Math.max(1, Math.round(delayMs / 1000))}s)`,
                            autoRetryUsed,
                        }));
                    }
                    await waitMs(delayMs);
                    if (cancelled || requestSeq !== decisionSupportRequestSeqRef.current) return;
                    return run(digestParam, canDigestRetry, retryAttempt + 1);
                }
                const fallbackData = pickFreshDecisionPayloadForFacts(
                    currentFactsDigestHash,
                    digestHint,
                    decisionSupportByBarcodeRef.current.get(resolvedBarcode) ?? null,
                    inlineFallback ?? null,
                    cachedPayload,
                );
                if (fallbackData) {
                    upsertDecisionPayloadByBarcode(decisionSupportByBarcodeRef.current, resolvedBarcode, fallbackData);
                }
                setDecisionSupportState({
                    status: fallbackData ? 'ready' : 'error',
                    data: fallbackData ? { ...fallbackData, staleDigest: true } : null,
                    error: fallbackData ? null : message,
                    autoRetryUsed,
                });
            }
        };

        void run(digestHint, true);

        return () => {
            cancelled = true;
        };
    }, [
        analysisBarcodeDigits,
        bundleState.meta.authoritativeIdentity.type,
        bundleState.meta.authoritativeIdentity.value,
        (bundleState.meta as { decisionSupportDigest?: string | null })?.decisionSupportDigest,
        (bundleState.meta as { bundleId?: string | null })?.bundleId,
        bundleState.meta.revision,
        bundleState.meta.sourceType,
        bundleState.meta.sourceTypeFinal,
        bundleState.meta.phase,
        isStreaming,
        scanSessionId,
    ]);

    const inlineDecisionTemplatePayload = useMemo<Record<string, unknown> | null>(() => {
        const inline =
            (bundleState.meta as { decisionSupportInline?: Record<string, unknown> | null }).decisionSupportInline ?? null;
        if (!inline || typeof inline !== 'object') return null;
        const currentFactsDigestHash = normalizeText(bundleState.meta.factsDigestHash ?? null) || null;
        const digestHint =
            typeof (bundleState.meta as { decisionSupportDigest?: unknown })?.decisionSupportDigest === 'string'
                ? String((bundleState.meta as { decisionSupportDigest?: string }).decisionSupportDigest)
                : null;
        return {
            ...inline,
            factsDigestHash: currentFactsDigestHash ?? getDecisionPayloadFactsDigestHash(inline),
            digest: normalizeText(typeof inline.digest === 'string' ? inline.digest : digestHint) || undefined,
            sourceType: normalizeText(
                typeof inline.sourceType === 'string' ? inline.sourceType : bundleState.meta.sourceType,
            ) || undefined,
        };
    }, [bundleState.meta]);
    const decisionTemplatePayload = useMemo<DecisionSupportTemplatePayload | null>(() => {
        const currentFactsDigestHash = normalizeText(bundleState.meta.factsDigestHash ?? null) || null;
        const currentDecisionDigest =
            typeof (bundleState.meta as { decisionSupportDigest?: unknown })?.decisionSupportDigest === 'string'
                ? String((bundleState.meta as { decisionSupportDigest?: string }).decisionSupportDigest)
                : null;
        const fetchedPayload =
            decisionSupportState.status === 'ready' && decisionSupportState.data && typeof decisionSupportState.data === 'object'
                ? decisionSupportState.data
                : null;
        const selectedPayload = pickFreshDecisionPayloadForFacts(
            currentFactsDigestHash,
            currentDecisionDigest,
            fetchedPayload,
            inlineDecisionTemplatePayload,
        );
        if (!selectedPayload) return null;
        return selectedPayload as DecisionSupportTemplatePayload;
    }, [
        (bundleState.meta as { decisionSupportDigest?: string | null })?.decisionSupportDigest,
        bundleState.meta.factsDigestHash,
        decisionSupportState.data,
        decisionSupportState.status,
        inlineDecisionTemplatePayload,
    ]);
    const decisionTemplatePending =
        !hasRenderableDecisionTemplate(decisionTemplatePayload as Record<string, unknown> | null | undefined)
        && (decisionSupportState.status === 'idle' || decisionSupportState.status === 'loading' || isStreaming);
    const decisionTemplateUnavailable =
        !hasRenderableDecisionTemplate(decisionTemplatePayload as Record<string, unknown> | null | undefined)
        && !decisionTemplatePending;
    const decisionOverviewBlock = decisionTemplatePayload?.overviewBlock;
    const decisionScienceBlock = decisionTemplatePayload?.scienceBlock;
    const decisionUsageBlock = decisionTemplatePayload?.usageBlock;
    const decisionSafetyBlock = decisionTemplatePayload?.safetyBlock;
    const decisionQualityMark = decisionTemplatePayload?.qualityMark;
    const decisionOverlayUsed = useMemo(() => {
        if (decisionUsageBlock?.directions?.sourceTier === 'overlay_iherb') return true;
        const sourceStrip = Array.isArray(decisionOverviewBlock?.sourceStrip) ? decisionOverviewBlock.sourceStrip : [];
        return sourceStrip.some((line) => /supplemental|product-page|iherb/i.test(String(line ?? '')));
    }, [decisionOverviewBlock?.sourceStrip, decisionUsageBlock?.directions?.sourceTier]);

    const onTilesGridLayout = useCallback((e: LayoutChangeEvent) => {
        const nextWidth = e.nativeEvent.layout.width;
        setTilesContainerW((prev) => (Math.abs(prev - nextWidth) < 1 ? prev : nextWidth));
    }, []);

    const productInfo = analysis?.productInfo ?? { brand: null, name: null, category: null, image: null };
    const factsProduct = factsDtoState.data?.product ?? null;
    const bundleProductIdentity =
        ((bundleState.meta as { productIdentity?: { name?: string | null; brand?: string | null } | null }).productIdentity)
        ?? null;
    const resolvedProductName =
        normalizeText(productInfo.name ?? null)
        || normalizeText(bundleProductIdentity?.name ?? null)
        || normalizeText(factsProduct?.name ?? null)
        || null;
    const resolvedProductBrand =
        normalizeText(productInfo.brand ?? null)
        || normalizeText(bundleProductIdentity?.brand ?? null)
        || normalizeText(factsProduct?.brand ?? null)
        || null;
    const brandForSubtitle = resolvedProductBrand ? formatBrandForPill(resolvedProductBrand) : null;
    const rawProductSubtitle = [brandForSubtitle, productInfo.category].filter(Boolean).join(' • ');
    const trustedDisplayIdentity = useMemo(
        () =>
            resolveTrustedDisplayIdentity({
                bundleMeta: bundleState.meta,
                productName: resolvedProductName || 'Supplement',
                productSubtitle: rawProductSubtitle,
                authoritativeIdentity: bundleState?.meta?.authoritativeIdentity ?? null,
                barcode: analysisBarcodeRaw || analysisBarcodeDigits || null,
                sources: (Array.isArray(analysis?.sources) ? analysis.sources : []).map((source: any) => ({
                    domain: typeof source?.domain === 'string' ? source.domain : null,
                    url: typeof source?.url === 'string' ? source.url : typeof source?.link === 'string' ? source.link : null,
                    link: typeof source?.link === 'string' ? source.link : null,
                })),
                showDebugWebHintSource: SHOW_SCAN_DEBUG,
            }),
        [
            analysis?.sources,
            analysisBarcodeDigits,
            analysisBarcodeRaw,
            bundleState.meta,
            rawProductSubtitle,
            resolvedProductName,
        ],
    );
    const productTitle = trustedDisplayIdentity.title;
    const productSubtitle = trustedDisplayIdentity.subtitle;
    const bundleSourceTypeFinal = bundleState.meta.sourceTypeFinal !== false && Number(bundleState.meta.revision) >= 1;
    const bundleSourceType = typeof bundleState.meta.sourceType === 'string' ? bundleState.meta.sourceType : null;
    const verificationPresentation = useMemo(
        () =>
            buildVerificationPresentation({
                meta: bundleState.meta,
                trustedIdentity: trustedDisplayIdentity,
                isStreaming,
            }),
        [bundleState.meta, isStreaming, trustedDisplayIdentity],
    );
    const sourceCopy = verificationPresentation.copyTokens.sourceCopy;
    const sourceBullets = verificationPresentation.copyTokens.sourceBullets;
    const sourceBadgeLabel = verificationPresentation.copyTokens.badgeLabel;
    const scrubConflictingSourceLine = useCallback(
        (value?: string | null): string | null => {
            const text = normalizeText(value);
            if (!text) return null;
            if (
                verificationPresentation.verificationStatus === 'final' &&
                /unverified web hints?|web evidence budget was reached|shown in limited mode/i.test(text)
            ) {
                return null;
            }
            return text;
        },
        [verificationPresentation.verificationStatus],
    );

    const overviewCover = bundleState.sections.overview.cover;
    const overviewSummarySeed = scrubConflictingSourceLine(overviewCover?.summary);
    const legacyOverviewSummaryText = sanitizeCoverLine(
        overviewSummarySeed,
        sourceCopy,
    );
    const rawOverviewBullets = Array.isArray(overviewCover?.bullets)
        ? overviewCover.bullets
              .map((bullet) => {
                  if (!bullet || typeof bullet !== 'object') return null;
                  const nextText = scrubConflictingSourceLine((bullet as { text?: string | null }).text);
                  if (!nextText) return null;
                  return {
                      ...(bullet as Record<string, unknown>),
                      text: nextText,
                  };
              })
              .filter((bullet): bullet is { text: string; basisTags?: BasisTag[] } => Boolean(bullet?.text))
        : [];
    const legacyOverviewBullets = sanitizeCoverBullets(
        rawOverviewBullets,
        sourceBullets,
        2,
    ).map((line) => {
        if (line.isPlaceholder) return { text: line.text };
        const raw = rawOverviewBullets.find((bullet) => bullet?.text?.trim() === line.text);
        return { text: formatTaggedText(line.text, raw?.basisTags) };
    });

    const ingredientsCover = bundleState.sections.ingredients.cover;
    const ingredientsItems = useMemo(
        () => (Array.isArray(ingredientsCover?.items) ? ingredientsCover.items : []),
        [ingredientsCover?.items]
    );
    const ingredientsItemsFiltered = useMemo(
        () => ingredientsItems.filter((item) => !isNutritionLabelLikeIngredient(item?.name)),
        [ingredientsItems],
    );
    const recordFacts = useMemo(
        () =>
            buildRecordFactsViewModel({
                bundle: bundleState,
                facts: factsDtoState.data,
            }),
        [bundleState, factsDtoState.data],
    );
    const dataCeilingSignal = useMemo(
        () =>
            resolveDataCeilingSignal({
                bundle: bundleState,
                recordFacts,
            }),
        [bundleState, recordFacts],
    );
    const isDataCeiling = dataCeilingSignal.isDataCeiling;
    const dataCeilingReasonNote = useMemo(() => {
        switch (dataCeilingSignal.reason) {
            case 'MISSING_MEDICINAL_INGREDIENTS':
                return 'This source record does not include medicinal ingredient fields.';
            case 'MISSING_AMOUNT_FIELDS':
                return 'This source record includes ingredient names, but amount fields are missing.';
            case 'PARSER_GAP_FIXABLE':
                return 'Source fields appear present, but ingredient amounts could not be parsed yet.';
            case 'MAPPING_GAP_NO_BARCODE':
                return 'A source record was found, but barcode mapping is incomplete for full ingredient detail.';
            default:
                return 'This verified source record is missing ingredient amount fields.';
        }
    }, [dataCeilingSignal.reason]);
    const dataCeilingOverviewLine = isDataCeiling
        ? 'We found a verified record, but it doesn’t include ingredient amounts.'
        : null;
    const dataCeilingActionLine = isDataCeiling
        ? 'Scan the Supplement Facts label for full details.'
        : null;
    const dataCeilingScienceLead = isDataCeiling ? 'Ingredients aren’t available in this record.' : null;
    const dataCeilingScienceAction = isDataCeiling ? 'Try label scan to identify ingredients and amounts.' : null;
    const ingredientsNotProvidedCopy =
        isDataCeiling
            ? 'Ingredients aren’t available in this record. Try label scan to identify ingredients and amounts.'
            : bundleSourceType === 'lnhpd'
            ? 'Ingredients are not listed in the LNHPD record for this NPN. Capture the Supplement Facts panel to unlock ingredient analysis.'
            : bundleSourceType === 'dsld'
                ? 'Ingredients are not listed in the DSLD record for this label. Capture the Supplement Facts panel to unlock ingredient analysis.'
                : 'Ingredient information is not available from this source. Scan the Supplement Facts panel.';
    const legacyIngredientMechanisms: Mechanism[] = ingredientsItems.length > 0
        ? ingredientsItems.slice(0, 3).map((item) => ({
            name: item.name,
            amount: item.dose ?? '',
            fill: item.dose ? 0.75 : 0.4,
            mode: item.dose ? 'actual' : 'unknown',
            showInfo: item.basisTags.length > 0,
        }))
        : recordFacts.ingredientRows.length > 0
            ? recordFacts.ingredientRows.slice(0, 3).map((item) => ({
                name: item.name,
                amount: item.doseLine ?? '',
                fill: item.doseLine ? 0.75 : 0.4,
                mode: item.doseLine ? 'actual' : 'unknown',
                showInfo: false,
            }))
        : [
            {
                name:
                    bundleState.sections.ingredients.dataStatus === 'not_provided'
                        ? (isDataCeiling
                            ? 'Ingredients aren’t available in this record'
                            : ingredientsNotProvidedCopy.replace(/\.$/, ''))
                        : 'Ingredient list not available — scan a Supplement Facts panel to unlock.',
                amount: '',
                fill: 0.35,
                mode: 'unknown',
                showInfo: false,
            },
        ];
    const ingredientRowsForRanking = useMemo(
        () =>
            ingredientsItemsFiltered.length > 0
                ? (ingredientsItemsFiltered as unknown as IngredientCoverItemLike[])
                : recordFacts.ingredientRows.map((row) => ({
                    name: row.name,
                    dose: row.doseLine ?? '',
                })).filter((row) => !isNutritionLabelLikeIngredient(row.name)) as unknown as IngredientCoverItemLike[],
        [ingredientsItemsFiltered, recordFacts.ingredientRows],
    );

    const keyIngredientsRanked = useMemo(
        () => pickKeyIngredientsForBackground(ingredientRowsForRanking),
        [ingredientRowsForRanking]
    );
    const keyIngredientsForIngredients = useMemo(
        () => keyIngredientsRanked.slice(0, 3),
        [keyIngredientsRanked]
    );
    const keyIngredientsForSafety = useMemo(
        () => keyIngredientsRanked.slice(0, 2),
        [keyIngredientsRanked]
    );
    const foundationHitSummary = useMemo(
        () => summarizeFoundationHits(keyIngredientsForIngredients),
        [keyIngredientsForIngredients],
    );
    const hasAnyOdsFoundationHit = foundationHitSummary.odsHitCount > 0;
    const [activeSafetyIngredientName, setActiveSafetyIngredientName] = useState<string | null>(
        keyIngredientsForSafety[0] ?? null,
    );
    useEffect(() => {
        const nextKeys = keyIngredientsForSafety.map((name) => normalizeIngredientNameForBackground(name));
        const activeKey = activeSafetyIngredientName ? normalizeIngredientNameForBackground(activeSafetyIngredientName) : null;
        if (!activeKey || !nextKeys.includes(activeKey)) {
            setActiveSafetyIngredientName(keyIngredientsForSafety[0] ?? null);
        }
    }, [keyIngredientsForSafety, activeSafetyIngredientName]);
    const activeSafetyIngredientKey = activeSafetyIngredientName
        ? normalizeIngredientNameForBackground(activeSafetyIngredientName)
        : null;
    const v4ResponseForInsights =
        scoreBundleV4State?.status === 'ready' ? scoreBundleV4State.response : null;
    const v4BundleForInsights = v4ResponseForInsights?.status === 'ok' ? v4ResponseForInsights.bundle : null;
    const productSpecificInsightsByIngredient = useMemo(
        () => extractProductSpecificInsights(v4BundleForInsights),
        [v4BundleForInsights]
    );
    // P0-2: Moved state declaration up so assembledInsights useMemo can reference it
    const [runtimeKbNotesByKey, setRuntimeKbNotesByKey] = useState<Record<string, RuntimeKbNotesState>>({});
    const assembledInsights = useMemo(
        () => {
            // P0-2: runtimeKbNotesByKey now uses normalizedIngredientName|formKey keys.
            const reviewedSegmentsByIngredient: Record<string, Record<string, string[]> | null> = {};
            for (const [compositeKey, notes] of Object.entries(runtimeKbNotesByKey)) {
                if (notes?.status !== 'ok' || !notes.segmentsByBucket) continue;
                const [ingredientKey] = compositeKey.split('|');
                if (!ingredientKey) continue;
                reviewedSegmentsByIngredient[ingredientKey] = notes.segmentsByBucket;
            }

            return assembleInsightsDTO({
                facts: factsDtoState.data,
                scoreBundle: v4BundleForInsights,
                reviewedSegmentsByIngredient: Object.keys(reviewedSegmentsByIngredient).length > 0
                    ? reviewedSegmentsByIngredient
                    : undefined,
            });
        },
        [factsDtoState.data, v4BundleForInsights, runtimeKbNotesByKey],
    );

    useEffect(() => {
        if (!bundleSourceTypeFinal) return;
        const digest = typeof bundleState.meta.factsDigestHash === 'string' ? bundleState.meta.factsDigestHash : '';
        if (!digest) return;
        if (foundationMetricLoggedRef.current.has(digest)) return;
        foundationMetricLoggedRef.current.add(digest);

        console.info('[foundation-overlay-metric]', {
            ...foundationHitSummary,
            selectedIngredients: keyIngredientsForIngredients,
        });
    }, [bundleSourceTypeFinal, bundleState.meta.factsDigestHash, foundationHitSummary, keyIngredientsForIngredients]);

    const usageCover = bundleState.sections.usage.cover;
    const rawUsageBullets = usageCover?.bullets ?? [];
    const legacyUsageBullets = sanitizeCoverBullets(
        rawUsageBullets,
        [
            'Use the product label first for dosing decisions.',
            'Scan the Directions panel to unlock more product-specific usage guidance.',
        ],
        3,
    ).map((line) => {
        if (line.isPlaceholder) return { text: line.text };
        const raw = rawUsageBullets.find((bullet) => bullet?.text?.trim() === line.text);
        return { text: formatTaggedText(line.text, raw?.basisTags) };
    });
    const legacyUsageRoutine = sanitizeCoverLine(
        usageCover?.bestTimeToTake?.text ?? usageCover?.dosage?.text ?? null,
        'Follow the package label directions for timing and dose.',
    );

    const safetyCover = bundleState.sections.safety.cover;
    const safetyPending = bundleState.sections.safety.dataStatus === 'pending';
    const safetyBullet0Raw = safetyCover?.bullets?.[0];
    const safetyBullet1Raw = safetyCover?.bullets?.[1];
    const legacySafetyWarningCoverText = sanitizeCoverLine(
        safetyBullet0Raw ? formatTaggedText(safetyBullet0Raw.text, safetyBullet0Raw.basisTags) : null,
        safetyPending
            ? 'Safety summary pending.'
            : 'Safety data is limited for this source. Consult your clinician for personal guidance.',
    );
    const legacySafetyTipCoverText = sanitizeCoverLine(
        safetyBullet1Raw ? formatTaggedText(safetyBullet1Raw.text, safetyBullet1Raw.basisTags) : null,
        safetyPending
            ? 'Safety tips pending.'
            : 'General reminder: check the label and consult a clinician if needed.',
    );
    const safetyBullet0Text = normalizeText(legacySafetyWarningCoverText);
    const safetyBullet1Text = normalizeText(legacySafetyTipCoverText);
    const showGeneralWatchOuts = !bundleState.sections.safety.detail?.warnings?.length && keyIngredientsForSafety.length > 0;
    const hasAnyProductSpecificSignal = useMemo(() => {
        for (const ingredientName of keyIngredientsForIngredients) {
            const key = normalizeIngredientNameForBackground(ingredientName);
            if (!key) continue;
            const insight = productSpecificInsightsByIngredient.get(key);
            if (!insight) continue;
            const hasForm =
                typeof insight.formLabel === 'string'
                && insight.formLabel.trim().length > 0
                && !isUnspecifiedFormSignal(insight.formKey, insight.reasonCode);
            const hasRbf = typeof insight.effectiveFactor === 'number' && Number.isFinite(insight.effectiveFactor);
            const hasDose =
                typeof insight.doseSignal?.status === 'string' &&
                insight.doseSignal.status.trim().length > 0 &&
                insight.doseSignal.status !== 'unknown';
            if (hasForm || hasRbf || hasDose) return true;
        }
        return false;
    }, [productSpecificInsightsByIngredient, keyIngredientsForIngredients]);
    const ingredientsNotes = hasAnyProductSpecificSignal
        ? undefined
        : ['Product-specific signals are limited for current evidence set.'];
    const sourceLockedScienceRows = useMemo(
        () =>
            (decisionScienceBlock?.ingredientRows ?? [])
                .map((row) => ({
                    name: String(row?.name ?? '').trim(),
                    dose: String(row?.dose ?? '').trim(),
                }))
                .filter((row) => row.name.length > 0 && !isNutritionLabelLikeIngredient(row.name)),
        [decisionScienceBlock?.ingredientRows],
    );
    const scienceIngredientsMerged = useMemo(() => {
        if (sourceLockedScienceRows.length > 0) {
            return mergeScienceIngredientCandidates({
                candidates: sourceLockedScienceRows.map((row) => ({
                    name: row.name,
                    dose: row.dose,
                    source: 'science_snapshot' as const,
                })),
                maxCoverItems: 3,
            });
        }

        const candidates = [
            ...(decisionScienceBlock?.ingredientSnapshotNames ?? [])
                .map((name) => ({
                    name: String(name ?? '').trim(),
                    dose: '',
                    source: 'science_snapshot' as const,
                }))
                .filter((row) => row.name.length > 0 && !isNutritionLabelLikeIngredient(row.name)),
            ...(decisionOverviewBlock?.providesVerified?.keyIngredients ?? [])
                .map((item) => ({
                    name: String(item?.name ?? '').trim(),
                    dose: String(item?.dose ?? '').trim(),
                    source: 'decision_overview' as const,
                }))
                .filter((row) => row.name.length > 0 && !isNutritionLabelLikeIngredient(row.name)),
            ...((ingredientsItemsFiltered.length > 0
                ? ingredientsItemsFiltered.map((row) => ({
                    name: row.name,
                    dose: row.dose ?? '',
                    source: 'ingredients_items' as const,
                }))
                : recordFacts.ingredientRows.map((row) => ({
                    name: row.name,
                    dose: row.doseLine ?? '',
                    source: 'record_facts' as const,
                }))).filter((row) => row.name.length > 0 && !isNutritionLabelLikeIngredient(row.name))),
        ];

        return mergeScienceIngredientCandidates({ candidates, maxCoverItems: 3 });
    }, [
        decisionOverviewBlock?.providesVerified?.keyIngredients,
        decisionScienceBlock?.ingredientSnapshotNames,
        ingredientsItemsFiltered,
        recordFacts.ingredientRows,
        sourceLockedScienceRows,
    ]);
    const scienceIngredientsAll = scienceIngredientsMerged.all;
    const scienceIngredientsTop3 = scienceIngredientsMerged.top3;
    const scienceIngredientsOverflowCount = scienceIngredientsMerged.overflowCount;
    const scienceIngredientBadgeLabel = resolveSimpleTaxonomyLabel('Verified', 'Verified');
    const coverIngredientCandidates = useMemo(
        () =>
            [
                ...((decisionOverviewBlock?.providesVerified?.keyIngredients ?? []).map((item) => ({
                    name: String(item?.name ?? '').trim(),
                    dose: String(item?.dose ?? '').trim(),
                }))),
                ...(scienceIngredientsTop3.map((item) => ({
                    name: String(item?.name ?? '').trim(),
                    dose: String(item?.dose ?? '').trim(),
                }))),
                ...(ingredientRowsForRanking.map((item) => ({
                    name: String(item?.name ?? '').trim(),
                    dose: String(item?.dose ?? '').trim(),
                }))),
            ]
                .filter((row) => row.name.length > 0 && !isNutritionLabelLikeIngredient(row.name))
                .filter((row, index, all) => {
                    const key = `${normalizeIngredientNameForBackground(row.name)}|${normalizeText(row.dose)}`;
                    return all.findIndex((candidate) => `${normalizeIngredientNameForBackground(candidate.name)}|${normalizeText(candidate.dose)}` === key) === index;
                }),
        [decisionOverviewBlock?.providesVerified?.keyIngredients, scienceIngredientsTop3, ingredientRowsForRanking],
    );
    const isOmegaLikeCover = useMemo(
        () =>
            /\b(omega[\s-]*3|fish oil|krill|epa|dha|pollock)\b/i.test(
                [productTitle, ...coverIngredientCandidates.map((row) => row.name)].join(' '),
            ),
        [coverIngredientCandidates, productTitle],
    );
    const omegaCoverSignals = useMemo(() => {
        const classify = (name: string): 'total' | 'epa' | 'dha' | 'fish' | null => {
            const normalized = normalizeText(name).toLowerCase();
            if (!normalized) return null;
            if (/total[^a-z0-9]*omega[\s-]*3|omega[\s-]*3[^a-z0-9]*total/.test(normalized)) return 'total';
            if (/\bepa\b|eicosapentaenoic/.test(normalized)) return 'epa';
            if (/\bdha\b|docosahexaenoic/.test(normalized)) return 'dha';
            if (/fish\s*oil|krill|pollock/.test(normalized)) return 'fish';
            return null;
        };
        const picked: Partial<Record<'total' | 'epa' | 'dha' | 'fish', { name: string; dose: string }>> = {};
        coverIngredientCandidates.forEach((row) => {
            const kind = classify(row.name);
            if (!kind) return;
            const next = { name: row.name, dose: normalizeText(row.dose) };
            const current = picked[kind];
            if (!current) {
                picked[kind] = next;
                return;
            }
            const currentHasDose = current.dose.length > 0;
            const nextHasDose = next.dose.length > 0;
            if (!currentHasDose && nextHasDose) {
                picked[kind] = next;
            }
        });
        return picked;
    }, [coverIngredientCandidates]);
    const overviewSummaryText = useMemo(() => {
        if (isOmegaLikeCover) {
            const title = normalizeText(productTitle).toLowerCase();
            const namesCombined = coverIngredientCandidates.map((row) => normalizeText(row.name).toLowerCase()).join(' ');
            const sourcePhrase = /pollock/.test(namesCombined)
                ? ' from wild Alaska pollock'
                : /krill/.test(namesCombined)
                    ? ' from krill'
                    : /fish\s*oil/.test(namesCombined)
                        ? ' from fish oil'
                        : '';
            if (/triple\s*strength/.test(title)) {
                return `Triple-strength omega-3 fish oil${sourcePhrase}.`;
            }
            return `Omega-3 fish oil${sourcePhrase} with disclosed active profile.`;
        }
        return legacyOverviewSummaryText;
    }, [coverIngredientCandidates, isOmegaLikeCover, legacyOverviewSummaryText, productTitle]);
    const overviewBullets = useMemo(() => {
        if (isOmegaLikeCover) {
            const bullets: string[] = [];
            const totalDose = normalizeText(omegaCoverSignals.total?.dose);
            const epaDose = normalizeText(omegaCoverSignals.epa?.dose);
            const dhaDose = normalizeText(omegaCoverSignals.dha?.dose);
            const fishDose = normalizeText(omegaCoverSignals.fish?.dose);
            if (totalDose) {
                bullets.push(`${totalDose} total omega-3 per serving.`);
            }
            if (epaDose && dhaDose) {
                bullets.push(`EPA ${epaDose} + DHA ${dhaDose} listed.`);
            } else if (epaDose) {
                bullets.push(`EPA ${epaDose} listed.`);
            } else if (dhaDose) {
                bullets.push(`DHA ${dhaDose} listed.`);
            }
            if (fishDose) {
                bullets.push(`Fish oil total: ${fishDose}.`);
            }
            if (bullets.length === 0) {
                bullets.push('Omega-3 actives are listed for product comparison.');
                bullets.push('Focus on total omega-3 and EPA/DHA values when comparing options.');
            }
            return bullets.slice(0, 2).map((text) => ({ text }));
        }
        const cleanedLegacy = legacyOverviewBullets
            .filter((item) => !/contains calories|total fat|scan the supplement facts panel|scan supplement facts/i.test(item.text))
            .slice(0, 2);
        if (cleanedLegacy.length > 0) return cleanedLegacy;
        return [
            { text: 'Key product facts are summarized from the verified record.' },
            { text: 'Open the card to review ingredient, usage, and safety details.' },
        ];
    }, [isOmegaLikeCover, legacyOverviewBullets, omegaCoverSignals.dha?.dose, omegaCoverSignals.epa?.dose, omegaCoverSignals.fish?.dose, omegaCoverSignals.total?.dose]);
    const ingredientMechanisms: Mechanism[] = useMemo(() => {
        if (isOmegaLikeCover) {
            const rows: Mechanism[] = [];
            const pushRow = (signal: { name: string; dose: string } | undefined, fill: number) => {
                if (!signal) return;
                rows.push({
                    name: signal.name,
                    amount: signal.dose || 'Amount not disclosed',
                    fill,
                    mode: signal.dose ? 'actual' : 'unknown',
                    showInfo: false,
                });
            };
            pushRow(omegaCoverSignals.total, 0.88);
            pushRow(omegaCoverSignals.epa, 0.85);
            pushRow(omegaCoverSignals.dha, 0.82);
            pushRow(omegaCoverSignals.fish, 0.78);
            if (rows.length > 0) return rows;
        }
        if (scienceIngredientsTop3.length > 0) {
            return scienceIngredientsTop3.map((item, index) => ({
                name: item.name,
                amount: item.dose || 'Amount not disclosed',
                fill: 0.8 - index * 0.06,
                mode: item.dose ? 'actual' : 'unknown',
                showInfo: false,
            }));
        }
        const cleanedLegacy = legacyIngredientMechanisms.filter((item) => !isNutritionLabelLikeIngredient(item?.name));
        if (cleanedLegacy.length > 0) return cleanedLegacy.slice(0, 3);
        return [
            {
                name: 'Active ingredient details are still loading',
                amount: 'Open this card for full ingredient breakdown.',
                fill: 0.45,
                mode: 'unknown',
                showInfo: false,
            },
        ];
    }, [isOmegaLikeCover, legacyIngredientMechanisms, omegaCoverSignals.dha, omegaCoverSignals.epa, omegaCoverSignals.fish, omegaCoverSignals.total, scienceIngredientsTop3]);
    const decisionDirectionsForCover = useMemo(
        () =>
            (decisionUsageBlock?.directions?.lines ?? [])
                .map((line) => humanizeUsageLine(line))
                .filter((line): line is string => Boolean(line))
                .filter((line) => !/^Source:/i.test(line)),
        [decisionUsageBlock?.directions?.lines],
    );
    const usageRoutine = useMemo(() => {
        const firstDirection = decisionDirectionsForCover.find((line) => /^Take\b/i.test(line))
            ?? decisionDirectionsForCover.find((line) => /\b(daily|once|twice|with food|per day)\b/i.test(line))
            ?? decisionDirectionsForCover[0];
        if (firstDirection) {
            return firstDirection;
        }
        if (/^anytime\s*\(with meals\)\.?$/i.test(legacyUsageRoutine) && decisionUsageBlock?.directions?.hasDirectionsTextVisible) {
            return 'Take this product with a meal at a consistent time each day.';
        }
        return legacyUsageRoutine;
    }, [decisionDirectionsForCover, decisionUsageBlock?.directions?.hasDirectionsTextVisible, legacyUsageRoutine]);
    const usageBullets = useMemo(() => {
        const bullets = [
            decisionUsageBlock?.timingTip ? ensurePeriod(decisionUsageBlock.timingTip) : null,
            decisionUsageBlock?.conservativeGuidance ? ensurePeriod(decisionUsageBlock.conservativeGuidance) : null,
        ].filter((line): line is string => Boolean(line));
        if (bullets.length > 0) return bullets.map((text) => ({ text }));
        return legacyUsageBullets;
    }, [decisionUsageBlock?.conservativeGuidance, decisionUsageBlock?.timingTip, legacyUsageBullets]);
    const safetyWarningCoverText = useMemo(() => {
        const warningLines = (decisionSafetyBlock?.labelWarnings ?? [])
            .map((line) => normalizeText(line))
            .filter(Boolean);
        const containsFishLine = warningLines.find((line) => /contains fish/i.test(line));
        const primary = containsFishLine ?? warningLines[0];
        if (primary) return ensurePeriod(primary);
        return legacySafetyWarningCoverText;
    }, [decisionSafetyBlock?.labelWarnings, legacySafetyWarningCoverText]);
    const safetyTipCoverText = useMemo(() => {
        const warningLines = (decisionSafetyBlock?.labelWarnings ?? [])
            .map((line) => normalizeText(line))
            .filter(Boolean);
        const consultLine = warningLines.find((line) =>
            /pregnan|nurs|blood thinner|surgery|medication|clinician|healthcare professional/i.test(line),
        );
        if (consultLine) return ensurePeriod(consultLine);
        const watchoutLine = (decisionSafetyBlock?.generalWatchouts ?? [])
            .map((line) => normalizeText(line))
            .find((line) => line.length > 0);
        if (watchoutLine) return ensurePeriod(watchoutLine);
        return legacySafetyTipCoverText;
    }, [decisionSafetyBlock?.generalWatchouts, decisionSafetyBlock?.labelWarnings, legacySafetyTipCoverText]);
    const safetyNotes = showGeneralWatchOuts
        ? ['No label-specific warnings detected; general watch-outs shown.']
        : undefined;
    const scienceTileFooterText =
        scienceIngredientsOverflowCount > 0
            ? `+${scienceIngredientsOverflowCount} more ingredients`
            : undefined;

    const overviewDataStatus = useMemo(() => {
        const missingReasons = new Set<MissingReason>();
        const hasSummary = normalizeText(overviewCover?.summary ?? null).length > 0;
        const hasBenefits = Array.isArray(overviewCover?.bullets)
            && overviewCover.bullets.some((bullet) => normalizeText(bullet?.text ?? null).length > 0);
        if (!hasSummary) missingReasons.add('MISSING_OVERVIEW_SUMMARY');
        if (!hasBenefits) missingReasons.add('MISSING_OVERVIEW_BENEFITS');

        return {
            ...buildBundleDataStatus(
                bundleState.sections.overview.dataStatus,
                bundleSourceType,
                bundleSourceTypeFinal,
                undefined,
                { supplementalLabelDataUsed: decisionOverlayUsed },
            ),
            missingReasons: Array.from(missingReasons),
        };
    }, [
        bundleState.sections.overview.dataStatus,
        bundleSourceType,
        bundleSourceTypeFinal,
        decisionOverlayUsed,
        overviewCover?.summary,
        overviewCover?.bullets,
    ]);

    const ingredientsDataStatus = useMemo(() => {
        const missingReasons = new Set<MissingReason>();
        const hasPrimary = ingredientsItems.length > 0;
        const hasDoseRange = ingredientsItems.some(
            (item) => typeof item?.dose === 'string' && item.dose.trim().length > 0
        );

        let hasEvidenceMapping = false;
        let hasFormQuality = false;
        for (const insight of productSpecificInsightsByIngredient.values()) {
            if (!insight) continue;
            const hasEvidenceSignal =
                (typeof insight.matchScore === 'number' && Number.isFinite(insight.matchScore))
                || (typeof insight.doseSignal?.status === 'string' && insight.doseSignal.status !== 'unknown');
            const hasFormSignal =
                typeof insight.formLabel === 'string'
                && insight.formLabel.trim().length > 0
                && !isUnspecifiedFormSignal(insight.formKey, insight.reasonCode);
            if (hasEvidenceSignal) hasEvidenceMapping = true;
            if (hasFormSignal) hasFormQuality = true;
            if (hasEvidenceMapping && hasFormQuality) break;
        }

        if (!hasPrimary) missingReasons.add('MISSING_PRIMARY_ACTIVE');
        if (!hasDoseRange) missingReasons.add('MISSING_DOSE_RANGE');
        if (!hasEvidenceMapping) missingReasons.add('MISSING_EVIDENCE_MAPPING');
        if (!hasFormQuality) missingReasons.add('MISSING_FORM_QUALITY');

        return {
            ...buildBundleDataStatus(
                bundleState.sections.ingredients.dataStatus,
                bundleSourceType,
                bundleSourceTypeFinal,
                ingredientsNotes,
                { supplementalLabelDataUsed: decisionOverlayUsed },
            ),
            missingReasons: Array.from(missingReasons),
        };
    }, [
        bundleState.sections.ingredients.dataStatus,
        bundleSourceType,
        bundleSourceTypeFinal,
        decisionOverlayUsed,
        ingredientsItems,
        productSpecificInsightsByIngredient,
        ingredientsNotes,
    ]);

    const usageDataStatus = useMemo(() => {
        const missingReasons = new Set<MissingReason>();
        const hasUsageGuidance =
            normalizeText(usageCover?.dosage?.text ?? null).length > 0
            || normalizeText(usageCover?.bestTimeToTake?.text ?? null).length > 0
            || normalizeText(bundleState.sections.usage.detail?.timingRationale?.text ?? null).length > 0;
        const hasBestFor = Array.isArray(usageCover?.bullets)
            && usageCover.bullets.some((bullet) => normalizeText(bullet?.text ?? null).length > 0);

        if (!hasUsageGuidance) missingReasons.add('MISSING_USAGE_GUIDANCE');
        if (!hasBestFor) missingReasons.add('MISSING_BEST_FOR');

        return {
            ...buildBundleDataStatus(
                bundleState.sections.usage.dataStatus,
                bundleSourceType,
                bundleSourceTypeFinal,
                undefined,
                { supplementalLabelDataUsed: decisionOverlayUsed },
            ),
            missingReasons: Array.from(missingReasons),
        };
    }, [
        bundleState.sections.usage.dataStatus,
        bundleState.sections.usage.detail?.timingRationale?.text,
        bundleSourceType,
        bundleSourceTypeFinal,
        decisionOverlayUsed,
        usageCover?.dosage?.text,
        usageCover?.bestTimeToTake?.text,
        usageCover?.bullets,
    ]);

    const safetyDataStatus = useMemo(() => {
        const missingReasons = new Set<MissingReason>();
        const hasWarning =
            Array.isArray(bundleState.sections.safety.detail?.warnings)
            && bundleState.sections.safety.detail.warnings.some(
                (warning) => normalizeText(warning?.text ?? null).length > 0
            );
        const hasSafetyTip =
            normalizeText(safetyCover?.bullets?.[1]?.text ?? null).length > 0 || showGeneralWatchOuts;

        if (!hasWarning) missingReasons.add('MISSING_SAFETY_WARNING');
        if (!hasSafetyTip) missingReasons.add('MISSING_SAFETY_TIP');

        return {
            ...buildBundleDataStatus(
                bundleState.sections.safety.dataStatus,
                bundleSourceType,
                bundleSourceTypeFinal,
                safetyNotes,
                { supplementalLabelDataUsed: decisionOverlayUsed },
            ),
            missingReasons: Array.from(missingReasons),
        };
    }, [
        bundleState.sections.safety.dataStatus,
        bundleState.sections.safety.detail?.warnings,
        bundleSourceType,
        bundleSourceTypeFinal,
        decisionOverlayUsed,
        safetyCover?.bullets,
        showGeneralWatchOuts,
        safetyNotes,
    ]);
    const unifiedOverviewDataStatus = useMemo(
        () => buildUnifiedTileDataStatus(overviewDataStatus, factsDtoState.data?.dataQuality),
        [overviewDataStatus, factsDtoState.data?.dataQuality],
    );
    const unifiedIngredientsDataStatus = useMemo(
        () => buildUnifiedTileDataStatus(ingredientsDataStatus, factsDtoState.data?.dataQuality),
        [ingredientsDataStatus, factsDtoState.data?.dataQuality],
    );
    const unifiedUsageDataStatus = useMemo(
        () => buildUnifiedTileDataStatus(usageDataStatus, factsDtoState.data?.dataQuality),
        [usageDataStatus, factsDtoState.data?.dataQuality],
    );
    const unifiedSafetyDataStatus = useMemo(
        () => buildUnifiedTileDataStatus(safetyDataStatus, factsDtoState.data?.dataQuality),
        [safetyDataStatus, factsDtoState.data?.dataQuality],
    );

    const fetchIngredientsDetail = useCallback(async () => {
        if (!ENABLE_LEGACY_SECTION_API) {
            return;
        }
        if (!isIngredientsDetailReady(bundleState)) {
            return;
        }
        const requestKey = buildIngredientsDetailRequestKey(bundleState);
        if (detailLoadingRef.current && detailInFlightKeyRef.current === requestKey) return;
        if (detailLoadingRef.current) return;
        const coverTotalCount =
            bundleState.sections.ingredients.cover?.totalCount ??
            bundleState.sections.ingredients.cover?.items?.length ??
            0;
        // If we don't have any actives, detail is not applicable and we must not hammer the API.
        if (coverTotalCount <= 0) {
            setDetailError('Ingredient list not available from this source. Scan the Supplement Facts panel for ingredient-level analysis.');
            setBundleState((prev) => {
                if (isBundleV4(prev)) {
                    return {
                        ...prev,
                        sections: {
                            ...prev.sections,
                            ingredients: {
                                ...prev.sections.ingredients,
                                dataStatus: 'not_provided',
                            },
                        },
                    };
                }
                return {
                    ...prev,
                    sections: {
                        ...prev.sections,
                        ingredients: {
                            ...prev.sections.ingredients,
                            dataStatus: 'not_provided',
                        },
                    },
                };
            });
            return;
        }
        detailLoadingRef.current = true;
        detailInFlightKeyRef.current = requestKey;
        setDetailLoading(true);
        setDetailError(null);
        // Align loading copy with dataStatus: only show "Generating..." when pending.
        // Treat "detail missing + fetch in-flight" as pending, even if cover facts are already complete.
        if (!bundleState.sections.ingredients.detail) {
            setBundleState((prev) => {
                if (isBundleV4(prev)) {
                    return {
                        ...prev,
                        sections: {
                            ...prev.sections,
                            ingredients: {
                                ...prev.sections.ingredients,
                                dataStatus: 'pending',
                            },
                        },
                    };
                }
                return {
                    ...prev,
                    sections: {
                        ...prev.sections,
                        ingredients: {
                            ...prev.sections.ingredients,
                            dataStatus: 'pending',
                        },
                    },
                };
            });
        }
        try {
            const rawBaseUrl = Config.searchApiBaseUrl;
            const API_URL = rawBaseUrl.endsWith('/') ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
            const headers = await withAuthHeaders({ 'Content-Type': 'application/json' });
            const body = {
                identity: bundleState.meta.authoritativeIdentity,
                section: 'ingredients_detail',
                locale: bundleState.meta.locale,
                promptVersion: bundleState.meta.promptVersion,
                factsDigestHash: bundleState.meta.factsDigestHash,
                limit: 8,
                cursor: 0,
            };
            const retryBackoffMs = [500, 1000, 2000];
            let attempt = 0;

            while (true) {
                const response = await fetch(`${API_URL}/api/analysis-section`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                });

                if (response.status === 202) {
                    const payload = await response.json().catch(() => null);
                    const retryMs = typeof (payload as any)?.retryAfterMs === 'number' ? (payload as any).retryAfterMs : 2000;
                    setDetailError(`Still generating. Try again in ~${Math.round(retryMs / 1000)}s.`);
                    setBundleState((prev) => {
                        if (isBundleV4(prev)) {
                            return {
                                ...prev,
                                sections: {
                                    ...prev.sections,
                                    ingredients: {
                                        ...prev.sections.ingredients,
                                        dataStatus: 'limited',
                                    },
                                },
                            };
                        }
                        return {
                            ...prev,
                            sections: {
                                ...prev.sections,
                                ingredients: {
                                    ...prev.sections.ingredients,
                                    dataStatus: 'limited',
                                },
                            },
                        };
                    });
                    return;
                }

                if (response.status === 429 && attempt < retryBackoffMs.length) {
                    const retryAfter = response.headers.get('retry-after');
                    const retryAfterSec = retryAfter ? Number.parseInt(retryAfter, 10) : NaN;
                    const delayMs = Number.isFinite(retryAfterSec)
                        ? Math.max(retryBackoffMs[attempt], retryAfterSec * 1000)
                        : retryBackoffMs[attempt];
                    setDetailError(`Too many requests, retrying… (${Math.round(delayMs / 1000)}s)`);
                    attempt += 1;
                    await waitMs(delayMs);
                    continue;
                }

                if (!response.ok) {
                    if (response.status === 429) {
                        setDetailError('Too many requests. Showing available data; try again shortly.');
                    } else {
                        setDetailError('Detail unavailable');
                    }
                    setBundleState((prev) => {
                        if (isBundleV4(prev)) {
                            return {
                                ...prev,
                                sections: {
                                    ...prev.sections,
                                    ingredients: {
                                        ...prev.sections.ingredients,
                                        dataStatus: 'limited',
                                    },
                                },
                            };
                        }
                        return {
                            ...prev,
                            sections: {
                                ...prev.sections,
                                ingredients: {
                                    ...prev.sections.ingredients,
                                    dataStatus: 'limited',
                                },
                            },
                        };
                    });
                    return;
                }

                const payload = await response.json();
                const detail = (payload?.detail ?? null) as IngredientsDetail | null;
                const nextStatusRaw = String(payload?.dataStatus ?? '').trim().toLowerCase();
                const retryAfterRaw = Number((payload as any)?.meta?.retryAfterMs ?? 0);
                const retryAfterMs = Number.isFinite(retryAfterRaw) ? Math.max(0, Math.round(retryAfterRaw)) : 0;
                if (nextStatusRaw === 'limited' && retryAfterMs > 0) {
                    const retrySec = Math.max(1, Math.round(retryAfterMs / 1000));
                    setDetailError(`Showing available data; retry in ~${retrySec}s.`);
                } else {
                    setDetailError(null);
                }
                setBundleState((prev) => {
                    const nextStatus = (payload?.dataStatus ?? prev.sections.ingredients.dataStatus) as DataStatus;
                    const nextDetail = detail ?? prev.sections.ingredients.detail ?? null;
                    if (isBundleV4(prev)) {
                        return {
                            ...prev,
                            sections: {
                                ...prev.sections,
                                ingredients: {
                                    ...prev.sections.ingredients,
                                    detail: nextDetail as IngredientsDetailV4 | null,
                                    dataStatus: nextStatus,
                                },
                            },
                        };
                    }
                    return {
                        ...prev,
                        sections: {
                            ...prev.sections,
                            ingredients: {
                                ...prev.sections.ingredients,
                                detail: nextDetail as IngredientsDetailV3 | null,
                                dataStatus: nextStatus,
                            },
                        },
                    };
                });
                return;
            }
        } catch {
            setDetailError('Detail unavailable');
            setBundleState((prev) => {
                if (isBundleV4(prev)) {
                    return {
                        ...prev,
                        sections: {
                            ...prev.sections,
                            ingredients: {
                                ...prev.sections.ingredients,
                                dataStatus: 'limited',
                            },
                        },
                    };
                }
                return {
                    ...prev,
                    sections: {
                        ...prev.sections,
                        ingredients: {
                            ...prev.sections.ingredients,
                            dataStatus: 'limited',
                        },
                    },
                };
            });
        } finally {
            if (detailInFlightKeyRef.current === requestKey) {
                detailInFlightKeyRef.current = null;
            }
            detailLoadingRef.current = false;
            setDetailLoading(false);
        }
    }, [bundleState]);

    const autoFetchKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (!ENABLE_LEGACY_SECTION_API) return;
        const coverTotalCount =
            bundleState.sections.ingredients.cover?.totalCount ??
            bundleState.sections.ingredients.cover?.items?.length ??
            0;
        const hasDetail = (bundleState.sections.ingredients.detail?.items?.length ?? 0) > 0;
        const status = bundleState.sections.ingredients.dataStatus;
        const isTerminal = status === 'not_provided' || status === 'limited' || status === 'error' || status === 'pending';

        const key = buildIngredientsDetailRequestKey(bundleState);
        if (autoFetchKeyRef.current && autoFetchKeyRef.current !== key) {
            autoFetchKeyRef.current = null;
        }
        if (selectedTileType !== 'science') {
            return;
        }
        if (autoFetchKeyRef.current === key) return;

        if (coverTotalCount > 0 && !hasDetail && !detailLoading && !isTerminal && isIngredientsDetailReady(bundleState)) {
            autoFetchKeyRef.current = key;
            fetchIngredientsDetail();
        }
    }, [selectedTileType, bundleState, detailLoading, fetchIngredientsDetail]);

    const overviewFacts = factsDtoState.data;
    const overviewGapNotes = buildGapActionSentences(overviewFacts?.dataQuality?.missingReasons, 'overview');
    const bundleSourceForTrust: 'lnhpd' | 'dsld' | 'web' | 'unknown' =
        bundleSourceType === 'lnhpd' || bundleSourceType === 'dsld' || bundleSourceType === 'web'
            ? bundleSourceType
            : 'unknown';
    const hasLabelScanEvidence =
        sourceType === 'label_scan' ||
        normalizeText(overviewFacts?.provenance?.sourceFiles?.pdf ?? null).length > 0;
    const hasSupplementalOverlayEvidence = decisionOverlayUsed;
    const decisionWarningLines = Array.isArray(decisionSafetyBlock?.labelWarnings) ? decisionSafetyBlock.labelWarnings : [];
    const hasDecisionProductWarnings = decisionWarningLines.some((line) => {
        const normalized = normalizeText(line);
        if (!normalized) return false;
        return !/not included in the official record|not available in this source/.test(normalized);
    });
    const directionsAvailableForDecision = Boolean(
        recordFacts.directionsPresent
        || decisionUsageBlock?.directions?.hasDirectionsTextVisible,
    );
    const warningsAvailableForDecision = Boolean(recordFacts.warningsPresent || hasDecisionProductWarnings);
    const verifiedFromBase =
        bundleSourceForTrust === 'lnhpd'
            ? 'Health Canada LNHPD (official record)'
            : bundleSourceForTrust === 'dsld'
                ? 'NIH DSLD (official record)'
                : bundleSourceForTrust === 'web'
                    ? 'Web evidence (unverified)'
                    : 'Available source records';
    const verifiedFromDisplay =
        [
            verifiedFromBase,
            hasLabelScanEvidence && bundleSourceForTrust !== 'web' ? 'label scan' : null,
            hasSupplementalOverlayEvidence ? 'supplemental product-page label data' : null,
        ]
            .filter((part): part is string => Boolean(part))
            .join(' + ');
    const isLnhpdSource = bundleSourceForTrust === 'lnhpd';
    const isDsldSource = bundleSourceForTrust === 'dsld';
    const retrievedOn =
        formatDateYmd(overviewFacts?.meta?.fetchedAt ?? null)
        ?? formatDateYmd((analysis as Record<string, any>)?.analysisMeta?.labelExtraction?.fetchedAt ?? null)
        ?? 'Unknown';
    const completenessChecks = [
        { label: 'active ingredients', ok: recordFacts.ingredientCount > 0 },
        { label: 'per-serving dose', ok: Boolean(recordFacts.perServingDoseLine) },
        { label: 'directions', ok: directionsAvailableForDecision },
        { label: 'label warnings', ok: warningsAvailableForDecision },
        { label: 'dosage form', ok: normalizeText(overviewFacts?.usage?.dosageForm ?? '').length > 0 },
        { label: 'serving size', ok: Boolean(recordFacts.servingSizeText) },
    ];
    const verifiedFieldCount = completenessChecks.filter((item) => item.ok).length;
    const verifiedFieldLabels = completenessChecks.filter((item) => item.ok).map((item) => item.label);
    const missingFieldLabels = completenessChecks.filter((item) => !item.ok).map((item) => item.label);
    const highImpactMissingLabels = missingFieldLabels.filter((label) => label === 'label warnings' || label === 'directions');
    const lowImpactMissingLabels = missingFieldLabels.filter((label) => !highImpactMissingLabels.includes(label));
    const trustLevel: 'High' | 'Medium' | 'Limited' =
        highImpactMissingLabels.length === 0 && verifiedFieldCount >= 5
            ? 'High'
            : highImpactMissingLabels.length <= 1 && verifiedFieldCount >= 3
                ? 'Medium'
                : 'Limited';
    const trustReason =
        highImpactMissingLabels.length > 0
            ? `${highImpactMissingLabels[0]} not captured in official record`
            : lowImpactMissingLabels.length > 0
                ? `${lowImpactMissingLabels[0]} missing in official record`
                : 'Core product fields are available';
    const trustVerifiedSummary = verifiedFieldLabels.length > 0
        ? `Verified: ${verifiedFieldLabels.slice(0, 3).join(', ')}`
        : 'Verified: core fields are limited';
    const trustMissingSummary = highImpactMissingLabels.length > 0
        ? `Missing: ${highImpactMissingLabels.join(', ')}`
        : lowImpactMissingLabels.length > 0
            ? `Missing: ${lowImpactMissingLabels[0]}`
            : 'Missing: no high-impact gaps detected';
    const officialRecordSourceId = normalizeText(overviewFacts?.meta?.sourceId ?? bundleState.meta.authoritativeIdentity?.value ?? '');
    const officialRecordUrl = buildOfficialRecordUrl(bundleSourceForTrust, officialRecordSourceId || null);
    const trustPanelSources: NonNullable<TileConfig['trustPanel']>['sources'] = [
        {
            tag: 'Product-specific',
            label: 'Official record',
            value:
                bundleSourceForTrust === 'lnhpd'
                    ? `LNHPD ${officialRecordSourceId || 'record'}`
                    : bundleSourceForTrust === 'dsld'
                        ? `DSLD ${officialRecordSourceId || 'record'}`
                        : 'Record unavailable',
            url: officialRecordUrl,
        },
        {
            tag: 'General reference',
            label: hasAnyOdsFoundationHit ? 'NIH ODS' : 'General science reference',
            value: hasAnyOdsFoundationHit
                ? `${recordFacts.topIngredient?.name ?? 'Ingredient'} fact sheet (general reference)`
                : 'No direct ODS ingredient match in current record context.',
            url: hasAnyOdsFoundationHit ? 'https://ods.od.nih.gov/factsheets/list-all/' : null,
        },
        {
            tag: 'User scan evidence',
            label: 'Label evidence',
            value: hasLabelScanEvidence ? `available (${retrievedOn})` : 'not provided',
            url: null,
        },
        {
            tag: 'Web evidence',
            label: 'Web evidence',
            value: bundleSourceForTrust === 'web' || hasSupplementalOverlayEvidence
                ? (hasSupplementalOverlayEvidence && bundleSourceForTrust !== 'web'
                    ? 'supplemental product-page label data used'
                    : 'used')
                : 'not used',
            url: null,
        },
    ];
    const sharedTrustPanel: NonNullable<TileConfig['trustPanel']> = {
        verifiedFrom: verifiedFromDisplay,
        retrievedOn,
        webEvidence: bundleSourceForTrust === 'web' || hasSupplementalOverlayEvidence ? 'used' : 'not used',
        trustLevel,
        verifiedSummary: trustVerifiedSummary,
        missingSummary: trustMissingSummary,
        reason: trustReason,
        sources: trustPanelSources,
    };
    const decisionProvides = decisionOverviewBlock?.providesVerified;
    const decisionMissingLines = (decisionOverviewBlock?.missingInfo ?? [])
        .map((line) => (typeof line === 'string' ? line.trim() : ''))
        .filter((line) => line.length > 0)
        .slice(0, 2);
    const unresolvedMissingLines = decisionMissingLines.length > 0
        ? decisionMissingLines
        : highImpactMissingLabels.length > 0
            ? [`Missing: ${highImpactMissingLabels.join(', ')}.`]
            : [];
    const warningsMissing = unresolvedMissingLines.some((line) => /warning/i.test(line));
    const missingInfoCtaLabel = decisionOverviewBlock?.singleCta?.label || 'Scan Supplement Facts + Warnings panel';
    const missingInfoScanPrompt = `Next step: ${missingInfoCtaLabel}.`;
    const overviewAiDigest =
        decisionTemplatePayload
            ? normalizeText(decisionTemplatePayload?.digest ?? bundleState.meta.factsDigestHash ?? null) || null
            : null;
    const overviewPrimaryScienceRow = scienceIngredientsAll[0] ?? null;
    const overviewPrimaryIngredientLabel = useMemo(() => {
        if (!overviewPrimaryScienceRow) return null;
        const baseName = normalizeText(overviewPrimaryScienceRow.baseName || overviewPrimaryScienceRow.name);
        if (!baseName) return null;
        if (scienceIngredientsAll.length > 1 && /\b(blend|complex|matrix|formula|proprietary)\b/i.test(baseName)) {
            return 'Multi-ingredient formula';
        }
        return baseName;
    }, [overviewPrimaryScienceRow, scienceIngredientsAll]);
    const overviewServingUnitSingular = useMemo(
        () => singularizeServingUnit(decisionProvides?.servingSize ?? decisionProvides?.dosageForm ?? null),
        [decisionProvides?.dosageForm, decisionProvides?.servingSize],
    );
    const overviewServingUnitPlural = useMemo(
        () => pluralizeServingUnit(decisionProvides?.servingSize ?? decisionProvides?.dosageForm ?? null),
        [decisionProvides?.dosageForm, decisionProvides?.servingSize],
    );
    const overviewProductType = useMemo(
        () => deriveProductTypeLabel({ productTitle, primaryIngredient: overviewPrimaryIngredientLabel }),
        [overviewPrimaryIngredientLabel, productTitle],
    );
    const overviewStrengthClaim = useMemo(() => extractStrengthClaim(productTitle), [productTitle]);
    const overviewServingStrength = useMemo(() => {
        if (!overviewPrimaryScienceRow?.dose) return null;
        if (!overviewPrimaryIngredientLabel || overviewPrimaryIngredientLabel === 'Multi-ingredient formula') return null;
        if (overviewServingUnitSingular) return `${overviewPrimaryScienceRow.dose} per ${overviewServingUnitSingular.toLowerCase()}`;
        return `${overviewPrimaryScienceRow.dose} per serving`;
    }, [overviewPrimaryIngredientLabel, overviewPrimaryScienceRow?.dose, overviewServingUnitSingular]);
    const overviewFormValue = useMemo(() => {
        const plural = normalizeText(overviewServingUnitPlural);
        if (plural) return toTitleCaseWords(plural);
        const dosageForm = normalizeText(decisionProvides?.dosageForm ?? null);
        return dosageForm ? toTitleCaseWords(pluralizeServingUnit(dosageForm) ?? dosageForm) : null;
    }, [decisionProvides?.dosageForm, overviewServingUnitPlural]);
    const overviewCountValue = useMemo(() => {
        const servings = decisionProvides?.servingsPerContainer;
        if (typeof servings !== 'number') return null;
        const pluralUnit = normalizeText(overviewServingUnitPlural);
        if (pluralUnit) return `${servings} ${pluralUnit.toLowerCase()}`;
        return `${servings} servings`;
    }, [decisionProvides?.servingsPerContainer, overviewServingUnitPlural]);
    const overviewSourceContextHint = useMemo(() => {
        if (!overviewPrimaryScienceRow?.formValue) return null;
        return /\(From\b/i.test(overviewPrimaryScienceRow.name) ? overviewPrimaryScienceRow.formValue : null;
    }, [overviewPrimaryScienceRow?.formValue, overviewPrimaryScienceRow?.name]);
    const overviewChemicalFormHint = useMemo(() => {
        if (!overviewPrimaryScienceRow?.formValue) return null;
        return /\(As\b/i.test(overviewPrimaryScienceRow.name) ? overviewPrimaryScienceRow.formValue : null;
    }, [overviewPrimaryScienceRow?.formValue, overviewPrimaryScienceRow?.name]);
    const overviewKeyProductFactsRows = useMemo(
        () =>
            [
                { label: 'Product type', value: overviewProductType },
                { label: 'Primary ingredient', value: overviewPrimaryIngredientLabel },
                { label: 'Strength claim', value: overviewStrengthClaim },
                { label: 'Form', value: overviewFormValue },
                { label: 'Count', value: overviewCountValue },
            ].filter(
                (row): row is { label: string; value: string } =>
                    typeof row.value === 'string' && normalizeText(row.value).length > 0,
            ),
        [
            overviewCountValue,
            overviewFormValue,
            overviewPrimaryIngredientLabel,
            overviewProductType,
            overviewServingStrength,
            overviewStrengthClaim,
        ],
    );
    const authoritativeTilePayloadReady = useMemo(
        () => hasRenderableDecisionTemplate(decisionTemplatePayload as Record<string, unknown> | null | undefined),
        [decisionTemplatePayload],
    );
    const authoritativeScienceTileMechanisms = useMemo<Mechanism[]>(() => {
        if (!authoritativeTilePayloadReady) {
            const fallbackMechanisms = ingredientMechanisms.filter((item) => normalizeText(item?.name ?? null).length > 0);
            if (fallbackMechanisms.length > 0) {
                return fallbackMechanisms;
            }
            if (decisionTemplateUnavailable) {
                return [
                    {
                        name: 'Verified ingredient details unavailable',
                        amount: 'Retry scan',
                        fill: 0.35,
                        mode: 'unknown',
                        showInfo: false,
                    },
                    {
                        name: 'Per-serving ingredient facts request was interrupted',
                        amount: 'Try again',
                        fill: 0.3,
                        mode: 'unknown',
                        showInfo: false,
                    },
                ];
            }
            return [
                {
                    name: 'Verified ingredient details loading',
                    amount: 'Please wait',
                    fill: 0.42,
                    mode: 'unknown',
                    showInfo: false,
                },
                {
                    name: 'Latest per-serving amounts',
                    amount: 'Preparing facts',
                    fill: 0.38,
                    mode: 'unknown',
                    showInfo: false,
                },
            ];
        }
        const rows = (decisionScienceBlock?.ingredientRows ?? [])
            .map((row, index) => ({
                name: normalizeText(row?.name ?? ''),
                amount: normalizeText(row?.dose ?? '') || 'Dose not disclosed',
                fill: 0.8 - index * 0.06,
                mode: normalizeText(row?.dose ?? '') ? 'actual' as const : 'unknown' as const,
                showInfo: false,
            }))
            .filter((row) => row.name.length > 0)
            .slice(0, 3);
        if (rows.length > 0) return rows;
        return [
            {
                name: 'Verified ingredient details are limited',
                amount: 'Open the card for the latest product facts',
                fill: 0.38,
                mode: 'unknown',
                showInfo: false,
            },
        ];
    }, [
        authoritativeTilePayloadReady,
        decisionScienceBlock?.ingredientRows,
        decisionTemplateUnavailable,
        ingredientMechanisms,
    ]);
    const productOverviewAiRequestPayload = useMemo<ProductOverviewAiRequestPayload | null>(() => {
        if (!overviewAiDigest) return null;
        const normalizedProductName = normalizeText(overviewFacts?.product?.name ?? productTitle);
        if (!normalizedProductName) return null;
        return {
            digest: overviewAiDigest,
            productName: normalizedProductName,
            brandName: normalizeText(overviewFacts?.product?.brand ?? brandForSubtitle) || null,
            productTypeHint: overviewProductType,
            primaryIngredient: overviewPrimaryIngredientLabel,
            keyIngredients: scienceIngredientsAll.slice(0, 4).map((row) => ({
                name: row.baseName || row.name,
                dose: row.dose ?? null,
            })),
            sourceContextHint: overviewSourceContextHint,
            chemicalFormHint: overviewChemicalFormHint,
            strengthClaim: overviewStrengthClaim,
            servingStrength: overviewServingStrength,
            form: overviewFormValue,
            count: overviewCountValue,
            isLikelySingleIngredient:
                Boolean(overviewPrimaryIngredientLabel)
                && overviewPrimaryIngredientLabel !== 'Multi-ingredient formula'
                && scienceIngredientsAll.length <= 1,
        };
    }, [
        brandForSubtitle,
        overviewAiDigest,
        overviewChemicalFormHint,
        overviewCountValue,
        overviewFacts?.product?.brand,
        overviewFacts?.product?.name,
        overviewFormValue,
        overviewPrimaryIngredientLabel,
        overviewProductType,
        overviewServingStrength,
        overviewSourceContextHint,
        overviewStrengthClaim,
        productTitle,
        scienceIngredientsAll,
    ]);
    const overviewAiRequestFingerprint = useMemo(
        () => (productOverviewAiRequestPayload ? JSON.stringify(productOverviewAiRequestPayload) : null),
        [productOverviewAiRequestPayload],
    );
    const overviewAiFallback = useMemo(
        () => (productOverviewAiRequestPayload ? buildProductOverviewFallbackClient(productOverviewAiRequestPayload) : null),
        [productOverviewAiRequestPayload],
    );
    const overviewAiClientFallback = useMemo(
        () => (overviewAiFallback ? { ...overviewAiFallback, promptVersion: 'client-fallback' as const } : null),
        [overviewAiFallback],
    );
    const canRequestOverviewAi = Boolean(
        overviewAiDigest
        && overviewAiRequestFingerprint
        && decisionTemplatePayload
        && typeof decisionTemplatePayload === 'object',
    );
    const currentOverviewAiState =
        overviewAiDigest && productOverviewAiByDigest[overviewAiDigest]
            ? productOverviewAiByDigest[overviewAiDigest]
            : undefined;
    const currentOverviewAiStatus = currentOverviewAiState?.status ?? 'idle';
    const currentOverviewAiMatchesFingerprint = Boolean(
        overviewAiRequestFingerprint
        && currentOverviewAiState?.fingerprint === overviewAiRequestFingerprint,
    );
    const buildOverviewAiFallbackState = useCallback(
        (error: string): ProductOverviewAiState => {
            if (overviewAiClientFallback) {
                return {
                    status: 'ok',
                    fingerprint: overviewAiRequestFingerprint ?? undefined,
                    data: overviewAiClientFallback,
                    error,
                    source: 'client-fallback',
                    fallbackUsed: true,
                    startedAt: undefined,
                };
            }
            return {
                status: 'unavailable',
                fingerprint: overviewAiRequestFingerprint ?? undefined,
                error,
                startedAt: undefined,
            };
        },
        [overviewAiClientFallback, overviewAiRequestFingerprint],
    );
    const buildOverviewAiLoadingState = useCallback(
        (): ProductOverviewAiState => ({
            status: 'loading',
            fingerprint: overviewAiRequestFingerprint ?? undefined,
            data: overviewAiClientFallback ?? undefined,
            source: overviewAiClientFallback ? 'client-fallback' : undefined,
            fallbackUsed: Boolean(overviewAiClientFallback),
            startedAt: Date.now(),
        }),
        [overviewAiClientFallback, overviewAiRequestFingerprint],
    );
    const overviewAiDisplayData = currentOverviewAiState?.data ?? overviewAiClientFallback ?? null;
    const overviewAiApiDisplayData = useMemo<ProductOverviewAiPayload | null>(() => {
        if (!currentOverviewAiState || currentOverviewAiState.status !== 'ok') return null;
        if (currentOverviewAiState.source !== 'api') return null;
        if (!currentOverviewAiMatchesFingerprint) return null;
        return currentOverviewAiState.data ?? null;
    }, [currentOverviewAiMatchesFingerprint, currentOverviewAiState]);
    const overviewAiParagraphOne = overviewAiDisplayData
        ? [toSentence(overviewAiDisplayData.lead), toSentence(overviewAiDisplayData.whatItIs)]
            .filter((line): line is string => Boolean(line))
            .join(' ')
        : null;
    const overviewAiParagraphTwo = overviewAiDisplayData
        ? toSentence(overviewAiDisplayData.whyPeopleTakeIt)
        : null;
    const overviewAiHasRenderableContent = Boolean(overviewAiParagraphOne || overviewAiParagraphTwo);
    const overviewAiCoverSummaryText = useMemo(() => {
        const lead = toSentence(overviewAiApiDisplayData?.lead);
        const whatItIs = toSentence(overviewAiApiDisplayData?.whatItIs);
        const preferred = clampText(lead, 110);
        if (preferred) return capitalizeSentences(preferred);
        const combined = clampText([lead, whatItIs].filter(Boolean).join(' '), 110);
        return combined ? capitalizeSentences(combined) : null;
    }, [overviewAiApiDisplayData?.lead, overviewAiApiDisplayData?.whatItIs]);
    const overviewAiCoverBullets = useMemo<BulletItem[]>(() => {
        if (!overviewAiApiDisplayData) return [];
        const lines = [
            clampText(toSentence(overviewAiApiDisplayData.whatItIs), 108),
            clampText(toSentence(overviewAiApiDisplayData.whyPeopleTakeIt), 108),
        ]
            .map((line) => capitalizeSentences(line))
            .filter((line): line is string => Boolean(line))
            .filter((line) => line.toLowerCase() !== overviewAiCoverSummaryText?.toLowerCase())
            .filter((line, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === line.toLowerCase()) === index);
        return lines.slice(0, 2).map((text) => ({ text }));
    }, [overviewAiApiDisplayData, overviewAiCoverSummaryText]);
    const overviewMissingInfoLines = enforceNeverBlank({
        lines: [
            unresolvedMissingLines.length > 0 ? 'Some high-impact record details are missing.' : 'Core high-impact details are present.',
            ...unresolvedMissingLines,
            warningsMissing ? 'Impact: Safety uses general guidance only.' : null,
            ...(isDataCeiling ? [dataCeilingReasonNote] : []),
            ...overviewGapNotes.slice(0, 1),
            unresolvedMissingLines.length > 0 ? missingInfoScanPrompt : null,
        ],
        fallback: [
            'Some expected fields are missing in this source record.',
        ],
    });
    const authoritativeOverviewTileSummary = useMemo<CoverLine>(() => {
        if (!authoritativeTilePayloadReady) {
            const fallbackSummary = normalizeText(overviewSummaryText);
            if (fallbackSummary) {
                return {
                    text: fallbackSummary,
                };
            }
            if (decisionTemplateUnavailable) {
                return {
                    text: 'Verified product details are temporarily unavailable.',
                };
            }
            return {
                text: 'Latest verified product details are loading.',
                isPlaceholder: true,
            };
        }
        if (overviewAiCoverSummaryText) {
            return {
                text: overviewAiCoverSummaryText,
            };
        }
        if (canRequestOverviewAi && (currentOverviewAiStatus === 'idle' || currentOverviewAiStatus === 'loading')) {
            return {
                text: 'Preparing verified product overview...',
                isPlaceholder: true,
            };
        }
        if (overviewProductType && overviewPrimaryIngredientLabel) {
            if (overviewPrimaryIngredientLabel === 'Multi-ingredient formula') {
                return {
                    text: `${overviewProductType} with multiple disclosed active components.`,
                };
            }
            return {
                text: `${overviewProductType} featuring ${overviewPrimaryIngredientLabel}.`,
            };
        }
        if (overviewProductType) {
            return {
                text: `${overviewProductType} with verified product details.`,
            };
        }
        if (overviewPrimaryIngredientLabel) {
            return {
                text: `${overviewPrimaryIngredientLabel} with verified product details.`,
            };
        }
        return {
            text: 'Verified product details are ready to review.',
        };
    }, [
        authoritativeTilePayloadReady,
        canRequestOverviewAi,
        currentOverviewAiStatus,
        decisionTemplateUnavailable,
        overviewAiCoverSummaryText,
        overviewPrimaryIngredientLabel,
        overviewProductType,
        overviewSummaryText,
    ]);
    const authoritativeOverviewTileBullets = useMemo<BulletItem[]>(() => {
        if (!authoritativeTilePayloadReady) {
            const fallbackBullets = overviewBullets.filter((item) => normalizeText(item?.text ?? null).length > 0);
            if (fallbackBullets.length > 0) {
                return fallbackBullets;
            }
            if (decisionTemplateUnavailable) {
                return [
                    {
                        text: 'The verified details request was interrupted.',
                    },
                    {
                        text: 'Go back and rescan to reload the latest product facts.',
                    },
                ];
            }
            return [
                {
                    text: 'Loading verified product facts.',
                    isPlaceholder: true,
                },
                {
                    text: 'Open the card to review the latest details.',
                    isPlaceholder: true,
                },
            ];
        }
        if (overviewAiCoverBullets.length > 0) {
            return overviewAiCoverBullets;
        }
        const bullets: BulletItem[] = [];
        if (overviewPrimaryIngredientLabel) {
            bullets.push({ text: `Primary ingredient: ${overviewPrimaryIngredientLabel}.` });
        }
        if (overviewStrengthClaim) {
            bullets.push({ text: `Strength claim: ${overviewStrengthClaim}.` });
        }
        if (overviewFormValue) {
            bullets.push({ text: `Form: ${overviewFormValue}.` });
        }
        if (overviewCountValue) {
            bullets.push({ text: `Count: ${overviewCountValue}.` });
        }
        if (bullets.length === 0) {
            bullets.push({ text: 'Verified product facts are ready to review.' });
        }
        return bullets.slice(0, 2);
    }, [
        authoritativeTilePayloadReady,
        decisionTemplateUnavailable,
        overviewAiCoverBullets,
        overviewBullets,
        overviewCountValue,
        overviewFormValue,
        overviewPrimaryIngredientLabel,
        overviewStrengthClaim,
    ]);

    useEffect(() => {
        if (!overviewAiDigest || !overviewAiRequestFingerprint || !canRequestOverviewAi) return;
        const currentOverviewAi = productOverviewAiStateRef.current[overviewAiDigest];
        const currentOverviewAiMatchesRequestedFingerprint =
            currentOverviewAi?.fingerprint === overviewAiRequestFingerprint;
        if (
            currentOverviewAiMatchesRequestedFingerprint
            && (
                currentOverviewAi?.status === 'loading'
                || currentOverviewAi?.status === 'ok'
                || currentOverviewAi?.status === 'unavailable'
                || currentOverviewAi?.status === 'error'
            )
        ) {
            return;
        }

        let cancelled = false;
        let timedOut = false;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, PRODUCT_OVERVIEW_AI_TIMEOUT_MS);
        setProductOverviewAiState(overviewAiDigest, buildOverviewAiLoadingState());
        const interactionTask = InteractionManager.runAfterInteractions(() => {
            void run();
        });

        const run = async () => {
            try {
                const baseUrl = String(Config.searchApiBaseUrl).replace(/\/$/, '');
                const headers = await withAuthHeaders({
                    'Content-Type': 'application/json',
                });
                if (cancelled) return;
                const res = await fetch(`${baseUrl}/api/product-overview-ai/v1`, {
                    method: 'POST',
                    headers,
                    body: overviewAiRequestFingerprint,
                    signal: controller.signal,
                });

                if (cancelled) return;

                if (!res.ok) {
                    setProductOverviewAiState(overviewAiDigest, buildOverviewAiFallbackState(`HTTP ${res.status}`));
                    return;
                }

                const payload = await res.json();
                if (cancelled) return;
                if (normalizeText(payload?.digest ?? null) !== overviewAiDigest) {
                    setProductOverviewAiState(overviewAiDigest, buildOverviewAiFallbackState('overview_ai_digest_mismatch'));
                    return;
                }

                if (
                    payload?.status === 'ok'
                    && payload?.overviewAi
                    && typeof payload.overviewAi === 'object'
                ) {
                    setProductOverviewAiState(overviewAiDigest, {
                        status: 'ok',
                        fingerprint: overviewAiRequestFingerprint,
                        data: {
                            mode: payload.overviewAi.mode === 'rich' ? 'rich' : 'short',
                            lead: String(payload.overviewAi.lead ?? '').trim(),
                            whatItIs: String(payload.overviewAi.whatItIs ?? '').trim(),
                            whyPeopleTakeIt: String(payload.overviewAi.whyPeopleTakeIt ?? '').trim(),
                            promptVersion: typeof payload.promptVersion === 'string' ? payload.promptVersion : undefined,
                        },
                        source: payload?.fallbackUsed ? 'client-fallback' : 'api',
                        fallbackUsed: Boolean(payload?.fallbackUsed),
                        startedAt: undefined,
                    });
                    return;
                }

                setProductOverviewAiState(
                    overviewAiDigest,
                    buildOverviewAiFallbackState(typeof payload?.reason === 'string' ? payload.reason : 'AI summary fallback'),
                );
            } catch (error) {
                if (cancelled) return;
                if (error instanceof Error && error.name === 'AbortError' && !timedOut) {
                    return;
                }
                setProductOverviewAiState(
                    overviewAiDigest,
                    buildOverviewAiFallbackState(
                        timedOut
                            ? 'overview_ai_timeout'
                            : error instanceof Error
                                ? error.message
                                : 'AI summary fallback',
                    ),
                );
            } finally {
                clearTimeout(timeoutId);
            }
        };

        const watchdogId = setTimeout(() => {
            setProductOverviewAiState(overviewAiDigest, (current) => {
                if (
                    !current
                    || current.status !== 'loading'
                    || current.fingerprint !== overviewAiRequestFingerprint
                ) {
                    return current;
                }
                return buildOverviewAiFallbackState('overview_ai_watchdog_timeout');
            });
        }, PRODUCT_OVERVIEW_AI_WATCHDOG_MS);

        return () => {
            cancelled = true;
            interactionTask.cancel();
            controller.abort();
            clearTimeout(timeoutId);
            clearTimeout(watchdogId);
            setProductOverviewAiState(overviewAiDigest, (current) => {
                if (
                    !current
                    || current.status !== 'loading'
                    || current.fingerprint !== overviewAiRequestFingerprint
                ) {
                    return current;
                }
                if (current.data) {
                    return {
                        ...current,
                        status: 'ok',
                        startedAt: undefined,
                    };
                }
                return {
                    status: 'idle',
                    fingerprint: overviewAiRequestFingerprint,
                };
            });
        };
    }, [
        buildOverviewAiFallbackState,
        buildOverviewAiLoadingState,
        canRequestOverviewAi,
        overviewAiDigest,
        overviewAiRequestFingerprint,
        setProductOverviewAiState,
    ]);

    const shouldShowOverviewAiLoading =
        canRequestOverviewAi
        && !overviewAiHasRenderableContent
        && (
            currentOverviewAiStatus === 'idle'
            || (currentOverviewAiStatus === 'loading' && currentOverviewAiMatchesFingerprint)
        );

    const overviewContent = (
        <View style={styles.detailStack}>
            <GlassCard
                title="What is it?"
                subtitle="Based on product name + main ingredients"
                accentColor="#2563EB"
                right={<GlassPill label={resolveSimpleTaxonomyLabel('AI summary')} />}
            >
                {shouldShowOverviewAiLoading ? (
                    <View style={styles.inlineLoadingRow}>
                        <ActivityIndicator />
                        <Text style={styles.inlineLoadingText}>AI generating</Text>
                    </View>
                ) : overviewAiHasRenderableContent ? (
                    <View style={{ gap: 12 }}>
                        {overviewAiParagraphOne ? (
                            <Text style={styles.detailNarrativeText}>{overviewAiParagraphOne}</Text>
                        ) : null}
                        {overviewAiParagraphTwo ? (
                            <Text style={styles.detailNarrativeText}>{overviewAiParagraphTwo}</Text>
                        ) : null}
                    </View>
                ) : (
                    <View style={styles.emptyStateBox}>
                        <Text style={styles.emptyStateTitle}>AI summary unavailable</Text>
                        <Text style={styles.emptyStateText}>Current factual details remain available below.</Text>
                    </View>
                )}
            </GlassCard>

            <GlassCard title="Key Product Facts" subtitle="Structured product facts" accentColor="#2563EB">
                {overviewKeyProductFactsRows.length > 0 ? (
                    <View style={styles.kvGrid}>
                        {overviewKeyProductFactsRows.map((row) => (
                            <View key={`ov-fact-${row.label}`} style={styles.kvRow}>
                                <Text style={styles.kvLabel}>{row.label}</Text>
                                <Text style={styles.kvValue}>{row.value}</Text>
                            </View>
                        ))}
                    </View>
                ) : (
                    <Text style={styles.detailPlaceholderText}>Key facts are limited in the current record.</Text>
                )}
            </GlassCard>

            <GlassCard title="Missing info" subtitle="One place for gaps and next step" accentColor="#2563EB">
                <View style={{ gap: 10 }}>
                    {overviewMissingInfoLines.map((line, idx) => (
                        <Text key={`ov-qual-${idx}`} style={styles.detailBodyText}>
                            {line}
                        </Text>
                    ))}
                    {isSingleCtaAllowed('overview') && unresolvedMissingLines.length > 0 ? (
                        <Pressable
                            style={styles.missingInfoCtaButton}
                            onPress={() =>
                                emitScanUxMetric('scan_missing_info_cta_clicked', {
                                    viewMode: SCAN_UX_VIEW_MODE,
                                    variant: SCAN_UX_VARIANT,
                                    sheetType: 'overview',
                                    sourceType: bundleSourceForTrust,
                                    sourceTypeFinal: bundleSourceTypeFinal,
                                    missingFields: unresolvedMissingLines,
                                    dwellMs: 0,
                                    maxScrollRatio: 0,
                                    summaryVersion: null,
                                    guardApplied: null,
                                    fallbackUsed: null,
                                })
                            }
                            accessibilityRole="button"
                            accessibilityLabel={missingInfoCtaLabel}
                        >
                            <Text style={styles.missingInfoCtaButtonText}>{missingInfoCtaLabel}</Text>
                        </Pressable>
                    ) : null}
                </View>
            </GlassCard>
        </View>
    );

    const decisionBarcodeForScience = useMemo(
        () =>
            normalizeBarcodeForDecision(analysisBarcodeDigits)
            ?? normalizeBarcodeForDecision(String(bundleState.meta.authoritativeIdentity?.value ?? ''))
            ?? null,
        [analysisBarcodeDigits, bundleState.meta.authoritativeIdentity?.value],
    );
    const decisionDigestForScience = normalizeText(decisionTemplatePayload?.digest ?? '') || null;
    const scienceSourceFinalKey = bundleSourceTypeFinal ? 'final' : 'nonfinal';
    const decisionScienceIngredientRows = useMemo<ScienceSidecarIngredientRow[]>(
        () =>
            (decisionScienceBlock?.ingredientRows ?? [])
                .map((row) => ({
                    key: normalizeIngredientNameForBackground(row?.name),
                    name: normalizeText(row?.name ?? ''),
                    dose: normalizeText(row?.dose ?? '') || null,
                }))
                .filter((row) => row.key.length > 0 && row.name.length > 0 && !isNutritionLabelLikeIngredient(row.name)),
        [decisionScienceBlock?.ingredientRows],
    );
    const scientificBackgroundIngredientRows = useMemo(
        () => {
            const researchRows = pickResearchModeScienceRows(decisionScienceIngredientRows);
            return researchRows.length > 0 ? researchRows : decisionScienceIngredientRows;
        },
        [decisionScienceIngredientRows],
    );
    const keyIngredientsForDetail = useMemo(
        () => scientificBackgroundIngredientRows.map((row) => row.name),
        [scientificBackgroundIngredientRows],
    );
    const [activeIngredientName, setActiveIngredientName] = useState<string | null>(
        keyIngredientsForDetail[0] ?? null
    );
    const showIngredientSelector = keyIngredientsForDetail.length > 1;

    useEffect(() => {
        const listKeys = keyIngredientsForDetail.map((name) => normalizeIngredientNameForBackground(name));
        const activeKey = activeIngredientName ? normalizeIngredientNameForBackground(activeIngredientName) : null;
        if (!activeKey || !listKeys.includes(activeKey)) {
            setActiveIngredientName(keyIngredientsForDetail[0] ?? null);
        }
    }, [keyIngredientsForDetail, activeIngredientName]);

    const activeIngredientKey = activeIngredientName ? normalizeIngredientNameForBackground(activeIngredientName) : null;
    const activeScienceIngredientRow = useMemo(
        () =>
            scientificBackgroundIngredientRows.find((row) => row.key === activeIngredientKey)
            ?? scientificBackgroundIngredientRows[0]
            ?? null,
        [activeIngredientKey, scientificBackgroundIngredientRows],
    );
    const activeIngredientLabelLine = useMemo(() => {
        const selectedName = activeScienceIngredientRow?.name
            ? capitalizeSentences(activeScienceIngredientRow.name)
            : (isDataCeiling ? 'Ingredients unavailable in this record' : 'No ingredient selected');
        if (activeScienceIngredientRow?.dose) {
            return `${selectedName} • ${activeScienceIngredientRow.dose}`;
        }
        return `${selectedName} • ${isDataCeiling ? 'Scan Supplement Facts to continue' : 'Dose not disclosed on label'}`;
    }, [activeScienceIngredientRow?.dose, activeScienceIngredientRow?.name, isDataCeiling]);
    const chemicalFormDisplayText = normalizeText(decisionScienceBlock?.formMatters?.ingredientChemicalForm ?? '') || null;
    const deliveryTypeDisplayText = normalizeText(decisionScienceBlock?.formMatters?.dosageForm ?? '') || null;

    const ingredientOverviewRequestKey = useMemo(
        () =>
            decisionBarcodeForScience && decisionDigestForScience
                ? ['ingredient_overview', decisionBarcodeForScience, decisionDigestForScience, scienceSourceFinalKey].join('|')
                : null,
        [decisionBarcodeForScience, decisionDigestForScience, scienceSourceFinalKey],
    );
    const scientificBackgroundRequestKey = useMemo(
        () =>
            decisionBarcodeForScience && decisionDigestForScience && activeIngredientKey
                ? [
                    'scientific_background',
                    decisionBarcodeForScience,
                    decisionDigestForScience,
                    activeIngredientKey,
                    scienceSourceFinalKey,
                ].join('|')
                : null,
        [activeIngredientKey, decisionBarcodeForScience, decisionDigestForScience, scienceSourceFinalKey],
    );
    const ingredientOverviewState = ingredientOverviewRequestKey
        ? ingredientOverviewByRequestKey[ingredientOverviewRequestKey]
        : undefined;
    const scientificBackgroundState = scientificBackgroundRequestKey
        ? scientificBackgroundByRequestKey[scientificBackgroundRequestKey]
        : undefined;

    useEffect(() => {
        setRuntimeKbNotesByKey({});
        setIngredientOverviewByRequestKey({});
        setScientificBackgroundByRequestKey({});
        ingredientOverviewStateRef.current = {};
        scientificBackgroundStateRef.current = {};
        setActiveIngredientName(keyIngredientsForDetail[0] ?? null);
        setActiveSafetyIngredientName(keyIngredientsForSafety[0] ?? null);
    }, [incomingBundleRunKey, keyIngredientsForDetail, keyIngredientsForSafety]);

    useEffect(() => {
        if (decisionSupportState.status !== 'ready') return;
        if (!ingredientOverviewRequestKey || !decisionBarcodeForScience || !decisionDigestForScience) return;
        const current = ingredientOverviewStateRef.current[ingredientOverviewRequestKey];
        if (current && (current.status === 'loading' || current.status === 'ok')) return;

        let cancelled = false;
        let settled = false;
        const controller = new AbortController();
        const fallbackBlock = buildIngredientOverviewFallbackClient(decisionScienceIngredientRows);

        const run = async () => {
            try {
                setIngredientOverviewSidecarState(ingredientOverviewRequestKey, { status: 'loading' });
                const baseUrl = String(Config.searchApiBaseUrl).replace(/\/$/, '');
                const response = await fetch(`${baseUrl}/api/ingredient-overview/v1`, {
                    method: 'POST',
                    headers: {
                        ...(await withAuthHeaders({
                            'Content-Type': 'application/json',
                        })),
                    },
                    body: JSON.stringify({
                        barcode: decisionBarcodeForScience,
                        decisionDigest: decisionDigestForScience,
                    }),
                    signal: controller.signal,
                });

                if (cancelled) return;

                if (!response.ok) {
                    settled = true;
                    setIngredientOverviewSidecarState(ingredientOverviewRequestKey, {
                        status: 'ok',
                        source: 'fallback',
                        fallbackUsed: true,
                        promptVersion: 'ingredient_overview_client_fallback_v1',
                        data: fallbackBlock,
                    });
                    return;
                }

                const payload = await response.json() as IngredientOverviewResponse & { latestDigest?: string };
                if (cancelled) return;
                if (payload?.status !== 'ok' || !payload.ingredientOverview) {
                    throw new Error('ingredient_overview_invalid_payload');
                }

                settled = true;
                setIngredientOverviewSidecarState(ingredientOverviewRequestKey, {
                    status: 'ok',
                    source: payload.source,
                    fallbackUsed: payload.fallbackUsed,
                    promptVersion: payload.promptVersion,
                    data: payload.ingredientOverview,
                });
            } catch (error) {
                if (cancelled) return;
                settled = true;
                setIngredientOverviewSidecarState(ingredientOverviewRequestKey, {
                    status: 'ok',
                    source: 'fallback',
                    fallbackUsed: true,
                    promptVersion: 'ingredient_overview_client_fallback_v1',
                    data: fallbackBlock,
                    error: error instanceof Error ? error.message : 'Ingredient overview unavailable',
                });
            }
        };

        const interactionTask = InteractionManager.runAfterInteractions(() => {
            void run();
        });
        return () => {
            cancelled = true;
            controller.abort();
            interactionTask.cancel();
            if (!settled) {
                setIngredientOverviewSidecarState(ingredientOverviewRequestKey, (currentState) =>
                    currentState?.status === 'loading' ? undefined : currentState,
                );
            }
        };
    }, [
        decisionSupportState.status,
        decisionBarcodeForScience,
        decisionDigestForScience,
        decisionScienceIngredientRows,
        ingredientOverviewRequestKey,
        setIngredientOverviewSidecarState,
    ]);

    useEffect(() => {
        if (decisionSupportState.status !== 'ready') return;
        if (!decisionBarcodeForScience || !decisionDigestForScience) return;
        if (scientificBackgroundIngredientRows.length === 0) return;

        let cancelled = false;
        const requestRunKey = currentRunKeyRef.current;
        const controllers: AbortController[] = [];
        const startedRequestKeys = new Set<string>();
        const settledRequestKeys = new Set<string>();
        const interactionTask = InteractionManager.runAfterInteractions(() => {
            const baseUrl = String(Config.searchApiBaseUrl).replace(/\/$/, '');
            scientificBackgroundIngredientRows.forEach((row) => {
                const requestKey = [
                    'scientific_background',
                    decisionBarcodeForScience,
                    decisionDigestForScience,
                    row.key,
                    scienceSourceFinalKey,
                ].join('|');
                const current = scientificBackgroundStateRef.current[requestKey];
                if (current && (current.status === 'loading' || current.status === 'ok')) return;

                const controller = new AbortController();
                controllers.push(controller);
                startedRequestKeys.add(requestKey);
                const fallbackBlock = buildScientificBackgroundFallbackClient(
                    row.name,
                    decisionScienceIngredientRows,
                );

                void (async () => {
                    try {
                        setScientificBackgroundSidecarState(requestKey, { status: 'loading' });
                        const response = await fetch(`${baseUrl}/api/scientific-background/v1`, {
                            method: 'POST',
                            headers: {
                                ...(await withAuthHeaders({
                                    'Content-Type': 'application/json',
                                })),
                            },
                            body: JSON.stringify({
                                barcode: decisionBarcodeForScience,
                                decisionDigest: decisionDigestForScience,
                                selectedIngredientName: row.name,
                            }),
                            signal: controller.signal,
                        });

                        if (cancelled || currentRunKeyRef.current !== requestRunKey) return;

                        if (!response.ok) {
                            settledRequestKeys.add(requestKey);
                            setScientificBackgroundSidecarState(requestKey, {
                                status: 'ok',
                                source: 'fallback',
                                fallbackUsed: true,
                                promptVersion: 'scientific_background_client_fallback_v1',
                                data: fallbackBlock,
                            });
                            return;
                        }

                        const payload = await response.json() as ScientificBackgroundResponse & { latestDigest?: string };
                        if (cancelled || currentRunKeyRef.current !== requestRunKey) return;
                        if (payload?.status !== 'ok' || !payload.scientificBackground) {
                            throw new Error('scientific_background_invalid_payload');
                        }

                        settledRequestKeys.add(requestKey);
                        setScientificBackgroundSidecarState(requestKey, {
                            status: 'ok',
                            source: payload.source,
                            fallbackUsed: payload.fallbackUsed,
                            promptVersion: payload.promptVersion,
                            data: payload.scientificBackground,
                        });
                    } catch (error) {
                        if (cancelled || currentRunKeyRef.current !== requestRunKey) return;
                        settledRequestKeys.add(requestKey);
                        setScientificBackgroundSidecarState(requestKey, {
                            status: 'ok',
                            source: 'fallback',
                            fallbackUsed: true,
                            promptVersion: 'scientific_background_client_fallback_v1',
                            data: fallbackBlock,
                            error: error instanceof Error ? error.message : 'Scientific background unavailable',
                        });
                    }
                })();
            });
        });
        return () => {
            cancelled = true;
            controllers.forEach((controller) => controller.abort());
            interactionTask.cancel();
            startedRequestKeys.forEach((requestKey) => {
                if (settledRequestKeys.has(requestKey)) return;
                setScientificBackgroundSidecarState(requestKey, (currentState) =>
                    currentState?.status === 'loading' ? undefined : currentState,
                );
            });
        };
    }, [
        decisionSupportState.status,
        decisionBarcodeForScience,
        decisionDigestForScience,
        decisionScienceIngredientRows,
        scientificBackgroundIngredientRows,
        scienceSourceFinalKey,
        setScientificBackgroundSidecarState,
    ]);

    useEffect(() => {
        if (selectedTileType !== 'science') return;
        if (!scientificBackgroundState || scientificBackgroundState.status !== 'ok') return;
        emitScanUxMetric('scan_summary_rendered', {
            viewMode: SCAN_UX_VIEW_MODE,
            variant: SCAN_UX_VARIANT,
            sheetType: 'science',
            sourceType: bundleSourceType ?? null,
            sourceTypeFinal: bundleSourceTypeFinal,
            dwellMs: 0,
            maxScrollRatio: 0,
            summaryVersion: scientificBackgroundState.promptVersion ?? null,
            guardApplied: true,
            fallbackUsed: scientificBackgroundState.fallbackUsed ?? (scientificBackgroundState.source === 'fallback'),
        });
    }, [bundleSourceType, bundleSourceTypeFinal, scientificBackgroundState, selectedTileType]);

    const scientificBackgroundSections = scientificBackgroundState?.data?.sections ?? [];
    const ingredientOverviewTitleLine = ingredientOverviewState?.data?.titleLine ?? null;
    const ingredientOverviewParagraphOne = ingredientOverviewState?.data?.paragraph1 ?? null;
    const ingredientOverviewParagraphTwo = ingredientOverviewState?.data?.paragraph2 ?? null;
    const ingredientOverviewCompareHint = ingredientOverviewState?.data?.compareHint ?? null;
    const scientificBackgroundIntroLine = scientificBackgroundState?.data?.introLine ?? activeIngredientLabelLine;
    const scientificBackgroundClosingNote = scientificBackgroundState?.data?.closingNote ?? null;
    const ingredientsContent = (
        <View style={styles.detailStack}>
            <GlassCard
                title="What this product provides"
                subtitle="Verified product-specific fields"
                accentColor="#D97706"
                right={<GlassPill label={scienceIngredientBadgeLabel} />}
            >
                <View style={{ marginBottom: (chemicalFormDisplayText || deliveryTypeDisplayText) ? 12 : 0 }}>
                    <View style={styles.ingredientsList}>
                        {decisionScienceIngredientRows.length > 0 ? (
                            decisionScienceIngredientRows.map((item, idx) => (
                                <View key={`${item.key}-${idx}`} style={styles.ingredientsListRow}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.ingredientsListName}>{item.name}</Text>
                                        {item.dose ? (
                                            <Text style={styles.ingredientsListDose}>{item.dose}</Text>
                                        ) : (
                                            <Text style={styles.ingredientsListDoseMuted}>Dose not disclosed</Text>
                                        )}
                                    </View>
                                </View>
                            ))
                        ) : (
                            <Text style={styles.detailPlaceholderText}>
                                {isDataCeiling && dataCeilingScienceLead && dataCeilingScienceAction
                                    ? `${dataCeilingScienceLead} ${dataCeilingScienceAction}`
                                    : 'Verified ingredient rows are still loading.'}
                            </Text>
                        )}
                    </View>
                </View>

                {(chemicalFormDisplayText || deliveryTypeDisplayText) ? (
                    <View style={styles.kvGrid}>
                        {chemicalFormDisplayText ? (
                            <View style={styles.kvRow}>
                                <Text style={styles.kvLabel}>Chemical Form</Text>
                                <Text style={styles.kvValue}>{chemicalFormDisplayText}</Text>
                            </View>
                        ) : null}
                        {deliveryTypeDisplayText ? (
                            <View style={styles.kvRow}>
                                <Text style={styles.kvLabel}>Delivery Type</Text>
                                <Text style={styles.kvValue}>{deliveryTypeDisplayText}</Text>
                            </View>
                        ) : null}
                    </View>
                ) : null}
            </GlassCard>

            <GlassCard
                title="Ingredient overview"
                subtitle="Core ingredient identity and formula context"
                accentColor="#D97706"
                right={<GlassPill label={resolveSimpleTaxonomyLabel('AI summary')} />}
            >
                {ingredientOverviewState?.status === 'loading' ? (
                    <View style={styles.inlineLoadingRow}>
                        <ActivityIndicator />
                        <Text style={styles.inlineLoadingText}>Generating overview…</Text>
                    </View>
                ) : ingredientOverviewState?.status === 'ok' && ingredientOverviewState.data ? (
                    <View style={{ gap: 12 }}>
                        {ingredientOverviewTitleLine ? (
                            <Text style={styles.summarySectionTitle}>{ingredientOverviewTitleLine}</Text>
                        ) : null}
                        {ingredientOverviewParagraphOne ? (
                            <Text style={styles.detailNarrativeText}>{ingredientOverviewParagraphOne}</Text>
                        ) : null}
                        {ingredientOverviewParagraphTwo ? (
                            <Text style={styles.detailNarrativeText}>{ingredientOverviewParagraphTwo}</Text>
                        ) : null}
                        {ingredientOverviewCompareHint ? (
                            <Text style={styles.detailBodyText}>{ingredientOverviewCompareHint}</Text>
                        ) : null}
                    </View>
                ) : (
                    <Text style={styles.detailPlaceholderText}>Ingredient overview is pending.</Text>
                )}
            </GlassCard>

            <GlassCard
                title="Scientific background"
                subtitle="Research context for the selected ingredient"
                accentColor="#D97706"
                right={<GlassPill label={resolveSimpleTaxonomyLabel('General science')} />}
            >
                <View style={{ gap: 12 }}>
                    {showIngredientSelector ? (
                        <View style={{ gap: 10 }}>
                            <Text style={styles.detailMetaLabel}>Choose an ingredient for scientific background</Text>
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.ingredientSelectorRow}
                            >
                                {keyIngredientsForDetail.map((name) => {
                                    const key = normalizeIngredientNameForBackground(name);
                                    const isActive = key === activeIngredientKey;
                                    return (
                                        <Pressable
                                            key={key}
                                            onPress={() => setActiveIngredientName(name)}
                                            style={[
                                                styles.ingredientChip,
                                                isActive ? styles.ingredientChipActive : null,
                                            ]}
                                        >
                                            <DashboardBlur intensity={isActive ? 22 : 14} tint="light" style={StyleSheet.absoluteFill} />
                                            <Text style={[styles.ingredientChipText, isActive ? styles.ingredientChipTextActive : null]} numberOfLines={1}>
                                                {capitalizeSentences(name)}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </ScrollView>
                            <Text style={styles.detailMetaText}>{scientificBackgroundIntroLine}</Text>
                        </View>
                    ) : null}

                    {scientificBackgroundState?.status === 'loading' ? (
                        <View style={styles.inlineLoadingRow}>
                            <ActivityIndicator />
                            <Text style={styles.inlineLoadingText}>Generating scientific background…</Text>
                        </View>
                    ) : scientificBackgroundState?.status === 'ok' && scientificBackgroundState.data ? (
                        <View style={{ gap: 16 }}>
                            {!showIngredientSelector ? (
                                <Text style={styles.detailMetaText}>{scientificBackgroundIntroLine}</Text>
                            ) : null}
                            {scientificBackgroundSections.map((section, idx) => (
                                <View key={`scientific-background-section-${idx}`} style={{ gap: 8 }}>
                                    <Text style={styles.summarySectionTitle}>{section.heading}</Text>
                                    <Text style={styles.detailNarrativeText}>{section.summary}</Text>
                                    {section.bullets.map((bullet, bulletIndex) => (
                                        <View key={`scientific-background-bullet-${idx}-${bulletIndex}`} style={styles.bulletRow}>
                                            <View style={styles.bulletDot} />
                                            <Text style={styles.bulletText}>{bullet}</Text>
                                        </View>
                                    ))}
                                    <Text style={styles.detailBodyText}>{section.evidenceRead}</Text>
                                    {section.shopperMeaning ? (
                                        <Text style={styles.detailBodyText}>{section.shopperMeaning}</Text>
                                    ) : null}
                                </View>
                            ))}
                            {scientificBackgroundClosingNote ? (
                                <Text style={styles.detailBodyText}>{scientificBackgroundClosingNote}</Text>
                            ) : null}
                        </View>
                    ) : (
                        <Text style={styles.detailPlaceholderText}>Scientific background is pending.</Text>
                    )}
                </View>
            </GlassCard>

            {detailError ? (
                <GlassCard title="Ingredient detail error" subtitle={detailError} accentColor="#EF4444">
                    <Text style={styles.emptyStateText}>Some ingredient details could not be resolved. Try again or scan a label-based source.</Text>
                </GlassCard>
            ) : null}
        </View>
    );

    const usageFacts = factsDtoState.data;
    const usageScheduleRows = Array.isArray(bundleState?.sections?.usage?.detail?.scheduleFromLabel)
        ? bundleState.sections.usage.detail.scheduleFromLabel
        : [];
    const usageScheduleLines = usageScheduleRows
        .slice(0, 2)
        .map((row) => {
            const population = normalizeText(row?.population ?? '');
            const dose = normalizeText(row?.dose ?? '');
            const frequency = normalizeText(row?.frequency ?? '');
            const rawText = normalizeText(row?.rawText ?? '');
            const parts = [population, dose, frequency].filter(Boolean);
            if (parts.length > 0) return `Label schedule: ${parts.join(' ')}.`;
            if (rawText) return `Label schedule: ${rawText}`;
            return null;
        })
        .filter((line): line is string => Boolean(line));
    const usageBestTimeRaw = usageCover?.bestTimeToTake;
    const usageBestTimeText = normalizeText(
        typeof usageBestTimeRaw === 'string'
            ? usageBestTimeRaw
            : usageBestTimeRaw?.text ?? '',
    );
    const decisionUsageDirectionsLines = (decisionUsageBlock?.directions?.lines ?? [])
        .map((line) => humanizeUsageLine(typeof line === 'string' ? line.trim() : ''))
        .filter((line): line is string => Boolean(line))
        .slice(0, 4);
    const usageSourceTier = decisionUsageBlock?.directions?.sourceTier ?? 'official_record';
    const usageDirectionsFromRecord = normalizeText(usageFacts?.usage?.directionsText ?? '');
    const directionsSummaryLine = decisionUsageDirectionsLines[0]
        ? decisionUsageDirectionsLines[0]
        : usageDirectionsFromRecord
        ? `Directions from record: ${usageDirectionsFromRecord}`
        : usageScheduleLines.length > 0
            ? `Directions from record: ${usageScheduleLines[0]?.replace(/^Label schedule:\s*/i, '') ?? ''}`
            : isDsldSource
                ? 'Directions from record: Not provided in this record. Scan label for exact directions.'
                : 'Directions from record: Not available in this source.';
    const usageSourceLine = usageSourceTier === 'scanned_label'
        ? 'Based on scanned label data.'
        : usageSourceTier === 'overlay_iherb'
            ? 'Based on supplemental product-page label data.'
            : usageSourceTier === 'official_record'
                ? 'Based on the official record.'
                : null;
    const usageHasInlineSourceLine = decisionUsageDirectionsLines.some((line) => /^source:|^based on /i.test(line));
    const usageStructuredLines = [
        isDataCeiling ? 'This verified source includes limited structured fields and does not provide ingredient amount rows.' : null,
        ...(decisionUsageDirectionsLines.length > 0 ? decisionUsageDirectionsLines : [humanizeUsageLine(directionsSummaryLine) ?? directionsSummaryLine]),
        usageHasInlineSourceLine ? null : usageSourceLine,
        usageFacts?.serving?.servingSizeText
            ? `Serving size: ${usageFacts.serving.servingSizeText}${usageFacts.serving.servingsPerContainer != null
                ? `; servings per container: ${usageFacts.serving.servingsPerContainer}`
                : ''
            }.`
            : null,
        usageBestTimeText ? `Timing from label: ${usageBestTimeText}.` : null,
        usageScheduleLines.length > 1 ? usageScheduleLines[1] : null,
    ]
        .map((line) => humanizeUsageLine(line))
        .map((line) => (line ? line.replace(/\s+\(a serving is not the same as the daily amount\)/gi, ', and a serving is not the same as the daily amount') : line))
        .filter((line): line is string => Boolean(line && line.trim().length > 0));
    const usageRecordLines = enforceNeverBlank({
        lines: [
            ...usageStructuredLines,
            usageStructuredLines.length === 0
                ? 'Label directions were not available from this source.'
                : null,
        ],
        fallback: [
            'Follow the product label first for timing and frequency.',
            'If directions are missing, use conservative daily timing until label details are confirmed.',
        ],
    });
    const usageSourcePillLabel = usageSourceTier === 'overlay_iherb'
        ? 'Official + supplemental label data'
        : usageSourceTier === 'scanned_label'
            ? 'Scanned label (patch/label)'
            : 'Official record';
    const usageSourceSubtitle = usageSourceTier === 'overlay_iherb'
        ? 'Directions from supplemental product-page label data'
        : usageSourceTier === 'scanned_label'
            ? 'Directions from scanned label (patched)'
            : 'Directions from the official record';
    const usageGuidanceLines = enforceNeverBlank({
        lines: [
            'Follow the product label first.',
            'If you are new to this product, start at the lowest suggested label amount.',
            'If you use medications, are pregnant/breastfeeding, or have chronic conditions, check with a clinician.',
        ],
        fallback: [
            'Use conservative dosing when evidence is incomplete.',
            'Seek clinician advice for personalized use decisions.',
        ],
    });
    const usageTimingTipLines = enforceNeverBlank({
        lines: [
            usageBestTimeText ? `Timing tip: ${usageBestTimeText}` : 'Timing tip: take it at a consistent time each day.',
            'Optional: take with a meal if it fits your routine.',
        ],
        fallback: [
            'Timing tip: take it at a consistent time each day.',
            'Optional: take with a meal if it fits your routine.',
        ],
    });
    const summaryIdentityKey = useMemo(
        () =>
            [
                `${bundleState.meta.authoritativeIdentity.type}:${bundleState.meta.authoritativeIdentity.value}`,
                bundleState.meta.sourceType ?? 'unknown',
                bundleState.meta.sourceTypeFinal === false ? '0' : '1',
            ].join('|'),
        [
            bundleState.meta.authoritativeIdentity.type,
            bundleState.meta.authoritativeIdentity.value,
            bundleState.meta.sourceType,
            bundleState.meta.sourceTypeFinal,
        ],
    );

    const usageContent = (
        <View style={styles.detailStack}>
            <GlassCard
                title="How to take it"
                subtitle={usageSourceSubtitle}
                accentColor="#0EA5E9"
                right={<GlassPill label={resolveSimpleTaxonomyLabel(usageSourcePillLabel, usageSourcePillLabel)} />}
            >
                <View style={{ gap: 10 }}>
                    {usageRecordLines.map((line, idx) => (
                        <Text key={`usage-rec-${idx}`} style={idx === 0 ? styles.detailLeadText : styles.detailBodyText}>
                            {line}
                        </Text>
                    ))}
                </View>
            </GlassCard>

            <GlassCard title="General tips" subtitle="Conservative default guidance" accentColor="#0EA5E9">
                <View style={{ gap: 10 }}>
                    {usageGuidanceLines.map((line, idx) => (
                        <View key={`usage-guide-${idx}`} style={styles.bulletRow}>
                            <View style={styles.bulletDot} />
                            <Text style={styles.bulletText}>{line}</Text>
                        </View>
                    ))}
                </View>
            </GlassCard>

            <GlassCard title="Timing tip (general)" subtitle="Consistency guidance" accentColor="#0EA5E9">
                <View style={{ gap: 10 }}>
                    {usageTimingTipLines.map((line, idx) => (
                        <View key={`usage-time-${idx}`} style={styles.bulletRow}>
                            <View style={styles.bulletDot} />
                            <Text style={styles.bulletText}>{line}</Text>
                        </View>
                    ))}
                </View>
            </GlassCard>

        </View>
    );

    const safetyFacts = factsDtoState.data;
    const safetySignalPack = useMemo(
        () =>
            buildSafetySignalPack({
                bundle: bundleState,
                scoreBundle: v4BundleForInsights,
                facts: safetyFacts,
                ingredientNames: keyIngredientsForSafety,
            }),
        [bundleState, v4BundleForInsights, safetyFacts, keyIngredientsForSafety],
    );
    const safetyOdsInteractionLines = safetySignalPack.odsInteractions.map((item) => item.text);
    const safetyUlEntryLines = Array.isArray(safetySignalPack.ulEntries)
        ? safetySignalPack.ulEntries.map((item) => item.explainLine)
        : [];
    const safetyUlSignalLines = safetyUlEntryLines.length > 0
        ? safetyUlEntryLines
        : safetySignalPack.ulSignals.map((item) => item.text);
    const matchesSafetyIngredient = useCallback(
        (line: string): boolean => {
            if (!activeSafetyIngredientKey) return true;
            const normalizedLine = normalizeIngredientNameForBackground(line);
            return normalizedLine.includes(activeSafetyIngredientKey);
        },
        [activeSafetyIngredientKey],
    );
    const selectedSafetyOdsInteractionLines = useMemo(() => {
        const filtered = safetyOdsInteractionLines.filter((line) => matchesSafetyIngredient(line));
        return filtered.length > 0 ? filtered : safetyOdsInteractionLines.slice(0, 3);
    }, [safetyOdsInteractionLines, matchesSafetyIngredient]);
    const selectedSafetyUlSignalLines = useMemo(() => {
        const filtered = safetyUlSignalLines.filter((line) => matchesSafetyIngredient(line));
        return filtered.length > 0 ? filtered : safetyUlSignalLines.slice(0, 3);
    }, [safetyUlSignalLines, matchesSafetyIngredient]);
    const hasComparableUlSignals = safetyUlEntryLines.length > 0;
    const hasReferenceOnlyUlSignals =
        !hasComparableUlSignals
        && selectedSafetyUlSignalLines.some((line) => /upper limit \(ul\):/i.test(line));
    const hasTrueOdsUlSource = (safetySignalPack.ulEntries ?? []).some(
        (entry) => entry.evidenceSource === 'NIH_ODS_UL',
    );
    const hasTrueOdsInteractionSource =
        safetySignalPack.odsInteractions.some((item) => item.source === 'ods_interaction')
        || safetySignalPack.odsWatchouts.some((item) => item.source === 'ods_watchout');
    const decisionSafetyLabelLines = (decisionSafetyBlock?.labelWarnings ?? [])
        .map((line) => (typeof line === 'string' ? line.trim() : ''))
        .filter((line) => line.length > 0)
        .slice(0, 4);
    const decisionSafetyUlLines = (decisionSafetyBlock?.ulGuidance ?? [])
        .map((line) => (typeof line === 'string' ? line.trim() : ''))
        .filter((line) => line.length > 0)
        .slice(0, 3);
    const decisionSafetyWatchoutLines = (decisionSafetyBlock?.generalWatchouts ?? [])
        .map((line) => (typeof line === 'string' ? line.trim() : ''))
        .filter((line) => line.length > 0)
        .slice(0, 3);
    const safetyUlBadge = resolveSimpleTaxonomyLabel(
        generalScienceBadgeLabel(hasTrueOdsUlSource),
        'General science',
    );
    const safetyInteractionBadge = resolveSimpleTaxonomyLabel(
        generalScienceBadgeLabel(hasTrueOdsInteractionSource),
        'General science',
    );
    const safetyUlSubtitle = hasTrueOdsUlSource
        ? 'General reference (NIH ODS)'
        : 'General reference';
    const safetyInteractionSubtitle = hasTrueOdsInteractionSource
        ? 'Ingredient-level guidance from NIH ODS'
        : 'Ingredient-level guidance';
    const safetyUsesAnyTrueOdsSource = hasTrueOdsUlSource || hasTrueOdsInteractionSource;
    const safetyLabelLines = enforceNeverBlank({
        lines: [
            ...(decisionSafetyLabelLines.length > 0
                ? decisionSafetyLabelLines.map((line) => ensurePeriod(line))
                : safetySignalPack.labelWarnings.map((item) => ensurePeriod(item.text))),
            decisionSafetyLabelLines.length === 0 && safetySignalPack.labelWarnings.length === 0
                ? 'Product-specific label warnings were not available in the official record.'
                : null,
        ],
        fallback: [
            'Product-specific label warnings were not available in the official record.',
        ],
    });
    const safetyUlGuidanceLines = enforceNeverBlank({
        lines: (decisionSafetyUlLines.length > 0
            ? decisionSafetyUlLines
            : selectedSafetyUlSignalLines)
            .map((line) => ensurePeriod(normalizeText(line)))
            .filter((line) => line.length > 0)
            .filter((line, index, list) => list.findIndex((candidate) => candidate.toLowerCase() === line.toLowerCase()) === index)
            .slice(0, 3),
        fallback: [
            'Adult UL guidance is general and applies to total daily intake from all sources.',
            'Compare your total daily intake across supplements and food sources.',
        ],
    });
    const safetyInteractionLines = enforceNeverBlank({
        lines: [
            ...(decisionSafetyWatchoutLines.length > 0
                ? decisionSafetyWatchoutLines
                : selectedSafetyOdsInteractionLines)
                .map((line) => ensurePeriod(normalizeText(line)))
                .filter((line) => line.length > 0)
                .filter((line) => !/fatty fish|beef liver|egg yolks|cheese/i.test(line))
                .slice(0, 2),
            'Talk to a clinician if you are pregnant or breastfeeding, have chronic conditions, or use medications that may interact.',
        ],
        fallback: [
            'Talk to a clinician if you are pregnant or breastfeeding, have chronic conditions, or use medications that may interact.',
            'General watch-outs are ingredient-level guidance and not product-label warnings.',
        ],
    });
    const [safetySummaryByRequestKey, setSafetySummaryByRequestKey] = useState<Record<string, SafetySummaryState>>({});
    useEffect(() => {
        setSafetySummaryByRequestKey({});
    }, [incomingBundleRunKey]);
    const safetySummaryFallback = useMemo(() => {
        const riskLine = ensurePeriod(
            normalizeText(
                safetyLabelLines[0] ??
                'Label-specific warnings were limited, so this summary stays conservative.',
            ),
        );
        const contextLine = ensurePeriod(
            normalizeText(
                safetyUlSignalLines[0] ??
                safetyOdsInteractionLines[0] ??
                'General watch-outs provide ingredient-level context but do not replace product-label warnings.',
            ),
        );
        const actionLine = ensurePeriod(
            normalizeText(
                'Review the product label and consult a clinician for personal risk factors.',
            ),
        );
        const tldr = [riskLine, contextLine, actionLine]
            .map((line) => normalizeText(line))
            .filter((line) => line.length > 0)
            .slice(0, 3)
            .join(' ');
        return { riskLine, contextLine, actionLine, tldr };
    }, [safetyLabelLines, safetyOdsInteractionLines, safetyUlSignalLines]);
    const safetySummaryPayloadFingerprint = useMemo(
        () =>
            JSON.stringify({
                sourceType: bundleSourceType ?? null,
                productName: productInfo?.name ?? null,
                labelLines: safetyLabelLines.slice(0, 4),
                ulLines: safetyUlSignalLines.slice(0, 3),
                interactionLines: safetyOdsInteractionLines.slice(0, 3),
                missingLines: [],
            }),
        [
            bundleSourceType,
            productInfo?.name,
            safetyLabelLines,
            safetyUlSignalLines,
            safetyOdsInteractionLines,
        ],
    );
    const safetySummaryRequestKey = useMemo(
        () => `${summaryIdentityKey}|safety|${safetySummaryPayloadFingerprint}`,
        [summaryIdentityKey, safetySummaryPayloadFingerprint],
    );
    const safetySummaryState = safetySummaryByRequestKey[safetySummaryRequestKey];
    const safetySummaryStatus = safetySummaryState?.status ?? 'idle';

    useEffect(() => {
        if (selectedTileType !== 'safety' || !SHOW_SCAN_DEBUG) return;
        if (!safetySummaryRequestKey) return;
        if (safetySummaryStatus === 'ok' || safetySummaryStatus === 'loading') return;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3_800);
        let cancelled = false;

        const run = async () => {
            setSafetySummaryByRequestKey((prev) => ({
                ...prev,
                [safetySummaryRequestKey]: {
                    status: 'loading',
                    startedAt: Date.now(),
                    source: 'fallback',
                    phase: 'instant_fallback',
                    tldr: safetySummaryFallback.tldr,
                    riskLine: safetySummaryFallback.riskLine,
                    contextLine: safetySummaryFallback.contextLine,
                    actionLine: safetySummaryFallback.actionLine,
                    reasonCode: 'FALLBACK_DETERMINISTIC',
                },
            }));
            try {
                const baseUrl = String(Config.searchApiBaseUrl).replace(/\/$/, '');
                const payload = JSON.parse(safetySummaryPayloadFingerprint) as {
                    sourceType: string | null;
                    productName: string | null;
                    labelLines: string[];
                    ulLines: string[];
                    interactionLines: string[];
                    missingLines: string[];
                };
                const response = await fetch(`${baseUrl}/api/summary/safety`, {
                    method: 'POST',
                    headers: {
                        ...(await withAuthHeaders({
                            'Content-Type': 'application/json',
                        })),
                    },
                    body: JSON.stringify({
                        locale: 'en',
                        sourceType: payload.sourceType,
                        productName: payload.productName,
                        labelLines: payload.labelLines,
                        ulLines: payload.ulLines,
                        interactionLines: payload.interactionLines,
                        missingLines: payload.missingLines,
                    }),
                    signal: controller.signal,
                });
                if (!response.ok) {
                    if (cancelled) return;
                    setSafetySummaryByRequestKey((prev) => ({
                        ...prev,
                        [safetySummaryRequestKey]: {
                            status: 'ok',
                            source: 'fallback',
                            phase: 'instant_fallback',
                            tldr: safetySummaryFallback.tldr,
                            riskLine: safetySummaryFallback.riskLine,
                            contextLine: safetySummaryFallback.contextLine,
                            actionLine: safetySummaryFallback.actionLine,
                            reasonCode: 'FALLBACK_DETERMINISTIC',
                            startedAt: undefined,
                        },
                    }));
                    return;
                }
                const json = await response.json();
                const riskLine = ensurePeriod(
                    normalizeText(
                        (typeof json?.riskLine === 'string' && json.riskLine) ||
                        (typeof json?.summary?.riskLine === 'string' && json.summary.riskLine) ||
                        '',
                    ),
                );
                const contextLine = ensurePeriod(
                    normalizeText(
                        (typeof json?.contextLine === 'string' && json.contextLine) ||
                        (typeof json?.summary?.contextLine === 'string' && json.summary.contextLine) ||
                        '',
                    ),
                );
                const actionLine = ensurePeriod(
                    normalizeText(
                        (typeof json?.actionLine === 'string' && json.actionLine) ||
                        (typeof json?.summary?.actionLine === 'string' && json.summary.actionLine) ||
                        '',
                    ),
                );
                const tldr = normalizeText(
                    (typeof json?.tldr === 'string' && json.tldr) ||
                    (typeof json?.summary?.tldr === 'string' && json.summary.tldr) ||
                    [riskLine, contextLine, actionLine].filter(Boolean).join(' '),
                );
                const reasonCode =
                    typeof json?.reasonCode === 'string'
                        ? json.reasonCode
                        : typeof json?.summary?.reasonCode === 'string'
                            ? json.summary.reasonCode
                            : null;
                if (cancelled) return;
                const hasStructuredLines = riskLine.length > 0 && contextLine.length > 0 && actionLine.length > 0;
                if (!hasStructuredLines || tldr.length < 20) {
                    setSafetySummaryByRequestKey((prev) => ({
                        ...prev,
                        [safetySummaryRequestKey]: {
                            status: 'ok',
                            source: 'fallback',
                            phase: 'instant_fallback',
                            tldr: safetySummaryFallback.tldr,
                            riskLine: safetySummaryFallback.riskLine,
                            contextLine: safetySummaryFallback.contextLine,
                            actionLine: safetySummaryFallback.actionLine,
                            reasonCode: 'FALLBACK_DETERMINISTIC',
                            startedAt: undefined,
                        },
                    }));
                    return;
                }
                setSafetySummaryByRequestKey((prev) => ({
                    ...prev,
                    [safetySummaryRequestKey]: {
                        status: 'ok',
                        source: json?.fallbackUsed ? 'fallback' : 'api',
                        phase: json?.fallbackUsed ? 'instant_fallback' : 'upgraded',
                        tldr,
                        riskLine,
                        contextLine,
                        actionLine,
                        reasonCode,
                        startedAt: undefined,
                    },
                }));
            } catch (error) {
                if (cancelled) return;
                setSafetySummaryByRequestKey((prev) => ({
                    ...prev,
                    [safetySummaryRequestKey]: {
                        status: 'ok',
                        source: 'fallback',
                        phase: 'instant_fallback',
                        tldr: safetySummaryFallback.tldr,
                        riskLine: safetySummaryFallback.riskLine,
                        contextLine: safetySummaryFallback.contextLine,
                        actionLine: safetySummaryFallback.actionLine,
                        reasonCode: 'FALLBACK_DETERMINISTIC',
                        error: error instanceof Error ? error.message : 'safety_summary_fetch_failed',
                        startedAt: undefined,
                    },
                }));
            } finally {
                clearTimeout(timeoutId);
            }
        };

        run();
        return () => {
            cancelled = true;
            controller.abort();
            clearTimeout(timeoutId);
        };
    }, [
        selectedTileType,
        safetySummaryRequestKey,
        safetySummaryStatus,
        safetySummaryPayloadFingerprint,
        safetySummaryFallback,
    ]);

    useEffect(() => {
        if (selectedTileType !== 'safety' || !SHOW_SCAN_DEBUG) return;
        if (safetySummaryStatus !== 'loading') return;
        if (!safetySummaryRequestKey) return;
        const watchdogId = setTimeout(() => {
            setSafetySummaryByRequestKey((prev) => {
                const current = prev[safetySummaryRequestKey];
                if (!current || current.status !== 'loading') return prev;
                return {
                    ...prev,
                    [safetySummaryRequestKey]: {
                        status: 'ok',
                        source: 'fallback',
                        phase: 'instant_fallback',
                        tldr: safetySummaryFallback.tldr,
                        riskLine: safetySummaryFallback.riskLine,
                        contextLine: safetySummaryFallback.contextLine,
                        actionLine: safetySummaryFallback.actionLine,
                        reasonCode: 'FALLBACK_DETERMINISTIC',
                        startedAt: undefined,
                    },
                };
            });
        }, 4_200);
        return () => clearTimeout(watchdogId);
    }, [selectedTileType, safetySummaryStatus, safetySummaryRequestKey, safetySummaryFallback]);

    const safetyContent = (
        <View style={styles.detailStack}>
            <GlassCard
                title="Label warning notice"
                subtitle={decisionOverlayUsed ? 'Official + supplemental label data' : 'From the official record'}
                accentColor="#EF4444"
                right={<GlassPill label={resolveSimpleTaxonomyLabel(decisionOverlayUsed ? 'Official + supplemental label data' : 'Official record')} />}
            >
                <View style={{ gap: 10 }}>
                    {safetyLabelLines.map((line, idx) => (
                        <View key={`safe-label-${idx}`} style={styles.bulletRow}>
                            <View style={styles.bulletDot} />
                            <Text style={styles.bulletText}>{line}</Text>
                        </View>
                    ))}
                </View>
            </GlassCard>

            <GlassCard
                title="Upper limit (UL) guidance"
                subtitle={safetyUlSubtitle}
                accentColor="#EF4444"
                right={<GlassPill label={safetyUlBadge} />}
            >
                <View style={{ gap: 10 }}>
                    {safetyUlGuidanceLines.map((line, idx) => (
                        <View key={`safe-ul-${idx}`} style={styles.bulletRow}>
                            <View style={styles.bulletDot} />
                            <Text style={styles.bulletText}>{line}</Text>
                        </View>
                    ))}
                    {hasReferenceOnlyUlSignals ? (
                        <Text style={styles.detailBodyText}>
                            UL shown as reference. Personalized comparison needs complete daily directions.
                        </Text>
                    ) : null}
                </View>
            </GlassCard>

            <GlassCard
                title="Interactions and watch-outs (general)"
                subtitle={safetyInteractionSubtitle}
                accentColor="#EF4444"
                right={<GlassPill label={safetyInteractionBadge} />}
            >
                <View style={{ gap: 10 }}>
                    {safetyInteractionLines.map((line, idx) => (
                        <View key={`safe-int-${idx}`} style={styles.bulletRow}>
                            <View style={styles.bulletDot} />
                            <Text style={styles.bulletText}>{line}</Text>
                        </View>
                    ))}
                    {SHOW_SCAN_DEBUG && safetySummaryStatus === 'loading' ? (
                        <View style={styles.inlineLoadingRow}>
                            <ActivityIndicator size="small" />
                            <Text style={styles.inlineLoadingText}>Refining summary...</Text>
                        </View>
                    ) : null}
                </View>
            </GlassCard>
        </View>
    );

    const tiles: TileConfig[] = [
        {
            id: 1,
            type: 'overview',
            title: t.analysisTileOverviewTitle,
            modalTitle: t.analysisTileOverviewModalTitle,
            icon: Zap,
            accentColor: 'text-blue-500',
            backgroundColor: '#123CC5',
            textColor: '#F7FBFF',
            labelColor: '#D6E5FF',
            viewLabel: t.analysisView,
            eyebrow: t.analysisEyebrowCoreBenefits,
            summary: authoritativeOverviewTileSummary,
            summaryLines: 2,
            bullets: authoritativeOverviewTileBullets,
            bulletLimit: 2,
            bulletLines: 2,
            dataStatus: unifiedOverviewDataStatus,
            content: overviewContent,
            trustPanel: sharedTrustPanel,
            showDataStatusCard: false,
        },
        {
            id: 2,
            type: 'science',
            title: t.analysisTileScienceTitle,
            modalTitle: t.analysisTileScienceModalTitle,
            icon: BarChart3,
            accentColor: 'text-amber-500',
            backgroundColor: '#F7C948',
            textColor: '#ea580c',
            labelColor: '#ea580c',
            viewLabel: t.analysisView,
            eyebrow: t.analysisEyebrowKeyMechanism,
            mechanisms: authoritativeScienceTileMechanisms,
            footerText: scienceTileFooterText,
            dataStatus: unifiedIngredientsDataStatus,
            content: ingredientsContent,
            trustPanel: sharedTrustPanel,
            showDataStatusCard: false,
        },
        {
            id: 3,
            type: 'usage',
            title: t.analysisTileUsageTitle,
            modalTitle: t.analysisTileUsageModalTitle,
            icon: Clock,
            accentColor: 'text-sky-500',
            backgroundColor: '#8CCBFF',
            textColor: '#0B2545',
            labelColor: '#0B2545',
            viewLabel: t.analysisView,
            eyebrow: t.analysisEyebrowDailyRoutine,
            routineLine: usageRoutine ? { text: usageRoutine } : undefined,
            bullets: usageBullets,
            dataStatus: unifiedUsageDataStatus,
            content: usageContent,
            trustPanel: sharedTrustPanel,
            showDataStatusCard: false,
        },
        {
            id: 4,
            type: 'safety',
            title: t.analysisTileSafetyTitle,
            modalTitle: t.analysisTileSafetyModalTitle,
            icon: Shield,
            accentColor: 'text-rose-500',
            backgroundColor: '#F1E7D8',
            textColor: '#2E2A25',
            labelColor: '#6B5B4B',
            viewLabel: t.analysisView,
            eyebrow: t.analysisEyebrowSafetyNotes,
            warning: { text: safetyWarningCoverText, isPlaceholder: safetyPending && isPlaceholderText(safetyWarningCoverText) },
            tip: { text: safetyTipCoverText, isPlaceholder: safetyPending && isPlaceholderText(safetyTipCoverText) },
            dataStatus: unifiedSafetyDataStatus,
            content: safetyContent,
            trustPanel: sharedTrustPanel,
            showDataStatusCard: false,
        },
    ];
    const selectedTile = useMemo(
        () => (selectedTileType ? tiles.find((tile) => tile.type === selectedTileType) ?? null : null),
        [selectedTileType, tiles],
    );

    type ScoreUiMode = 'not_scored' | 'scoring' | 'scored';
    type ScoreNotScoredCause =
        | 'score_request_failed'
        | 'not_initiated_or_not_eligible';
    const scoreRequestFailed = decisionSupportState.status === 'error';
    const bundleMetaFallback =
        (bundleState.meta as { fallback?: { code?: string } | null }).fallback ?? null;
    const bundleFallbackCodeRaw =
        bundleState.meta.fallbackReason ?? bundleMetaFallback?.code ?? null;
    const bundleFallbackCode = typeof bundleFallbackCodeRaw === 'string' ? bundleFallbackCodeRaw.toLowerCase() : '';
    const bundleFallbackOwnershipBlocked = bundleFallbackCode.includes('ownership_unverified');
    const bundleFallbackWebLimited =
        bundleFallbackCode.includes('needs_js') || bundleFallbackCode.includes('web_text_unusable');
    const bundleScoreReasonCode =
        typeof (bundleState.meta as { scoreReasonCode?: string | null }).scoreReasonCode === 'string'
            ? ((bundleState.meta as { scoreReasonCode?: string | null }).scoreReasonCode as string)
            : null;
    const scoreReasonCode =
        isDataCeiling
            ? 'INSUFFICIENT_RECORD_DATA'
            : bundleScoreReasonCode || (typeof bundleState.meta.fallbackReason === 'string' ? bundleState.meta.fallbackReason : null);
    const scoreReasonMessage =
        decisionSupportState.status === 'error' && normalizeText(decisionSupportState.error).length > 0
            ? normalizeText(decisionSupportState.error)
            : resolveReasonCodeMessage(scoreReasonCode);

    const hasNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    // SCORE_SECTION_FROZEN_PAYLOAD_START
    // Treat the score ring/card contract as frozen unless the user explicitly requests a score change.
    // Detail-sheet copy, AI summaries, and modal rewrites must not become score inputs by accident.
    const scoreCardPayload = decisionTemplatePayload?.nutriScoreCard ?? null;
    const scoreCardV2Payload = decisionTemplatePayload?.nutriScoreCardV2 ?? null;
    const scoreCardV2Modules = Array.isArray(scoreCardV2Payload?.modules)
        ? scoreCardV2Payload.modules
        : [];
    const scoreCardV2DisplayModules = useMemo<DecisionScoreCardV2Module[]>(() => {
        if (scoreCardV2Modules.length === 6) return scoreCardV2Modules;
        return [];
    }, [scoreCardV2Modules]);
    // SCORE_SECTION_FROZEN_PAYLOAD_END
    const telemetrySourceTierUsage = useMemo(() => {
        const counts = {
            official: 0,
            scanned: 0,
            overlay: 0,
            generalScience: 0,
        };
        const addByTier = (tier: string | null | undefined) => {
            if (tier === 'official_record') counts.official += 1;
            else if (tier === 'scanned_label') counts.scanned += 1;
            else if (tier === 'overlay_iherb') counts.overlay += 1;
            else if (tier === 'general_science') counts.generalScience += 1;
        };

        scoreCardV2DisplayModules.forEach((module) => {
            (module?.checklist ?? []).forEach((item) => {
                addByTier(item?.sourceTier ?? null);
            });
        });
        addByTier(decisionUsageBlock?.directions?.sourceTier ?? null);
        (decisionScienceBlock?.odsGeneralScienceBullets ?? []).forEach(() => {
            counts.generalScience += 1;
        });
        (decisionSafetyBlock?.ulGuidance ?? []).forEach(() => {
            counts.generalScience += 1;
        });
        (decisionSafetyBlock?.generalWatchouts ?? []).forEach(() => {
            counts.generalScience += 1;
        });
        return counts;
    }, [
        decisionSafetyBlock?.generalWatchouts,
        decisionSafetyBlock?.ulGuidance,
        decisionScienceBlock?.odsGeneralScienceBullets,
        decisionUsageBlock?.directions?.sourceTier,
        scoreCardV2DisplayModules,
    ]);
    const usedCategorySpecificRanking = useMemo(() => {
        if (!isOmegaLikeCover) return false;
        const topNames = authoritativeScienceTileMechanisms
            .slice(0, 3)
            .map((item) => normalizeText(item?.name).toLowerCase())
            .filter(Boolean);
        if (topNames.length === 0) return false;
        const hasOmegaActives = topNames.some((name) => /total omega|epa|dha|fish oil/.test(name));
        const hasNutritionFallback = topNames.some((name) => /calories|total fat/.test(name));
        return hasOmegaActives && !hasNutritionFallback;
    }, [authoritativeScienceTileMechanisms, isOmegaLikeCover]);
    const usedFallbackCopyCount = useMemo(() => {
        const fallbackPattern =
            /still loading|open this card|general reminder|follow the package label directions|safety data is limited|key product facts are summarized|active ingredient details are still loading|latest verified product details are loading|loading verified product facts|verified ingredient details loading|preparing facts/i;
        const lines: string[] = [
            authoritativeOverviewTileSummary.text,
            ...authoritativeOverviewTileBullets.map((item) => item.text),
            usageRoutine,
            ...usageBullets.map((item) => item.text),
            safetyWarningCoverText,
            safetyTipCoverText,
        ];
        return lines.reduce((count, line) => (fallbackPattern.test(normalizeText(line)) ? count + 1 : count), 0);
    }, [
        authoritativeOverviewTileBullets,
        authoritativeOverviewTileSummary.text,
        safetyTipCoverText,
        safetyWarningCoverText,
        usageBullets,
        usageRoutine,
    ]);
    const overlayConsumerFieldHitCount =
        telemetrySourceTierUsage.official
        + telemetrySourceTierUsage.scanned
        + telemetrySourceTierUsage.overlay
        + telemetrySourceTierUsage.generalScience;
    const decisionSupportV2Available = scoreCardV2DisplayModules.length === 6;
    const legacyVisibleFallback = !decisionSupportV2Available;
    const mobileUiLegacyCallCount = FREEZE_SHADOW_ONLY ? 0 : null;
    useEffect(() => {
        const digest = typeof bundleState.meta.factsDigestHash === 'string' ? bundleState.meta.factsDigestHash : '';
        if (!digest) return;
        if (overlayConsumerMetricLoggedRef.current.has(digest)) return;
        overlayConsumerMetricLoggedRef.current.add(digest);
        const payload = {
            sourceType: bundleSourceType ?? null,
            sourceTypeFinal: bundleSourceTypeFinal,
            overlayConsumerFieldHitCount,
            usedOfficialFields: telemetrySourceTierUsage.official,
            usedScannedLabelFields: telemetrySourceTierUsage.scanned,
            usedIherbOverlayFields: telemetrySourceTierUsage.overlay,
            usedGeneralScienceFields: telemetrySourceTierUsage.generalScience,
            legacyVisibleFallback,
            mobile_ui_legacy_call_count: mobileUiLegacyCallCount,
            decisionSupportV2Available,
            usedCategorySpecificRanking,
            usedFallbackCopyCount,
        };
        console.info('[overlay-consumer-metric]', payload);
        emitScanUxMetric('scan_overlay_consumer_fields', {
            viewMode: SCAN_UX_VIEW_MODE,
            variant: SCAN_UX_VARIANT,
            ...payload,
        });
    }, [
        bundleSourceType,
        bundleSourceTypeFinal,
        bundleState.meta.factsDigestHash,
        decisionSupportV2Available,
        legacyVisibleFallback,
        mobileUiLegacyCallCount,
        overlayConsumerFieldHitCount,
        telemetrySourceTierUsage.generalScience,
        telemetrySourceTierUsage.official,
        telemetrySourceTierUsage.overlay,
        telemetrySourceTierUsage.scanned,
        usedCategorySpecificRanking,
        usedFallbackCopyCount,
    ]);
    // SCORE_SECTION_FROZEN_STATE_START
    const scoreCardRows = scoreCardPayload?.rows ?? [];
    const scoreCardChecklists = scoreCardPayload?.checklistsByRow ?? null;
    const overviewBlock = decisionOverviewBlock;
    const scienceBlock = decisionScienceBlock;
    const usageBlock = decisionUsageBlock;
    const safetyBlock = decisionSafetyBlock;
    const qualityMark = decisionQualityMark;

    const findScoreCardRowScore = (rowId: 'effectiveness' | 'safety' | 'integrity'): number | null => {
        const row = scoreCardRows.find((item) => item.id === rowId);
        return hasNumber(row?.score) ? row.score : null;
    };
    const unknownRatioByRow = (rowId: 'effectiveness' | 'safety' | 'integrity'): number => {
        const rows = scoreCardChecklists?.[rowId] ?? [];
        if (!rows.length) return 1;
        const unknownCount = rows.filter((item) => item.status === 'unknown').length;
        return unknownCount / rows.length;
    };
    const applyUnknownScoreCap = (score: number, unknownRatio: number): number => {
        if (unknownRatio > 0.6) return Math.min(score, 45);
        if (unknownRatio > 0.4) return Math.min(score, 60);
        return score;
    };

    const findV2ModuleScore = useCallback((moduleId: DecisionScoreCardV2Module['id']): number | null => {
        const module = scoreCardV2Modules.find((item) => item.id === moduleId);
        return hasNumber(module?.score) ? module.score : null;
    }, [scoreCardV2Modules]);
    const averageScores = useCallback((values: Array<number | null>): number | null => {
        const filtered = values.filter((value): value is number => hasNumber(value));
        if (filtered.length === 0) return null;
        return Math.round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length);
    }, []);
    const decisionEffectivenessRaw = findScoreCardRowScore('effectiveness');
    const decisionSafetyRaw = findScoreCardRowScore('safety');
    const decisionIntegrityRaw = findScoreCardRowScore('integrity');
    const decisionEffectivenessScore =
        hasNumber(decisionEffectivenessRaw)
            ? applyUnknownScoreCap(decisionEffectivenessRaw, unknownRatioByRow('effectiveness'))
            : averageScores([
                findV2ModuleScore('formula_transparency'),
                findV2ModuleScore('product_quality'),
            ]);
    const decisionSafetyScore =
        hasNumber(decisionSafetyRaw)
            ? applyUnknownScoreCap(decisionSafetyRaw, unknownRatioByRow('safety'))
            : averageScores([
                findV2ModuleScore('ingredient_safety'),
                findV2ModuleScore('label_clarity'),
            ]);
    const decisionIntegrityScore =
        hasNumber(decisionIntegrityRaw)
            ? applyUnknownScoreCap(decisionIntegrityRaw, unknownRatioByRow('integrity'))
            : averageScores([
                findV2ModuleScore('manufacturing_standards'),
                findV2ModuleScore('testing_verification'),
            ]);
    const hasDecisionRowScores =
        hasNumber(decisionEffectivenessScore)
        && hasNumber(decisionSafetyScore)
        && hasNumber(decisionIntegrityScore);
    const decisionScoreReady = hasDecisionRowScores;
    const resolvedDecisionScores = decisionScoreReady
        ? {
            effectiveness: decisionEffectivenessScore,
            safety: decisionSafetyScore,
            integrity: decisionIntegrityScore,
        }
        : null;

    const effectiveScoreUiMode: ScoreUiMode =
        decisionScoreReady
            ? 'scored'
            : decisionSupportState.status === 'loading' || decisionSupportState.status === 'idle' || isStreaming
                ? 'scoring'
                : 'not_scored';

    const ringScores =
        effectiveScoreUiMode === 'scored' && resolvedDecisionScores
            ? {
                effectiveness: resolvedDecisionScores.effectiveness,
                safety: resolvedDecisionScores.safety,
                integrity: resolvedDecisionScores.integrity,
                value: resolvedDecisionScores.integrity,
                overall: Math.round(
                    (resolvedDecisionScores.effectiveness + resolvedDecisionScores.safety + resolvedDecisionScores.integrity) / 3,
                ),
            }
            : { effectiveness: 0, safety: 0, integrity: null, value: 0, overall: 0 };
    const ringMuted = effectiveScoreUiMode !== 'scored' || scoreState === 'muted';
    const ringDisplay =
        effectiveScoreUiMode === 'not_scored'
            ? {
                overall: t.analysisScoreNotScored,
                effectiveness: '--',
                safety: '--',
                value: '--',
            }
            : effectiveScoreUiMode === 'scoring'
                ? {
                    overall: t.analysisScoreScoring,
                    effectiveness: '--',
                    safety: '--',
                    value: '--',
                }
                : undefined;
    const scoreNotScoredCause: ScoreNotScoredCause | null =
        effectiveScoreUiMode !== 'not_scored'
            ? null
            : decisionSupportState.status === 'error'
                ? 'score_request_failed'
                : 'not_initiated_or_not_eligible';
    const notScoredReason =
        scoreNotScoredCause === 'score_request_failed'
                ? t.analysisScoreNotScoredReasonRequestFailed
                : bundleFallbackOwnershipBlocked
            ? t.analysisScoreNotScoredReasonOwnership
            : bundleSourceType === 'web' || bundleFallbackWebLimited
                ? t.analysisScoreNotScoredReasonWeb
                : scoreReasonMessage || t.analysisScoreNotScoredReasonUnavailable;
    const showScoreRetryCta = Boolean(onRetryScore)
        && effectiveScoreUiMode === 'not_scored'
        && scoreNotScoredCause === 'score_request_failed';
    const scoreMetaBlockedReasons = new Set<string>([
        t.analysisScoreNotScoredReasonUnavailable,
        t.analysisScoreNotScoredReasonWeb,
        t.analysisScoreNotScoredReasonOwnership,
        t.analysisScoreScoringReason,
    ]);
    const ringMetaLinesRaw =
        effectiveScoreUiMode === 'not_scored'
            ? [notScoredReason]
            : effectiveScoreUiMode === 'scoring'
                ? [t.analysisScoreScoringReason]
                : [];
    const ringMetaLines =
        effectiveScoreUiMode === 'scored'
            ? ringMetaLinesRaw.filter((line) => !scoreMetaBlockedReasons.has(line))
            : ringMetaLinesRaw;
    // SCORE_SECTION_FROZEN_STATE_END

    const baseScoreDescriptions =
        effectiveScoreUiMode === 'scored'
            ? {
                effectiveness: {
                    verdict: 'Evidence-based effectiveness score.',
                    highlights: [],
                },
                safety: {
                    verdict: 'Safety score reflects ingredient risks and UL guidance when available.',
                    highlights: [],
                },
                practicality: {
                    verdict: 'Integrity score reflects label disclosure and formulation transparency.',
                    highlights: [],
                },
            }
            : {
                effectiveness: { verdict: '', highlights: [] },
                safety: { verdict: '', highlights: [] },
                practicality: { verdict: '', highlights: [] },
            };
    const unknownCategories =
        effectiveScoreUiMode === 'scored'
            ? {
                effectiveness: !hasNumber(decisionEffectivenessScore),
                safety: !hasNumber(decisionSafetyScore),
                value: !hasNumber(decisionIntegrityScore),
            }
            : { effectiveness: false, safety: false, value: false };

    const identityType = normalizeText(bundleState.meta.authoritativeIdentity?.type ?? null);
    const identityValue = normalizeText(bundleState.meta.authoritativeIdentity?.value ?? null);
    const officialRecordLine = identityType === 'dsldlabelid' && identityValue
        ? `Official record: DSLD (dsldLabelId:${identityValue})`
        : identityType === 'npn' && identityValue
            ? `Official record: LNHPD (npn:${identityValue})`
            : 'Official record: Not linked yet (barcode only)';

    const labelUsedLine = usageBlock?.directions?.sourceTier === 'scanned_label'
        ? 'Label used: Yes (scanned-label patch applied)'
        : usageBlock?.directions?.sourceTier === 'overlay_iherb'
            ? 'Label used: Yes (supplemental product-page label data used)'
        : usageBlock?.directions?.hasDirectionsTextVisible
            ? 'Label used: Yes (official record directions available)'
            : 'Label used: No (directions/warnings not extracted yet)';

    const retrievedFromRecord = normalizeText(
        (analysis as { analysis?: { labelExtraction?: { fetchedAt?: string | null } | null } | null })?.analysis?.labelExtraction?.fetchedAt
        ?? null,
    );
    const retrievedFromVersion = normalizeText((bundleState.meta as { factsSourceVersion?: string | null })?.factsSourceVersion ?? null);
    const retrievedLine = `Retrieved: ${retrievedFromRecord || retrievedFromVersion || '(from record)'}`;
    const overviewSourceStripLines = [
        officialRecordLine,
        labelUsedLine,
        decisionOverlayUsed ? 'Supplemental product-page label data: used' : null,
        retrievedLine,
        'View sources: (sources drawer)',
    ].filter((line): line is string => Boolean(line));

    const factsSourceTarget = resolveFactsSourceFromIdentity(bundleState.meta.authoritativeIdentity);
    const simpleOfficialRecordUrl = factsSourceTarget
        ? buildOfficialRecordUrl(factsSourceTarget.source, factsSourceTarget.sourceId)
        : null;
    const sourceRows = useMemo(() => {
        const rows: { label: string; value: string; url?: string | null }[] = [];
        if (simpleOfficialRecordUrl && identityValue) {
            rows.push({
                label: 'Official record',
                value: identityType === 'dsldlabelid' ? `DSLD ${identityValue}` : `LNHPD ${identityValue}`,
                url: simpleOfficialRecordUrl,
            });
        }
        const incomingSources = Array.isArray((analysis as { sources?: Record<string, unknown>[] | null })?.sources)
            ? ((analysis as { sources?: Record<string, unknown>[] }).sources ?? [])
            : [];
        incomingSources.forEach((source, idx) => {
            const title = normalizeText((source.title as string | null | undefined) ?? null) || `Source ${idx + 1}`;
            const url = normalizeText((source.url as string | null | undefined) ?? null)
                || normalizeText((source.link as string | null | undefined) ?? null)
                || null;
            rows.push({
                label: title,
                value: url ?? 'No URL available',
                url,
            });
        });
        if (rows.length === 0) {
            rows.push({
                label: 'Source',
                value: 'No linked source pages were returned for this scan yet.',
                url: null,
            });
        }
        return rows;
    }, [analysis, identityType, identityValue, simpleOfficialRecordUrl]);

    const fallbackBestForCandidates = (
        (overviewBlock?.bestForBullets && overviewBlock.bestForBullets.length > 0)
            ? overviewBlock.bestForBullets
            : overviewBullets.map((item) => item.text)
    );
    const isOmegaLike = /\b(omega|epa|dha|fish oil|krill)\b/i.test(
        [
            productTitle,
            ...(overviewBlock?.providesVerified?.keyIngredients ?? []).map((item) => normalizeText(item?.name ?? null)),
        ].join(' '),
    );
    const overviewBestForBullets = buildBestForContractLines({
        candidateLines: fallbackBestForCandidates,
        isOmegaLike,
    }).slice(0, 3);

    const overviewProvides = overviewBlock?.providesVerified;
    const overviewProvideLines: string[] = [];
    if (overviewProvides?.servingSize) {
        overviewProvideLines.push(`Serving size: ${overviewProvides.servingSize}`);
    }
    if (typeof overviewProvides?.servingsPerContainer === 'number') {
        overviewProvideLines.push(`Servings per container: ${overviewProvides.servingsPerContainer}`);
    }
    (overviewProvides?.keyIngredients ?? []).slice(0, 3).forEach((item) => {
        overviewProvideLines.push(`${item.name}${item.dose ? `: ${item.dose}` : ''}`);
    });
    if (overviewProvides?.dosageForm) {
        overviewProvideLines.push(`Dosage form: ${overviewProvides.dosageForm}`);
    }
    const hasProvidesData = overviewProvideLines.length > 0;
    if (!hasProvidesData) {
        overviewProvideLines.push('Key ingredient: not available yet from this record.');
    }
    const missingInfoCandidates = [
        ...(
            (overviewBlock?.missingInfo && overviewBlock.missingInfo.length > 0)
                ? overviewBlock.missingInfo
                : overviewMissingInfoLines
        ),
        ...(hasProvidesData ? [] : ['Key ingredient and dose are not available from this record.']),
    ];
    const dedupMissing = Array.from(
        new Set(
            missingInfoCandidates
                .map((line) => normalizeText(line))
                .filter(Boolean),
        ),
    );
    const overviewMissingInfo = dedupMissing.slice(0, 2);
    const usageDirectionsLines = (
        Array.isArray(usageBlock?.directions?.lines) && usageBlock?.directions?.lines?.length
            ? usageBlock?.directions?.lines
            : [
                (typeof usageBlock?.directions?.text === 'string' ? usageBlock.directions.text.trim() : '')
                || usageRecordLines[0]
                || 'Directions are not included in the official record.',
            ]
    ).slice(0, 3);
    const usageDirectionsTier = usageBlock?.directions?.sourceTier ?? 'official_record';
    const usageDirectionsTierLabel = usageDirectionsTier === 'scanned_label'
        ? sourceTierLabel('scanned_label')
        : usageDirectionsTier === 'overlay_iherb'
            ? 'Supplemental label data'
            : sourceTierLabel('official_record');
    const safetyWarnings = (safetyBlock?.labelWarnings && safetyBlock.labelWarnings.length > 0)
        ? safetyBlock.labelWarnings
        : safetyLabelLines;
    const safetyUl = (safetyBlock?.ulGuidance && safetyBlock.ulGuidance.length > 0)
        ? safetyBlock.ulGuidance
        : safetyUlGuidanceLines;
    const safetyWatchouts = (safetyBlock?.generalWatchouts && safetyBlock.generalWatchouts.length > 0)
        ? safetyBlock.generalWatchouts
        : safetyInteractionLines;
    const hasTemplateChecklistData = Boolean(
        scoreCardChecklists
        && (
            (scoreCardChecklists.effectiveness?.length ?? 0) > 0
            || (scoreCardChecklists.safety?.length ?? 0) > 0
            || (scoreCardChecklists.integrity?.length ?? 0) > 0
        ),
    );
    const templateChecklistLoading =
        !hasTemplateChecklistData
        && (decisionSupportState.status === 'idle' || decisionSupportState.status === 'loading');
    const effectivenessChecklistRows = scoreCardChecklists?.effectiveness ?? [];
    const safetyChecklistRows = scoreCardChecklists?.safety ?? [];
    const integrityChecklistRows = scoreCardChecklists?.integrity ?? [];
    const topBlockers = Array.isArray(decisionTemplatePayload?.topBlockers)
        ? decisionTemplatePayload.topBlockers
        : null;
    const hasCoreBlockers = Array.isArray(topBlockers)
        ? topBlockers.some((blocker) => blocker && (blocker.affectsCoreVerdict ?? true))
        : false;
    const noUnresolvedBlockerStatus: ScoreTemplateItemStatus = topBlockers == null
        ? 'unknown'
        : hasCoreBlockers
            ? 'missing'
            : 'verified';

    const qualityMarkCheckedStatus: ScoreTemplateItemStatus = qualityMark?.checked ? 'verified' : 'unknown';
    const qualityMarkStatusLine = (() => {
        if (qualityMark?.checkedMode === 'search_only' || qualityMark?.evidenceType === 'search') {
            return {
                label: 'unknown (search-only evidence)',
                status: 'unknown' as ScoreTemplateItemStatus,
            };
        }
        if (qualityMark?.status === 'detected' && qualityMark?.evidenceType === 'page') {
            return {
                label: 'detected',
                status: 'verified' as ScoreTemplateItemStatus,
            };
        }
        if (
            qualityMark?.status === 'not_detected'
            && qualityMark?.checkedMode === 'page_fetch'
            && (qualityMark?.pagesFetchedCount ?? 0) >= 2
        ) {
            return {
                label: 'not_detected (real pages fetched)',
                status: 'missing' as ScoreTemplateItemStatus,
            };
        }
        return {
            label: 'unknown',
            status: 'unknown' as ScoreTemplateItemStatus,
        };
    })();

    const effectivenessSections: ScoreTemplateSection[] = [
        {
            title: 'Goal / Evidence Fit',
            items: [
                {
                    label: 'Official record linked',
                    status: resolveChecklistStatusByKey(effectivenessChecklistRows, 'goalevidencefit:official_record_used'),
                },
                {
                    label: 'Category intent recognized (e.g., omega-3, vitamin D)',
                    status: resolveChecklistStatusByKey(effectivenessChecklistRows, 'goalevidencefit:ingredient_signal_present'),
                },
            ],
        },
        {
            title: 'Formula Quality',
            items: [
                {
                    label: 'Active amount disclosed (e.g., krill oil mg)',
                    status: resolveChecklistStatusByKey(effectivenessChecklistRows, 'formulaquality:amount_disclosed'),
                },
                {
                    label: 'EPA+DHA breakdown disclosed (for omega-3)',
                    status: resolveChecklistStatusByKey(effectivenessChecklistRows, 'formulaquality:active_breakdown'),
                },
                {
                    label: 'Chemical form disclosed (e.g., D3 vs D2 / citrate vs oxide)',
                    status: resolveChecklistStatusByKey(effectivenessChecklistRows, 'formulaquality:form_disclosed'),
                },
            ],
        },
    ];

    const safetySections: ScoreTemplateSection[] = [
        {
            title: 'Safety Transparency',
            items: [
                {
                    label: 'Directions present in record',
                    status: resolveChecklistStatusByKey(safetyChecklistRows, 'safetytransparency:directions_present'),
                },
                {
                    label: 'Label warnings present in record',
                    status: resolveChecklistStatusByKey(safetyChecklistRows, 'safetytransparency:warnings_present'),
                },
                {
                    label: 'Missing items surfaced in "Missing info"',
                    status: resolveChecklistStatusByKey(safetyChecklistRows, 'safetytransparency:warnings_ceiling_notice'),
                },
            ],
        },
        {
            title: 'Upper Limit / General Watchouts',
            items: [
                {
                    label: 'UL guidance available (if category has UL)',
                    status: safetyUl.length > 0 ? 'verified' : 'unknown',
                },
                {
                    label: 'General risk factors surfaced (pregnant / meds / surgery etc.)',
                    status: safetyWatchouts.length > 0 ? 'verified' : 'unknown',
                },
            ],
        },
    ];

    const integritySections: ScoreTemplateSection[] = [
        {
            title: 'Source & Data Integrity',
            items: [
                {
                    label: 'Authoritative source finalized (DSLD / LNHPD)',
                    status: resolveChecklistStatusByKey(integrityChecklistRows, 'trustqualityassurance:source_finality'),
                },
                {
                    label: 'Scanned-label patch applied (if applicable)',
                    status: usageBlock?.directions?.sourceTier === 'scanned_label' ? 'verified' : 'unknown',
                },
                {
                    label: 'No unresolved blocker',
                    status: noUnresolvedBlockerStatus,
                },
            ],
        },
        {
            title: 'Third-party Quality',
            items: [
                {
                    label: 'Third-party quality mark checked',
                    status: qualityMarkCheckedStatus,
                },
                {
                    label: qualityMarkStatusLine.label,
                    status: qualityMarkStatusLine.status,
                },
            ],
        },
    ];

    const scoreDescriptions: {
        effectiveness: ContentSection;
        safety: ContentSection;
        practicality: ContentSection;
    } = {
        effectiveness: {
            ...baseScoreDescriptions.effectiveness,
            templateLoading: templateChecklistLoading,
            templateSections: hasTemplateChecklistData ? effectivenessSections : undefined,
        },
        safety: {
            ...baseScoreDescriptions.safety,
            templateLoading: templateChecklistLoading,
            templateSections: hasTemplateChecklistData ? safetySections : undefined,
        },
        practicality: {
            ...baseScoreDescriptions.practicality,
            templateLoading: templateChecklistLoading,
            templateSections: hasTemplateChecklistData ? integritySections : undefined,
        },
    };
    const displayedOverallScore =
        hasNumber(scoreCardV2Payload?.overallScore)
            ? Number(scoreCardV2Payload?.overallScore)
            : ringScores.overall;
    const displayedOverallBand =
        hasNumber(scoreCardV2Payload?.overallScore) || effectiveScoreUiMode === 'scored'
            ? normalizeText(scoreCardV2Payload?.overallBand ?? null) || getOverallBandLabel(displayedOverallScore)
            : null;
    const shouldRenderInlineMiniHeader = !disableMiniHeader && miniHeaderMode !== 'header';

    useEffect(() => {
        onMiniScoreMetaChange?.({
            overallScore: displayedOverallScore,
            overallBand: displayedOverallBand,
            muted: ringMuted,
        });
    }, [displayedOverallBand, displayedOverallScore, onMiniScoreMetaChange, ringMuted]);

    return (
        <View style={styles.root}>
            {shouldRenderInlineMiniHeader ? (
                <MiniScoreHeader
                    scrollY={scrollY}
                    overallScore={displayedOverallScore}
                    overallBand={displayedOverallBand}
                    muted={ringMuted}
                />
            ) : null}

            <ScrollContainer
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                {...scrollProps}
            >
                {!disableHeroHeader ? (
                    <View style={styles.heroHeader}>
                        <LinearGradient
                            colors={['rgba(255,255,255,0.86)', 'rgba(255,255,255,0.58)']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.heroCard}
                        >
                            <DashboardBlur intensity={18} tint="light" style={StyleSheet.absoluteFill} />

                            <View style={styles.heroTopRow}>
                                {productInfo?.image ? (
                                    <Image
                                        source={{ uri: productInfo.image }}
                                        style={styles.heroImage}
                                        resizeMode="cover"
                                    />
                                ) : (
                                    <View style={styles.heroImagePlaceholder}>
                                        <BarChart3 size={18} color="#111827" />
                                    </View>
                                )}

                                <View style={styles.heroTextBlock}>
                                    <Text style={styles.heroEyebrow}>{t.analysisHeaderEyebrow}</Text>
                                    <Text style={styles.heroTitle} numberOfLines={2}>
                                        {productTitle}
                                    </Text>
                                    {!!productSubtitle && (
                                        <Text style={styles.heroSubtitle} numberOfLines={2} ellipsizeMode="tail">
                                            {productSubtitle}
                                        </Text>
                                    )}
                                </View>
                            </View>

                            <View style={styles.heroPillsRow}>
                                <GlassPill label={sourceBadgeLabel} />
                                {scoreBadge ? <GlassPill label={scoreBadge} accentColor={ringMuted ? '#9CA3AF' : '#111827'} /> : null}
                            </View>
                        </LinearGradient>
                    </View>
                ) : null}

                <>
                        {/* SCORE_SECTION_FROZEN_RENDER_START */}
                        <View style={styles.scoreSection}>
                            <View style={styles.scoreHeroCard}>
                                {!disableScoreRing ? (
                                    decisionSupportV2Available ? (
                                        <NutriScoreCardV2
                                            overallScore={displayedOverallScore}
                                            overallBand={displayedOverallBand}
                                            modules={scoreCardV2DisplayModules}
                                            muted={ringMuted}
                                        />
                                    ) : (
                                        <View style={styles.scoreLoadingCard}>
                                            <Text style={styles.scoreLoadingTitle}>Nutri Score</Text>
                                            <Text style={styles.scoreLoadingBody}>
                                                {decisionTemplatePending
                                                    ? 'Calculating verified score details...'
                                                    : 'Verified score details are refreshing for this scan.'}
                                            </Text>
                                        </View>
                                    )
                                ) : (
                                    <View style={styles.bisectNoticeCard}>
                                        <Text style={styles.bisectNoticeTitle}>Score Ring disabled</Text>
                                        <Text style={styles.bisectNoticeText}>{scoreRingDisableNotice}</Text>
                                    </View>
                                )}

                            </View>
                        </View>
                        {/* SCORE_SECTION_FROZEN_RENDER_END */}

                        {!disableTilesGrid ? (
                            <>
                                <View style={styles.tilesHeader}>
                                    <Text style={styles.tilesTitle}>{t.analysisDeepCategoriesTitle}</Text>
                                    <Text style={styles.tilesSubtitle}>{t.analysisDeepCategoriesSubtitle}</Text>
                                </View>

                                <View style={styles.tilesGrid} onLayout={onTilesGridLayout}>
                                    {tiles.map((tile) => (
                                        <TileRenderer
                                            key={tile.id}
                                            tile={tile}
                                            onPress={() => setSelectedTileType(tile.type)}
                                            scrollY={scrollY}
                                            viewportHeight={viewportHeight}
                                            tileWidth={tileWidth}
                                            style={{ marginBottom: TILE_GAP }}
                                        />
                                    ))}
                                </View>
                            </>
                        ) : (
                            <View style={styles.bisectNoticeCard}>
                                <Text style={styles.bisectNoticeTitle}>Tiles grid disabled</Text>
                                <Text style={styles.bisectNoticeText}>Set by `no_tiles` in `EXPO_PUBLIC_SCAN_DASHBOARD_BISECT`.</Text>
                            </View>
                        )}
                    </>
            </ScrollContainer>

            {!disableModalPane ? (
                <DashboardModal
                    key={selectedTileType ?? 'closed'}
                    visible={!!selectedTile}
                    tile={selectedTile}
                    onClose={() => setSelectedTileType(null)}
                    sourceType={bundleSourceType ?? null}
                    sourceTypeFinal={bundleSourceTypeFinal}
                />
            ) : null}
        </View>
    );
};

type AnalysisDashboardProps = {
    analysis: Analysis;
    isStreaming?: boolean;
    scoreBadge?: string;
    scoreState?: ScoreState;
    sourceType?: SourceType;
    scanSessionId?: string | null;
    analysisBundle?: AnalysisBundle | null;
    scoreBundleV4State?: ScoreBundleV4State;
    onRetryScore?: () => void;
    externalScrollY?: SharedValue<number>;
    miniHeaderMode?: 'inline' | 'header';
    onMiniScoreMetaChange?: (meta: { overallScore: number; overallBand: string | null; muted: boolean }) => void;
};

const LegacyAnalysisDashboard: React.FC<AnalysisDashboardProps> = ({ analysis, isStreaming = false, scoreBadge, scoreState, sourceType, scanSessionId = null, analysisBundle, scoreBundleV4State, onRetryScore }) => {
    const [selectedTile, setSelectedTile] = useState<TileConfig | null>(null);
    const { t } = useTranslation();
    const scrollY = useSharedValue(0);
    const scrollHandler = useAnimatedScrollHandler((event) => {
        scrollY.value = event.contentOffset.y;
    });
    const { height: viewportHeight } = useWindowDimensions();
    const [tilesContainerW, setTilesContainerW] = useState(0);

    const TILE_GAP = 12;
    const tileWidth: DimensionValue = tilesContainerW > 0 ? tilesContainerW : '100%';
    const TileRenderer = disableTileAnimation ? StaticTile : AnimatedTile;
    const ScrollContainer: any = disableReanimatedScroll ? ScrollView : Animated.ScrollView;
    const scrollProps = disableReanimatedScroll
        ? {}
        : { onScroll: scrollHandler };

    const onTilesGridLayout = useCallback((e: LayoutChangeEvent) => {
        const nextWidth = e.nativeEvent.layout.width;
        setTilesContainerW((prev) => (Math.abs(prev - nextWidth) < 1 ? prev : nextWidth));
    }, []);

    const productInfo = useMemo(() => analysis.productInfo ?? {}, [analysis.productInfo]);
    const efficacy = useMemo(() => analysis.efficacy ?? {}, [analysis.efficacy]);
    const usage = useMemo(() => analysis.usage ?? {}, [analysis.usage]);
    const safety = useMemo(() => analysis.safety ?? {}, [analysis.safety]);
    const value = useMemo(() => analysis.value ?? {}, [analysis.value]);
    const social = useMemo(() => analysis.social ?? {}, [analysis.social]);
    const sourceRefs = useMemo(
        () => buildSourceRefs(Array.isArray(analysis.sources) ? analysis.sources : [], sourceType),
        [analysis.sources, sourceType]
    );
    const analysisMeta = useMemo(() => analysis.meta ?? null, [analysis.meta]);
    const labelSource =
        (analysisMeta as { labelExtraction?: { source?: string | null } | null } | null)?.labelExtraction?.source ?? null;
    const isRegulatoryLabel = labelSource === 'lnhpd';
    const analysisStatus = (analysisMeta as { analysisStatus?: string | null; status?: string | null } | null)?.analysisStatus
        ?? (analysisMeta as { status?: string | null } | null)?.status
        ?? null;

    const isLabelSource = sourceType === 'label_scan';
    const badgeTextSafe = isLabelSource ? scoreBadge : undefined;
    const requiresProvisional =
        analysisStatus === 'catalog_only' || analysisStatus === 'label_enriched';
    const scoreAvailability = useMemo(() => ({
        effectiveness: !requiresProvisional && typeof efficacy.score === 'number',
        safety: !requiresProvisional && typeof safety.score === 'number',
        value: !requiresProvisional && typeof value.score === 'number',
    }), [efficacy.score, safety.score, value.score, requiresProvisional]);
    const availableScoreCount =
        (scoreAvailability.effectiveness ? 1 : 0) +
        (scoreAvailability.safety ? 1 : 0) +
        (scoreAvailability.value ? 1 : 0);
    const derivedScoreConfidence: CoverStatus =
        availableScoreCount === 0
            ? 'limited'
            : availableScoreCount === 3
                ? 'complete'
                : 'partial';
    const scoreConfidence: CoverStatus =
        scoreState === 'muted' || scoreState === 'loading' ? 'limited' : derivedScoreConfidence;
    const provisionalScore = 50;

    // Compute scores using new AI-driven scoring system
    const scores = useMemo(() => {
        if (scoreConfidence === 'complete') {
            const analysisInput: AnalysisInput = {
                efficacy: {
                    score: efficacy.score,
                    primaryActive: efficacy.primaryActive ?? null,
                    ingredients: efficacy.ingredients ?? [],
                    overallAssessment: efficacy.overallAssessment,
                    marketingVsReality: efficacy.marketingVsReality,
                    coreBenefits: efficacy.coreBenefits ?? efficacy.benefits ?? [],
                },
                safety: {
                    score: safety.score,
                    ulWarnings: safety.ulWarnings ?? [],
                    allergens: safety.allergens ?? [],
                    interactions: safety.interactions ?? [],
                    redFlags: safety.redFlags ?? [],
                    consultDoctorIf: safety.consultDoctorIf ?? [],
                },
                value: {
                    score: value.score,
                    costPerServing: value.costPerServing ?? null,
                    alternatives: value.alternatives ?? [],
                },
                social: {
                    score: social.score,
                    summary: social.summary,
                },
            };

            return computeSmartScores(analysisInput);
        }

        if (availableScoreCount === 0 || scoreConfidence === 'limited') {
            return {
                effectiveness: provisionalScore,
                safety: provisionalScore,
                value: provisionalScore,
                overall: provisionalScore,
                label: t.analysisProvisional,
                details: {
                    effectivenessFactors: [],
                    safetyFactors: [],
                    valueFactors: [],
                },
            };
        }

        const effectivenessScore = scoreAvailability.effectiveness
            ? Math.round((efficacy.score ?? 0) * 10)
            : provisionalScore;
        const safetyScore = scoreAvailability.safety
            ? Math.round((safety.score ?? 0) * 10)
            : provisionalScore;
        const valueScore = scoreAvailability.value
            ? Math.round((value.score ?? 0) * 10)
            : provisionalScore;
        const weights = { effectiveness: 0.4, safety: 0.35, value: 0.25 };
        let weightedSum = 0;
        let totalWeight = 0;
        if (scoreAvailability.effectiveness) {
            weightedSum += effectivenessScore * weights.effectiveness;
            totalWeight += weights.effectiveness;
        }
        if (scoreAvailability.safety) {
            weightedSum += safetyScore * weights.safety;
            totalWeight += weights.safety;
        }
        if (scoreAvailability.value) {
            weightedSum += valueScore * weights.value;
            totalWeight += weights.value;
        }
        const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : provisionalScore;

        return {
            effectiveness: effectivenessScore,
            safety: safetyScore,
            value: valueScore,
            overall: overallScore,
            label: t.analysisProvisional,
            details: {
                effectivenessFactors: [],
                safetyFactors: [],
                valueFactors: [],
            },
        };
    }, [
        efficacy,
        safety,
        value,
        social,
        scoreConfidence,
        scoreAvailability,
        availableScoreCount,
        t.analysisProvisional,
    ]);
    const legacyNotScored = scoreConfidence !== 'complete';
    const unknownCategories = legacyNotScored
        ? { effectiveness: true, safety: true, value: true }
        : {
            effectiveness: !scoreAvailability.effectiveness,
            safety: !scoreAvailability.safety,
            value: !scoreAvailability.value,
        };
    const displayOverrides = legacyNotScored
        ? { overall: '--', effectiveness: '--', safety: '--', value: '--' }
        : {
            overall: undefined,
            effectiveness: unknownCategories.effectiveness ? '--' : undefined,
            safety: unknownCategories.safety ? '--' : undefined,
            value: unknownCategories.value ? '--' : undefined,
        };
    const ringScores = legacyNotScored
        ? { effectiveness: 0, safety: 0, value: 0, overall: 0, label: t.analysisScoreNotScored, details: scores.details }
        : scores;
    const formatScoreText = (value: number, override?: string) => {
        if (override) return override;
        return Number.isFinite(value) ? `${Math.round(value)}/100` : 'AI';
    };
    const overviewScoreText = legacyNotScored ? t.analysisScoreNotScored : formatScoreText(scores.overall, displayOverrides?.overall);
    const overviewScoreLabel = legacyNotScored ? t.analysisScoreNotScored : t.analysisScoreLabel;
    const scoreMetaLines = legacyNotScored
        ? [t.analysisScoreNotScoredReasonUnavailable]
        : [];
    const legacyScoreReady = !legacyNotScored;

    // Construct descriptions for InteractiveScoreRing with score factor explanations
    const descriptions: {
        effectiveness: ContentSection;
        safety: ContentSection;
        practicality: ContentSection;
    } = useMemo(() => ({
        effectiveness: {
            verdict: efficacy.verdict || 'Analyzing efficacy based on ingredients and evidence...',
            // Use scoring factors as highlights to explain the score
            highlights: legacyScoreReady
                ? scores.details.effectivenessFactors.filter(f => f.startsWith('+'))
                : [],
            warnings: legacyScoreReady
                ? scores.details.effectivenessFactors.filter(f => f.startsWith('-') || f.startsWith('−'))
                : [],
        },
        safety: {
            verdict: safety.verdict || 'Analyzing safety profile...',
            highlights: legacyScoreReady
                ? scores.details.safetyFactors.filter(f => f.startsWith('+'))
                : [],
            warnings: legacyScoreReady
                ? [...(safety.redFlags || []), ...scores.details.safetyFactors.filter(f => f.startsWith('-') || f.startsWith('−'))]
                : [],
        },
        practicality: {
            verdict: value.verdict || 'Analyzing value and practicality...',
            highlights: legacyScoreReady
                ? scores.details.valueFactors.filter(f => f.startsWith('+'))
                : [],
            warnings: [],
        },
    }), [efficacy.verdict, legacyScoreReady, safety.redFlags, safety.verdict, scores.details, value.verdict]);

    const scienceSummary =
        efficacy.verdict ||
        (Array.isArray(efficacy.benefits) && efficacy.benefits[0]) ||
        'Formula effectiveness has been analyzed based on typical clinical ranges.';

    const usageSummaryRaw =
        usage.summary ||
        usage.timing ||
        t.analysisPlaceholderUsage;
    const usageSummary = isRegulatoryLabel
        ? clampTextWithEllipsis(usageSummaryRaw, 160)
        : usageSummaryRaw;

    const safetySummaryRaw =
        safety.verdict ||
        (Array.isArray(safety.redFlags) && safety.redFlags[0]) ||
        (Array.isArray(safety.risks) && safety.risks[0]) ||
        t.analysisPlaceholderInsufficient;
    const safetySummary = isRegulatoryLabel
        ? clampTextWithEllipsis(safetySummaryRaw, 160)
        : safetySummaryRaw;

    // Legacy meta is no longer used - scoring now comes from AI analysis directly

    // Use primaryActive from efficacy if available
    const primaryActive = efficacy?.primaryActive;

    const formatScaledValue = (value: number, scale: number) => {
        const scaled = value / scale;
        const rounded = Math.round(scaled * 10) / 10;
        return Number.isInteger(rounded) ? `${rounded}` : `${rounded}`;
    };

    const formatCfuValue = (value: number) => {
        if (value >= 1e12) return `${formatScaledValue(value, 1e12)} Trillion CFU`;
        if (value >= 1e9) return `${formatScaledValue(value, 1e9)} Billion CFU`;
        if (value >= 1e6) return `${formatScaledValue(value, 1e6)} Million CFU`;
        return `${Math.round(value)} CFU`;
    };

    const hasNumericDose = (value?: number | null) =>
        typeof value === 'number' && Number.isFinite(value) && value > 0;

    // Format dosage with unit
    const formatDose = (value?: number | null, unit?: string | null): string | null => {
        const normalizedUnit = unit?.trim().toLowerCase();
        if (normalizedUnit === 'np' || normalizedUnit === 'n/p' || normalizedUnit === 'not present') {
            return t.analysisPlaceholderIncludedInBlend;
        }
        if (value === 0 && !normalizedUnit) {
            return t.analysisPlaceholderIncludedInBlend;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) return null;
        if (normalizedUnit === 'cfu' || normalizedUnit === 'ufc') {
            return formatCfuValue(value);
        }
        return `${value} ${unit || 'mg'}`;
    };

    // Format form text to be user-friendly (simplify long scientific names)
    const formatFormShort = (): string | null => {
        if (!primaryActive) return null;

        if (primaryActive.form) {
            const form = primaryActive.form.toLowerCase();
            // Simplify common scientific terms to user-friendly versions
            if (form.includes('haematococcus') || form.includes('algae')) {
                return 'Algae-derived';
            }
            if (form.includes('methylcobalamin')) {
                return 'Methylated form';
            }
            if (form.includes('citrate') || form.includes('glycinate') || form.includes('chelate')) {
                return 'Chelated form';
            }
            if (form.includes('liposomal')) {
                return 'Liposomal';
            }
            // Truncate if too long
            if (primaryActive.form.length > 25) {
                return primaryActive.form.slice(0, 22) + '...';
            }
            return primaryActive.form;
        }

        // Fallback to formQuality label
        if (primaryActive.formQuality && primaryActive.formQuality !== 'unknown') {
            const labelMap: Record<string, string> = {
                high: 'High-quality',
                medium: 'Standard',
                low: 'Basic',
            };
            return labelMap[primaryActive.formQuality] || null;
        }

        return null;
    };

    // Pre-computed form label for overview
    const formLabel = formatFormShort();

    // Primary active dosage (from AI analysis)
    const primaryDoseLabel = formatDose(primaryActive?.dosageValue, primaryActive?.dosageUnit);
    const primaryName = primaryActive?.name || productInfo.primaryIngredient || '';

    // Build overview summary: prefer AI-generated, then structured fallback, then legacy
    const overviewSummary = (() => {
        // 1. Use new AI-generated overviewSummary if available
        if (efficacy?.overviewSummary) {
            return efficacy.overviewSummary;
        }
        // 2. Build from primaryActive (structured fallback)
        if (hasNumericDose(primaryActive?.dosageValue) && primaryActive?.name) {
            const evidenceText = primaryActive.evidenceLevel && primaryActive.evidenceLevel !== 'none'
                ? ` with ${primaryActive.evidenceLevel} evidence`
                : '';
            const doseText =
                hasNumericDose(primaryActive.dosageValue) && primaryDoseLabel
                    ? primaryDoseLabel
                    : `${primaryActive.dosageValue} ${primaryActive.dosageUnit || 'mg'}`;
            return `Provides ${doseText} ${primaryActive.name}${evidenceText}. ${value.analysis || value.verdict || ''}`;
        }
        // 3. Legacy fallback
        return value.analysis ||
            efficacy.dosageAssessment?.text ||
            value.verdict ||
            social.summary ||
            '';
    })();

    // Get core benefits from efficacy (new) or fallback to benefits array
    const rawBenefits: unknown[] =
        Array.isArray(efficacy?.coreBenefits) && efficacy.coreBenefits.length > 0
            ? efficacy.coreBenefits
            : Array.isArray(efficacy?.benefits) && efficacy.benefits.length > 0
                ? efficacy.benefits
                : [];
    const coreBenefits = rawBenefits
        .filter((benefit: unknown): benefit is string =>
            typeof benefit === 'string' && benefit.trim().length > 0,
        )
        .slice(0, isRegulatoryLabel ? 2 : 3)
        .map((benefit) => isRegulatoryLabel ? clampTextWithEllipsis(benefit, 120) : benefit);

    const scienceIngredients = useMemo(
        () =>
            Array.isArray(efficacy.ingredients)
                ? dedupeIngredients(efficacy.ingredients as IngredientDetail[])
                : [],
        [efficacy.ingredients]
    );

    const formatBestForText = (value: string) => {
        const normalized = normalizeText(value);
        if (!normalized) return '';
        if (/\d/.test(normalized)) return normalized;
        const lower = normalized.toLowerCase();
        if (
            lower.startsWith('support') ||
            lower.startsWith('supports') ||
            lower.startsWith('help') ||
            lower.startsWith('helps') ||
            lower.startsWith('promote') ||
            lower.startsWith('promotes') ||
            lower.startsWith('for ')
        ) {
            return normalized;
        }
        return `Supports ${normalized}`;
    };

    const bestForFallback = (() => {
        const benefitWithoutNumbers = coreBenefits.find((item: string) => !/\d/.test(item));
        if (benefitWithoutNumbers) return formatBestForText(benefitWithoutNumbers);
        if (productInfo.category) return normalizeText(productInfo.category);
        const fallbackBenefit = coreBenefits[0];
        return fallbackBenefit ? formatBestForText(fallbackBenefit) : '';
    })();

    const bestFor = usage.bestFor || usage.target || usage.who || bestForFallback;
    const bestForDisplay = isRegulatoryLabel
        ? clampTextWithEllipsis(bestFor, 220)
        : bestFor;
    const routineLine = usage.dosage || usage.frequency || usage.timing || '';

    const warningLine =
        (Array.isArray(safety.redFlags) && safety.redFlags[0]) ||
        (Array.isArray(safety.risks) && safety.risks[0]) ||
        (typeof safety.verdict === 'string' ? safety.verdict : '') ||
        '';

    const evidenceLevelText = (() => {
        switch (primaryActive?.evidenceLevel) {
            case 'strong': return 'Strong clinical evidence';
            case 'moderate': return 'Moderate evidence';
            case 'weak': return 'Limited evidence';
            default: return 'AI-reviewed evidence';
        }
    })();

    const bioavailabilityText = primaryActive?.formQuality && primaryActive.formQuality !== 'unknown'
        ? `Form quality: ${primaryActive.formQuality.charAt(0).toUpperCase() + primaryActive.formQuality.slice(1)}`
        : 'Bioavailability estimated from label information.';

    const doseMatchCopy =
        hasNumericDose(primaryActive?.dosageValue) && primaryDoseLabel
            ? `Delivers ${primaryDoseLabel} per serving.`
            : 'Dose compared against typical clinical ranges.';

    const timingCopy = usage.withFood === true
        ? 'Take with food for better tolerance and absorption.'
        : usage.withFood === false
            ? 'Can be taken without food if stomach tolerates it.'
            : '';

    const interactionCopy = (() => {
        const interactionCount = safety.interactions?.length ?? 0;
        if (interactionCount >= 3) return 'Multiple potential interactions — consult a clinician.';
        if (interactionCount >= 1) return 'Some interaction potential with common medications.';
        return 'Low interaction potential reported.';
    })();

    const evidenceFillMap: Record<string, number> = {
        strong: 95,
        moderate: 72,
        weak: 50,
        none: 40,
    };
    const formFillMap: Record<string, number> = {
        high: 92,
        medium: 72,
        low: 52,
    };

    const benefitsPhrase = coreBenefits.slice(0, 2).join(', ');
    const overviewCoverSummaryText = capitalizeSentences(
        clampText(
            [
                primaryName
                    ? ensurePeriod(
                        `Focused on ${primaryName}${hasNumericDose(primaryActive?.dosageValue) && primaryDoseLabel
                            ? ` ${primaryDoseLabel}`
                            : ''
                        }`
                    )
                    : '',
                benefitsPhrase ? ensurePeriod(`Key benefits: ${benefitsPhrase}`) : '',
            ]
                .filter(Boolean)
                .join(' '),
            110
        ) || clampText(overviewSummary, 110)
    );

    const usageCoverLine = capitalizeSentences(
        clampText(
            [
                routineLine || usage.summary || '',
                timingCopy,
            ]
                .map((part) => normalizeText(part))
                .filter(Boolean)
                .map((part) => ensurePeriod(part))
                .join(' '),
            96
        )
    );
    const bestForCover = capitalizeSentences(clampText(bestFor, 84));

    const safetyCoverWarning = capitalizeSentences(
        clampText(
            ensurePeriod(warningLine || ''),
            96
        )
    );

    const makePlaceholderLine = (text: string, reason?: MissingReason, showInfo?: boolean): CoverLine => ({
        text,
        isPlaceholder: true,
        showInfo,
        missingReason: reason,
    });

    const buildOverviewCover = () => {
        const missingReasons = new Set<MissingReason>();
        const summary = overviewCoverSummaryText
            ? { text: overviewCoverSummaryText }
            : makePlaceholderLine(t.analysisPlaceholderOverviewSummary, 'MISSING_OVERVIEW_SUMMARY');
        if (summary.isPlaceholder) {
            missingReasons.add('MISSING_OVERVIEW_SUMMARY');
        }
        const bullets: BulletItem[] = [];
        const slotStates: boolean[] = [!summary.isPlaceholder];
        for (let i = 0; i < 2; i += 1) {
            const benefit = coreBenefits[i];
            if (benefit) {
                bullets.push({ text: capitalizeSentences(benefit) });
                slotStates.push(true);
            } else {
                bullets.push({
                    text: t.analysisPlaceholderNotEnoughInfo,
                    isPlaceholder: true,
                    missingReason: 'MISSING_OVERVIEW_BENEFITS',
                });
                missingReasons.add('MISSING_OVERVIEW_BENEFITS');
                slotStates.push(false);
            }
        }

        return {
            summary,
            bullets,
            dataStatus: {
                status: computeCoverStatus(slotStates),
                missingReasons: Array.from(missingReasons),
                sources: sourceRefs,
            },
        };
    };

    const buildScienceCover = () => {
        const missingReasons = new Set<MissingReason>();
        const primaryHasName = !!primaryName;
        const primaryHasDose = hasNumericDose(primaryActive?.dosageValue);
        const primarySlotFilled = primaryHasName && primaryHasDose;
        const primaryFill = primarySlotFilled
            ? evidenceFillMap[primaryActive?.evidenceLevel || 'none'] || 72
            : provisionalScore;
        const primaryRow: Mechanism = {
            name: primaryHasName ? primaryName : t.analysisPrimaryActiveLabel,
            amount: primaryDoseLabel ?? t.analysisPlaceholderSeeLabel,
            fill: primarySlotFilled ? primaryFill : provisionalScore,
            mode: primarySlotFilled ? 'actual' : 'unknown',
            showInfo: !primaryHasName,
            missingReason: !primaryHasName ? 'MISSING_PRIMARY_ACTIVE' : undefined,
        };

        const evidenceLevel = primaryActive?.evidenceLevel;
        const evidenceHasData = typeof evidenceLevel === 'string';
        const evidenceAmount = evidenceHasData
            ? evidenceLevel === 'none'
                ? t.analysisEvidenceNone
                : capitalizeSentences(evidenceLevel)
            : t.analysisPlaceholderNotRated;
        const evidenceRow: Mechanism = {
            name: t.analysisEvidenceLevelLabel,
            amount: evidenceAmount,
            fill: evidenceHasData ? evidenceFillMap[evidenceLevel || 'none'] || 60 : provisionalScore,
            mode: evidenceHasData ? 'actual' : 'unknown',
            showInfo: !evidenceHasData,
            missingReason: !evidenceHasData ? 'MISSING_EVIDENCE_MAPPING' : undefined,
        };

        const formQuality = primaryActive?.formQuality;
        const formHasData = !!formQuality && formQuality !== 'unknown';
        const formRow: Mechanism = {
            name: t.analysisFormQualityLabel,
            amount: formHasData ? capitalizeSentences(formQuality) : t.analysisPlaceholderUnknown,
            fill: formHasData ? formFillMap[formQuality as keyof typeof formFillMap] || 64 : provisionalScore,
            mode: formHasData ? 'actual' : 'unknown',
            showInfo: false,
            missingReason: !formHasData ? 'MISSING_FORM_QUALITY' : undefined,
        };

        if (!primaryHasName) {
            missingReasons.add('MISSING_PRIMARY_ACTIVE');
        }
        if (primaryHasName && !primaryHasDose) {
            missingReasons.add('MISSING_DOSE_RANGE');
        }
        if (!evidenceHasData) {
            missingReasons.add('MISSING_EVIDENCE_MAPPING');
        }
        if (!formHasData) {
            missingReasons.add('MISSING_FORM_QUALITY');
        }

        return {
            mechanisms: [primaryRow, evidenceRow, formRow],
            dataStatus: {
                status: computeCoverStatus([primarySlotFilled, evidenceHasData, formHasData]),
                missingReasons: Array.from(missingReasons),
                sources: sourceRefs,
            },
        };
    };

    const buildUsageCover = () => {
        const missingReasons = new Set<MissingReason>();
        const routineLine = usageCoverLine
            ? { text: usageCoverLine }
            : makePlaceholderLine(t.analysisPlaceholderUsage, 'MISSING_USAGE_GUIDANCE', true);
        if (routineLine.isPlaceholder) {
            missingReasons.add('MISSING_USAGE_GUIDANCE');
        }
        const bestForLine = bestForCover
            ? { text: bestForCover }
            : makePlaceholderLine(t.analysisPlaceholderBestFor, 'MISSING_BEST_FOR', true);
        if (bestForLine.isPlaceholder) {
            missingReasons.add('MISSING_BEST_FOR');
        }

        return {
            routineLine,
            bestFor: bestForLine,
            dataStatus: {
                status: computeCoverStatus([!routineLine.isPlaceholder, !bestForLine.isPlaceholder]),
                missingReasons: Array.from(missingReasons),
                sources: sourceRefs,
            },
        };
    };

    const buildSafetyCover = () => {
        const missingReasons = new Set<MissingReason>();
        const warningLine = safetyCoverWarning
            ? { text: safetyCoverWarning }
            : makePlaceholderLine(t.analysisPlaceholderSafetyWarning, 'MISSING_SAFETY_WARNING', true);
        if (warningLine.isPlaceholder) {
            missingReasons.add('MISSING_SAFETY_WARNING');
        }
        const tipText = normalizeText(typeof safety.recommendation === 'string' ? safety.recommendation : '');
        const tipLine = tipText
            ? { text: tipText }
            : makePlaceholderLine(t.analysisPlaceholderSafetyTip, 'MISSING_SAFETY_TIP');
        if (tipLine.isPlaceholder) {
            missingReasons.add('MISSING_SAFETY_TIP');
        }

        return {
            warning: warningLine,
            tip: tipLine,
            dataStatus: {
                status: computeCoverStatus([!warningLine.isPlaceholder, !tipLine.isPlaceholder]),
                missingReasons: Array.from(missingReasons),
                sources: sourceRefs,
            },
        };
    };

    const overviewCover = buildOverviewCover();
    const scienceCover = buildScienceCover();
    const usageCover = buildUsageCover();
    const safetyCover = buildSafetyCover();

    const overviewSummaryLine = overviewCover.summary;
    const overviewBullets = overviewCover.bullets;
    const overviewDataStatus = overviewCover.dataStatus;
    const keyMechanisms = scienceCover.mechanisms;
    const scienceDataStatus = scienceCover.dataStatus;
    const usageLine = usageCover.routineLine;
    const bestForLine = usageCover.bestFor;
    const usageDataStatus = usageCover.dataStatus;
    const safetyWarningLine = safetyCover.warning;
    const safetyTipLine = safetyCover.tip;
    const safetyDataStatus = safetyCover.dataStatus;
    const scienceFooterText = undefined;

    const overviewSummaryDisplay = isRegulatoryLabel
        ? clampTextWithEllipsis(overviewSummary, 220)
        : overviewSummary;
    const displayBrandRaw = isRegulatoryLabel
        ? (shortenCompanyName(productInfo.brand) ?? productInfo.brand)
        : productInfo.brand;
    const displayBrand =
        typeof displayBrandRaw === 'string' && displayBrandRaw.trim()
            ? formatBrandForPill(displayBrandRaw)
            : null;
    const overviewContent = (
        <View style={{ gap: 16 }}>
            <Text style={styles.modalParagraph}>
                {overviewSummaryDisplay || t.analysisPlaceholderOverviewSummary}
            </Text>
            <View style={styles.modalOverviewGrid}>
                <View style={styles.modalOverviewCard}>
                    <TrendingUp size={20} color="#3B82F6" />
                    <Text style={styles.modalOverviewNumber}>
                        {overviewScoreText}
                    </Text>
                    <Text style={styles.modalOverviewLabel}>{overviewScoreLabel}</Text>
                </View>
                {/* Form card - use simplified formLabel */}
                {formLabel && (
                    <View style={styles.modalOverviewCard}>
                        <Activity size={20} color="#3B82F6" />
                        <Text style={styles.modalOverviewNumber} numberOfLines={1}>
                            {formLabel}
                        </Text>
                        <Text style={styles.modalOverviewLabel}>Form</Text>
                    </View>
                )}
            </View>
            <View style={styles.modalCalloutCard}>
                <Text style={styles.modalBulletTitle}>Core benefits</Text>
                {coreBenefits.map((benefit: string, idx: number) => (
                    <Text key={idx} style={styles.modalBulletItem}>
                        • {benefit}
                    </Text>
                ))}
            </View>
            <View style={styles.modalTagRow}>
                {displayBrand && (
                    <View style={styles.modalTag}>
                        <Text style={styles.modalTagLabel}>Brand</Text>
                        <Text style={styles.modalTagValue} numberOfLines={2} ellipsizeMode="tail">
                            {displayBrand}
                        </Text>
                    </View>
                )}
                {productInfo.category && (
                    <View style={styles.modalTag}>
                        <Text style={styles.modalTagLabel}>Category</Text>
                        <Text style={styles.modalTagValue}>{productInfo.category}</Text>
                    </View>
                )}
            </View>
        </View>
    );

    const tiles: TileConfig[] = [
        {
            id: 1,
            type: 'overview',
            title: t.analysisTileOverviewTitle,
            modalTitle: t.analysisTileOverviewModalTitle,
            icon: Zap,
            accentColor: 'text-blue-500',
            backgroundColor: '#123CC5',
            textColor: '#F7FBFF',
            labelColor: '#D6E5FF',
            viewLabel: t.analysisView,
            eyebrow: t.analysisEyebrowCoreBenefits,
            summary: overviewSummaryLine,
            summaryLines: 2,
            bullets: overviewBullets,
            bulletLimit: 2,
            bulletLines: 2,
            footerLines: 1,
            dataStatus: overviewDataStatus,
            content: overviewContent,
        },
        {
            id: 2,
            type: 'science',
            title: t.analysisTileScienceTitle,
            modalTitle: t.analysisTileScienceModalTitle,
            icon: BarChart3,
            accentColor: 'text-amber-500',
            backgroundColor: '#F7C948',
            textColor: '#ea580c',
            labelColor: '#ea580c',
            viewLabel: t.analysisView,
            eyebrow: t.analysisEyebrowKeyMechanism,
            mechanisms: keyMechanisms,
            footerText: scienceFooterText,
            footerLines: 1,
            dataStatus: scienceDataStatus,
            content: (
                <View style={{ gap: 16 }}>
                    <Text style={styles.modalParagraphSmall}>{scienceSummary}</Text>

                    {/* NEW: Enhanced Ingredient Analysis */}
                    {scienceIngredients.length > 0 && (
                        <View style={styles.modalCalloutCard}>
                            <Text style={styles.modalBulletTitle}>Ingredient Analysis</Text>
                            {scienceIngredients.slice(0, 4).map((ingredient: any, idx: number) => {
                                const doseLabel = formatDose(ingredient.dosageValue, ingredient.dosageUnit);
                                return (
                                    <View key={idx} style={{ marginTop: idx > 0 ? 12 : 4 }}>
                                        <Text
                                            style={[styles.modalParagraphSmall, { fontWeight: '600' }]}
                                            numberOfLines={2}
                                            ellipsizeMode="tail"
                                        >
                                            {ingredient.name}
                                            {ingredient.form && ` (${ingredient.form})`}
                                        </Text>
                                        {ingredient.formQuality && ingredient.formQuality !== 'unknown' && (
                                            <Text style={styles.modalParagraphSmall}>
                                                Form quality: {ingredient.formQuality.charAt(0).toUpperCase() + ingredient.formQuality.slice(1)}
                                                {ingredient.formNote && ` — ${ingredient.formNote}`}
                                            </Text>
                                        )}
                                        {doseLabel && (
                                            <Text style={styles.modalParagraphSmall}>
                                                Dose: {doseLabel}
                                                {ingredient.dosageAssessment && ingredient.dosageAssessment !== 'unknown' && (
                                                    ` (${ingredient.dosageAssessment})`
                                                )}
                                            </Text>
                                        )}
                                        {ingredient.evidenceLevel && ingredient.evidenceLevel !== 'none' && (
                                            <Text style={styles.modalParagraphSmall}>
                                                Evidence: {ingredient.evidenceLevel.charAt(0).toUpperCase() + ingredient.evidenceLevel.slice(1)}
                                            </Text>
                                        )}
                                    </View>
                                );
                            })}
                        </View>
                    )}

                    {/* Marketing vs Reality - NEW */}
                    {efficacy.marketingVsReality && (
                        <View style={styles.modalCalloutCard}>
                            <Text style={styles.modalBulletTitle}>Marketing vs Reality</Text>
                            <Text style={styles.modalParagraphSmall}>{efficacy.marketingVsReality}</Text>
                        </View>
                    )}

                    {/* Overall Assessment - NEW */}
                    {efficacy.overallAssessment && (
                        <View style={styles.modalCalloutCard}>
                            <Text style={styles.modalBulletTitle}>Overall Assessment</Text>
                            <Text style={styles.modalParagraphSmall}>{efficacy.overallAssessment}</Text>
                        </View>
                    )}

                    {/* Fallback to legacy key mechanisms display */}
                    {(scienceIngredients.length === 0) && (
                        <>
                            <View style={styles.modalCalloutCard}>
                                <Text style={styles.modalBulletTitle}>Dose alignment</Text>
                                <Text style={styles.modalParagraphSmall}>{doseMatchCopy}</Text>
                                <Text style={styles.modalParagraphSmall}>{evidenceLevelText}</Text>
                                <Text style={styles.modalParagraphSmall}>{bioavailabilityText}</Text>
                            </View>
                            <View>
                                <Text style={styles.modalBulletTitle}>Key mechanisms</Text>
                                {keyMechanisms.map((item, idx) => (
                                    <Text key={idx} style={styles.modalBulletItem}>
                                        • {item.name}: {item.amount}
                                    </Text>
                                ))}
                            </View>
                        </>
                    )}

                    {Array.isArray(efficacy.benefits) && efficacy.benefits.length > 0 && (
                        <View style={{ marginTop: 8 }}>
                            <Text style={styles.modalBulletTitle}>Commonly targeted benefits:</Text>
                            {efficacy.benefits.slice(0, 4).map((benefit: string, idx: number) => (
                                <Text key={idx} style={styles.modalBulletItem}>
                                    • {benefit}
                                </Text>
                            ))}
                        </View>
                    )}
                </View>
            ),
        },
        {
            id: 3,
            type: 'usage',
            title: t.analysisTileUsageTitle,
            modalTitle: t.analysisTileUsageModalTitle,
            icon: Clock,
            accentColor: 'text-sky-500',
            backgroundColor: '#8CCBFF',
            textColor: '#0B2545',
            labelColor: '#0B2545',
            viewLabel: t.analysisView,
            eyebrow: t.analysisEyebrowDailyRoutine,
            routineLine: usageLine,
            bestFor: bestForLine,
            bestForLabel: t.analysisLabelBestFor,
            dataStatus: usageDataStatus,
            content: (
                <View style={{ gap: 16 }}>
                    <View style={styles.modalUsageCard}>
                        <Pill size={32} color="#F97316" />
                        <View style={{ flex: 1 }}>
                            <Text style={styles.modalUsageTitle}>Suggested Routine</Text>
                            <Text style={styles.modalUsageSubtitle}>{usage.dosage || 'Follow label dose'}</Text>
                        </View>
                    </View>
                    <Text style={styles.modalParagraph}>{usageSummary}</Text>
                    <Text style={styles.modalParagraphSmall}>{timingCopy}</Text>
                    <View style={styles.modalCalloutCard}>
                        <Text style={styles.modalBulletTitle}>Best for</Text>
                        <Text style={styles.modalParagraphSmall}>{bestForDisplay}</Text>
                        {usage.frequency && (
                            <Text style={styles.modalParagraphSmall}>Frequency: {usage.frequency}</Text>
                        )}
                        {usage.timing && (
                            <Text style={styles.modalParagraphSmall}>Timing: {usage.timing}</Text>
                        )}
                    </View>

                    {/* Medical Disclaimer */}
                    <View style={styles.modalDisclaimerCard}>
                        <Text style={styles.modalDisclaimerText}>
                            This information is for educational purposes only. Consult a healthcare professional before use.
                        </Text>
                    </View>
                </View>
            ),
        },
        {
            id: 4,
            type: 'safety',
            title: t.analysisTileSafetyTitle,
            modalTitle: t.analysisTileSafetyModalTitle,
            icon: Shield,
            accentColor: 'text-rose-500',
            backgroundColor: '#F1E7D8',
            textColor: '#2E2A25',
            labelColor: '#6B5B4B',
            viewLabel: t.analysisView,
            eyebrow: t.analysisEyebrowSafetyNotes,
            warning: safetyWarningLine,
            tip: safetyTipLine,
            tipLabel: t.analysisLabelTip,
            dataStatus: safetyDataStatus,
            content: (
                <View style={{ gap: 16 }}>
                    <View style={styles.modalSafetyCard}>
                        <CheckCircle2 size={28} color="#16A34A" />
                        <View style={{ flex: 1 }}>
                            <Text style={styles.modalSafetyTitle}>{safety.verdict || 'Generally safe at standard doses'}</Text>
                            <Text style={styles.modalSafetyText}>{safetySummary}</Text>
                        </View>
                    </View>

                    {/* NEW: UL Warnings */}
                    {Array.isArray(safety.ulWarnings) && safety.ulWarnings.length > 0 && (
                        <View style={styles.modalWarningCard}>
                            <Text style={styles.modalWarningText}>⚠️ Upper Limit Warnings:</Text>
                            {safety.ulWarnings.map((warning: any, idx: number) => (
                                <Text key={idx} style={styles.modalWarningTextItem}>
                                    • {warning.ingredient}: {warning.currentDose} (UL: {warning.ulLimit})
                                    {warning.riskLevel === 'high' && ' — HIGH RISK'}
                                </Text>
                            ))}
                        </View>
                    )}

                    {Array.isArray(safety.redFlags) && safety.redFlags.length > 0 && (
                        <View style={styles.modalWarningCard}>
                            <Text style={styles.modalWarningText}>Red flags to watch:</Text>
                            {safety.redFlags.slice(0, 3).map((flag: string, idx: number) => (
                                <Text key={idx} style={styles.modalWarningTextItem}>
                                    • {flag}
                                </Text>
                            ))}
                        </View>
                    )}

                    {/* NEW: Allergens */}
                    {Array.isArray(safety.allergens) && safety.allergens.length > 0 && (
                        <View style={styles.modalCalloutCard}>
                            <Text style={styles.modalBulletTitle}>Allergens Detected</Text>
                            <Text style={styles.modalParagraphSmall}>
                                {safety.allergens.join(', ')}
                            </Text>
                        </View>
                    )}

                    {/* NEW: Drug Interactions */}
                    {Array.isArray(safety.interactions) && safety.interactions.length > 0 && (
                        <View style={styles.modalCalloutCard}>
                            <Text style={styles.modalBulletTitle}>Drug Interactions</Text>
                            {safety.interactions.slice(0, 3).map((interaction: string, idx: number) => (
                                <Text key={idx} style={styles.modalParagraphSmall}>• {interaction}</Text>
                            ))}
                        </View>
                    )}

                    {/* NEW: Consult Doctor If */}
                    {Array.isArray(safety.consultDoctorIf) && safety.consultDoctorIf.length > 0 && (
                        <View style={styles.modalCalloutCard}>
                            <Text style={styles.modalBulletTitle}>Consult Doctor If</Text>
                            {safety.consultDoctorIf.slice(0, 4).map((condition: string, idx: number) => (
                                <Text key={idx} style={styles.modalParagraphSmall}>• {condition}</Text>
                            ))}
                        </View>
                    )}

                    <View style={styles.modalCalloutCard}>
                        <Text style={styles.modalBulletTitle}>General Notes</Text>
                        <Text style={styles.modalParagraphSmall}>{interactionCopy}</Text>
                        {(safety.allergens?.length ?? 0) > 0 && (
                            <Text style={styles.modalParagraphSmall}>Contains allergens — review label carefully.</Text>
                        )}
                    </View>

                    {/* Medical Disclaimer */}
                    <View style={styles.modalDisclaimerCard}>
                        <Text style={styles.modalDisclaimerText}>
                            This information is for educational purposes only and is not a substitute for professional medical advice. Always consult with a qualified healthcare provider before starting any supplement regimen.
                        </Text>
                    </View>
                </View>
            ),
        },
    ];

    if (analysisBundle?.meta?.schemaVersion === 3 || analysisBundle?.meta?.schemaVersion === 4) {
        return (
            <AnalysisBundleDashboard
                bundle={analysisBundle}
                analysis={analysis}
                isStreaming={isStreaming}
                scoreBadge={scoreBadge}
                scoreState={scoreState}
                sourceType={sourceType}
                scanSessionId={scanSessionId}
                scoreBundleV4State={scoreBundleV4State}
                onRetryScore={onRetryScore}
            />
        );
    }

    const fallbackMeta = (analysisBundle?.meta ?? null) as any;
    const trustedFallbackIdentity = resolveTrustedDisplayIdentity({
        bundleMeta: fallbackMeta,
        sourceAttributionHint: sourceType === 'label_scan' || isRegulatoryLabel ? 'label_record' : null,
        sourceTypeHint: isRegulatoryLabel ? 'lnhpd' : sourceType === 'label_scan' ? 'label_scan' : null,
        productName: productInfo.name || 'Supplement',
        productSubtitle: [
            displayBrand,
            ...(isRegulatoryLabel ? [] : [productInfo.category]),
        ]
            .filter(Boolean)
            .join(' • '),
        authoritativeIdentity:
            fallbackMeta?.authoritativeIdentity ?? null,
        barcode:
            fallbackMeta?.authoritativeIdentity?.value ?? null,
        sources: (Array.isArray(analysis.sources) ? analysis.sources : []).map((source: any) => ({
            domain: typeof source?.domain === 'string' ? source.domain : null,
            url: typeof source?.url === 'string' ? source.url : typeof source?.link === 'string' ? source.link : null,
            link: typeof source?.link === 'string' ? source.link : null,
        })),
        showDebugWebHintSource: SHOW_SCAN_DEBUG,
    });
    const productTitle = trustedFallbackIdentity.title;
    const productSubtitle = trustedFallbackIdentity.subtitle;

    return (
        <View style={styles.root}>
            <ScrollContainer
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                {...scrollProps}
            >

                {/* Header Section */}
                {!disableHeroHeader ? (
                    <View style={styles.headerSection}>
                        <Text style={styles.headerEyebrow}>{t.analysisHeaderEyebrow}</Text>
                        <Text style={styles.headerTitle}>{productTitle}</Text>
                        {!!productSubtitle && (
                            <Text
                                style={styles.headerSubtitle}
                                numberOfLines={isRegulatoryLabel ? 2 : 1}
                                ellipsizeMode="tail"
                            >
                                {productSubtitle}
                            </Text>
                        )}
                    </View>
                ) : null}

                {/* Score Ring Card */}
                <View style={styles.scoreSection}>
                    {!disableScoreRing ? (
                        <InteractiveScoreRing
                            scores={{
                                effectiveness: ringScores.effectiveness,
                                safety: ringScores.safety,
                                value: ringScores.value,
                                overall: ringScores.overall
                            }}
                            descriptions={descriptions}
                            display={displayOverrides}
                            unknownCategories={unknownCategories}
                            labels={{
                                overall: t.analysisScoreLabel,
                                effectiveness: t.analysisScoreEffectiveness,
                                safety: t.analysisScoreSafety,
                                value: sourceType === 'label_scan' ? t.analysisScoreFormulaQuality : t.analysisScoreIntegrity,
                                valueLabel: sourceType === 'label_scan' ? t.analysisScoreFormulaQuality : t.analysisScoreIntegrity,
                            }}
                            metaLines={scoreMetaLines}
                            badgeText={badgeTextSafe}
                            sourceType={sourceType}
                            showStaticModeHint={SHOW_SCAN_DEBUG}
                        />
                    ) : (
                        <View style={styles.bisectNoticeCard}>
                            <Text style={styles.bisectNoticeTitle}>Score Ring disabled</Text>
                            <Text style={styles.bisectNoticeText}>{scoreRingDisableNotice}</Text>
                        </View>
                    )}
                </View>

                {/* Deep Categories */}
                {!disableTilesGrid ? (
                    <>
                        <View style={styles.tilesHeader}>
                            <Text style={styles.tilesTitle}>{t.analysisDeepCategoriesTitle}</Text>
                            <Text style={styles.tilesSubtitle}>{t.analysisDeepCategoriesSubtitle}</Text>
                        </View>

                        <View style={styles.tilesGrid} onLayout={onTilesGridLayout}>
                            {tiles.map((tile) => (
                                <TileRenderer
                                    key={tile.id}
                                    tile={tile}
                                    onPress={() => setSelectedTile(tile)}
                                    scrollY={scrollY}
                                    viewportHeight={viewportHeight}
                                    tileWidth={tileWidth}
                                    style={{
                                        marginBottom: TILE_GAP,
                                    }}
                                />
                            ))}
                        </View>
                    </>
                ) : (
                    <View style={styles.bisectNoticeCard}>
                        <Text style={styles.bisectNoticeTitle}>Tiles grid disabled</Text>
                        <Text style={styles.bisectNoticeText}>Set by `no_tiles` in `EXPO_PUBLIC_SCAN_DASHBOARD_BISECT`.</Text>
                    </View>
                )}
            </ScrollContainer>

            {!disableModalPane ? (
                <DashboardModal
                    visible={!!selectedTile}
                    tile={selectedTile}
                    onClose={() => setSelectedTile(null)}
                    sourceType={sourceType ?? null}
                    sourceTypeFinal={true}
                />
            ) : null}
        </View>
    );
};

const ensureModernAnalysisBundle = (
    bundle: AnalysisBundle | null | undefined,
    analysis: Analysis,
    scanSessionId: string | null,
): AnalysisBundle => {
    if (bundle?.meta?.schemaVersion === 3 || bundle?.meta?.schemaVersion === 4) {
        return bundle;
    }

    const rawBarcode = normalizeText((analysis as { barcode?: string | null })?.barcode ?? null).replace(/\D/g, '');
    const normalizedGtin14 =
        rawBarcode.length >= 8
            ? (rawBarcode.length > 14 ? rawBarcode.slice(-14) : rawBarcode.padStart(14, '0'))
            : null;
    const identityValue = normalizedGtin14 || `session:${normalizeText(scanSessionId) || 'unknown'}`;
    const authoritativeIdentity: AnalysisBundle['meta']['authoritativeIdentity'] = normalizedGtin14
        ? { type: 'gtin14', value: identityValue }
        : { type: 'webCanonicalId', value: identityValue };

    return {
        meta: {
            schemaVersion: 4,
            promptVersion: 'synthetic_modern_bundle_v1',
            sourceType: 'web',
            sourceTypeFinal: false,
            scoreAvailable: false,
            authoritativeIdentity,
            locale: 'en',
            phase: 'skeleton',
            bundleId: `synthetic:${identityValue}`,
            revision: 0,
            factsDigestHash: `synthetic:${identityValue}`,
            factsSourceVersion: 'synthetic',
            fallbackReason: 'synthetic_bundle_bootstrap',
        },
        sections: {
            overview: { layout: 'overview_card', cover: null, detail: null, dataStatus: 'pending' },
            ingredients: { layout: 'ingredients_list', cover: null, detail: null, dataStatus: 'pending' },
            usage: { layout: 'usage_bullets', cover: null, detail: null, dataStatus: 'pending' },
            safety: { layout: 'safety_bullets', cover: null, detail: null, signals: null, dataStatus: 'pending' },
        },
    };
};

export const AnalysisDashboard: React.FC<AnalysisDashboardProps> = ({
    analysis,
    isStreaming = false,
    scoreBadge,
    scoreState,
    sourceType,
    scanSessionId = null,
    analysisBundle,
    scoreBundleV4State,
    onRetryScore,
    externalScrollY,
    miniHeaderMode = 'inline',
    onMiniScoreMetaChange,
}) => {
    const modernBundle = ensureModernAnalysisBundle(analysisBundle, analysis, scanSessionId);
    return (
        <AnalysisBundleDashboard
            bundle={modernBundle}
            analysis={analysis}
            isStreaming={isStreaming}
            scoreBadge={scoreBadge}
            scoreState={scoreState}
            sourceType={sourceType}
            scanSessionId={scanSessionId}
            scoreBundleV4State={scoreBundleV4State}
            onRetryScore={onRetryScore}
            externalScrollY={externalScrollY}
            miniHeaderMode={miniHeaderMode}
            onMiniScoreMetaChange={onMiniScoreMetaChange}
        />
    );
};

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#F2F2F7', // iOS System Gray 6
        width: '100%',
        alignSelf: 'stretch',
    },
    scroll: {
        flex: 1,
        backgroundColor: '#F2F2F7',
        width: '100%',
        alignSelf: 'stretch',
    },
    scrollContent: {
        width: '100%',
        alignSelf: 'stretch',
        flexGrow: 1,
        paddingHorizontal: 16,
        paddingBottom: 40,
        paddingTop: 12,
    },
    headerSection: {
        marginBottom: 20,
        paddingHorizontal: 0,
    },
    headerEyebrow: {
        fontSize: 12,
        fontWeight: '700',
        color: '#3B82F6',
        letterSpacing: 1,
        marginBottom: 4,
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: '800',
        color: '#000000',
        marginBottom: 4,
        letterSpacing: -0.5,
    },
    headerSubtitle: {
        fontSize: 15,
        color: '#6B7280',
        fontWeight: '500',
    },
    scoreSection: {
        marginBottom: 24,
    },
    bisectNoticeCard: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#dbeafe',
        backgroundColor: '#eff6ff',
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    bisectNoticeTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#1e3a8a',
        marginBottom: 4,
    },
    bisectNoticeText: {
        fontSize: 12,
        lineHeight: 16,
        color: '#1d4ed8',
    },
    tilesHeader: {
        marginBottom: 12,
        paddingHorizontal: 0,
    },
    tilesTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1C1C1E',
    },
    tilesSubtitle: {
        fontSize: 13,
        color: '#8E8E93',
        marginTop: 2,
    },
    tilesGrid: {
        flexDirection: 'column',
    },
    tileShadow: {
        width: '100%',
        height: TILE_HEIGHT,
        borderRadius: 32,
        borderCurve: 'continuous',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.08,
        shadowRadius: 30,
        elevation: 6,
    },
    tile: {
        width: '100%',
        flexBasis: '100%',
        height: TILE_HEIGHT,
        minHeight: TILE_HEIGHT,
        borderRadius: 32,
        borderCurve: 'continuous',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.05)',
    },
    tileOuterPadding: {
        flex: 1,
        padding: 16,
    },
    tileGlass: {
        flex: 1,
        borderRadius: 22,
        borderCurve: 'continuous',
        padding: 16,
        justifyContent: 'space-between',
        backgroundColor: 'rgba(255,255,255,0.14)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.18)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.08,
        shadowRadius: 32,
        elevation: 3,
        overflow: 'hidden',
    },
    tileHeaderRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
    },
    tileHeaderLeft: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
    },
    tileIconShadow: {
        borderRadius: 16,
        borderCurve: 'continuous',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 1,
    },
    tileIconContainer: {
        width: 36,
        height: 36,
        borderRadius: 16,
        borderCurve: 'continuous',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: 'rgba(255,255,255,0.25)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.4)',
    },
    tileHeaderText: {
        flex: 1,
        minWidth: 0,
        paddingTop: 2,
    },
    tileTitle: {
        fontSize: 15,
        fontWeight: '800',
        lineHeight: 18,
    },
    viewPillShadow: {
        borderRadius: 999,
        borderCurve: 'continuous',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 2,
    },
    viewPill: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        borderCurve: 'continuous',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.3)',
        backgroundColor: 'rgba(255,255,255,0.2)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    viewPillText: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.4,
    },
    tileSection: {
        gap: 8,
        marginTop: 16,
        flexGrow: 1,
    },
    tileSectionCentered: {
        justifyContent: 'center',
    },
    tileEyebrow: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginBottom: 2,
    },
    tileSummary: {
        fontSize: 13,
        fontWeight: '600',
        lineHeight: 20,
        flexShrink: 1,
    },
    tileBulletList: {
        gap: 8,
    },
    tileBulletRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
    },
    inlineRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flex: 1,
    },
    infoBadge: {
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    infoBadgeText: {
        fontSize: 10,
        fontWeight: '700',
        lineHeight: 12,
    },
    bulletIcon: {
        marginTop: 2,
    },
    tileBulletText: {
        flex: 1,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '600',
        flexShrink: 1,
    },
    tileFooter: {
        marginTop: 6,
        fontSize: 11,
        lineHeight: 14,
        fontWeight: '600',
        opacity: 0.85,
    },
    mechList: {
        gap: 10,
    },
    mechListCentered: {
        justifyContent: 'center',
    },
    mechRow: {
        gap: 6,
    },
    mechHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    mechAmountRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    mechName: {
        flex: 1,
        fontSize: 13,
        fontWeight: '700',
    },
    mechAmount: {
        fontSize: 11,
        fontWeight: '800',
    },
    mechBar: {
        height: 6,
        borderRadius: 999,
        borderCurve: 'continuous',
        overflow: 'hidden',
        backgroundColor: 'rgba(255,255,255,0.4)',
    },
    mechBarUnknown: {
        backgroundColor: 'rgba(148,163,184,0.2)',
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.5)',
        borderStyle: 'dashed',
    },
    mechFill: {
        height: '100%',
        borderRadius: 999,
        borderCurve: 'continuous',
    },
    bestForCard: {
        marginTop: 6,
        padding: 12,
        borderRadius: 12,
        borderCurve: 'continuous',
        gap: 4,
    },
    bestForLabel: {
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.4,
    },
    bestForText: {
        marginTop: 4,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '600',
    },
    warningPill: {
        padding: 12,
        borderRadius: 12,
        borderCurve: 'continuous',
    },
    warningText: {
        fontSize: 12,
        fontWeight: '700',
        lineHeight: 16,
        flex: 1,
    },
    tipBlock: {
        gap: 4,
        marginTop: 6,
    },
    tipLabel: {
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.6,
    },
    tipText: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '600',
    },
    // Modal Styles
    modalBackdrop: {
        flex: 1,
        backgroundColor: '#F2F2F7',  // Match main screen background
        justifyContent: 'flex-end',
    },
    modalBackdropTouchable: {
        flex: 1,
    },
    modalHandle: {
        width: 40,
        height: 5,
        backgroundColor: '#E5E7EB',
        borderRadius: 3,
        alignSelf: 'center',
        marginBottom: 16,
    },
    modalContainer: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        paddingHorizontal: 24,
        paddingTop: 12,
        paddingBottom: 24,
        height: '85%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 20,
    },
    modalCloseBtn: {
        position: 'absolute',
        top: 24,
        right: 24,
        width: 32,
        height: 32,
        backgroundColor: '#F2F2F7',
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
    },
    modalIconCircle: {
        width: 64,
        height: 64,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
    modalTitle: {
        fontSize: 24,
        fontWeight: '800',
        color: '#1C1C1E',
        marginBottom: 16,
    },
    modalDivider: {
        height: 4,
        width: 40,
        borderRadius: 2,
        marginBottom: 24,
    },
    modalContent: {
        // No flex - let ScrollView handle scrolling when content exceeds modal height
    },
    modalParagraph: {
        fontSize: 16,
        lineHeight: 24,
        color: '#374151',
    },
    modalParagraphSmall: {
        fontSize: 14,
        lineHeight: 22,
        color: '#4B5563',
    },
    modalOverviewGrid: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 8,
    },
    modalOverviewCard: {
        flex: 1,
        backgroundColor: '#F9FAFB',
        borderRadius: 16,
        padding: 16,
        alignItems: 'center',
        gap: 8,
    },
    modalOverviewNumber: {
        fontSize: 20,
        fontWeight: '700',
        color: '#111827',
    },
    modalOverviewLabel: {
        fontSize: 12,
        color: '#6B7280',
        fontWeight: '600',
    },
    modalBulletTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#374151',
        marginBottom: 8,
    },
    modalBulletItem: {
        fontSize: 14,
        color: '#4B5563',
        marginBottom: 4,
        lineHeight: 20,
    },
    modalCalloutCard: {
        backgroundColor: '#F9FAFB',
        borderRadius: 16,
        padding: 14,
        gap: 6,
    },

    // Ingredient selector (Science Analysis)
    ingredientSelectorRow: {
        paddingTop: 10,
        paddingBottom: 2,
        gap: 10,
    },
    ingredientSelectorChip: {
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        minWidth: 120,
    },
    ingredientSelectorChipActive: {
        borderColor: '#111827',
    },
    ingredientSelectorChipText: {
        fontSize: 14,
        fontWeight: '800',
        color: '#111827',
    },
    ingredientSelectorChipTextActive: {
        color: '#111827',
    },
    ingredientSelectorChipSubtext: {
        fontSize: 12,
        fontWeight: '600',
        color: '#6B7280',
        marginTop: 2,
    },
    ingredientSelectorChipSubtextActive: {
        color: '#374151',
    },

    // Inline notice
    inlineNoticeRow: {
        marginTop: 10,
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        padding: 12,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    inlineNoticeText: {
        fontSize: 13,
        lineHeight: 18,
        color: '#6B7280',
        fontWeight: '600',
    },

    // Module cards (Science Analysis)
    moduleCard: {
        borderRadius: 18,
        padding: 14,
        gap: 10,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        backgroundColor: '#FFFFFF',
    },
    moduleCardOds: {
        backgroundColor: '#FFFBEB',
        borderColor: '#FDE68A',
        borderLeftWidth: 4,
        borderLeftColor: '#F59E0B',
    },
    moduleCardVerified: {
        backgroundColor: '#EFF6FF',
        borderColor: '#BFDBFE',
        borderLeftWidth: 4,
        borderLeftColor: '#3B82F6',
    },
    moduleCardSummary: {
        backgroundColor: '#EEF2FF',
        borderColor: '#C7D2FE',
        borderLeftWidth: 4,
        borderLeftColor: '#6366F1',
    },
    moduleHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    moduleBadge: {
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#E5E7EB',
    },
    moduleBadgeOds: {
        backgroundColor: '#FDE68A',
    },
    moduleBadgeVerified: {
        backgroundColor: '#BFDBFE',
    },
    moduleBadgeSummary: {
        backgroundColor: '#C7D2FE',
    },
    moduleBadgeText: {
        fontSize: 13,
        fontWeight: '900',
        color: '#111827',
    },
    moduleTitle: {
        fontSize: 15,
        fontWeight: '900',
        color: '#111827',
    },
    moduleSubtitle: {
        fontSize: 12,
        lineHeight: 18,
        color: '#6B7280',
        fontWeight: '600',
        marginTop: 2,
    },
    modulePill: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: 'rgba(255, 255, 255, 0.85)',
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.06)',
    },
    modulePillText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#92400E',
    },

    // Metrics
    metricGrid: {
        backgroundColor: 'rgba(255, 255, 255, 0.72)',
        borderRadius: 16,
        padding: 12,
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.06)',
        gap: 10,
    },
    metricRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
    },
    metricLabel: {
        flex: 0.42,
        fontSize: 12,
        fontWeight: '900',
        color: '#374151',
    },
    metricValue: {
        flex: 0.58,
        fontSize: 13,
        fontWeight: '800',
        color: '#111827',
        textAlign: 'right',
    },
    metricValueCol: {
        flex: 0.58,
        alignItems: 'flex-end',
        gap: 2,
    },
    metricMeta: {
        fontSize: 11,
        lineHeight: 16,
        color: '#6B7280',
        fontWeight: '600',
        textAlign: 'right',
    },

    // Layer tags
    tagRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    tagPill: {
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: 'rgba(255, 255, 255, 0.72)',
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.06)',
    },
    tagPillText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#374151',
    },

    // Why box
    whyCard: {
        backgroundColor: 'rgba(255, 255, 255, 0.78)',
        borderRadius: 16,
        padding: 12,
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.06)',
        gap: 6,
    },
    whyTitle: {
        fontSize: 13,
        fontWeight: '900',
        color: '#111827',
    },
    whyLineRow: {
        flexDirection: 'row',
        gap: 8,
    },
    whyBullet: {
        width: 14,
        fontSize: 14,
        color: '#6B7280',
        fontWeight: '900',
    },
    whyLineText: {
        flex: 1,
        fontSize: 13,
        lineHeight: 19,
        color: '#374151',
        fontWeight: '600',
    },

    // Summary module
    summaryLoadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    summaryHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
    },
    summarySourcePillText: {
        fontSize: 12,
        fontWeight: '900',
        color: '#312E81',
    },
    summaryTldr: {
        fontSize: 15,
        lineHeight: 22,
        color: '#111827',
        fontWeight: '700',
    },
    summaryList: {
        gap: 6,
    },
    summaryListTitle: {
        fontSize: 13,
        fontWeight: '900',
        color: '#111827',
    },
    summaryLineRow: {
        flexDirection: 'row',
        gap: 8,
    },
    summaryBullet: {
        width: 14,
        fontSize: 14,
        color: '#6B7280',
        fontWeight: '900',
    },
    summaryLineText: {
        flex: 1,
        fontSize: 13,
        lineHeight: 19,
        color: '#374151',
        fontWeight: '600',
    },
    summaryFootnote: {
        marginTop: 2,
        backgroundColor: 'rgba(255, 255, 255, 0.70)',
        borderRadius: 14,
        padding: 10,
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.06)',
    },
    summaryFootnoteText: {
        fontSize: 12,
        lineHeight: 18,
        color: '#4B5563',
        fontWeight: '600',
    },
    foundationFallbackCard: {
        backgroundColor: '#FFFBEB',
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: '#FDE68A',
        borderLeftWidth: 4,
        borderLeftColor: '#F59E0B',
        gap: 8,
    },
    foundationFallbackTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: '#92400E',
    },
    foundationFallbackDisclaimer: {
        fontSize: 12,
        lineHeight: 18,
        color: '#78350F',
        fontWeight: '600',
    },
    foundationFallbackBody: {
        fontSize: 13,
        lineHeight: 20,
        color: '#78350F',
    },
    productInsightCard: {
        backgroundColor: '#EFF6FF',
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: '#BFDBFE',
        borderLeftWidth: 4,
        borderLeftColor: '#3B82F6',
        gap: 8,
    },
    productInsightTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: '#1E3A8A',
    },
    productInsightDisclaimer: {
        fontSize: 12,
        lineHeight: 18,
        color: '#1D4ED8',
        fontWeight: '600',
    },
    modalTagRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 4,
    },
    modalTag: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: '#F3F4F6',
        minWidth: 120,
    },
    modalTagLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#6B7280',
        marginBottom: 4,
    },
    modalTagValue: {
        fontSize: 14,
        fontWeight: '700',
        color: '#111827',
    },
    modalUsageCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF7ED',
        padding: 16,
        borderRadius: 16,
        gap: 16,
    },
    modalUsageTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#9A3412',
    },
    modalUsageSubtitle: {
        fontSize: 14,
        color: '#C2410C',
    },
    modalSafetyCard: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: '#F0FDF4',
        padding: 16,
        borderRadius: 16,
        gap: 12,
    },
    modalSafetyTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#166534',
        marginBottom: 4,
    },
    modalSafetyText: {
        fontSize: 14,
        color: '#15803D',
        lineHeight: 20,
    },
    modalWarningCard: {
        backgroundColor: '#FEF2F2',
        padding: 16,
        borderRadius: 16,
        marginTop: 8,
    },
    modalWarningText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#991B1B',
        marginBottom: 8,
    },
    modalWarningTextItem: {
        fontSize: 14,
        color: '#B91C1C',
        marginBottom: 4,
    },
    modalDisclaimerCard: {
        backgroundColor: '#F9FAFB',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        marginTop: 8,
    },
    modalDisclaimerText: {
        fontSize: 12,
        color: '#6B7280',
        lineHeight: 18,
        textAlign: 'center',
        fontStyle: 'italic',
    },
    dataStatusCard: {
        marginTop: 20,
        backgroundColor: '#F8FAFC',
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        gap: 6,
    },
    dataStatusTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#111827',
    },
    dataStatusLine: {
        fontSize: 12,
        color: '#4B5563',
        lineHeight: 18,
    },
    dataStatusNote: {
        fontSize: 11,
        color: '#6B7280',
        lineHeight: 16,
        marginTop: 4,
    },


    // ---------- New glass / iOS-like primitives ----------
    detailStack: {
        gap: 14,
    },
    sourceStripCard: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.25)',
        backgroundColor: 'rgba(255,255,255,0.74)',
        padding: 10,
        gap: 6,
    },
    sourceStripLine: {
        fontSize: 12,
        lineHeight: 17,
        color: 'rgba(17,24,39,0.8)',
    },
    detailLeadText: {
        fontSize: 15,
        lineHeight: 22,
        color: '#111827',
    },
    detailNarrativeText: {
        fontSize: 15,
        lineHeight: 22,
        color: '#111827',
    },
    detailBodyText: {
        fontSize: 14,
        lineHeight: 20,
        color: 'rgba(17,24,39,0.82)',
    },
    detailMetaLabel: {
        fontSize: 12,
        color: 'rgba(17,24,39,0.55)',
        fontWeight: '600',
    },
    detailMetaText: {
        marginTop: 4,
        fontSize: 13,
        color: 'rgba(17,24,39,0.82)',
    },
    detailPlaceholderText: {
        fontSize: 14,
        color: 'rgba(17,24,39,0.55)',
        lineHeight: 20,
    },
    detailFootnoteText: {
        marginTop: 12,
        fontSize: 12,
        color: 'rgba(17,24,39,0.55)',
        lineHeight: 18,
    },
    sourcesToggleButton: {
        alignSelf: 'flex-start',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(37,99,235,0.25)',
        backgroundColor: 'rgba(37,99,235,0.08)',
        paddingHorizontal: 12,
        paddingVertical: 7,
        marginTop: 4,
    },
    sourcesToggleButtonText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#1D4ED8',
    },
    sourcesDrawerCard: {
        marginTop: 8,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.25)',
        backgroundColor: 'rgba(255,255,255,0.66)',
        padding: 10,
        gap: 8,
    },
    sourcesDrawerTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: '#1F2937',
    },
    sourceRow: {
        gap: 2,
        paddingBottom: 6,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(148,163,184,0.35)',
    },
    sourceRowTag: {
        fontSize: 11,
        fontWeight: '700',
        color: '#475569',
    },
    sourceRowLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#111827',
        lineHeight: 18,
    },
    sourceRowUrl: {
        fontSize: 11,
        color: '#2563EB',
        lineHeight: 16,
    },
    missingInfoCtaButton: {
        alignSelf: 'flex-start',
        marginTop: 4,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(37,99,235,0.35)',
        backgroundColor: 'rgba(37,99,235,0.10)',
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    missingInfoCtaButtonText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#1D4ED8',
    },

    glassCard: {
        borderRadius: 22,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.28)',
        backgroundColor: 'rgba(255,255,255,0.35)',
    },
    glassCardContent: {
        padding: 14,
    },
    glassCardHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 10,
        gap: 12,
    },
    glassCardHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        flex: 1,
    },
    glassCardHeaderRight: {
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    glassAccent: {
        width: 4,
        height: 18,
        borderRadius: 3,
        marginTop: 2,
    },
    glassCardTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: '#111827',
        lineHeight: 20,
    },
    glassCardSubtitle: {
        marginTop: 2,
        fontSize: 12,
        color: 'rgba(17,24,39,0.55)',
        lineHeight: 16,
    },

    glassPill: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.22)',
        backgroundColor: 'rgba(255,255,255,0.34)',
    },
    glassPillText: {
        fontSize: 12,
        color: 'rgba(17,24,39,0.72)',
        fontWeight: '600',
    },

    bulletRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
    },
    bulletDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        marginTop: 7,
        backgroundColor: 'rgba(17,24,39,0.40)',
    },
    bulletText: {
        flex: 1,
        fontSize: 13,
        lineHeight: 19,
        color: 'rgba(17,24,39,0.82)',
    },

    nextStepsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 2,
    },
    nextStepChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.24)',
        backgroundColor: 'rgba(255,255,255,0.30)',
    },
    nextStepChipText: {
        fontSize: 12,
        fontWeight: '700',
        color: 'rgba(17,24,39,0.75)',
    },

    // ---------- Hero header ----------
    heroHeader: {
        marginTop: 10,
        marginBottom: 14,
        paddingHorizontal: 20,
    },
    heroCard: {
        borderRadius: 26,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.26)',
        padding: 16,
    },
    heroTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    heroImage: {
        width: 54,
        height: 54,
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.25)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.35)',
    },
    heroImagePlaceholder: {
        width: 54,
        height: 54,
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.32)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.35)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    heroTextBlock: {
        flex: 1,
    },
    heroEyebrow: {
        fontSize: 12,
        color: 'rgba(17,24,39,0.55)',
        fontWeight: '700',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
    heroTitle: {
        marginTop: 4,
        fontSize: 20,
        fontWeight: '800',
        color: '#111827',
        lineHeight: 24,
    },
    heroSubtitle: {
        marginTop: 6,
        fontSize: 13,
        color: 'rgba(17,24,39,0.60)',
        lineHeight: 18,
    },
    heroPillsRow: {
        marginTop: 12,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },

    // ---------- Score hero + mini header ----------
    scoreHeroCard: {
        borderRadius: 26,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.26)',
        backgroundColor: 'rgba(255,255,255,0.30)',
        paddingVertical: 14,
    },
    scoreRetryButton: {
        marginTop: 8,
        alignSelf: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(17,24,39,0.18)',
        backgroundColor: 'rgba(255,255,255,0.75)',
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    scoreRetryButtonText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#111827',
    },
    scoreRowButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.35)',
        backgroundColor: 'rgba(255,255,255,0.7)',
        paddingHorizontal: 10,
        paddingVertical: 10,
    },
    scoreRowLabel: {
        flex: 1,
        fontSize: 14,
        fontWeight: '700',
        color: '#111827',
    },
    scoreRowValue: {
        fontSize: 13,
        fontWeight: '700',
        color: '#1F2937',
    },
    scoreChecklistBox: {
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.25)',
        backgroundColor: 'rgba(248,250,252,0.75)',
        paddingHorizontal: 10,
        paddingVertical: 8,
        gap: 6,
    },
    scoreV2Card: {
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.28)',
        backgroundColor: 'rgba(255,255,255,0.78)',
        padding: 12,
        gap: 10,
    },
    scoreLoadingCard: {
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.20)',
        backgroundColor: 'rgba(255,255,255,0.72)',
        paddingHorizontal: 16,
        paddingVertical: 18,
        gap: 6,
    },
    scoreLoadingTitle: {
        fontSize: 14,
        fontWeight: '900',
        color: '#111827',
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
    scoreLoadingBody: {
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '600',
        color: '#4B5563',
    },
    scoreV2Header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 10,
    },
    scoreV2HeaderLeft: {
        flex: 1,
        gap: 3,
    },
    scoreV2Eyebrow: {
        fontSize: 11,
        letterSpacing: 0.6,
        fontWeight: '800',
        color: 'rgba(17,24,39,0.58)',
    },
    scoreV2OverallValue: {
        fontSize: 30,
        lineHeight: 34,
        fontWeight: '900',
        color: '#111827',
    },
    scoreV2OverallOutOf: {
        fontSize: 18,
        lineHeight: 22,
        fontWeight: '700',
        color: 'rgba(17,24,39,0.5)',
    },
    scoreV2OverallBand: {
        fontSize: 13,
        fontWeight: '800',
        color: 'rgba(17,24,39,0.72)',
    },
    scoreV2Confidence: {
        fontSize: 13,
        fontWeight: '700',
        color: 'rgba(17,24,39,0.7)',
    },
    scoreV2ConfidenceHint: {
        marginTop: 2,
        fontSize: 11,
        lineHeight: 15,
        color: 'rgba(17,24,39,0.6)',
        fontWeight: '500',
    },
    scoreV2Modules: {
        gap: 8,
    },
    scoreV2ModuleCard: {
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.25)',
        backgroundColor: 'rgba(255,255,255,0.82)',
        overflow: 'hidden',
    },
    scoreV2ModuleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 10,
        paddingVertical: 10,
        gap: 10,
    },
    scoreV2ModuleTitleWrap: {
        flex: 1,
        gap: 2,
    },
    scoreV2ModuleTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: '#111827',
    },
    scoreV2ModuleStatus: {
        fontSize: 11,
        fontWeight: '700',
    },
    scoreV2ModuleRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    scoreV2ModuleScore: {
        fontSize: 13,
        fontWeight: '800',
        color: '#1F2937',
    },
    scoreV2ChevronExpanded: {
        transform: [{ rotate: '90deg' }],
    },
    scoreV2ChecklistBlock: {
        borderTopWidth: 1,
        borderTopColor: 'rgba(148,163,184,0.2)',
        paddingHorizontal: 10,
        paddingVertical: 9,
        gap: 6,
        backgroundColor: 'rgba(248,250,252,0.72)',
    },
    scoreV2ChecklistRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 8,
    },
    scoreV2ChecklistLine: {
        flex: 1,
        fontSize: 12,
        lineHeight: 18,
        color: '#374151',
        fontWeight: '600',
    },
    scoreV2ChecklistChip: {
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 2,
        alignSelf: 'flex-start',
    },
    scoreV2ChecklistChipText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#1F2937',
    },
    scoreV2ChipVerified: {
        backgroundColor: 'rgba(22,163,74,0.12)',
        borderColor: 'rgba(22,163,74,0.4)',
    },
    scoreV2ChipDetected: {
        backgroundColor: 'rgba(234,179,8,0.16)',
        borderColor: 'rgba(202,138,4,0.45)',
    },
    scoreV2ChipNotVerified: {
        backgroundColor: 'rgba(107,114,128,0.06)',
        borderColor: 'rgba(107,114,128,0.35)',
    },
    scoreV2ChipNotShown: {
        backgroundColor: 'rgba(220,38,38,0.12)',
        borderColor: 'rgba(220,38,38,0.45)',
    },

    miniHeader: {
        position: 'absolute',
        top: 12,
        alignSelf: 'center',
        width: 72,
        height: 72,
        borderRadius: 999,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.28)',
        backgroundColor: 'rgba(255,255,255,0.20)',
        zIndex: 50,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#111827',
        shadowOpacity: 0.08,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
        elevation: 10,
    },
    miniHeaderTint: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    miniScoreBubble: {
        width: 54,
        height: 54,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(17,24,39,0.12)',
        backgroundColor: 'rgba(255,255,255,0.42)',
    },
    miniScoreBubbleMuted: {
        borderColor: 'rgba(17,24,39,0.08)',
        backgroundColor: 'rgba(255,255,255,0.32)',
    },
    miniScoreText: {
        fontSize: 18,
        fontWeight: '900',
        color: '#111827',
    },

    // ---------- Score insight deck ----------
    scoreInsightDeck: {
        paddingHorizontal: 16,
        paddingBottom: 2,
        marginTop: 6,
    },
    scoreInsightHeader: {
        marginBottom: 10,
        paddingHorizontal: 4,
    },
    scoreInsightTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#111827',
    },
    scoreInsightSubtitle: {
        marginTop: 4,
        fontSize: 12,
        lineHeight: 16,
        color: 'rgba(17,24,39,0.55)',
    },
    scoreInsightList: {
        gap: 10,
    },
    scoreInsightItem: {
        borderRadius: 20,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.26)',
        backgroundColor: 'rgba(255,255,255,0.28)',
        padding: 12,
    },
    scoreInsightItemTop: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    scoreInsightItemLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        flex: 1,
    },
    scoreInsightIconBubble: {
        width: 28,
        height: 28,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.55)',
        borderWidth: 1,
        borderColor: 'rgba(17,24,39,0.10)',
    },
    scoreInsightItemTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: '#111827',
    },
    scoreInsightItemSummary: {
        marginTop: 2,
        fontSize: 12,
        color: 'rgba(17,24,39,0.55)',
        lineHeight: 16,
    },
    scoreInsightItemRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    scoreInsightExpanded: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.25)',
    },
    scoreMiniGrid: {
        flexDirection: 'row',
        gap: 10,
    },
    scoreMiniCell: {
        flex: 1,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.26)',
        backgroundColor: 'rgba(255,255,255,0.32)',
        padding: 10,
        alignItems: 'center',
    },
    scoreMiniLabel: {
        fontSize: 11,
        color: 'rgba(17,24,39,0.55)',
        fontWeight: '700',
    },
    scoreMiniValue: {
        marginTop: 4,
        fontSize: 16,
        fontWeight: '900',
        color: '#111827',
    },
    scoreInsightDetailTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: '#111827',
        marginBottom: 8,
    },
    scoreReasonRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        marginBottom: 8,
    },
    scoreReasonDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        marginTop: 7,
        backgroundColor: 'rgba(17,24,39,0.35)',
    },
    scoreReasonText: {
        flex: 1,
        fontSize: 12,
        lineHeight: 17,
        color: 'rgba(17,24,39,0.74)',
    },
    scoreInsightNote: {
        marginTop: 8,
        fontSize: 12,
        color: 'rgba(17,24,39,0.55)',
        lineHeight: 16,
    },

    pillarTriad: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },

    pillarTriadCols: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    pillarCol: {
        alignItems: 'flex-start',
        justifyContent: 'center',
        minWidth: 54,
    },
    pillarColLabel: {
        fontSize: 10,
        fontWeight: '800',
        color: 'rgba(17,24,39,0.55)',
    },
    pillarColValueRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 3,
    },
    pillarColValueText: {
        fontSize: 11,
        fontWeight: '900',
        color: 'rgba(17,24,39,0.70)',
    },
    pillarChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.26)',
        backgroundColor: 'rgba(255,255,255,0.34)',
    },
    pillarDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    pillarChipText: {
        fontSize: 11,
        fontWeight: '800',
        color: 'rgba(17,24,39,0.65)',
    },

    // ---------- Ingredient detail styling ----------

    ingredientChip: {
        borderRadius: 999,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.26)',
        backgroundColor: 'rgba(255,255,255,0.28)',
        paddingHorizontal: 12,
        paddingVertical: 9,
        maxWidth: 220,
    },
    ingredientChipActive: {
        borderColor: 'rgba(217,119,6,0.45)',
        backgroundColor: 'rgba(255,255,255,0.40)',
    },
    ingredientChipText: {
        fontSize: 12,
        fontWeight: '900',
        color: 'rgba(17,24,39,0.68)',
    },
    ingredientChipTextActive: {
        color: '#111827',
    },
    ingredientsList: {
        gap: 10,
    },
    ingredientsListRow: {
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.25)',
        backgroundColor: 'rgba(255,255,255,0.30)',
    },
    ingredientsListName: {
        fontSize: 14,
        fontWeight: '800',
        color: '#111827',
    },
    ingredientsListDose: {
        marginTop: 3,
        fontSize: 12,
        color: 'rgba(17,24,39,0.65)',
        fontWeight: '600',
    },
    ingredientsListDoseMuted: {
        marginTop: 3,
        fontSize: 12,
        color: 'rgba(17,24,39,0.45)',
        fontWeight: '600',
    },
    embeddedPanel: {
        borderRadius: 18,
        overflow: 'hidden',
    },

    kvGrid: {
        gap: 10,
    },
    kvRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.25)',
        backgroundColor: 'rgba(255,255,255,0.30)',
    },
    kvLabel: {
        fontSize: 12,
        color: 'rgba(17,24,39,0.55)',
        fontWeight: '700',
        flex: 1,
    },
    kvValue: {
        fontSize: 12,
        color: 'rgba(17,24,39,0.85)',
        fontWeight: '800',
        textAlign: 'right',
        flex: 1,
    },

    reasonBlock: {
        padding: 12,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.25)',
        backgroundColor: 'rgba(255,255,255,0.28)',
    },
    reasonHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    reasonTitle: {
        fontSize: 12,
        fontWeight: '900',
        color: '#111827',
    },
    reasonText: {
        marginTop: 8,
        fontSize: 12,
        lineHeight: 17,
        color: 'rgba(17,24,39,0.72)',
    },

    emptyStateBox: {
        padding: 12,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.25)',
        backgroundColor: 'rgba(255,255,255,0.28)',
    },
    emptyStateTitle: {
        fontSize: 13,
        fontWeight: '900',
        color: '#111827',
    },
    emptyStateText: {
        marginTop: 6,
        fontSize: 12,
        lineHeight: 17,
        color: 'rgba(17,24,39,0.60)',
    },

    inlineLoadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
    },
    inlineLoadingText: {
        fontSize: 12,
        color: 'rgba(17,24,39,0.60)',
        fontWeight: '700',
    },

    summaryMainText: {
        fontSize: 14,
        lineHeight: 20,
        color: 'rgba(17,24,39,0.82)',
    },
    summarySectionTitle: {
        fontSize: 12,
        fontWeight: '900',
        color: '#111827',
    },
    verdictRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    verdictIconBubble: {
        width: 34,
        height: 34,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
    },
    verdictTitleText: {
        fontSize: 14,
        fontWeight: '900',
        color: '#111827',
    },
    verdictSubtitleText: {
        marginTop: 4,
        fontSize: 12,
        lineHeight: 17,
        color: 'rgba(17,24,39,0.60)',
    },

    // ---------- New modal styling ----------
    modalOverlayGlass: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    modalBackdropTint: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.22)',
    },
    modalSheet: {
        width: '100%',
        height: '88%',
        maxHeight: '88%',
        minHeight: 420,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.22)',
        backgroundColor: 'rgba(255,255,255,0.28)',
        paddingBottom: 8,
    },
    modalHeaderNew: {
        paddingHorizontal: 16,
        paddingBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    modalHeaderLeftNew: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        flex: 1,
    },
    modalIconBubble: {
        width: 38,
        height: 38,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
    },
    modalTitleNew: {
        fontSize: 16,
        fontWeight: '900',
        color: '#111827',
    },
    modalSubtitleNew: {
        marginTop: 4,
        fontSize: 12,
        color: 'rgba(17,24,39,0.55)',
        lineHeight: 16,
    },
    modalCloseButtonNew: {
        width: 34,
        height: 34,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.28)',
        backgroundColor: 'rgba(255,255,255,0.40)',
    },
    modalScrollNew: {
        flex: 1,
    },
    modalScrollContentNew: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },

    dataStatusRowNew: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    dataStatusSmallNew: {
        fontSize: 12,
        color: 'rgba(17,24,39,0.55)',
        fontWeight: '600',
    },
    dataStatusNoteNew: {
        fontSize: 12,
        color: 'rgba(17,24,39,0.65)',
        lineHeight: 17,
    },
    dataStatusDisclaimerNew: {
        fontSize: 11,
        color: 'rgba(17,24,39,0.55)',
        lineHeight: 16,
    },
});
