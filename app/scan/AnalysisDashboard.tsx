import {
    Activity,
    BarChart3,
    CheckCircle2,
    Clock,
    Pill,
    Shield,
    TrendingUp,
    X,
    Zap,
} from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useMemo, useState } from 'react';
import {
    Modal,
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
    useAnimatedReaction,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    type SharedValue,
} from 'react-native-reanimated';

import { SkeletonLoader } from '@/components/ui/SkeletonLoader';
import { InteractiveScoreRing } from '@/components/ui/InteractiveScoreRing';
import { ContentSection } from '@/components/ui/ScoreDetailCard';
import { useTranslation } from '@/lib/i18n';
import { computeSmartScores, type AnalysisInput } from '../../lib/scoring';
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
    icon: any;
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
        missingReasons: MissingReason[];
        sources: SourceRef[];
    };
    content: React.ReactNode;
};

type WidgetTileProps = {
    tile: TileConfig;
    onPress: () => void;
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
                    <BlurView intensity={24} tint="systemUltraThinMaterialLight" style={styles.tileGlass}>
                        <View style={styles.tileHeaderRow}>
                            <View style={styles.tileHeaderLeft}>
                                <View style={styles.tileIconShadow}>
                                    <View style={styles.tileIconContainer}>
                                        <BlurView intensity={18} tint="systemUltraThinMaterialLight" style={StyleSheet.absoluteFillObject} />
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
                                        <BlurView intensity={18} tint="systemUltraThinMaterialLight" style={StyleSheet.absoluteFillObject} />
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
                    </BlurView>
                </View>
            </TouchableOpacity>
        </View>
    );
};

const DashboardModal: React.FC<{
    visible: boolean;
    onClose: () => void;
    tile: TileConfig | null;
}> = ({ visible, onClose, tile }) => {
    const { t } = useTranslation();
    if (!tile) return null;
    const Icon = tile.icon;
    const accentColor = colorMap[tile.accentColor] || '#3B82F6';
    const dataStatus = tile.dataStatus;

    const statusLabel = (status: CoverStatus) => {
        switch (status) {
            case 'complete':
                return t.analysisConfidenceComplete;
            case 'partial':
                return t.analysisConfidencePartial;
            case 'limited':
            default:
                return t.analysisConfidenceLimited;
        }
    };

    const reasonLabel = (reason: MissingReason) => {
        switch (reason) {
            case 'MISSING_PRIMARY_ACTIVE':
                return t.analysisMissingPrimaryActive;
            case 'MISSING_EVIDENCE_MAPPING':
                return t.analysisMissingEvidenceMapping;
            case 'MISSING_FORM_QUALITY':
                return t.analysisMissingFormQuality;
            case 'MISSING_OVERVIEW_SUMMARY':
                return t.analysisMissingOverviewSummary;
            case 'MISSING_OVERVIEW_BENEFITS':
                return t.analysisMissingOverviewBenefits;
            case 'MISSING_USAGE_GUIDANCE':
                return t.analysisMissingUsageGuidance;
            case 'MISSING_BEST_FOR':
                return t.analysisMissingBestFor;
            case 'MISSING_SAFETY_WARNING':
                return t.analysisMissingSafetyWarning;
            case 'MISSING_SAFETY_TIP':
                return t.analysisMissingSafetyTip;
            case 'MISSING_DOSE_RANGE':
                return t.analysisMissingDoseRange;
            default:
                return t.analysisPlaceholderUnknown;
        }
    };

    const sourceLabel = (source: SourceRef) => {
        switch (source.type) {
            case 'pubmed':
                return t.analysisSourcePubMed;
            case 'cochrane':
                return t.analysisSourceCochrane;
            case 'ods':
                return t.analysisSourceOds;
            case 'label':
                return t.analysisSourceLabel;
            case 'other':
            default:
                return t.analysisSourceOther;
        }
    };

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <View style={styles.modalBackdrop}>
                {/* Tap backdrop to close */}
                <Pressable style={styles.modalBackdropTouchable} onPress={onClose} />

                {/* Bottom sheet container */}
                <View style={styles.modalContainer}>
                    {/* Handle bar */}
                    <View style={styles.modalHandle} />

                    <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose}>
                        <X size={20} color="#6B7280" />
                    </TouchableOpacity>

                    <View style={[styles.modalIconCircle, { backgroundColor: `${accentColor}15` }]}>
                        <Icon size={32} color={accentColor} />
                    </View>

                    <Text style={styles.modalTitle}>{tile.modalTitle}</Text>
                    <View style={[styles.modalDivider, { backgroundColor: accentColor }]} />

                    <ScrollView
                        style={styles.modalContent}
                        contentContainerStyle={{ paddingBottom: 40 }}
                        showsVerticalScrollIndicator={true}
                        bounces={true}
                    >
                        {tile.content}
                        {dataStatus && (
                            <View style={styles.dataStatusCard}>
                                <Text style={styles.dataStatusTitle}>
                                    {t.analysisDataStatusTitle}: {statusLabel(dataStatus.status)}
                                </Text>
                                <Text style={styles.dataStatusLine}>
                                    {t.analysisDataStatusMissing}:{' '}
                                    {dataStatus.missingReasons.length > 0
                                        ? dataStatus.missingReasons.map(reasonLabel).join(' • ')
                                        : t.analysisDataStatusNone}
                                </Text>
                                <Text style={styles.dataStatusLine}>
                                    {t.analysisDataStatusSources}:{' '}
                                    {dataStatus.sources.length > 0
                                        ? Array.from(
                                            new Set(dataStatus.sources.map(sourceLabel))
                                        ).join(' • ')
                                        : t.analysisDataStatusNoSources}
                                </Text>
                                <Text style={styles.dataStatusNote}>{t.analysisIntegrityNote}</Text>
                            </View>
                        )}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
};

