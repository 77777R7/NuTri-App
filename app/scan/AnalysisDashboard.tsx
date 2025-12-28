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
import type { LabelDraft } from '@/backend/src/labelAnalysis';
import { computeSmartScores, type AnalysisInput } from '../../lib/scoring';
type Analysis = any;
type ScoreState = 'active' | 'muted' | 'loading';
type SourceType = 'barcode' | 'label_scan';

type TileType = 'overview' | 'science' | 'usage' | 'safety';

type Mechanism = {
    name: string;
    amount: string;
    fill: number;
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
    eyebrow: string;
    summary?: string;
    bullets?: string[];
    bulletLimit?: number;
    mechanisms?: Mechanism[];
    routineLine?: string;
    bestFor?: string;
    warning?: string;
    recommendation?: string;
    loading?: boolean;
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

function normalizeText(value?: string | null) {
    return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function ensurePeriod(value: string) {
    return /[.!?]$/.test(value) ? value : `${value}.`;
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

const LABEL_NAME_NOISE_PATTERNS: RegExp[] = [
    /supplement facts/i,
    /nutrition facts/i,
    /serving size/i,
    /\bamount\b/i,
    /per serving/i,
    /daily value/i,
    /% ?dv/i,
    /\bvalue\b/i,
    /(medicinal|non-medicinal) ingredients/i,
    /other ingredients/i,
    /also contains/i,
    /directions?/i,
    /warnings?/i,
    /caution/i,
    /store/i,
    /^(each|in each|chaque|dans chaque)\b.*\bcontains?\b/i,
];

function isNoiseLabelIngredientName(name?: string | null) {
    if (!name) return true;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 2) return true;
    return LABEL_NAME_NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
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
                        {!!tile.summary && (
                            <Text style={[styles.tileSummary, { color: tColor }]} numberOfLines={3}>
                                {tile.summary}
                            </Text>
                        )}
                        <View style={styles.tileBulletList}>
                            {(tile.bullets || []).slice(0, tile.bulletLimit ?? 2).map((bullet, idx) => (
                                <View key={idx} style={styles.tileBulletRow}>
                                    <View style={styles.bulletIcon}>
                                        <CheckCircle2 size={14} color={label} />
                                    </View>
                                    <Text style={[styles.tileBulletText, { color: tColor }]} numberOfLines={3}>
                                        {bullet}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    </View>
                );
            case 'science':
                return (
                    <View style={styles.tileSection}>
                        <View style={styles.mechList}>
                            {(tile.mechanisms || []).slice(0, 3).map((mechanism, idx) => (
                                <View key={idx} style={styles.mechRow}>
                                    <View style={styles.mechHeader}>
                                        <Text style={[styles.mechName, { color: tColor }]} numberOfLines={1}>
                                            {mechanism.name}
                                        </Text>
                                        <Text style={[styles.mechAmount, { color: label }]} numberOfLines={1}>
                                            {mechanism.amount}
                                        </Text>
                                    </View>
                                    <View style={[styles.mechBar, { backgroundColor: 'rgba(255,255,255,0.4)' }]}>
                                        <View
                                            style={[
                                                styles.mechFill,
                                                {
                                                    backgroundColor: label,
                                                    width: `${Math.min(100, Math.max(12, mechanism.fill ?? 0))}%`
                                                }
                                            ]}
                                        />
                                    </View>
                                </View>
                            ))}
                        </View>
                    </View>
                );
            case 'usage':
                return (
                    <View style={styles.tileSection}>
                        {!!tile.routineLine && (
                            <Text style={[styles.tileSummary, { color: tColor }]} numberOfLines={2}>
                                {tile.routineLine}
                            </Text>
                        )}
                        {!!tile.bestFor && (
                            <View style={[styles.bestForCard, { backgroundColor: withAlpha(label, 0.08) }]}>
                                <Text style={[styles.bestForLabel, { color: label }]}>Best for:</Text>
                                <Text style={[styles.bestForText, { color: tColor }]} numberOfLines={3}>
                                    {tile.bestFor}
                                </Text>
                            </View>
                        )}
                    </View>
                );
            case 'safety':
            default:
                return (
                    <View style={styles.tileSection}>
                        {!!tile.warning && (
                            <View style={[styles.warningPill, { backgroundColor: withAlpha(label, 0.12) }]}>
                                <Text style={[styles.warningText, { color: label }]} numberOfLines={3}>
                                    {tile.warning}
                                </Text>
                            </View>
                        )}
                        {!!tile.recommendation && (
                            <View style={styles.recommendationBlock}>
                                <Text style={[styles.recommendationLabel, { color: label }]}>RECOMMENDATION</Text>
                                <Text style={[styles.recommendationText, { color: tColor }]}>
                                    {tile.recommendation}
                                </Text>
                            </View>
                        )}
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
                                            View
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
    if (!tile) return null;
    const Icon = tile.icon;
    const accentColor = colorMap[tile.accentColor] || '#3B82F6';

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
    labelDraft?: LabelDraft;
}> = ({ analysis, isStreaming = false, scoreBadge, scoreState, sourceType, labelDraft }) => {
    const [selectedTile, setSelectedTile] = useState<TileConfig | null>(null);
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

    const productInfo = analysis.productInfo ?? {};
    const efficacy = analysis.efficacy ?? {};
    const usage = analysis.usage ?? {};
    const safety = analysis.safety ?? {};
    const value = analysis.value ?? {};
    const social = analysis.social ?? {};

    // Check if all core AI analysis is complete before computing scores
    const isFullyLoaded = useMemo(() => {
        return (
            typeof efficacy.score === 'number' &&
            typeof safety.score === 'number' &&
            typeof value.score === 'number'
        );
    }, [efficacy.score, safety.score, value.score]);
    const isLabelSource = sourceType === 'label_scan';
    const scrubLabelValueText = useCallback(
        (text?: string | null) => {
            if (!isLabelSource || !text) return text ?? '';
            return /price|cost/i.test(text) ? '' : text;
        },
        [isLabelSource]
    );
    const labelActives = useMemo(() => {
        if (!isLabelSource || !labelDraft) return [];
        const seen = new Set<string>();
        const results: { name: string; doseText: string; dosageValue: number | null; dosageUnit: string | null }[] = [];
        for (const ing of labelDraft.ingredients ?? []) {
            const name = ing.name?.trim();
            if (!name) continue;
            if (isNoiseLabelIngredientName(name)) continue;
            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            const doseText =
                ing.amount != null && ing.unit
                    ? `${ing.amount} ${ing.unit}`
                    : ing.dvPercent != null
                        ? `${ing.dvPercent}% DV`
                        : 'dose not specified';
            results.push({
                name,
                doseText,
                dosageValue: ing.amount ?? null,
                dosageUnit: ing.unit ?? null,
            });
            if (results.length >= 3) break;
        }
        return results;
    }, [isLabelSource, labelDraft]);
    const effectiveScoreState: ScoreState = isLabelSource
        ? (scoreState ?? (isFullyLoaded ? 'active' : 'loading'))
        : (isFullyLoaded ? 'active' : 'loading');
    const badgeTextSafe = isLabelSource ? scoreBadge : undefined;

    // Compute scores using new AI-driven scoring system
    // Only compute when fully loaded, otherwise show loading state
    const scores = useMemo(() => {
        if (!isFullyLoaded) {
            // Return loading state - will show skeleton
            return {
                effectiveness: 0,
                safety: 0,
                value: 0,
                overall: 0,
                label: 'Loading...',
                details: {
                    effectivenessFactors: [],
                    safetyFactors: [],
                    valueFactors: [],
                },
            };
        }

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
    }, [efficacy, safety, value, social, isFullyLoaded]);
    const displayOverrides = effectiveScoreState === 'muted'
        ? { overall: '--', effectiveness: '--', safety: '--', value: '--' }
        : undefined;
    const ringScores = effectiveScoreState === 'muted'
        ? { effectiveness: 0, safety: 0, value: 0, overall: 0 }
        : scores;
    const formatScoreText = (value: number, override?: string) => {
        if (override) return override;
        return Number.isFinite(value) ? `${Math.round(value)}/100` : 'AI';
    };
    const overviewScoreText = formatScoreText(scores.overall, displayOverrides?.overall);

    // Construct descriptions for InteractiveScoreRing with score factor explanations
    const descriptions: {
        effectiveness: ContentSection;
        safety: ContentSection;
        practicality: ContentSection;
    } = useMemo(() => ({
        effectiveness: {
            verdict: efficacy.verdict || 'Analyzing efficacy based on ingredients and evidence...',
            // Use scoring factors as highlights to explain the score
            highlights: isFullyLoaded
                ? scores.details.effectivenessFactors.filter(f => f.startsWith('+'))
                : [],
            warnings: isFullyLoaded
                ? scores.details.effectivenessFactors.filter(f => f.startsWith('-') || f.startsWith('−'))
                : [],
        },
        safety: {
            verdict: safety.verdict || 'Analyzing safety profile...',
            highlights: isFullyLoaded
                ? scores.details.safetyFactors.filter(f => f.startsWith('+'))
                : [],
            warnings: isFullyLoaded
                ? [...(safety.redFlags || []), ...scores.details.safetyFactors.filter(f => f.startsWith('-') || f.startsWith('−'))]
                : [],
        },
        practicality: {
            verdict:
                scrubLabelValueText(value.verdict) ||
                (isLabelSource ? 'Analyzing formula quality...' : 'Analyzing value and practicality...'),
            highlights: isFullyLoaded
                ? scores.details.valueFactors.filter(f => f.startsWith('+'))
                : [],
            warnings: [],
        },
    }), [efficacy.verdict, safety.verdict, safety.redFlags, value.verdict, scores.details, isFullyLoaded, isLabelSource, scrubLabelValueText]);

    const labelActiveLines = labelActives.map((active) => `${active.name} - ${active.doseText}`);
    const labelIssueCaution = labelDraft?.issues?.find((issue) =>
        ['unit_invalid', 'value_anomaly', 'non_ingredient_line_detected', 'unit_boundary_suspect', 'dose_inconsistency_or_claim', 'incomplete_ingredients']
            .includes(issue.type)
    );
    const labelCautionLine =
        (Array.isArray(safety.redFlags) && safety.redFlags[0]) ||
        (Array.isArray(safety.risks) && safety.risks[0]) ||
        labelIssueCaution?.message ||
        'Review interactions if taking other supplements or medications.';

    const scienceSummary = isLabelSource && labelActiveLines.length
        ? `Key actives: ${labelActiveLines.slice(0, 3).join('; ')}.`
        : isLabelSource
            ? 'Ingredients could not be confirmed from the label. Review evidence for accuracy.'
            : efficacy.verdict ||
                (Array.isArray(efficacy.benefits) && efficacy.benefits[0]) ||
                'Formula effectiveness has been analyzed based on typical clinical ranges.';

    const usageSummary =
        usage.summary ||
        usage.timing ||
        'Follow label directions and keep timing consistent each day.';

    const safetySummary =
        safety.verdict ||
        (Array.isArray(safety.redFlags) && safety.redFlags[0]) ||
        (Array.isArray(safety.risks) && safety.risks[0]) ||
        'No major safety concerns were highlighted in public sources at standard doses.';

    // Legacy meta is no longer used - scoring now comes from AI analysis directly

    const clampFill = (value?: number, fallback: number = 68) => {
        if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
        return Math.min(100, Math.max(12, value));
    };

    // Use primaryActive from efficacy if available
    const primaryActive = efficacy?.primaryActive;

    // Format dosage with unit
    const formatDose = (value?: number | null, unit?: string | null): string | null => {
        if (typeof value !== 'number' || value === null) return null;
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
    const primaryName = primaryActive?.name || productInfo.primaryIngredient || productInfo.name;

    // Build overview summary: prefer AI-generated, then structured fallback, then legacy
    const labelOverviewSummary = isLabelSource && labelActiveLines.length
        ? `Label-only snapshot${labelDraft?.servingSize ? ` (${labelDraft.servingSize})` : ''}: ${labelActiveLines
            .slice(0, 3)
            .join(', ')}.`
        : null;
    const overviewSummary = (() => {
        if (labelOverviewSummary) {
            return labelOverviewSummary;
        }
        // 1. Use new AI-generated overviewSummary if available
        if (efficacy?.overviewSummary) {
            return efficacy.overviewSummary;
        }
        if (isLabelSource) {
            return labelDraft?.servingSize
                ? `Label-only summary (${labelDraft.servingSize}).`
                : 'Label-only summary based on extracted ingredients.';
        }
        // 2. Build from primaryActive (structured fallback)
        if (primaryActive?.dosageValue != null && primaryActive?.name) {
            const evidenceText = primaryActive.evidenceLevel && primaryActive.evidenceLevel !== 'none'
                ? ` with ${primaryActive.evidenceLevel} evidence`
                : '';
            return `Provides ${primaryActive.dosageValue} ${primaryActive.dosageUnit || 'mg'} ${primaryActive.name}${evidenceText}. ${value.analysis || value.verdict || ''}`;
        }
        // 3. Legacy fallback
        return value.analysis ||
            efficacy.dosageAssessment?.text ||
            value.verdict ||
            social.summary ||
            'Analysis based on available search results.';
    })();

    // Get core benefits from efficacy (new) or fallback to benefits array
    const labelFallbackBenefits = [
        labelDraft?.servingSize ? `Serving size: ${labelDraft.servingSize}` : 'Serving size not detected',
        'Ingredients extracted from label evidence',
    ];
    const coreBenefits = (
        isLabelSource
            ? (labelActiveLines.length > 0 ? labelActiveLines : labelFallbackBenefits)
            : Array.isArray(efficacy?.coreBenefits) && efficacy.coreBenefits.length > 0
                ? efficacy.coreBenefits
                : Array.isArray(efficacy?.benefits) && efficacy.benefits.length > 0
                    ? efficacy.benefits
                    : ['Enhanced clarity', 'Sustained energy']
    ).slice(0, 3);

    const bestFor = usage.bestFor || usage.target || usage.who || 'Professionals & students needing focus.';
    const routineLine = usage.dosage || usage.frequency || usage.timing || '2 caps with breakfast for steady effect.';

    const warningLine =
        (Array.isArray(safety.redFlags) && safety.redFlags[0]) ||
        (Array.isArray(safety.risks) && safety.risks[0]) ||
        safetySummary;

    const recommendationLine =
        safety.recommendation ||
        safety.verdict ||
        'Ideal for mid-day brain fog and sustained clarity.';

    // Calculate dose fill percentage based on primaryActive
    const doseMatchPercent = (() => {
        if (primaryActive?.dosageValue != null) {
            const evidenceFillMap: Record<string, number> = {
                'strong': 92,
                'moderate': 75,
                'weak': 55,
                'none': 40,
            };
            return evidenceFillMap[primaryActive.evidenceLevel || 'none'] || 72;
        }
        return 72; // Default
    })();

    const baseMechanisms: Mechanism[] = [
        {
            name: primaryName || 'Primary Active',
            amount: primaryDoseLabel || 'See label',
            fill: doseMatchPercent,
        },
    ];

    // Add evidence level if available from primaryActive
    if (primaryActive?.evidenceLevel && primaryActive.evidenceLevel !== 'none') {
        const evidenceFillMap: Record<string, number> = {
            'strong': 95,
            'moderate': 72,
            'weak': 50,
        };
        baseMechanisms.push({
            name: 'Evidence Level',
            amount: primaryActive.evidenceLevel.charAt(0).toUpperCase() + primaryActive.evidenceLevel.slice(1),
            fill: evidenceFillMap[primaryActive.evidenceLevel] || 60,
        });
    }

    // Add form quality if available
    if (primaryActive?.formQuality && primaryActive.formQuality !== 'unknown') {
        const formFillMap: Record<string, number> = {
            'high': 92,
            'medium': 72,
            'low': 52,
        };
        baseMechanisms.push({
            name: 'Form Quality',
            amount: primaryActive.formQuality.charAt(0).toUpperCase() + primaryActive.formQuality.slice(1),
            fill: formFillMap[primaryActive.formQuality] || 64,
        });
    } // formQuality already added from primaryActive above

    const labelMechanisms: Mechanism[] = labelActives.map((active, index) => ({
        name: active.name,
        amount: active.doseText,
        fill: Math.max(48, 92 - index * 14),
    }));
    const keyMechanisms = isLabelSource && labelMechanisms.length ? labelMechanisms : baseMechanisms;


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
        primaryActive?.dosageValue != null
            ? `Delivers ${primaryActive.dosageValue} ${primaryActive.dosageUnit || 'mg'} per serving.`
            : 'Dose compared against typical clinical ranges.';

    const timingCopy =
        usage.withFood === true
            ? 'Take with food for better tolerance and absorption.'
            : usage.withFood === false
                ? 'Can be taken without food if stomach tolerates it.'
                : 'Follow a consistent time each day; pair with breakfast for smoother energy.';

    const interactionCopy = (() => {
        const interactionCount = safety.interactions?.length ?? 0;
        if (interactionCount >= 3) return 'Multiple potential interactions — consult a clinician.';
        if (interactionCount >= 1) return 'Some interaction potential with common medications.';
        return 'Low interaction potential reported.';
    })();

    const benefitsPhrase = coreBenefits.slice(0, 2).join(', ');
    const overviewCoverSummary = capitalizeSentences(
        clampText(
            isLabelSource
                ? (labelOverviewSummary || overviewSummary)
                : [
                    primaryName
                        ? ensurePeriod(`Focused on ${primaryName}${primaryDoseLabel ? ` ${primaryDoseLabel}` : ''}`)
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
                routineLine || usage.summary || 'Follow the label consistently each day',
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
            ensurePeriod(
                warningLine ||
                    interactionCopy ||
                    safetySummary ||
                    'Review label warnings and consult a clinician if needed'
            ),
            96
        )
    );
    const safetyCoverRecommendation = capitalizeSentences(
        clampText(
            ensurePeriod(recommendationLine || safetySummary || 'Follow label dosing and avoid late-day use'),
            96
        )
    );

    const overviewCoverBullets = (isLabelSource
        ? [...coreBenefits.slice(0, 2), labelCautionLine]
        : coreBenefits.slice(0, 3))
        .map((benefit: string) => capitalizeSentences(benefit))
        .filter(Boolean);

    const isEfficacyReady = !!efficacy.verdict || !isStreaming;
    const isSafetyReady = !!safety.verdict || !isStreaming;
    const isUsageReady = !!usage.summary || !isStreaming;
    // Overview should wait for all AI analysis to complete to avoid partial/inconsistent display
    const isOverviewReady = isFullyLoaded || !isStreaming;

    const overviewContent = isLabelSource ? (
        <View style={{ gap: 16 }}>
            <View style={styles.modalCalloutCard}>
                <Text style={styles.modalBulletTitle}>What it is</Text>
                <Text style={styles.modalParagraphSmall}>{labelOverviewSummary ?? overviewSummary}</Text>
            </View>
            <View style={styles.modalCalloutCard}>
                <Text style={styles.modalBulletTitle}>What stands out</Text>
                {coreBenefits.slice(0, 3).map((benefit: string, idx: number) => (
                    <Text key={idx} style={styles.modalBulletItem}>
                        • {benefit}
                    </Text>
                ))}
            </View>
            <View style={styles.modalCalloutCard}>
                <Text style={styles.modalBulletTitle}>Main caution</Text>
                <Text style={styles.modalParagraphSmall}>{labelCautionLine}</Text>
            </View>
        </View>
    ) : (
        <View style={{ gap: 16 }}>
            <Text style={styles.modalParagraph}>{overviewSummary}</Text>
            <View style={styles.modalOverviewGrid}>
                <View style={styles.modalOverviewCard}>
                    <TrendingUp size={20} color="#3B82F6" />
                    <Text style={styles.modalOverviewNumber}>
                        {overviewScoreText}
                    </Text>
                    <Text style={styles.modalOverviewLabel}>NuTri Score</Text>
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
            title: 'Product Overview',
            modalTitle: 'Product Overview',
            icon: Zap,
            accentColor: 'text-blue-500',
            backgroundColor: '#123CC5',
            textColor: '#F7FBFF',
            labelColor: '#D6E5FF',
            eyebrow: isLabelSource ? 'KEY INGREDIENTS' : 'CORE BENEFITS',
            summary: overviewCoverSummary,
            bullets: overviewCoverBullets,
            bulletLimit: isLabelSource ? 3 : 2,
            loading: !isOverviewReady,
            content: overviewContent,
        },
        {
            id: 2,
            type: 'science',
            title: 'Science & Ingredients',
            modalTitle: 'Science Analysis',
            icon: BarChart3,
            accentColor: 'text-amber-500',
            backgroundColor: '#F7C948',
            textColor: '#ea580c',
            labelColor: '#ea580c',
            eyebrow: 'KEY MECHANISM',
            mechanisms: keyMechanisms,
            loading: !isEfficacyReady,
            content: (
                <View style={{ gap: 16 }}>
                    <Text style={styles.modalParagraphSmall}>{scienceSummary}</Text>

                    {isLabelSource && labelActiveLines.length > 0 && (
                        <View style={styles.modalCalloutCard}>
                            <Text style={styles.modalBulletTitle}>Key ingredients (label)</Text>
                            {labelActiveLines.slice(0, 3).map((line, idx) => (
                                <Text key={idx} style={styles.modalBulletItem}>
                                    • {line}
                                </Text>
                            ))}
                        </View>
                    )}

                    {isLabelSource && labelCautionLine && (
                        <View style={styles.modalCalloutCard}>
                            <Text style={styles.modalBulletTitle}>Main watchout</Text>
                            <Text style={styles.modalParagraphSmall}>{labelCautionLine}</Text>
                        </View>
                    )}

                    {/* NEW: Enhanced Ingredient Analysis */}
                    {Array.isArray(efficacy.ingredients) && efficacy.ingredients.length > 0 && (
                        <View style={styles.modalCalloutCard}>
                            <Text style={styles.modalBulletTitle}>Ingredient Analysis</Text>
                            {efficacy.ingredients.slice(0, 4).map((ingredient: any, idx: number) => (
                                <View key={idx} style={{ marginTop: idx > 0 ? 12 : 4 }}>
                                    <Text style={[styles.modalParagraphSmall, { fontWeight: '600' }]}>
                                        {ingredient.name}
                                        {ingredient.form && ` (${ingredient.form})`}
                                    </Text>
                                    {ingredient.formQuality && ingredient.formQuality !== 'unknown' && (
                                        <Text style={styles.modalParagraphSmall}>
                                            Form quality: {ingredient.formQuality.charAt(0).toUpperCase() + ingredient.formQuality.slice(1)}
                                            {ingredient.formNote && ` — ${ingredient.formNote}`}
                                        </Text>
                                    )}
                                    {ingredient.dosageValue && ingredient.dosageUnit && (
                                        <Text style={styles.modalParagraphSmall}>
                                            Dose: {ingredient.dosageValue} {ingredient.dosageUnit}
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
                            ))}
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
                    {(!efficacy.ingredients || efficacy.ingredients.length === 0) && (
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
            title: 'Practical Usage',
            modalTitle: 'Usage Guide',
            icon: Clock,
            accentColor: 'text-sky-500',
            backgroundColor: '#8CCBFF',
            textColor: '#0B2545',
            labelColor: '#0B2545',
            eyebrow: 'DAILY ROUTINE',
            routineLine: usageCoverLine,
            bestFor: bestForCover,
            loading: !isUsageReady,
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
            title: 'Safety & Recs',
            modalTitle: 'Safety First',
            icon: Shield,
            accentColor: 'text-rose-500',
            backgroundColor: '#F1E7D8',
            textColor: '#2E2A25',
            labelColor: '#6B5B4B',
            eyebrow: 'SAFETY NOTES',
            warning: safetyCoverWarning,
            recommendation: safetyCoverRecommendation,
            loading: !isSafetyReady,
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
                    <Text style={styles.headerEyebrow}>AI ANALYSIS</Text>
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
                            muted={effectiveScoreState === 'muted'}
                            badgeText={badgeTextSafe}
                            sourceType={sourceType}
                        />
                </View>

                {/* Deep Categories */}
                <View style={styles.tilesHeader}>
                    <Text style={styles.tilesTitle}>Deep Categories</Text>
                    <Text style={styles.tilesSubtitle}>Tap to view detailed analysis</Text>
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
    },
    recommendationBlock: {
        gap: 4,
        marginTop: 6,
    },
    recommendationLabel: {
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.6,
    },
    recommendationText: {
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
});
