import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
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
import { summarizeFoundationHits } from '@/lib/knowledge/foundationLookup';
import { resolveDataCeilingSignal } from '@/lib/scan/dataCeiling';
import { buildGapActionSentences } from '@/lib/scan/gapActionSentenceLibrary';
import { isNutritionLabelLikeIngredient } from '@/lib/scan/isNutritionLabelLikeIngredient';
import { assembleInsightsDTO, buildWhyBullets } from '@/lib/scan/insightsAssembler';
import { enforceNeverBlank, isPlaceholderText, sanitizeCoverBullets, sanitizeCoverLine } from '@/lib/scan/neverBlank';
import { buildRecordFactsViewModel } from '@/lib/scan/recordFactsViewModel';
import { buildSafetySignalPack, safetySignalsToPriorityLines } from '@/lib/scan/safetySignalPack';
import { resolveTrustedDisplayIdentity } from '@/lib/scan/resolveTrustedDisplayIdentity';
import { buildVerificationPresentation } from '@/lib/scan/verificationPresentation';
import { resolveReasonCodeMessage } from '@/lib/scan/streamStateMachine';
import { computeSmartScores, type AnalysisInput } from '@/lib/scoring';
import { formatBrandForPill } from '@/lib/supplementDisplay';
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
    content: React.ReactNode;
};

type WidgetTileProps = {
    tile: TileConfig;
    onPress: () => void;
};

const FORCE_FULL_DASHBOARD_EFFECTS =
    process.env.EXPO_PUBLIC_FORCE_FULL_DASHBOARD_EFFECTS === 'true' ||
    process.env.EXPO_PUBLIC_FORCE_FULL_DASHBOARD_EFFECTS === '1';
const SHOW_SCAN_DEBUG =
    process.env.EXPO_PUBLIC_SHOW_SCAN_DEBUG === 'true' ||
    process.env.EXPO_PUBLIC_SHOW_SCAN_DEBUG === '1';
const SCORE_PENDING_DONE_TIMEOUT_MS = Math.max(
    8_000,
    Math.min(
        15_000,
        Number(process.env.EXPO_PUBLIC_SCORE_PENDING_DONE_TIMEOUT_MS ?? 10_000) || 10_000,
    ),
);

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