export const AnalysisDashboard: React.FC<{
    analysis: Analysis;
    isStreaming?: boolean;
    scoreBadge?: string;
    scoreState?: ScoreState;
    sourceType?: SourceType;
}> = ({ analysis, isStreaming = false, scoreBadge, scoreState, sourceType }) => {
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
    const unknownCategories = {
        effectiveness: scoreConfidence === 'limited' || !scoreAvailability.effectiveness,
        safety: scoreConfidence === 'limited' || !scoreAvailability.safety,
        value: scoreConfidence === 'limited' || !scoreAvailability.value,
    };
    const displayOverrides = {
        overall: scoreConfidence === 'limited' ? '~50' : undefined,
        effectiveness: unknownCategories.effectiveness ? '~50' : undefined,
        safety: unknownCategories.safety ? '~50' : undefined,
        value: unknownCategories.value ? '~50' : undefined,
    };
    const ringScores = scores;
    const formatScoreText = (value: number, override?: string) => {
        if (override) return override;
        return Number.isFinite(value) ? `${Math.round(value)}/100` : 'AI';
    };
    const overviewScoreText = formatScoreText(scores.overall, displayOverrides?.overall);
    const overviewScoreLabel =
        scoreConfidence === 'complete'
            ? t.analysisScoreLabel
            : `${t.analysisScoreLabel} · ${t.analysisProvisional}`;
    const scoreConfidenceLabel =
        scoreConfidence === 'complete'
            ? t.analysisConfidenceComplete
            : scoreConfidence === 'partial'
              ? t.analysisConfidencePartial
              : t.analysisConfidenceLimited;
    const scoreMetaLines = [
        `${t.analysisConfidencePrefix}: ${scoreConfidenceLabel}`,
        scoreConfidence === 'limited' ? `${t.analysisStatusPrefix}: ${t.analysisStatusInsufficient}` : null,
        scoreConfidence !== 'complete' ? `${t.analysisProvisional} · ${t.analysisProvisionalNote}` : null,
    ].filter(Boolean) as string[];

    // Construct descriptions for InteractiveScoreRing with score factor explanations
    const descriptions: {
        effectiveness: ContentSection;
        safety: ContentSection;
        practicality: ContentSection;
    } = useMemo(() => ({
        effectiveness: {
            verdict: efficacy.verdict || 'Analyzing efficacy based on ingredients and evidence...',
            // Use scoring factors as highlights to explain the score
            highlights: scoreConfidence === 'complete'
                ? scores.details.effectivenessFactors.filter(f => f.startsWith('+'))
                : [],
            warnings: scoreConfidence === 'complete'
                ? scores.details.effectivenessFactors.filter(f => f.startsWith('-') || f.startsWith('−'))
                : [],
        },
        safety: {
            verdict: safety.verdict || 'Analyzing safety profile...',
            highlights: scoreConfidence === 'complete'
                ? scores.details.safetyFactors.filter(f => f.startsWith('+'))
                : [],
            warnings: scoreConfidence === 'complete'
                ? [...(safety.redFlags || []), ...scores.details.safetyFactors.filter(f => f.startsWith('-') || f.startsWith('−'))]
                : [],
        },
        practicality: {
            verdict: value.verdict || 'Analyzing value and practicality...',
            highlights: scoreConfidence === 'complete'
                ? scores.details.valueFactors.filter(f => f.startsWith('+'))
                : [],
            warnings: [],
        },
    }), [efficacy.verdict, safety.verdict, safety.redFlags, value.verdict, scores.details, scoreConfidence]);

    const scienceSummary =
        efficacy.verdict ||
        (Array.isArray(efficacy.benefits) && efficacy.benefits[0]) ||
        'Formula effectiveness has been analyzed based on typical clinical ranges.';

    const usageSummary =
        usage.summary ||
        usage.timing ||
        t.analysisPlaceholderUsage;

    const safetySummary =
        safety.verdict ||
        (Array.isArray(safety.redFlags) && safety.redFlags[0]) ||
        (Array.isArray(safety.risks) && safety.risks[0]) ||
        t.analysisPlaceholderInsufficient;

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

    const normalizeIngredientKey = (value?: string | null) =>
        value?.toLowerCase().replace(/[^a-z0-9]+/g, '').trim() ?? '';

    const scoreIngredientDetail = (ingredient: any) => {
        let score = 0;
        if (typeof ingredient?.dosageValue === 'number') score += 4;
        if (ingredient?.dosageUnit) score += 2;
        if (ingredient?.form) score += 1;
        if (ingredient?.formQuality && ingredient.formQuality !== 'unknown') score += 1;
        if (ingredient?.evidenceLevel && ingredient.evidenceLevel !== 'none') score += 1;
        return score;
    };

    const dedupeIngredients = (items: any[]) => {
        const map = new Map<string, any>();
        const ordered: any[] = [];
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
    const coreBenefits = (
        Array.isArray(efficacy?.coreBenefits) && efficacy.coreBenefits.length > 0
            ? efficacy.coreBenefits
            : Array.isArray(efficacy?.benefits) && efficacy.benefits.length > 0
                ? efficacy.benefits
                : []
    )
        .filter((benefit): benefit is string => typeof benefit === 'string' && benefit.trim().length > 0)
        .slice(0, 3);

    const scienceIngredients = useMemo(
        () => (Array.isArray(efficacy.ingredients) ? dedupeIngredients(efficacy.ingredients) : []),
        [dedupeIngredients, efficacy.ingredients]
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
        const benefitWithoutNumbers = coreBenefits.find((item) => item && !/\d/.test(item));
        if (benefitWithoutNumbers) return formatBestForText(benefitWithoutNumbers);
        if (productInfo.category) return normalizeText(productInfo.category);
        const fallbackBenefit = coreBenefits[0];
        return fallbackBenefit ? formatBestForText(fallbackBenefit) : '';
    })();

    const bestFor = usage.bestFor || usage.target || usage.who || bestForFallback;
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
                        `Focused on ${primaryName}${
                            hasNumericDose(primaryActive?.dosageValue) && primaryDoseLabel
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

    const overviewContent = (
        <View style={{ gap: 16 }}>
            <Text style={styles.modalParagraph}>
                {overviewSummary || t.analysisPlaceholderOverviewSummary}
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
                {productInfo.brand && (
                    <View style={styles.modalTag}>
                        <Text style={styles.modalTagLabel}>Brand</Text>
                        <Text style={styles.modalTagValue}>{productInfo.brand}</Text>
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
                        <Text style={styles.modalParagraphSmall}>{bestFor}</Text>
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

    const productTitle = productInfo.name || 'Supplement';
    const productSubtitle = [productInfo.brand, productInfo.category].filter(Boolean).join(' • ');

    return (
        <View style={styles.root}>
            <Animated.ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                onScroll={scrollHandler}
            >

                {/* Header Section */}
                <View style={styles.headerSection}>
                    <Text style={styles.headerEyebrow}>{t.analysisHeaderEyebrow}</Text>
                    <Text style={styles.headerTitle}>{productTitle}</Text>
                    {!!productSubtitle && <Text style={styles.headerSubtitle}>{productSubtitle}</Text>}
                </View>

                {/* Score Ring Card */}
                <View style={styles.scoreSection}>
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
                                value: sourceType === 'label_scan' ? t.analysisScoreFormulaQuality : t.analysisScoreValue,
                                valueLabel: sourceType === 'label_scan' ? t.analysisScoreFormulaQuality : t.analysisScoreValue,
                            }}
                            metaLines={scoreMetaLines}
                            badgeText={badgeTextSafe}
                            sourceType={sourceType}
                        />
                </View>

                {/* Deep Categories */}
                <View style={styles.tilesHeader}>
                    <Text style={styles.tilesTitle}>{t.analysisDeepCategoriesTitle}</Text>
                    <Text style={styles.tilesSubtitle}>{t.analysisDeepCategoriesSubtitle}</Text>
                </View>

                <View style={styles.tilesGrid} onLayout={onTilesGridLayout}>
                    {tiles.map((tile) => (
                        <AnimatedTile
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
            </Animated.ScrollView>

            <DashboardModal visible={!!selectedTile} tile={selectedTile} onClose={() => setSelectedTile(null)} />
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
});
