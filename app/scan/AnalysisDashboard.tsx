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
import React, { useMemo, useState } from 'react';
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
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

import { InteractiveScoreRing } from '@/components/ui/InteractiveScoreRing';
import { ContentSection } from '@/components/ui/ScoreDetailCard';
import { SkeletonLoader } from '@/components/ui/SkeletonLoader';
import { computeScores, SupplementMeta } from '../../lib/scoring';
type Analysis = any;

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
}> = ({ tile, onPress, scrollY, viewportHeight }) => {
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
            style={[{ width: '100%' }, animatedStyle]}
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
};

const WidgetTile: React.FC<WidgetTileProps> = ({ tile, onPress }) => {
    const Icon = tile.icon;
    const accentColor = colorMap[tile.accentColor] || tile.accentColor || '#3B82F6';
    const backgroundColor = tile.backgroundColor || '#FFFFFF';
    const textColor = tile.textColor || '#0F172A';
    const labelColor = tile.labelColor || accentColor;

    const renderContent = () => {
        if (tile.loading) {
            return (
                <View style={styles.tileSection}>
                    <SkeletonLoader width="30%" height={12} style={{ marginBottom: 8 }} />
                    <SkeletonLoader width="100%" height={16} style={{ marginBottom: 4 }} />
                    <SkeletonLoader width="80%" height={16} style={{ marginBottom: 12 }} />
                    <View style={{ gap: 8 }}>
                        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                            <SkeletonLoader width={16} height={16} borderRadius={8} />
                            <SkeletonLoader width="60%" height={14} />
                        </View>
                        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                            <SkeletonLoader width={16} height={16} borderRadius={8} />
                            <SkeletonLoader width="50%" height={14} />
                        </View>
                    </View>
                </View>
            );
        }

        switch (tile.type) {
            case 'overview':
                return (
                    <View style={styles.tileSection}>
                        <Text style={[styles.tileEyebrow, { color: labelColor }]} numberOfLines={1}>
                            {tile.eyebrow}
                        </Text>
                        {!!tile.summary && (
                            <Text style={[styles.tileSummary, { color: textColor }]} numberOfLines={2}>
                                {tile.summary}
                            </Text>
                        )}
                        <View style={styles.tileBulletList}>
                            {(tile.bullets || []).slice(0, 3).map((bullet, idx) => (
                                <View key={idx} style={styles.tileBulletRow}>
                                    <CheckCircle2 size={16} color={labelColor} />
                                    <Text style={[styles.tileBulletText, { color: textColor }]} numberOfLines={3}>
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
                        <Text style={[styles.tileEyebrow, { color: labelColor }]} numberOfLines={1}>
                            {tile.eyebrow}
                        </Text>
                        <View style={styles.mechList}>
                            {(tile.mechanisms || []).slice(0, 3).map((mechanism, idx) => (
                                <View key={idx} style={styles.mechRow}>
                                    <View style={styles.mechHeader}>
                                        <Text style={[styles.mechName, { color: textColor }]} numberOfLines={1}>
                                            {mechanism.name}
                                        </Text>
                                        <Text style={[styles.mechAmount, { color: labelColor }]} numberOfLines={1}>
                                            {mechanism.amount}
                                        </Text>
                                    </View>
                                    <View style={[styles.mechBar, { backgroundColor: `${labelColor}33` }]}>
                                        {/*
                                          * Clamp fill width so we never render NaN or overflows.
                                          */}
                                        <View
                                            style={[
                                                styles.mechFill,
                                                {
                                                    backgroundColor: labelColor,
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
                        <Text style={[styles.tileEyebrow, { color: labelColor }]} numberOfLines={1}>
                            {tile.eyebrow}
                        </Text>
                        {!!tile.routineLine && (
                            <Text style={[styles.tileSummary, { color: textColor }]} numberOfLines={2}>
                                {tile.routineLine}
                            </Text>
                        )}
                        {!!tile.bestFor && (
                            <View style={[styles.bestForCard, { backgroundColor: `${labelColor}14` }]}>
                                <Text style={[styles.bestForLabel, { color: labelColor }]}>Best for:</Text>
                                <Text style={[styles.bestForText, { color: textColor }]} numberOfLines={3}>
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
                        <Text style={[styles.tileEyebrow, { color: labelColor }]} numberOfLines={1}>
                            {tile.eyebrow}
                        </Text>
                        {!!tile.warning && (
                            <View style={[styles.warningPill, { backgroundColor: `${labelColor}18` }]}>
                                <Text style={[styles.warningText, { color: labelColor }]} numberOfLines={3}>
                                    {tile.warning}
                                </Text>
                            </View>
                        )}
                        {!!tile.recommendation && (
                            <View style={styles.recommendationBlock}>
                                <Text style={[styles.recommendationLabel, { color: labelColor }]}>RECOMMENDATION</Text>
                                <Text style={[styles.recommendationText, { color: textColor }]}>
                                    {tile.recommendation}
                                </Text>
                            </View>
                        )}
                    </View>
                );
        }
    };

    return (
        <TouchableOpacity activeOpacity={0.85} onPress={tile.loading ? undefined : onPress} style={[styles.tile, { backgroundColor }]}>
            <View style={styles.tileHeader}>
                <View style={[styles.tileIconCircle, { backgroundColor: `${labelColor}15` }]}>
                    <Icon size={20} color={labelColor} />
                </View>
                <Text style={[styles.tileTitle, { color: textColor }]} numberOfLines={1}>{tile.title}</Text>
                {!tile.loading && (
                    <View style={[styles.chevronBadge, { borderColor: `${labelColor}45`, backgroundColor: `${labelColor}12` }]}>
                        <Text style={[styles.chevronSymbol, { color: labelColor }]}>{'>'}</Text>
                    </View>
                )}
            </View>

            {renderContent()}
        </TouchableOpacity>
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
        <Modal transparent visible={visible} animationType="fade">
            <Pressable style={styles.modalBackdrop} onPress={onClose}>
                <View style={styles.modalContainer}>
                    <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose}>
                        <X size={20} color="#6B7280" />
                    </TouchableOpacity>

                    <View style={[styles.modalIconCircle, { backgroundColor: `${accentColor}15` }]}>
                        <Icon size={32} color={accentColor} />
                    </View>

                    <Text style={styles.modalTitle}>{tile.modalTitle}</Text>
                    <View style={[styles.modalDivider, { backgroundColor: accentColor }]} />

                    <ScrollView style={styles.modalContent} contentContainerStyle={{ paddingBottom: 24 }}>
                        {tile.content}
                    </ScrollView>
                </View>
            </Pressable>
        </Modal>
    );
};

export const AnalysisDashboard: React.FC<{ analysis: Analysis; isStreaming?: boolean }> = ({ analysis, isStreaming = false }) => {
    const [selectedTile, setSelectedTile] = useState<TileConfig | null>(null);
    const scrollY = useSharedValue(0);
    const scrollHandler = useAnimatedScrollHandler((event) => {
        scrollY.value = event.contentOffset.y;
    });
    const { height: viewportHeight } = useWindowDimensions();

    const productInfo = analysis.productInfo ?? {};
    const efficacy = analysis.efficacy ?? {};
    const usage = analysis.usage ?? {};
    const safety = analysis.safety ?? {};
    const value = analysis.value ?? {};
    const social = analysis.social ?? {};

    // Compute scores in real-time if meta is available
    const scores = useMemo(() => {
        if (analysis.meta) {
            return computeScores(analysis.meta as SupplementMeta);
        }
        // Fallback to existing scores if no meta
        const existingScores = analysis.scores ?? {};
        const overall = typeof existingScores.overall === 'number'
            ? existingScores.overall
            : ((existingScores.effectiveness ?? 0) + (existingScores.safety ?? 0) + (existingScores.practicality ?? 0)) / 3;

        return {
            effectiveness: existingScores.effectiveness ?? 0,
            safety: existingScores.safety ?? 0,
            value: existingScores.practicality ?? existingScores.value ?? 0,
            overall: overall,
            label: 'optional' // default
        };
    }, [analysis]);

    // Construct descriptions for InteractiveScoreRing
    const descriptions: {
        effectiveness: ContentSection;
        safety: ContentSection;
        practicality: ContentSection;
    } = {
        effectiveness: {
            verdict: efficacy.verdict || 'Analysis based on active ingredients.',
            highlights: efficacy.benefits || [],
            warnings: [],
        },
        safety: {
            verdict: safety.verdict || 'Safety profile analyzed.',
            highlights: [],
            warnings: safety.redFlags || safety.risks || [],
        },
        practicality: {
            verdict: value.verdict || 'Value assessment.',
            highlights: [value.analysis].filter(Boolean) as string[],
            warnings: [],
        },
    };

    const overviewSummary =
        value.analysis ||
        efficacy.dosageAssessment?.text ||
        value.verdict ||
        social.summary ||
        'Search results did not provide this information.';

    const scienceSummary =
        efficacy.verdict ||
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

    const meta = analysis.meta as SupplementMeta | undefined;

    const clampFill = (value?: number, fallback: number = 68) => {
        if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
        return Math.min(100, Math.max(12, value));
    };

    const formatMg = (value?: number) => (typeof value === 'number' ? `${value} mg` : undefined);

    const coreBenefits = (Array.isArray(efficacy.benefits) && efficacy.benefits.length > 0
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

    const doseMatchPercent =
        meta?.actualDoseMg && meta?.refDoseMg
            ? clampFill(Math.round((meta.actualDoseMg / meta.refDoseMg) * 100), 72)
            : clampFill(undefined, 72);

    const keyMechanisms: Mechanism[] = [
        {
            name: meta?.primaryIngredient || productInfo.primaryIngredient || 'Primary Active',
            amount: formatMg(meta?.actualDoseMg) || 'Clinically aligned dose',
            fill: doseMatchPercent,
        },
        {
            name: 'Reference Range',
            amount: formatMg(meta?.refDoseMg) || 'Target range',
            fill: clampFill(meta?.refDoseMg ? 98 : 64, 64),
        },
    ];

    if (meta?.formBioRating) {
        const bioMap: Record<NonNullable<SupplementMeta['formBioRating']>, number> = {
            high: 92,
            medium: 72,
            low: 52,
        };
        keyMechanisms.push({
            name: 'Bioavailability',
            amount: meta.formBioRating === 'high' ? 'High' : meta.formBioRating === 'medium' ? 'Medium' : 'Low',
            fill: clampFill(bioMap[meta.formBioRating], 64),
        });
    }

    const evidenceLevelText = (() => {
        switch (meta?.evidenceLevel) {
            case 3: return 'Strong clinical evidence';
            case 2: return 'Moderate evidence';
            case 1: return 'Limited evidence';
            case 0: default: return 'AI-reviewed evidence';
        }
    })();

    const bioavailabilityText = meta?.formBioRating
        ? `Form bioavailability: ${meta.formBioRating}`
        : 'Bioavailability estimated from label information.';

    const doseMatchCopy =
        meta?.actualDoseMg && meta?.refDoseMg
            ? `Dose at ${Math.round((meta.actualDoseMg / meta.refDoseMg) * 100)}% of reference (${meta.actualDoseMg}mg vs ${meta.refDoseMg}mg).`
            : 'Dose compared against typical clinical ranges.';

    const timingCopy =
        usage.withFood === true
            ? 'Take with food for better tolerance and absorption.'
            : usage.withFood === false
                ? 'Can be taken without food if stomach tolerates it.'
                : 'Follow a consistent time each day; pair with breakfast for smoother energy.';

    const interactionCopy = (() => {
        if (meta?.interactionLevel === 'high') return 'High interaction potential — consult a clinician.';
        if (meta?.interactionLevel === 'moderate') return 'Moderate interaction potential with common medications.';
        if (meta?.interactionLevel === 'low') return 'Low interaction potential reported.';
        return 'Monitor with existing medications if uncertain.';
    })();

    const isEfficacyReady = !!efficacy.verdict || !isStreaming;
    const isSafetyReady = !!safety.verdict || !isStreaming;
    const isUsageReady = !!usage.summary || !isStreaming;
    const isOverviewReady = !!value.analysis || !!efficacy.dosageAssessment?.text || !isStreaming;

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
            eyebrow: 'CORE BENEFITS',
            summary: overviewSummary,
            bullets: coreBenefits,
            loading: !isOverviewReady,
            content: (
                <View style={{ gap: 16 }}>
                    <Text style={styles.modalParagraph}>{overviewSummary}</Text>
                    <View style={styles.modalOverviewGrid}>
                        <View style={styles.modalOverviewCard}>
                            <TrendingUp size={20} color="#3B82F6" />
                            <Text style={styles.modalOverviewNumber}>
                                {Number.isFinite(scores.overall) ? `${Math.round(scores.overall)}/100` : 'AI'}
                            </Text>
                            <Text style={styles.modalOverviewLabel}>NuTri Score</Text>
                        </View>
                        <View style={styles.modalOverviewCard}>
                            <Activity size={20} color="#3B82F6" />
                            <Text style={styles.modalOverviewNumber}>{productInfo.form || 'N/A'}</Text>
                            <Text style={styles.modalOverviewLabel}>Form</Text>
                        </View>
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
                        {meta?.dataCoverage != null && (
                            <View style={styles.modalTag}>
                                <Text style={styles.modalTagLabel}>Data Coverage</Text>
                                <Text style={styles.modalTagValue}>{Math.round(meta.dataCoverage * 100)}%</Text>
                            </View>
                        )}
                    </View>
                </View>
            ),
        },
        {
            id: 2,
            type: 'science',
            title: 'Science & Ingredients',
            modalTitle: 'Science Analysis',
            icon: BarChart3,
            accentColor: 'text-amber-500',
            backgroundColor: '#F7C948',
            textColor: '#0F172A',
            labelColor: '#0F172A',
            eyebrow: 'KEY MECHANISM',
            mechanisms: keyMechanisms,
            loading: !isEfficacyReady,
            content: (
                <View style={{ gap: 16 }}>
                    <Text style={styles.modalParagraphSmall}>{scienceSummary}</Text>
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
            routineLine,
            bestFor,
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
            warning: warningLine,
            recommendation: recommendationLine,
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
                    <View style={styles.modalCalloutCard}>
                        <Text style={styles.modalBulletTitle}>Interactions</Text>
                        <Text style={styles.modalParagraphSmall}>{interactionCopy}</Text>
                        {meta?.hasCommonAllergens && (
                            <Text style={styles.modalParagraphSmall}>Contains common allergens — review label.</Text>
                        )}
                        {meta?.hasStrongStimulants && (
                            <Text style={styles.modalParagraphSmall}>Includes strong stimulants — avoid late-day use.</Text>
                        )}
                        {meta?.thirdPartyTested && (
                            <Text style={styles.modalParagraphSmall}>Third-party tested reported.</Text>
                        )}
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
                            effectiveness: scores.effectiveness,
                            safety: scores.safety,
                            value: scores.value,
                            overall: scores.overall
                        }}
                        descriptions={descriptions}
                    />
                </View>

                {/* Deep Categories */}
                <View style={styles.tilesHeader}>
                    <Text style={styles.tilesTitle}>Deep Categories</Text>
                    <Text style={styles.tilesSubtitle}>Tap to view detailed analysis</Text>
                </View>

                <View style={styles.tilesGrid}>
                    {tiles.map(tile => (
                        <AnimatedTile
                            key={tile.id}
                            tile={tile}
                            onPress={() => setSelectedTile(tile)}
                            scrollY={scrollY}
                            viewportHeight={viewportHeight}
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
    },
    scrollContent: {
        paddingHorizontal: 16,
        paddingBottom: 40,
        paddingTop: 12,
    },
    headerSection: {
        marginBottom: 20,
        paddingHorizontal: 4,
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
        paddingHorizontal: 4,
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
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        justifyContent: 'space-between',
    },
    tile: {
        width: '100%',
        flexBasis: '100%',
        backgroundColor: '#FFFFFF',
        borderRadius: 22,
        padding: 14,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 4,
        minHeight: 190,
    },
    tileHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
        gap: 10,
    },
    tileIconCircle: {
        width: 36,
        height: 36,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tileTitle: {
        flex: 1,
        fontSize: 15,
        fontWeight: '700',
        letterSpacing: -0.1,
        minWidth: 0,
        lineHeight: 20,
    },
    chevronBadge: {
        width: 28,
        height: 28,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chevronSymbol: {
        fontSize: 15,
        fontWeight: '800',
    },
    tileSection: {
        gap: 8,
        marginTop: 6,
        flexGrow: 1,
    },
    tileEyebrow: {
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
    tileSummary: {
        fontSize: 14,
        fontWeight: '600',
        lineHeight: 20,
        flexShrink: 1,
    },
    tileBulletList: {
        gap: 8,
    },
    tileBulletRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    tileBulletText: {
        flex: 1,
        fontSize: 14,
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
        fontSize: 14,
        fontWeight: '700',
        letterSpacing: -0.1,
    },
    mechAmount: {
        fontSize: 12,
        fontWeight: '700',
    },
    mechBar: {
        height: 8,
        borderRadius: 10,
        overflow: 'hidden',
    },
    mechFill: {
        height: '100%',
        borderRadius: 10,
    },
    bestForCard: {
        marginTop: 6,
        padding: 12,
        borderRadius: 12,
        gap: 4,
    },
    bestForLabel: {
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.3,
    },
    bestForText: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '600',
    },
    warningPill: {
        padding: 12,
        borderRadius: 12,
    },
    warningText: {
        fontSize: 13,
        fontWeight: '700',
        lineHeight: 18,
    },
    recommendationBlock: {
        gap: 4,
        marginTop: 6,
    },
    recommendationLabel: {
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.4,
    },
    recommendationText: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '600',
    },
    // Modal Styles
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'flex-end',
    },
    modalContainer: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        padding: 24,
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
        flex: 1,
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
});