function ensurePeriod(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

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
                    <View style={styles.tileSection}>
                        <View style={styles.mechList}>
                            {(tile.mechanisms || []).slice(0, 3).map((mechanism, idx) => (
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
}> = ({ visible, onClose, tile }) => {
    const { t } = useTranslation();
    if (!tile) return null;

    const accent = tile.backgroundColor || '#D1D5DB';
    const ModalIcon = tile.icon;
    const statusLine = tile.dataStatus
        ? `Missing: ${formatMissingReasons(tile.dataStatus.missingReasons)}`
        : undefined;
    const sourceLine = formatSourceRefs(tile.dataStatus?.sources);
    const notesLine = tile.dataStatus?.notes?.length ? tile.dataStatus.notes.join(' • ') : null;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onRequestClose={onClose}
            statusBarTranslucent
        >
            <View style={styles.modalOverlayGlass}>
                {/* Backdrop */}
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
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

                        <Pressable style={styles.modalCloseButtonNew} onPress={onClose} accessibilityLabel="Close">
                            <DashboardBlur intensity={18} tint="light" style={StyleSheet.absoluteFill} />
                            <X size={18} color="#111827" />
                        </Pressable>
                    </View>

                    <ScrollView
                        style={styles.modalScrollNew}
                        contentContainerStyle={styles.modalScrollContentNew}
                        showsVerticalScrollIndicator={false}
                    >
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

                        {/* Data status (always visible, consistent) */}
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
    sourceTypeFinal: boolean
): SourceRef[] => {
    if (!sourceTypeFinal || !sourceType) {
        return [];
    }
    // Product trust framing: regulatory/label sources count as "connected" even if we didn't use web evidence.
    if (sourceType === 'lnhpd' || sourceType === 'dsld') {
        return [
            { type: 'label' },
            { type: 'other', title: 'Web evidence: not used' },
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
    notes?: string[]
) => ({
    status: mapBundleStatusToCover(status),
    missingReasons: [],
    sources: buildBundleSources(sourceType, sourceTypeFinal),
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

// Ingredient summary (DeepSeek-backed when available; deterministic fallback otherwise)
type IngredientSummaryState = {
    status: 'idle' | 'loading' | 'ok' | 'error';
    source?: 'api' | 'fallback';
    tldr?: string;
    highlights?: string[];
    caveats?: string[];
    confidence_note?: string;
    error?: string;
};

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

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const MiniScoreHeader: React.FC<{
    scrollY: SharedValue<number>;
    overallScore: number;
    title: string;
    subtitle?: string;
    muted?: boolean;
}> = ({ scrollY, overallScore, title, subtitle, muted }) => {
    const animatedStyle = useAnimatedStyle(() => {
        const p = clamp01((scrollY.value - 210) / 70); // appears after user scrolls a bit
        return {
            opacity: p,
            transform: [{ translateY: (1 - p) * -66 }],
        };
    }, []);

    return (
        <Animated.View style={[styles.miniHeader, animatedStyle]} pointerEvents="none">
            <DashboardBlur intensity={22} tint="light" style={StyleSheet.absoluteFill} />
            <View style={styles.miniHeaderTint} />

            <View style={styles.miniHeaderContent}>
                <View style={[styles.miniScoreBubble, muted ? styles.miniScoreBubbleMuted : null]}>
                    <Text style={styles.miniScoreText}>{Math.round(overallScore)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={styles.miniHeaderTitle} numberOfLines={1}>
                        {title}
                    </Text>
                    {subtitle ? (
                        <Text style={styles.miniHeaderSubtitle} numberOfLines={1}>
                            {subtitle}
                        </Text>
                    ) : null}
                </View>
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
    scoreBundleV4State?: ScoreBundleV4State;
    onRetryScore?: () => void;
}> = ({
    bundle,
    analysis,
    isStreaming = false,
    scoreBadge,
    scoreState = 'active',
    sourceType = 'barcode',
    scoreBundleV4State,
    onRetryScore,
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
    const detailLoadingRef = useRef(false);
    const detailInFlightKeyRef = useRef<string | null>(null);
    const foundationMetricLoggedRef = useRef<Set<string>>(new Set());
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
        // Never clobber on-demand detail fields (e.g. ingredients.detail) when a newer analysis_bundle
        // arrives over SSE. The SSE bundle typically carries cover + meta only, while detail is fetched
        // separately via /api/analysis-section. If we overwrite state here, we can re-trigger the
        // auto-fetch loop and hit backend 429s.
        setBundleState((prev) => {
            // v4 path
            if (isBundleV4(prev) && isBundleV4(bundle)) {
                const sameKey =
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

    const onTilesGridLayout = useCallback((e: LayoutChangeEvent) => {
        const nextWidth = e.nativeEvent.layout.width;
        setTilesContainerW((prev) => (Math.abs(prev - nextWidth) < 1 ? prev : nextWidth));
    }, []);

    const productInfo = analysis?.productInfo ?? { brand: null, name: null, category: null, image: null };
    const brandForSubtitle =
        typeof productInfo.brand === 'string' && productInfo.brand.trim()
            ? formatBrandForPill(productInfo.brand)
            : null;
    const rawProductSubtitle = [brandForSubtitle, productInfo.category].filter(Boolean).join(' • ');
    const trustedDisplayIdentity = useMemo(
        () =>
            resolveTrustedDisplayIdentity({
                bundleMeta: bundleState.meta,
                productName: productInfo.name || 'Supplement',
                productSubtitle: rawProductSubtitle,
                authoritativeIdentity: bundleState?.meta?.authoritativeIdentity ?? null,
                barcode: bundleState?.meta?.authoritativeIdentity?.value ?? null,
                sources: (Array.isArray(analysis?.sources) ? analysis.sources : []).map((source: any) => ({
                    domain: typeof source?.domain === 'string' ? source.domain : null,
                    url: typeof source?.url === 'string' ? source.url : typeof source?.link === 'string' ? source.link : null,
                    link: typeof source?.link === 'string' ? source.link : null,
                })),
                showDebugWebHintSource: SHOW_SCAN_DEBUG,
            }),
        [
            analysis?.sources,
            bundleState.meta,
            productInfo.name,
            rawProductSubtitle,
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
    const overviewSummaryText = sanitizeCoverLine(
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
    const overviewBullets = sanitizeCoverBullets(
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
    const ingredientMechanisms: Mechanism[] = ingredientsItems.length > 0
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

        const hitSummary = summarizeFoundationHits(keyIngredientsForIngredients);
        console.info('[foundation-overlay-metric]', {
            ...hitSummary,
            selectedIngredients: keyIngredientsForIngredients,
        });
    }, [bundleSourceTypeFinal, bundleState.meta.factsDigestHash, keyIngredientsForIngredients]);

    const usageCover = bundleState.sections.usage.cover;
    const rawUsageBullets = usageCover?.bullets ?? [];
    const usageBullets = sanitizeCoverBullets(
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
    const usageRoutine = sanitizeCoverLine(
        usageCover?.bestTimeToTake?.text ?? usageCover?.dosage?.text ?? null,
        'Follow the package label directions for timing and dose.',
    );

    const safetyCover = bundleState.sections.safety.cover;
    const safetyPending = bundleState.sections.safety.dataStatus === 'pending';
    const safetyBullet0Raw = safetyCover?.bullets?.[0];
    const safetyBullet1Raw = safetyCover?.bullets?.[1];
    const safetyWarningCoverText = sanitizeCoverLine(
        safetyBullet0Raw ? formatTaggedText(safetyBullet0Raw.text, safetyBullet0Raw.basisTags) : null,
        safetyPending
            ? 'Safety summary pending.'
            : 'Safety data is limited for this source. Consult your clinician for personal guidance.',
    );
    const safetyTipCoverText = sanitizeCoverLine(
        safetyBullet1Raw ? formatTaggedText(safetyBullet1Raw.text, safetyBullet1Raw.basisTags) : null,
        safetyPending
            ? 'Safety tips pending.'
            : 'General reminder: check the label and consult a clinician if needed.',
    );
    const safetyBullet0Text = normalizeText(safetyWarningCoverText);
    const safetyBullet1Text = normalizeText(safetyTipCoverText);
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
    const scienceTopIngredients = useMemo(
        () =>
            [
                ...(ingredientsItemsFiltered.length > 0
                    ? ingredientsItemsFiltered
                    : recordFacts.ingredientRows.map((row) => ({
                        name: row.name,
                        dose: row.doseLine ?? '',
                        basisTags: [] as BasisTag[],
                    })).filter((row) => !isNutritionLabelLikeIngredient(row.name))),
            ]
                .sort((a, b) => {
                    const aHasDose = normalizeText(a?.dose ?? '').length > 0 ? 1 : 0;
                    const bHasDose = normalizeText(b?.dose ?? '').length > 0 ? 1 : 0;
                    if (aHasDose !== bHasDose) return bHasDose - aHasDose;
                    return normalizeText(a?.name ?? '').localeCompare(normalizeText(b?.name ?? ''));
                })
                .slice(0, 3),
        [ingredientsItemsFiltered, recordFacts.ingredientRows],
    );
    const safetyNotes = showGeneralWatchOuts
        ? ['No label-specific warnings detected; general watch-outs shown.']
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
                bundleSourceTypeFinal
            ),
            missingReasons: Array.from(missingReasons),
        };
    }, [
        bundleState.sections.overview.dataStatus,
        bundleSourceType,
        bundleSourceTypeFinal,
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
                ingredientsNotes
            ),
            missingReasons: Array.from(missingReasons),
        };
    }, [
        bundleState.sections.ingredients.dataStatus,
        bundleSourceType,
        bundleSourceTypeFinal,
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
                bundleSourceTypeFinal
            ),
            missingReasons: Array.from(missingReasons),
        };
    }, [
        bundleState.sections.usage.dataStatus,
        bundleState.sections.usage.detail?.timingRationale?.text,
        bundleSourceType,
        bundleSourceTypeFinal,
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
                safetyNotes
            ),
            missingReasons: Array.from(missingReasons),
        };
    }, [
        bundleState.sections.safety.dataStatus,
        bundleState.sections.safety.detail?.warnings,
        bundleSourceType,
        bundleSourceTypeFinal,
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
    const overviewWhatIsLines = enforceNeverBlank({
        lines: [
            toSentence(
                `${overviewFacts?.product?.name ?? productTitle} by ${overviewFacts?.product?.brand ?? (brandForSubtitle ?? 'Unknown brand')
                } — ${verificationPresentation.copyTokens.overviewLead}`,
            ),
            isDataCeiling ? dataCeilingOverviewLine : overviewSummarySeed,
            isDataCeiling
                ? dataCeilingActionLine
                : (
                    recordFacts.topIngredient?.name
                        ? `Key ingredient detected: ${recordFacts.topIngredient.name}.`
                        : null
                ),
        ],
        fallback: [
            verificationPresentation.copyTokens.sourceCopy,
            'Add clearer label evidence to improve product-level context.',
        ],
    });

    const overviewVerifiedLines = enforceNeverBlank({
        lines: [
            isDataCeiling
                ? 'Active ingredients were not provided in this verified record.'
                : `Active ingredients detected: ${recordFacts.ingredientCount}.`,
            recordFacts.servingSizeText
                ? `Serving size on record: ${recordFacts.servingSizeText}.`
                : null,
            overviewFacts?.usage?.dosageForm ? `Dosage form on record: ${overviewFacts.usage.dosageForm}.` : null,
            recordFacts.perServingDoseLine
                ? `Per-serving dose from record: ${recordFacts.perServingDoseLine}.`
                : isDataCeiling
                    ? 'Per-serving dose from record is unavailable.'
                    : null,
            isDataCeiling ? `Reason: ${dataCeilingReasonNote}` : null,
        ],
        fallback: [
            'Ingredient-level verification is available for this product.',
            'When dosage form or serving fields are missing, we keep guidance conservative.',
        ],
    });

    const overviewQualityLines = enforceNeverBlank({
        lines: [
            `Data quality status: ${overviewFacts?.dataQuality?.overallStatus ?? COVER_STATUS_LABELS[unifiedOverviewDataStatus.status]}.`,
            isDataCeiling ? dataCeilingOverviewLine : null,
            isDataCeiling ? dataCeilingActionLine : null,
            ...(overviewFacts?.dataQuality?.notes ?? []),
            ...overviewGapNotes,
        ],
        fallback: [
            'Some expected fields are missing in this source record.',
            'Capture Supplement Facts + Directions panels to improve product-specific detail.',
        ],
    });

    const overviewContent = (
        <View style={styles.detailStack}>
            <GlassCard
                title="What this product is"
                subtitle={verificationPresentation.copyTokens.overviewSubtitle}
                accentColor="#2563EB"
                right={<GlassPill label={verificationPresentation.copyTokens.evidencePillLabel} />}
            >
                <View style={{ gap: 10 }}>
                    {overviewWhatIsLines.map((line, idx) => (
                        <Text key={`ov-what-${idx}`} style={idx === 0 ? styles.detailLeadText : styles.detailBodyText}>
                            {line}
                        </Text>
                    ))}
                </View>
            </GlassCard>

            <GlassCard title={verificationPresentation.copyTokens.factsCardTitle} subtitle="Facts-first checks" accentColor="#2563EB">
                <View style={{ gap: 10 }}>
                    {overviewVerifiedLines.map((line, idx) => (
                        <View key={`ov-ver-${idx}`} style={styles.bulletRow}>
                            <View style={styles.bulletDot} />
                            <Text style={styles.bulletText}>{line}</Text>
                        </View>
                    ))}
                </View>
            </GlassCard>

            <GlassCard title="Context notes" subtitle="What is missing and why" accentColor="#2563EB">
                <View style={{ gap: 10 }}>
                    {overviewQualityLines.map((line, idx) => (
                        <Text key={`ov-qual-${idx}`} style={styles.detailBodyText}>
                            {line}
                        </Text>
                    ))}
                </View>
            </GlassCard>
        </View>
    );

    const ingredientsDetail = bundleState.sections.ingredients.detail;


    // --- Science & Ingredients: per-ingredient detail view state ---
    const keyIngredientsForDetail = useMemo(() => {
        const preferred = keyIngredientsForIngredients.length
            ? keyIngredientsForIngredients
            : (
                ingredientsItemsFiltered.length > 0
                    ? ingredientsItemsFiltered.map((i) => i.name).filter(Boolean)
                    : recordFacts.ingredientRows
                        .map((row) => row.name)
                        .filter((name): name is string => Boolean(name) && !isNutritionLabelLikeIngredient(name))
            );

        const deduped: string[] = [];
        const seen = new Set<string>();
        for (const name of preferred) {
            const key = normalizeIngredientNameForBackground(name);
            if (!key) continue;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(name);
        }
        return deduped.slice(0, 3);
    }, [keyIngredientsForIngredients, ingredientsItemsFiltered, recordFacts.ingredientRows]);

    const [activeIngredientName, setActiveIngredientName] = useState<string | null>(
        keyIngredientsForDetail[0] ?? null
    );

    useEffect(() => {
        const listKeys = keyIngredientsForDetail.map((n) => normalizeIngredientNameForBackground(n));
        const activeKey = activeIngredientName ? normalizeIngredientNameForBackground(activeIngredientName) : null;
        if (!activeKey || !listKeys.includes(activeKey)) {
            setActiveIngredientName(keyIngredientsForDetail[0] ?? null);
        }
    }, [keyIngredientsForDetail, activeIngredientName]);

    const activeIngredientKey = activeIngredientName ? normalizeIngredientNameForBackground(activeIngredientName) : null;

    const activeIngredientCover = useMemo(() => {
        if (!activeIngredientKey) return null;
        return ingredientsItemsFiltered.find((i) => normalizeIngredientNameForBackground(i.name) === activeIngredientKey) ?? null;
    }, [ingredientsItemsFiltered, activeIngredientKey]);
    const activeIngredientRecord = useMemo(() => {
        if (!activeIngredientKey) return null;
        return (
            recordFacts.ingredientRows.find(
                (item) => normalizeIngredientNameForBackground(item.name) === activeIngredientKey,
            ) ?? null
        );
    }, [activeIngredientKey, recordFacts.ingredientRows]);

    const activeIngredientDetail = useMemo(() => {
        if (!activeIngredientKey) return null;
        const items = ingredientsDetail?.items ?? [];
        return items.find((i) => normalizeIngredientNameForBackground(i.name) === activeIngredientKey) ?? null;
    }, [ingredientsDetail?.items, activeIngredientKey]);

    const activeProductInsight = useMemo(() => {
        if (!activeIngredientKey) return null;
        return productSpecificInsightsByIngredient.get(activeIngredientKey) ?? null;
    }, [productSpecificInsightsByIngredient, activeIngredientKey]);

    const activeIngredientLabelLine = useMemo(() => {
        const selectedName = activeIngredientName
            ? capitalizeSentences(activeIngredientName)
            : (isDataCeiling ? 'Ingredients unavailable in this record' : 'No ingredient selected');
        const labelDose = normalizeText(
            typeof activeIngredientCover?.dose === 'string'
                ? activeIngredientCover.dose
                : activeIngredientRecord?.doseLine,
        );
        if (labelDose) {
            return `${selectedName} • ${labelDose}`;
        }
        return `${selectedName} • ${isDataCeiling ? 'Scan Supplement Facts to continue' : 'Dose not disclosed on label'}`;
    }, [activeIngredientName, activeIngredientCover?.dose, activeIngredientRecord?.doseLine, isDataCeiling]);

    // Runtime KB notes cache keyed by normalizedIngredientName|formKey.

    const activeRuntimeKey =
        activeIngredientKey && activeProductInsight?.formKey
            ? `${activeIngredientKey}|${activeProductInsight.formKey}`
            : null;

    const activeRuntimeNotes = activeRuntimeKey ? runtimeKbNotesByKey[activeRuntimeKey] : undefined;
    const activeRuntimeStatus = activeRuntimeNotes?.status;

    useEffect(() => {
        const FORM_MATCH_GATE = 0.35;
        if (selectedTileType !== 'science') return;
        if (!activeIngredientKey) return;
        if (!activeProductInsight?.ingredientId || !activeProductInsight?.formKey) return;
        if ((activeProductInsight.matchScore ?? 0) < FORM_MATCH_GATE) return;

        if (activeRuntimeStatus && ['loading', 'ok', 'not_found', 'error'].includes(activeRuntimeStatus)) return;

        const key = `${activeIngredientKey}|${activeProductInsight.formKey}`;

        const run = async () => {
            try {
                setRuntimeKbNotesByKey((prev) => ({
                    ...prev,
                    [key]: { status: 'loading' },
                }));

                const baseUrl = String(Config.searchApiBaseUrl).replace(/\/$/, '');
                const res = await fetch(`${baseUrl}/api/kb/runtime/form-insights/batch`, {
                    method: 'POST',
                    headers: {
                        ...(await withAuthHeaders({
                            'Content-Type': 'application/json',
                        })),
                    },
                    body: JSON.stringify({
                        locale: 'en',
                        items: [
                            {
                                ingredientId: activeProductInsight.ingredientId,
                                formKey: activeProductInsight.formKey,
                                ingredientName: activeIngredientName ?? undefined,
                                ingredientCanonicalKey: activeProductInsight.ingredientCanonicalKey ?? undefined,
                            },
                        ],
                    }),
                });

                if (!res.ok) {
                    setRuntimeKbNotesByKey((prev) => ({
                        ...prev,
                        [key]: { status: 'error', reason: `HTTP ${res.status}` },
                    }));
                    return;
                }

                const payload = await res.json();
                const items: any[] = Array.isArray(payload?.items) ? payload.items : [];

                const match =
                    items.find(
                        (i) =>
                            i?.ingredientId === activeProductInsight.ingredientId &&
                            i?.formKey === activeProductInsight.formKey
                    ) ??
                    items[0] ??
                    null;

                if (!match) {
                    setRuntimeKbNotesByKey((prev) => ({
                        ...prev,
                        [key]: { status: 'error', reason: 'No runtime KB response' },
                    }));
                    return;
                }

                const statusRaw: string = typeof match?.status === 'string' ? match.status : 'error';

                const segmentsByBucket: Record<string, string[]> = {};
                if (Array.isArray(match?.segments)) {
                    for (const seg of match.segments) {
                        const bucket =
                            typeof seg?.kind === 'string'
                                ? seg.kind
                                : typeof seg?.bucket === 'string'
                                    ? seg.bucket
                                    : null;
                        const t = typeof seg?.text === 'string' ? seg.text : null;
                        if (!bucket || !t) continue;
                        if (!segmentsByBucket[bucket]) segmentsByBucket[bucket] = [];
                        segmentsByBucket[bucket].push(t);
                    }
                }

                const nestedMeta = (match?.meta && typeof match.meta === 'object') ? match.meta : null;
                const meta = {
                    source:
                        (nestedMeta && typeof (nestedMeta as any).source === 'string'
                            ? (nestedMeta as any).source
                            : typeof match?.source === 'string'
                                ? match.source
                                : undefined),
                    packageSha256:
                        (nestedMeta && typeof (nestedMeta as any).packageSha256 === 'string'
                            ? (nestedMeta as any).packageSha256
                            : typeof match?.packageSha256 === 'string'
                                ? match.packageSha256
                                : undefined),
                    reviewedAt:
                        (nestedMeta && typeof (nestedMeta as any).reviewedAt === 'string'
                            ? (nestedMeta as any).reviewedAt
                            : typeof match?.reviewedAt === 'string'
                                ? match.reviewedAt
                                : undefined),
                    formDisplay:
                        (nestedMeta && typeof (nestedMeta as any).formDisplay === 'string'
                            ? (nestedMeta as any).formDisplay
                            : typeof match?.formDisplay === 'string'
                                ? match.formDisplay
                                : undefined),
                };

                if (statusRaw !== 'ok') {
                    setRuntimeKbNotesByKey((prev) => ({
                        ...prev,
                        [key]: {
                            status: 'not_found',
                            reason: typeof match?.reason === 'string' ? match.reason : 'Not available',
                            segmentsByBucket: Object.keys(segmentsByBucket).length ? segmentsByBucket : undefined,
                            meta,
                        },
                    }));
                    return;
                }

                setRuntimeKbNotesByKey((prev) => ({
                    ...prev,
                    [key]: {
                        status: 'ok',
                        segmentsByBucket: Object.keys(segmentsByBucket).length ? segmentsByBucket : undefined,
                        meta,
                    },
                }));
            } catch (e: any) {
                setRuntimeKbNotesByKey((prev) => ({
                    ...prev,
                    [key]: { status: 'error', reason: e?.message ?? 'Error' },
                }));
            }
        };

        run();
    }, [
        selectedTileType,
        activeIngredientKey,
        activeIngredientName,
        activeProductInsight?.ingredientId,
        activeProductInsight?.ingredientCanonicalKey,
        activeProductInsight?.formKey,
        activeProductInsight?.matchScore,
        activeRuntimeStatus,
    ]);

    // Ingredient summary cache (DeepSeek-backed when configured; deterministic fallback otherwise)
    const [summaryByIngredient, setSummaryByIngredient] = useState<Record<string, IngredientSummaryState>>({});

    const activeSummary = activeIngredientKey ? summaryByIngredient[activeIngredientKey] : undefined;
    const deepseekLoading = activeSummary?.status === 'loading';
    const deepseekError =
        activeSummary?.status === 'error'
            ? activeSummary.error ?? 'Summary unavailable'
            : null;
    const activeSummaryStatus = activeSummary?.status;
    const activeRuntimeSegments = activeRuntimeNotes?.segmentsByBucket ?? null;
    const activeIngredientDose = activeIngredientCover?.dose ?? null;
    const activeFactsIngredient = useMemo(() => {
        if (!activeIngredientKey) return null;
        const actives = factsDtoState.data?.ingredients?.actives ?? [];
        return (
            actives.find((item) => normalizeIngredientNameForBackground(item.name) === activeIngredientKey) ?? null
        );
    }, [activeIngredientKey, factsDtoState.data?.ingredients?.actives]);

    const activeInsightFromDto = useMemo(() => {
        if (!activeIngredientKey) return null;
        return (
            assembledInsights?.keyIngredientsInsights?.find(
                (item) => normalizeIngredientNameForBackground(item.name) === activeIngredientKey,
            ) ?? null
        );
    }, [activeIngredientKey, assembledInsights]);
    const hasInferredSpecificForm = Boolean(
        activeProductInsight?.formLabel
        && activeProductInsight.formLabel.trim().length > 0
        && !isUnspecifiedFormSignal(activeProductInsight.formKey, activeProductInsight.reasonCode),
    );

    const activeWhyPayload = useMemo(() => {
        if (!activeIngredientName) return null;
        return buildWhyBullets({
            ingredientName: activeIngredientName,
            formText: activeFactsIngredient?.formText ?? null,
            formSource: activeFactsIngredient?.formText ? 'facts' : hasInferredSpecificForm ? 'inferred' : 'none',
            formKey: activeProductInsight?.formKey ?? null,
            reasonCode: activeProductInsight?.reasonCode ?? null,
            formLabel: activeProductInsight?.formLabel ?? null,
            matchScore: activeProductInsight?.matchScore ?? null,
            evidenceGrade: activeProductInsight?.evidenceGrade ?? null,
            rbfFactor: activeProductInsight?.effectiveFactor ?? null,
            rbfBand: activeProductInsight?.rbfBand ?? 'unknown',
            doseSignal: activeProductInsight?.doseSignal ?? null,
            reviewedSegments: activeRuntimeSegments,
        });
    }, [
        activeIngredientName,
        activeFactsIngredient?.formText,
        activeProductInsight?.formLabel,
        activeProductInsight?.formKey,
        activeProductInsight?.reasonCode,
        activeProductInsight?.matchScore,
        activeProductInsight?.evidenceGrade,
        activeProductInsight?.effectiveFactor,
        activeProductInsight?.rbfBand,
        activeProductInsight?.doseSignal,
        activeRuntimeSegments,
        hasInferredSpecificForm,
    ]);
    const hasFactsSpecificForm = Boolean(activeFactsIngredient?.formText && activeFactsIngredient.formText.trim().length > 0);
    const hasSpecificFormSignal = hasFactsSpecificForm || hasInferredSpecificForm;
    const hasUnspecifiedFormFallback = isUnspecifiedFormSignal(
        activeProductInsight?.formKey,
        activeProductInsight?.reasonCode,
    );
    const activeFormDisplayText =
        activeFactsIngredient?.formText ??
        (hasInferredSpecificForm ? activeProductInsight?.formLabel : null) ??
        activeInsightFromDto?.form?.text ??
        'Form not disclosed on label; we do not assume.';
    const activeRbfFactor =
        activeInsightFromDto?.rbf?.factor ??
        (hasUnspecifiedFormFallback ? null : activeProductInsight?.effectiveFactor ?? null);
    const activeRbfBand =
        activeInsightFromDto?.rbf?.band ??
        (hasUnspecifiedFormFallback ? 'unknown' : activeProductInsight?.rbfBand ?? 'unknown');
    const activeConfidenceText = activeInsightFromDto
        ? activeInsightFromDto.confidenceNote
        : `Confidence: ${activeProductInsight?.confidenceTier ?? 'none'}.`;
    const scienceDatasetSubtitle =
        verificationPresentation.verificationStatus === 'final'
            ? 'Verified dataset (when available)'
            : verificationPresentation.verificationStatus === 'likely'
                ? 'Likely matched dataset (verify on label)'
                : verificationPresentation.verificationStatus === 'pending'
                    ? 'Dataset verification in progress'
                    : 'Dataset signals are limited for this source';
    const scienceDatasetPill =
        verificationPresentation.verificationStatus === 'final'
            ? 'Verified dataset'
            : verificationPresentation.verificationStatus === 'likely'
                ? 'Likely dataset'
                : verificationPresentation.verificationStatus === 'pending'
                    ? 'Verifying dataset'
                    : 'Limited dataset';

    useEffect(() => {
        if (selectedTileType !== 'science') return;
        if (!activeIngredientName || !activeIngredientKey) return;

        if (activeSummaryStatus && ['loading', 'ok'].includes(activeSummaryStatus)) return;

        const stringHash = (s: string) => {
            let h = 2166136261;
            for (let i = 0; i < s.length; i++) {
                h ^= s.charCodeAt(i);
                h = Math.imul(h, 16777619);
            }
            return h >>> 0;
        };

        const buildFallback = (): IngredientSummaryState => {
            const coverDose = activeIngredientDose;

            const highlights: string[] = [];
            const caveats: string[] = [];

            if (coverDose) {
                highlights.push(`Label dose: ${coverDose}.`);
            }

            if (activeProductInsight?.effectiveFactor && !hasUnspecifiedFormFallback) {
                const factor = activeProductInsight.effectiveFactor.toFixed(2);
                highlights.push(`Reviewed dataset suggests this form trends ${activeProductInsight.rbfBand.toLowerCase()} on relative bioavailability (RBF ${factor}).`);
            }

            if (activeProductInsight?.doseSignal) {
                const ds = activeProductInsight.doseSignal;
                const range =
                    typeof ds.dailyAmount === 'number' && ds.unit
                        ? `daily ${ds.dailyAmount} ${ds.unit}`
                        : null;
                const note = [
                    `Dose evidence: ${ds.status.replace(/_/g, ' ')}`,
                    range ? `(${range})` : null,
                ].filter(Boolean).join(' ');
                highlights.push(note + '.');
            }

            const chemicalFormExplain = isIngredientsDetailItemV4(activeIngredientDetail)
                ? activeIngredientDetail.chemicalFormExplain
                : null;
            const formFromLabel = Boolean(
                chemicalFormExplain &&
                !(chemicalFormExplain.basisTags ?? []).includes('not_provided')
            );
            if (!formFromLabel && !hasInferredSpecificForm) {
                caveats.push('Chemical form was not disclosed by the source, so absorption-specific insights are limited.');
            }

            const seed = stringHash(activeIngredientKey);
            const leadins = ['Overall,', 'In practice,', 'For most users,', 'In plain terms,'];
            const lead = leadins[seed % leadins.length];

            const tldrParts: string[] = [];
            tldrParts.push(`${lead} this ingredient view combines general background with product-specific signals when available.`);
            if (activeProductInsight?.confidenceTier && activeProductInsight.confidenceTier !== 'none') {
                tldrParts.push(`Confidence is ${activeProductInsight.confidenceTier.toLowerCase()} for the detected form evidence.`);
            } else {
                tldrParts.push('Confidence is limited because verified product signals are missing or incomplete.');
            }

            const confidence_note = activeProductInsight?.why ? activeProductInsight.why : undefined;

            return {
                status: 'ok',
                source: 'fallback',
                tldr: tldrParts.join(' '),
                highlights: highlights.slice(0, 4),
                caveats: caveats.slice(0, 3),
                confidence_note,
            };
        };

        const run = async () => {
            try {
                setSummaryByIngredient((prev) => ({
                    ...prev,
                    [activeIngredientKey]: { status: 'loading' },
                }));

                const baseUrl = String(Config.searchApiBaseUrl).replace(/\/$/, '');
                const packet = {
                    locale: 'en',
                    ingredientName: activeIngredientName,
                    facts: {
                        amount: activeFactsIngredient?.amount ?? null,
                        unit: activeFactsIngredient?.unit ?? null,
                        formText: activeFactsIngredient?.formText ?? null,
                    },
                    insight: {
                        rbfBand: activeProductInsight?.rbfBand ?? 'unknown',
                        rbfFactor: activeProductInsight?.effectiveFactor ?? null,
                        confidenceTier: activeProductInsight?.confidenceTier ?? 'none',
                        whyBullets: activeWhyPayload?.bullets ?? [],
                        doseStatus:
                            activeProductInsight?.doseSignal?.status === 'below_typical' ||
                                activeProductInsight?.doseSignal?.status === 'within_typical' ||
                                activeProductInsight?.doseSignal?.status === 'above_typical'
                                ? activeProductInsight.doseSignal.status
                                : 'unknown',
                        dailyAmount: activeProductInsight?.doseSignal?.dailyAmount ?? null,
                        dailyUnit: activeProductInsight?.doseSignal?.unit ?? null,
                    },
                    reviewedKbBullets: Object.values(activeRuntimeSegments ?? {}).flat().slice(0, 4),
                };

                const res = await fetch(`${baseUrl}/api/summary/ingredient`, {
                    method: 'POST',
                    headers: {
                        ...(await withAuthHeaders({
                            'Content-Type': 'application/json',
                        })),
                    },
                    body: JSON.stringify(packet),
                });

                if (!res.ok) {
                    setSummaryByIngredient((prev) => ({
                        ...prev,
                        [activeIngredientKey]: buildFallback(),
                    }));
                    return;
                }

                const json = await res.json();
                const tldr =
                    (typeof json?.tldr === 'string' && json.tldr) ||
                    (typeof json?.summary === 'string' && json.summary) ||
                    (typeof json?.text === 'string' && json.text) ||
                    null;

                const highlights = Array.isArray(json?.highlights)
                    ? json.highlights.filter((x: any) => typeof x === 'string')
                    : Array.isArray(json?.bullets)
                        ? json.bullets.filter((x: any) => typeof x === 'string')
                        : null;

                const caveats = Array.isArray(json?.caveats)
                    ? json.caveats.filter((x: any) => typeof x === 'string')
                    : null;

                const confidence_note = typeof json?.confidence_note === 'string' ? json.confidence_note : undefined;

                if (!tldr) {
                    setSummaryByIngredient((prev) => ({
                        ...prev,
                        [activeIngredientKey]: buildFallback(),
                    }));
                    return;
                }

                setSummaryByIngredient((prev) => ({
                    ...prev,
                    [activeIngredientKey]: {
                        status: 'ok',
                        source: 'api',
                        tldr,
                        highlights: highlights ?? undefined,
                        caveats: caveats ?? undefined,
                        confidence_note,
                    },
                }));
            } catch {
                setSummaryByIngredient((prev) => ({
                    ...prev,
                    [activeIngredientKey]: buildFallback(),
                }));
            }
        };

        run();
    }, [
        selectedTileType,
        activeIngredientKey,
        activeIngredientName,
        activeSummaryStatus,
        bundleState.meta.authoritativeIdentity,
        productInfo?.name,
        productInfo?.brand,
        bundleSourceType,
        activeIngredientDose,
        activeIngredientDetail,
        activeProductInsight,
        activeRuntimeSegments,
    ]);

    const ingredientsContent = (
        <View style={styles.detailStack}>
            <GlassCard
                title="Key ingredient focus"
                subtitle="Switch the context for the modules below"
                accentColor="#D97706"
                right={<GlassPill label="Science" />}
            >
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

                <View style={{ marginTop: 10 }}>
                    <Text style={styles.detailMetaLabel}>Current selection</Text>
                    <Text style={styles.detailMetaText}>{activeIngredientLabelLine}</Text>
                </View>
            </GlassCard>

            {/* Module 1 */}
            <GlassCard
                title="General science background"
                subtitle="NIH ODS (general; not product-specific)"
                accentColor="#D97706"
                right={<GlassPill label="NIH ODS" />}
            >
                <View style={styles.embeddedPanel}>
                    {disableOdsPanel ? (
                        <Text style={styles.detailBodyText}>ODS panel disabled by dashboard bisection flag.</Text>
                    ) : (
                        <OdsFoundationPanel ingredientName={activeIngredientName} mode="science" />
                    )}
                </View>
            </GlassCard>

            {/* Module 2 */}
            <GlassCard
                title="Form & bioavailability signals"
                subtitle={scienceDatasetSubtitle}
                accentColor="#D97706"
                right={<GlassPill label={scienceDatasetPill} />}
            >
                <View style={{ marginBottom: 12 }}>
                    <Text style={styles.detailMetaLabel}>Label ingredient snapshot</Text>
                    <View style={styles.ingredientsList}>
                        {scienceTopIngredients.length > 0 ? (
                            scienceTopIngredients.map((item) => (
                                <View key={item.name} style={styles.ingredientsListRow}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.ingredientsListName}>{item.name}</Text>
                                        {item.dose ? (
                                            <Text style={styles.ingredientsListDose}>
                                                {item.dose}
                                            </Text>
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
                                    : 'Scan the Supplement Facts panel to unlock ingredient analysis.'}
                            </Text>
                        )}
                    </View>
                </View>

                {activeProductInsight || activeInsightFromDto ? (
                    <View style={{ gap: 10 }}>
                        <View style={styles.kvGrid}>
                            <View style={styles.kvRow}>
                                <Text style={styles.kvLabel}>{hasSpecificFormSignal ? 'Detected form' : 'Form status'}</Text>
                                <Text style={styles.kvValue}>{activeFormDisplayText}</Text>
                            </View>

                            <View style={styles.kvRow}>
                                <Text style={styles.kvLabel}>Relative bioavailability factor</Text>
                                <Text style={styles.kvValue}>
                                    {typeof activeRbfFactor === 'number'
                                        ? `${activeRbfFactor.toFixed(2)} (${activeRbfBand})`
                                        : 'Unknown'}
                                </Text>
                            </View>

                            <View style={styles.kvRow}>
                                <Text style={styles.kvLabel}>Confidence</Text>
                                <Text style={styles.kvValue}>
                                    {activeInsightFromDto?.form?.matchScore != null
                                        ? `${activeInsightFromDto.form.matchScore.toFixed(2)} / ${activeInsightFromDto.form.evidenceGrade ?? 'n/a'}`
                                        : activeProductInsight?.confidenceTier ?? 'none'}
                                </Text>
                            </View>

                            {activeProductInsight?.doseSignal ? (
                                <View style={styles.kvRow}>
                                    <Text style={styles.kvLabel}>Dose check</Text>
                                    <Text style={styles.kvValue}>
                                        {`${activeProductInsight.doseSignal.status}${typeof activeProductInsight.doseSignal.dailyAmount === 'number' && activeProductInsight.doseSignal.unit
                                            ? ` (daily ${activeProductInsight.doseSignal.dailyAmount} ${activeProductInsight.doseSignal.unit})`
                                            : ''
                                            }`}
                                    </Text>
                                </View>
                            ) : null}
                        </View>

                        <View style={styles.reasonBlock}>
                            <Text style={styles.reasonTitle}>Why this band</Text>
                            <Text style={styles.reasonText}>
                                {`Band thresholds: High>=1.10, Normal 0.90-1.09, Low<0.90. Not a guarantee of individual outcomes.`}
                            </Text>
                        </View>

                        {activeWhyPayload?.bullets?.length ? (
                            <View style={styles.reasonBlock}>
                                <Text style={styles.reasonTitle}>Why this matters</Text>
                                <View style={{ marginTop: 8, gap: 8 }}>
                                    {activeWhyPayload.bullets.map((line, idx) => (
                                        <View key={`why-${idx}`} style={styles.bulletRow}>
                                            <View style={styles.bulletDot} />
                                            <Text style={styles.bulletText}>{line}</Text>
                                        </View>
                                    ))}
                                </View>
                                <Text style={[styles.reasonText, { marginTop: 8 }]}>{activeConfidenceText}</Text>
                            </View>
                        ) : null}

                        {activeRuntimeNotes ? (
                            <View style={styles.reasonBlock}>
                                <View style={styles.reasonHeaderRow}>
                                    <Text style={styles.reasonTitle}>Extra context</Text>
                                    {activeRuntimeNotes.meta?.source ? <GlassPill label={`KB: ${activeRuntimeNotes.meta.source}`} /> : null}
                                </View>
                                <View style={{ marginTop: 8, gap: 8 }}>
                                    {(
                                        Object.values(activeRuntimeNotes.segmentsByBucket ?? {}).flat()
                                            .slice(0, 6)
                                    ).map((r: string, idx: number) => (
                                        <View key={`kb-${idx}`} style={styles.bulletRow}>
                                            <View style={styles.bulletDot} />
                                            <Text style={styles.bulletText}>{r}</Text>
                                        </View>
                                    ))}
                                </View>
                            </View>
                        ) : null}
                    </View>
                ) : (
                    <View style={styles.emptyStateBox}>
                        <Text style={styles.emptyStateTitle}>
                            {bundleSourceType === 'web' ? 'Not available for web listings yet' : 'No verified dataset signals for this ingredient'}
                        </Text>
                        <Text style={styles.emptyStateText}>
                            {bundleSourceType === 'web'
                                ? 'Product-specific form signals are not available for most web listings yet.'
                                : 'No verified dataset signals were found for this ingredient.'}
                        </Text>
                    </View>
                )}
            </GlassCard>

            {/* Module 3 */}
            <GlassCard
                title="Ingredient summary"
                subtitle="DeepSeek (grounded to facts + dataset + ODS)"
                accentColor="#D97706"
                right={<GlassPill label="AI" />}
            >
                {deepseekLoading ? (
                    <View style={styles.inlineLoadingRow}>
                        <ActivityIndicator />
                        <Text style={styles.inlineLoadingText}>Generating summary…</Text>
                    </View>
                ) : deepseekError ? (
                    <View style={styles.emptyStateBox}>
                        <Text style={styles.emptyStateTitle}>Summary unavailable</Text>
                        <Text style={styles.emptyStateText}>{deepseekError}</Text>
                    </View>
                ) : activeSummary?.status === 'ok' ? (
                    <View style={{ gap: 12 }}>
                        <Text style={styles.summaryMainText}>{activeSummary.tldr}</Text>

                        {Array.isArray(activeSummary.highlights) && activeSummary.highlights.length > 0 ? (
                            <View style={{ gap: 8 }}>
                                <Text style={styles.summarySectionTitle}>Highlights</Text>
                                {activeSummary.highlights.slice(0, 4).map((b: string, idx: number) => (
                                    <View key={`sum-h-${idx}`} style={styles.bulletRow}>
                                        <View style={styles.bulletDot} />
                                        <Text style={styles.bulletText}>{b}</Text>
                                    </View>
                                ))}
                            </View>
                        ) : null}

                        {Array.isArray(activeSummary.caveats) && activeSummary.caveats.length > 0 ? (
                            <View style={{ gap: 8 }}>
                                <Text style={styles.summarySectionTitle}>Caveats</Text>
                                {activeSummary.caveats.slice(0, 4).map((b: string, idx: number) => (
                                    <View key={`sum-c-${idx}`} style={styles.bulletRow}>
                                        <View style={styles.bulletDot} />
                                        <Text style={styles.bulletText}>{b}</Text>
                                    </View>
                                ))}
                            </View>
                        ) : null}

                        {activeSummary.confidence_note ? (
                            <View style={styles.summaryFootnote}>
                                <Text style={styles.summaryFootnoteText}>{activeSummary.confidence_note}</Text>
                            </View>
                        ) : null}
                    </View>
                ) : (
                    <Text style={styles.detailPlaceholderText}>Ingredient summary is pending.</Text>
                )}
            </GlassCard>

            {detailError ? (
                <GlassCard title="Ingredient detail error" subtitle={detailError} accentColor="#EF4444">
                    <Text style={styles.emptyStateText}>Some ingredient details could not be resolved. Try again or scan a label-based source.</Text>
                </GlassCard>
            ) : null}
        </View>
    );

    const usageFacts = factsDtoState.data;
    const usageGapLines = buildGapActionSentences(usageFacts?.dataQuality?.missingReasons, 'usage');
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
    const usageDosageRaw = usageCover?.dosage;
    const usageBestTimeRaw = usageCover?.bestTimeToTake;
    const usageDosageText = normalizeText(
        typeof usageDosageRaw === 'string'
            ? usageDosageRaw
            : usageDosageRaw?.text ?? '',
    );
    const usageBestTimeText = normalizeText(
        typeof usageBestTimeRaw === 'string'
            ? usageBestTimeRaw
            : usageBestTimeRaw?.text ?? '',
    );
    const usageDirectionsFromRecord = normalizeText(usageFacts?.usage?.directionsText ?? '');
    const dosageTextConfirmed = usageDosageText.length > 0 && !/dose not confirmed/i.test(usageDosageText);
    const perServingDoseFromFacts = (() => {
        const actives = usageFacts?.ingredients?.actives ?? [];
        const primary = actives.find(
            (row) =>
                typeof row?.amount === 'number' &&
                Number.isFinite(row.amount) &&
                typeof row?.unit === 'string' &&
                row.unit.trim().length > 0 &&
                typeof row?.name === 'string' &&
                row.name.trim().length > 0,
        );
        if (!primary) return '';
        return `${primary.name} ${primary.amount} ${primary.unit}`;
    })();
    const directionsSummaryLine = usageDirectionsFromRecord
        ? `Directions from record: ${usageDirectionsFromRecord}`
        : usageScheduleLines.length > 0
            ? `Directions from record: ${usageScheduleLines[0]?.replace(/^Label schedule:\s*/i, '') ?? ''}`
            : 'Directions from record: Not available in this source.';
    const perServingSummaryLine = perServingDoseFromFacts
        ? `Per-serving dose from record: ${perServingDoseFromFacts}.`
        : dosageTextConfirmed
            ? `Per-serving dose from record: ${usageDosageText}.`
            : 'Per-serving dose from record: Not confirmed in this source.';
    const usageStructuredLines = [
        isDataCeiling ? 'This verified source includes limited structured fields and does not provide ingredient amount rows.' : null,
        directionsSummaryLine,
        perServingSummaryLine,
        usageFacts?.serving?.servingSizeText
            ? `Serving size: ${usageFacts.serving.servingSizeText}${usageFacts.serving.servingsPerContainer != null
                ? `; servings per container: ${usageFacts.serving.servingsPerContainer}`
                : ''
            }.`
            : null,
        usageBestTimeText ? `Timing from label: ${usageBestTimeText}` : null,
        usageScheduleLines.length > 1 ? usageScheduleLines[1] : null,
    ].filter((line): line is string => Boolean(line && line.trim().length > 0));
    const usageRecordLines = enforceNeverBlank({
        lines: [
            ...usageStructuredLines,
            usageStructuredLines.length === 0
                ? 'Label directions were not available from this source.'
                : null,
        ],
        fallback: [
            'Follow the product label first for timing and frequency.',
            'If directions are missing, keep usage conservative until label details are confirmed.',
        ],
    });
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
    const usageAccuracyLines = enforceNeverBlank({
        lines: usageGapLines,
        fallback: [
            'Adding a clear photo of the Supplement Facts and Directions panel improves product-specific guidance.',
            'We keep this section conservative until those fields are verified.',
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
            <GlassCard title="What the record says" subtitle="Label/source directions" accentColor="#0EA5E9" right={<GlassPill label="Practical" />}>
                <View style={{ gap: 10 }}>
                    {usageRecordLines.map((line, idx) => (
                        <Text key={`usage-rec-${idx}`} style={idx === 0 ? styles.detailLeadText : styles.detailBodyText}>
                            {line}
                        </Text>
                    ))}
                </View>
            </GlassCard>

            <GlassCard title="Conservative usage guidance" subtitle="Safe default guidance" accentColor="#0EA5E9">
                <View style={{ gap: 10 }}>
                    {usageGuidanceLines.map((line, idx) => (
                        <View key={`usage-guide-${idx}`} style={styles.bulletRow}>
                            <View style={styles.bulletDot} />
                            <Text style={styles.bulletText}>{line}</Text>
                        </View>
                    ))}
                </View>
            </GlassCard>

            <GlassCard title="What would improve accuracy" subtitle="Missing fields lower confidence" accentColor="#0EA5E9">
                <View style={{ gap: 10 }}>
                    {usageAccuracyLines.map((line, idx) => (
                        <Text key={`usage-acc-${idx}`} style={styles.detailBodyText}>
                            {line}
                        </Text>
                    ))}
                </View>
            </GlassCard>

        </View>
    );

    const safetyFacts = factsDtoState.data;
    const safetyGapLines = buildGapActionSentences(safetyFacts?.dataQuality?.missingReasons, 'safety');
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
    const safetyPriorityLines = safetySignalsToPriorityLines(safetySignalPack);
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
    const safetyLabelLines = enforceNeverBlank({
        lines: [
            ...safetyPriorityLines,
            safetyPriorityLines.length === 0
                ? 'No label-specific warnings were provided by this source.'
                : null,
        ],
        fallback: [
            'No label-specific warnings were provided by this source.',
            'General watch-outs are shown for key ingredients and are not product-label warnings.',
        ],
    });
    const [safetySummaryByRequestKey, setSafetySummaryByRequestKey] = useState<Record<string, SafetySummaryState>>({});
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
                safetyGapLines[0] ??
                'Review the product label and consult a clinician for personal risk factors.',
            ),
        );
        const tldr = [riskLine, contextLine, actionLine]
            .map((line) => normalizeText(line))
            .filter((line) => line.length > 0)
            .slice(0, 3)
            .join(' ');
        return { riskLine, contextLine, actionLine, tldr };
    }, [safetyGapLines, safetyLabelLines, safetyOdsInteractionLines, safetyUlSignalLines]);
    const safetySummaryPayloadFingerprint = useMemo(
        () =>
            JSON.stringify({
                sourceType: bundleSourceType ?? null,
                productName: productInfo?.name ?? null,
                labelLines: safetyLabelLines.slice(0, 4),
                ulLines: safetyUlSignalLines.slice(0, 3),
                interactionLines: safetyOdsInteractionLines.slice(0, 3),
                missingLines: safetyGapLines.slice(0, 2),
            }),
        [
            bundleSourceType,
            productInfo?.name,
            safetyLabelLines,
            safetyUlSignalLines,
            safetyOdsInteractionLines,
            safetyGapLines,
        ],
    );
    const safetySummaryRequestKey = useMemo(
        () => `${summaryIdentityKey}|safety|${safetySummaryPayloadFingerprint}`,
        [summaryIdentityKey, safetySummaryPayloadFingerprint],
    );
    const safetySummaryState = safetySummaryByRequestKey[safetySummaryRequestKey];
    const safetySummaryStatus = safetySummaryState?.status ?? 'idle';

    useEffect(() => {
        if (selectedTileType !== 'safety') return;
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
        if (selectedTileType !== 'safety') return;
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

    const safetySummaryText = safetySummaryState?.tldr ?? safetySummaryFallback.tldr;
    const safetySummaryLines = useMemo(() => {
        const candidateLines = [
            safetySummaryState?.riskLine,
            safetySummaryState?.contextLine,
            safetySummaryState?.actionLine,
        ]
            .map((line) => normalizeText(line))
            .filter((line) => line.length > 0);
        if (candidateLines.length >= 3) {
            return candidateLines.slice(0, 3);
        }
        return safetySummaryText
            .split(/(?<=[.!?])\s+/)
            .map((line) => normalizeText(line))
            .filter((line) => line.length > 0)
            .slice(0, 3);
    }, [
        safetySummaryState?.riskLine,
        safetySummaryState?.contextLine,
        safetySummaryState?.actionLine,
        safetySummaryText,
    ]);

    const safetyContent = (
        <View style={styles.detailStack}>
            <GlassCard title="Label warnings" subtitle="Label first, then general watch-outs" accentColor="#EF4444" right={<GlassPill label="Safety" />}>
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
                title="General watch-outs"
                subtitle="NIH ODS (not label-specific)"
                accentColor="#EF4444"
                right={<GlassPill label="NIH ODS" />}
            >
                {keyIngredientsForSafety.length > 0 ? (
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.ingredientSelectorRow}
                    >
                        {keyIngredientsForSafety.map((name) => {
                            const key = normalizeIngredientNameForBackground(name);
                            const isActive = key === activeSafetyIngredientKey;
                            return (
                                <Pressable
                                    key={`safety-${key}`}
                                    onPress={() => setActiveSafetyIngredientName(name)}
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
                ) : null}

                <View style={styles.embeddedPanel}>
                    {disableOdsPanel ? (
                        <Text style={styles.detailBodyText}>ODS panel disabled by dashboard bisection flag.</Text>
                    ) : (
                        <OdsFoundationPanel
                            ingredientName={activeSafetyIngredientName}
                            mode="safety"
                            interactionLines={selectedSafetyOdsInteractionLines}
                            ulLines={selectedSafetyUlSignalLines}
                        />
                    )}
                </View>
                {hasReferenceOnlyUlSignals ? (
                    <Text style={styles.detailBodyText}>
                        Reference UL shown. Personalized comparison needs daily directions.
                    </Text>
                ) : null}
            </GlassCard>

            <GlassCard title="Safety summary" subtitle="DeepSeek (grounded to warnings + UL + missing fields)" accentColor="#EF4444" right={<GlassPill label="AI" />}>
                <View style={{ gap: 10 }}>
                    {safetySummaryLines.map((line, idx) => (
                        <Text key={`safe-summary-${idx}`} style={styles.detailBodyText}>
                            {line}
                        </Text>
                    ))}
                    {safetySummaryStatus === 'loading' ? (
                        <View style={styles.inlineLoadingRow}>
                            <ActivityIndicator size="small" />
                            <Text style={styles.inlineLoadingText}>Refining summary...</Text>
                        </View>
                    ) : null}
                </View>
            </GlassCard>
        </View>
    );

    const [scorePendingTimedOutAfterDone, setScorePendingTimedOutAfterDone] = useState(false);
    const scoreResponseStatus =
        scoreBundleV4State?.status === 'ready' ? scoreBundleV4State.response?.status ?? null : null;
    const scoreLoadingAfterDone = scoreBundleV4State?.status === 'loading';
    useEffect(() => {
        if (isStreaming) {
            setScorePendingTimedOutAfterDone(false);
            return;
        }
        if (!scoreLoadingAfterDone && scoreResponseStatus !== 'pending') {
            setScorePendingTimedOutAfterDone(false);
            return;
        }
        const timeoutId = setTimeout(() => {
            setScorePendingTimedOutAfterDone(true);
        }, SCORE_PENDING_DONE_TIMEOUT_MS);
        return () => clearTimeout(timeoutId);
    }, [bundleState.meta.factsDigestHash, isStreaming, scoreLoadingAfterDone, scoreResponseStatus]);

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
            summary: { text: overviewSummaryText },
            summaryLines: 2,
            bullets: overviewBullets,
            bulletLimit: 2,
            bulletLines: 2,
            dataStatus: unifiedOverviewDataStatus,
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
            mechanisms: ingredientMechanisms,
            dataStatus: unifiedIngredientsDataStatus,
            content: ingredientsContent,
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
        },
    ];
    const selectedTile = useMemo(
        () => (selectedTileType ? tiles.find((tile) => tile.type === selectedTileType) ?? null : null),
        [selectedTileType, tiles],
    );

    type ScoreUiMode = 'not_scored' | 'scoring' | 'scored';
    type ScoreNotScoredCause =
        | 'pending_timeout_after_done'
        | 'score_request_failed'
        | 'not_initiated_or_not_eligible';
    const v4Response =
        scoreBundleV4State?.status === 'ready' ? scoreBundleV4State.response : null;
    const v4Bundle = v4Response?.status === 'ok' ? v4Response.bundle : null;
    const scoreRequestFailed = scoreBundleV4State?.status === 'error';
    const scorePendingAfterDone =
        !isStreaming &&
        scorePendingTimedOutAfterDone &&
        (v4Response?.status === 'pending' || scoreLoadingAfterDone);
    const bundleScoreSourceAuthoritative = bundleSourceType === 'lnhpd' || bundleSourceType === 'dsld';
    const bundleMetaFallback =
        (bundleState.meta as { fallback?: { code?: string } | null }).fallback ?? null;
    const bundleFallbackCodeRaw =
        bundleState.meta.fallbackReason ?? bundleMetaFallback?.code ?? null;
    const bundleFallbackCode = typeof bundleFallbackCodeRaw === 'string' ? bundleFallbackCodeRaw.toLowerCase() : '';
    const bundleFallbackOwnershipBlocked = bundleFallbackCode.includes('ownership_unverified');
    const bundleFallbackWebLimited =
        bundleFallbackCode.includes('needs_js') || bundleFallbackCode.includes('web_text_unusable');
    const bundleScoreEligible =
        bundleSourceTypeFinal &&
        bundleScoreSourceAuthoritative &&
        !bundleFallbackOwnershipBlocked &&
        !bundleFallbackWebLimited;
    const bundleScoreReasonCode =
        typeof (bundleState.meta as { scoreReasonCode?: string | null }).scoreReasonCode === 'string'
            ? ((bundleState.meta as { scoreReasonCode?: string | null }).scoreReasonCode as string)
            : null;
    const v4ResponseReasonCode =
        v4Response && 'reasonCode' in v4Response && typeof v4Response.reasonCode === 'string'
            ? v4Response.reasonCode
            : null;
    const v4ResponseMessage =
        v4Response && 'message' in v4Response && typeof v4Response.message === 'string'
            ? v4Response.message.trim()
            : '';
    const scoreReasonCode =
        v4ResponseReasonCode
            ? v4ResponseReasonCode
            : (isDataCeiling
                ? 'INSUFFICIENT_RECORD_DATA'
                : bundleScoreReasonCode || (typeof bundleState.meta.fallbackReason === 'string' ? bundleState.meta.fallbackReason : null));
    const scoreReasonMessage =
        v4ResponseMessage.length > 0
            ? v4ResponseMessage
            : resolveReasonCodeMessage(scoreReasonCode);

    const scoreUiMode: ScoreUiMode = (() => {
        if (v4Response?.status === 'ok') return 'scored';
        if (scorePendingAfterDone) return 'not_scored';
        if (scoreRequestFailed && !isStreaming) return 'not_scored';
        if ((!bundleScoreEligible && !isStreaming) || (!isStreaming && scoreBundleV4State?.status === 'idle')) {
            return 'not_scored';
        }
        if (!scoreBundleV4State || scoreBundleV4State.status !== 'ready') return 'scoring';
        if (v4Response?.status === 'pending') return 'scoring';
        if (v4Response?.status === 'not_found') return 'not_scored';
        return !isStreaming ? 'not_scored' : 'scoring';
    })();

    const hasNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const overallScore = hasNumber(v4Bundle?.overallScore) ? v4Bundle?.overallScore : null;
    const effectivenessScore = hasNumber(v4Bundle?.pillars?.effectiveness) ? v4Bundle?.pillars?.effectiveness : null;
    const safetyScore = hasNumber(v4Bundle?.pillars?.safety) ? v4Bundle?.pillars?.safety : null;
    const integrityScore = hasNumber(v4Bundle?.pillars?.integrity) ? v4Bundle?.pillars?.integrity : null;

    const ringScores =
        scoreUiMode === 'scored'
            ? {
                effectiveness: effectivenessScore ?? 0,
                safety: safetyScore ?? 0,
                integrity: integrityScore,
                value: integrityScore ?? 0,
                overall: overallScore ?? 0,
            }
            : { effectiveness: 0, safety: 0, integrity: null, value: 0, overall: 0 };
    const ringMuted = scoreUiMode !== 'scored' || scoreState === 'muted';
    const missingDisplay =
        scoreUiMode === 'scored'
            ? {
                overall: overallScore == null ? '--' : undefined,
                effectiveness: effectivenessScore == null ? '--' : undefined,
                safety: safetyScore == null ? '--' : undefined,
                value: integrityScore == null ? '--' : undefined,
            }
            : null;
    const shouldUseMissingDisplay =
        Boolean(missingDisplay) &&
        Object.values(missingDisplay as Record<string, unknown>).some((value) => typeof value === 'string' && value.length > 0);
    const ringDisplay =
        scoreUiMode === 'not_scored'
            ? {
                overall: t.analysisScoreNotScored,
                effectiveness: '--',
                safety: '--',
                value: '--',
            }
            : scoreUiMode === 'scoring'
                ? {
                    overall: t.analysisScoreScoring,
                    effectiveness: '--',
                    safety: '--',
                    value: '--',
                }
                    : shouldUseMissingDisplay
                        ? (missingDisplay as { overall?: string; effectiveness?: string; safety?: string; value?: string })
                        : undefined;
    const scoreNotScoredCause: ScoreNotScoredCause | null =
        scoreUiMode !== 'not_scored'
            ? null
            : scorePendingAfterDone
                ? 'pending_timeout_after_done'
                : scoreRequestFailed
                    ? 'score_request_failed'
                    : 'not_initiated_or_not_eligible';
    const notScoredReason =
        scoreNotScoredCause === 'pending_timeout_after_done'
            ? t.analysisScoreNotScoredReasonPendingTimeout
            : scoreNotScoredCause === 'score_request_failed'
                ? t.analysisScoreNotScoredReasonRequestFailed
                : bundleFallbackOwnershipBlocked ||
                    (v4Response?.status === 'not_found' && v4Response?.reasonCode === 'WEB_OWNERSHIP_FAILED')
            ? t.analysisScoreNotScoredReasonOwnership
            : bundleSourceType === 'web' || bundleFallbackWebLimited
                ? t.analysisScoreNotScoredReasonWeb
                : scoreReasonMessage || t.analysisScoreNotScoredReasonUnavailable;
    const showScoreRetryCta = Boolean(onRetryScore)
        && scoreUiMode === 'not_scored'
        && (scoreNotScoredCause === 'pending_timeout_after_done' || scoreNotScoredCause === 'score_request_failed');
    const scoreMetaBlockedReasons = new Set<string>([
        t.analysisScoreNotScoredReasonUnavailable,
        t.analysisScoreNotScoredReasonWeb,
        t.analysisScoreNotScoredReasonOwnership,
        t.analysisScoreScoringReason,
    ]);
    const ringMetaLinesRaw =
        scoreUiMode === 'not_scored'
            ? [notScoredReason]
            : scoreUiMode === 'scoring'
                ? [t.analysisScoreScoringReason]
                : hasNumber(v4Bundle?.confidence)
                    ? [`${t.analysisConfidencePrefix}: ${Math.round((v4Bundle?.confidence ?? 0) * 100)}%`]
                    : [];
    const ringMetaLines =
        scoreUiMode === 'scored'
            ? ringMetaLinesRaw.filter((line) => !scoreMetaBlockedReasons.has(line))
            : ringMetaLinesRaw;

    const v4Highlights = (v4Bundle?.highlights ?? [])
        .map((item) => item?.message)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .slice(0, 2);
    const v4Flags = (v4Bundle?.flags ?? [])
        .map((item) => item?.message)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .slice(0, 2);
    const scoreDescriptions =
        scoreUiMode === 'scored'
            ? {
                effectiveness: {
                    verdict: 'Evidence-based effectiveness score.',
                    highlights: v4Highlights,
                },
                safety: {
                    verdict: 'Safety score reflects ingredient risks and UL guidance when available.',
                    highlights: v4Highlights,
                    warnings: v4Flags.length ? v4Flags : undefined,
                },
                practicality: {
                    verdict: 'Integrity score reflects label disclosure and formulation transparency.',
                    highlights: v4Highlights,
                },
            }
            : {
                effectiveness: { verdict: '', highlights: [] },
                safety: { verdict: '', highlights: [] },
                practicality: { verdict: '', highlights: [] },
            };
    const unknownCategories =
        scoreUiMode === 'scored'
            ? {
                effectiveness: effectivenessScore == null,
                safety: safetyScore == null,
                value: integrityScore == null,
            }
            : { effectiveness: false, safety: false, value: false };
    return (
        <View style={styles.root}>
            {!disableMiniHeader ? (
                <MiniScoreHeader
                    scrollY={scrollY}
                    overallScore={ringScores.overall}
                    title={productTitle}
                    subtitle={scoreBadge ?? undefined}
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
                                {ringMuted ? <GlassPill label="Limited confidence" /> : null}
                            </View>
                        </LinearGradient>
                    </View>
                ) : null}

                <View style={styles.scoreSection}>
                    <View style={styles.scoreHeroCard}>
                        {!disableScoreRing ? (
                            <>
                                <InteractiveScoreRing
                                    scores={{
                                        overall: ringScores.overall,
                                        effectiveness: ringScores.effectiveness,
                                        safety: ringScores.safety,
                                        value: ringScores.value,
                                    }}
                                    labels={{
                                        value: t.analysisScoreIntegrity,
                                        valueLabel: t.analysisScoreIntegrity,
                                    }}
                                    descriptions={scoreDescriptions}
                                    display={ringDisplay}
                                    muted={ringMuted}
                                    badgeText={scoreBadge}
                                    sourceType={sourceType}
                                    unknownCategories={unknownCategories}
                                    metaLines={ringMetaLines}
                                    showStaticModeHint={SHOW_SCAN_DEBUG}
                                />
                                {showScoreRetryCta ? (
                                    <Pressable onPress={onRetryScore} style={styles.scoreRetryButton}>
                                        <Text style={styles.scoreRetryButtonText}>{t.analysisScoreRetryCta}</Text>
                                    </Pressable>
                                ) : null}
                            </>
                        ) : (
                            <View style={styles.bisectNoticeCard}>
                                <Text style={styles.bisectNoticeTitle}>Score Ring disabled</Text>
                                <Text style={styles.bisectNoticeText}>{scoreRingDisableNotice}</Text>
                            </View>
                        )}

                    </View>
                </View>

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
            </ScrollContainer>

            {!disableModalPane ? (
                <DashboardModal
                    key={selectedTileType ?? 'closed'}
                    visible={!!selectedTile}
                    tile={selectedTile}
                    onClose={() => setSelectedTileType(null)}
                />
            ) : null}
        </View>
    );
};

export const AnalysisDashboard: React.FC<{
    analysis: Analysis;
    isStreaming?: boolean;
    scoreBadge?: string;
    scoreState?: ScoreState;
    sourceType?: SourceType;
    analysisBundle?: AnalysisBundle | null;
    scoreBundleV4State?: ScoreBundleV4State;
    onRetryScore?: () => void;
}> = ({ analysis, isStreaming = false, scoreBadge, scoreState, sourceType, analysisBundle, scoreBundleV4State, onRetryScore }) => {
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
        : [`${t.analysisConfidencePrefix}: ${t.analysisConfidenceComplete}`];
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
                <DashboardModal visible={!!selectedTile} tile={selectedTile} onClose={() => setSelectedTile(null)} />
            ) : null}
        </View>
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
    detailLeadText: {
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

    miniHeader: {
        position: 'absolute',
        left: 16,
        right: 16,
        top: 10,
        borderRadius: 18,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.28)',
        backgroundColor: 'rgba(255,255,255,0.35)',
        zIndex: 50,
    },
    miniHeaderTint: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(255,255,255,0.15)',
    },
    miniHeaderContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    miniScoreBubble: {
        width: 36,
        height: 36,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(17,24,39,0.12)',
        backgroundColor: 'rgba(255,255,255,0.55)',
    },
    miniScoreBubbleMuted: {
        borderColor: 'rgba(17,24,39,0.08)',
        backgroundColor: 'rgba(255,255,255,0.40)',
    },
    miniScoreText: {
        fontSize: 14,
        fontWeight: '900',
        color: '#111827',
    },
    miniHeaderTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: '#111827',
    },
    miniHeaderSubtitle: {
        marginTop: 2,
        fontSize: 11,
        color: 'rgba(17,24,39,0.55)',
        fontWeight: '600',
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
