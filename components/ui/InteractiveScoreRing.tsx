import { ChevronRight, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
    Easing,
    FadeIn,
    FadeOut,
    useAnimatedProps,
    useSharedValue,
    withDelay,
    withTiming
} from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Stop } from 'react-native-svg';
import { ContentSection, ScoreDetailCard } from './ScoreDetailCard';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Category = 'effectiveness' | 'safety' | 'practicality';

type InteractiveScoreRingProps = {
    scores: {
        effectiveness: number;
        safety: number;
        value: number;
        overall: number;
    };
    display?: {
        effectiveness?: string;
        safety?: string;
        value?: string;
        overall?: string;
    };
    descriptions: {
        effectiveness: ContentSection;
        safety: ContentSection;
        practicality: ContentSection;
    };
    muted?: boolean;
    badgeText?: string;
    sourceType?: 'barcode' | 'label_scan';
    labels?: {
        overall?: string;
        effectiveness?: string;
        safety?: string;
        value?: string;
        valueLabel?: string;
    };
    unknownCategories?: {
        effectiveness?: boolean;
        safety?: boolean;
        value?: boolean;
    };
    metaLines?: string[];
};

export const InteractiveScoreRing = ({
    scores,
    descriptions,
    display,
    muted = false,
    badgeText,
    sourceType,
    labels,
    unknownCategories,
    metaLines,
}: InteractiveScoreRingProps) => {
    const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
    const valueLabel = labels?.valueLabel ?? (sourceType === 'label_scan' ? 'Formula Quality' : 'Value');
    const overallLabel = labels?.overall ?? 'NUTRI SCORE';
    const effectivenessLabel = labels?.effectiveness ?? 'Effectiveness';
    const safetyLabel = labels?.safety ?? 'Safety';
    const valueLegendLabel = labels?.value ?? valueLabel;
    const unknownEffectiveness = unknownCategories?.effectiveness ?? false;
    const unknownSafety = unknownCategories?.safety ?? false;
    const unknownValue = unknownCategories?.value ?? false;

    // Dimensions
    const size = 150; // Compact ring size to leave room for legend text
    const strokeWidth = 14;
    const center = size / 2;

    // Radii for concentric rings
    const r1 = 60; // Outer (Effectiveness)
    const r2 = 42; // Middle (Safety)
    const r3 = 24; // Inner (Practicality)

    const c1 = 2 * Math.PI * r1;
    const c2 = 2 * Math.PI * r2;
    const c3 = 2 * Math.PI * r3;

    const p1 = useSharedValue(0);
    const p2 = useSharedValue(0);
    const p3 = useSharedValue(0);

    useEffect(() => {
        if (muted) {
            p1.value = 0;
            p2.value = 0;
            p3.value = 0;
            return;
        }
        const target1 = unknownEffectiveness ? 0.5 : scores.effectiveness / 100;
        const target2 = unknownSafety ? 0.5 : scores.safety / 100;
        const target3 = unknownValue ? 0.5 : scores.value / 100;
        p1.value = withDelay(100, withTiming(target1, { duration: 1500, easing: Easing.out(Easing.exp) }));
        p2.value = withDelay(300, withTiming(target2, { duration: 1500, easing: Easing.out(Easing.exp) }));
        p3.value = withDelay(500, withTiming(target3, { duration: 1500, easing: Easing.out(Easing.exp) }));
    }, [scores, muted, unknownEffectiveness, unknownSafety, unknownValue]);

    const props1 = useAnimatedProps(() => ({
        strokeDashoffset: c1 * (1 - p1.value),
    }));
    const props2 = useAnimatedProps(() => ({
        strokeDashoffset: c2 * (1 - p2.value),
    }));
    const props3 = useAnimatedProps(() => ({
        strokeDashoffset: c3 * (1 - p3.value),
    }));

    const handlePress = (category: Category) => {
        if (muted) return;
        if (category === 'effectiveness' && unknownEffectiveness) return;
        if (category === 'safety' && unknownSafety) return;
        if (category === 'practicality' && unknownValue) return;
        setSelectedCategory(category);
    };

    const handleClose = () => {
        setSelectedCategory(null);
    };

    const getOverlayData = () => {
        if (!selectedCategory) return null;
        switch (selectedCategory) {
            case 'effectiveness':
                return { score: scores.effectiveness, desc: descriptions.effectiveness, color: '#FA114F', title: effectivenessLabel };
            case 'safety':
                return { score: scores.safety, desc: descriptions.safety, color: '#A6E533', title: safetyLabel };
            case 'practicality':
                return { score: scores.value, desc: descriptions.practicality, color: '#00DBDD', title: valueLabel };
        }
    };

    const overlayData = getOverlayData();
    const displayOverall = display?.overall ?? String(Math.round(scores.overall));
    const displayEffectiveness = display?.effectiveness ?? `${Math.round(scores.effectiveness)}`;
    const displaySafety = display?.safety ?? `${Math.round(scores.safety)}`;
    const displayValue = display?.value ?? `${Math.round(scores.value)}`;
    const overallIsDash = displayOverall === '--';
    const formatLegendScore = (value: string) => (value === '--' ? '--' : `${value}/100`);
    const track1 = muted || unknownEffectiveness ? 'rgba(148,163,184,0.2)' : 'rgba(250, 17, 79, 0.15)';
    const track2 = muted || unknownSafety ? 'rgba(148,163,184,0.2)' : 'rgba(166, 229, 51, 0.2)';
    const track3 = muted || unknownValue ? 'rgba(148,163,184,0.2)' : 'rgba(0, 219, 221, 0.15)';
    const ring1 = muted || unknownEffectiveness ? '#d1d5db' : '#FA114F';
    const ring1End = muted || unknownEffectiveness ? '#e5e7eb' : '#FF4F80';
    const ring2 = muted || unknownSafety ? '#d1d5db' : '#A6E533';
    const ring2End = muted || unknownSafety ? '#e5e7eb' : '#CFFF60';
    const ring3 = muted || unknownValue ? '#d1d5db' : '#00DBDD';
    const ring3End = muted || unknownValue ? '#e5e7eb' : '#50F0F2';

    return (
        <View style={styles.container}>
            <View style={styles.overallRow}>
                {badgeText ? (
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>{badgeText}</Text>
                    </View>
                ) : (
                    <View style={styles.badgeSpacer} />
                )}
                <View style={styles.overallScoreContainer}>
                    <Text style={[styles.overallLabel, muted ? styles.mutedText : null]}>{overallLabel}</Text>
                    <Text style={[styles.overallValue, muted ? styles.mutedTextStrong : null]}>
                        {displayOverall}
                        {!overallIsDash && <Text style={styles.overallMax}>/100</Text>}
                    </Text>
                </View>
            </View>

            <View style={styles.contentRow}>
                {/* Left Side: Rings */}
                <View style={styles.ringWrapper}>
                    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                        <Defs>
                            <LinearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
                                <Stop offset="0%" stopColor={ring1} />
                                <Stop offset="100%" stopColor={ring1End} />
                            </LinearGradient>
                            <LinearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="0%">
                                <Stop offset="0%" stopColor={ring2} />
                                <Stop offset="100%" stopColor={ring2End} />
                            </LinearGradient>
                            <LinearGradient id="grad3" x1="0%" y1="0%" x2="100%" y2="0%">
                                <Stop offset="0%" stopColor={ring3} />
                                <Stop offset="100%" stopColor={ring3End} />
                            </LinearGradient>
                        </Defs>

                        {/* Background Tracks */}
                        <G rotation="-90" origin={`${center}, ${center}`}>
                            <Circle cx={center} cy={center} r={r1} stroke={track1} strokeWidth={strokeWidth} fill="none" />
                            <Circle cx={center} cy={center} r={r2} stroke={track2} strokeWidth={strokeWidth} fill="none" />
                            <Circle cx={center} cy={center} r={r3} stroke={track3} strokeWidth={strokeWidth} fill="none" />

                            {/* Animated Progress Rings */}
                            <AnimatedCircle
                                cx={center}
                                cy={center}
                                r={r1}
                                stroke="url(#grad1)"
                                strokeWidth={strokeWidth}
                                strokeLinecap="round"
                                fill="none"
                                strokeDasharray={c1}
                                animatedProps={props1}
                                onPress={() => handlePress('effectiveness')}
                            />
                            <AnimatedCircle
                                cx={center}
                                cy={center}
                                r={r2}
                                stroke="url(#grad2)"
                                strokeWidth={strokeWidth}
                                strokeLinecap="round"
                                fill="none"
                                strokeDasharray={c2}
                                animatedProps={props2}
                                onPress={() => handlePress('safety')}
                            />
                            <AnimatedCircle
                                cx={center}
                                cy={center}
                                r={r3}
                                stroke="url(#grad3)"
                                strokeWidth={strokeWidth}
                                strokeLinecap="round"
                                fill="none"
                                strokeDasharray={c3}
                                animatedProps={props3}
                                onPress={() => handlePress('practicality')}
                            />
                        </G>
                    </Svg>
                </View>

                {/* Right Side: Legend */}
                <View style={styles.legendContainer}>
                    <View style={styles.legendList}>
                        <TouchableOpacity style={styles.legendItem} onPress={() => handlePress('effectiveness')} activeOpacity={muted || unknownEffectiveness ? 1 : 0.7}>
                            <View style={[styles.legendIcon, { backgroundColor: muted || unknownEffectiveness ? '#d1d5db' : '#FA114F' }]} />
                            <View style={styles.legendContent}>
                                <Text
                                    style={[
                                        styles.legendTitle,
                                        muted || unknownEffectiveness ? styles.mutedTextStrong : null
                                    ]}
                                    numberOfLines={1}
                                >
                                    {effectivenessLabel}
                                </Text>
                                <Text style={styles.legendScore} numberOfLines={1}>{formatLegendScore(displayEffectiveness)}</Text>
                            </View>
                            {!muted && !unknownEffectiveness && <ChevronRight size={16} color="#C7C7CC" />}
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.legendItem} onPress={() => handlePress('safety')} activeOpacity={muted || unknownSafety ? 1 : 0.7}>
                            <View style={[styles.legendIcon, { backgroundColor: muted || unknownSafety ? '#d1d5db' : '#A6E533' }]} />
                            <View style={styles.legendContent}>
                                <Text
                                    style={[
                                        styles.legendTitle,
                                        muted || unknownSafety ? styles.mutedTextStrong : null
                                    ]}
                                    numberOfLines={1}
                                >
                                    {safetyLabel}
                                </Text>
                                <Text style={styles.legendScore} numberOfLines={1}>{formatLegendScore(displaySafety)}</Text>
                            </View>
                            {!muted && !unknownSafety && <ChevronRight size={16} color="#C7C7CC" />}
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.legendItem} onPress={() => handlePress('practicality')} activeOpacity={muted || unknownValue ? 1 : 0.7}>
                            <View style={[styles.legendIcon, { backgroundColor: muted || unknownValue ? '#d1d5db' : '#00DBDD' }]} />
                            <View style={styles.legendContent}>
                                <Text
                                    style={[
                                        styles.legendTitle,
                                        muted || unknownValue ? styles.mutedTextStrong : null
                                    ]}
                                    numberOfLines={1}
                                >
                                    {valueLegendLabel}
                                </Text>
                                <Text style={styles.legendScore} numberOfLines={1}>{formatLegendScore(displayValue)}</Text>
                            </View>
                            {!muted && !unknownValue && <ChevronRight size={16} color="#C7C7CC" />}
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            {metaLines && metaLines.length > 0 && (
                <View style={styles.metaList}>
                    {metaLines.map((line, index) => (
                        <Text key={`${line}-${index}`} style={[styles.metaLine, muted ? styles.mutedTextStrong : null]}>
                            {line}
                        </Text>
                    ))}
                </View>
            )}

            {/* Overlay Window */}
            {!muted && selectedCategory && overlayData && (
                <Animated.View
                    entering={FadeIn.duration(200)}
                    exiting={FadeOut.duration(200)}
                    style={styles.overlay}
                >
                    <Pressable style={styles.overlayBackdrop} onPress={handleClose} />
                    <View style={styles.overlayCard}>
                        <View style={styles.overlayHeader}>
                            <Text style={styles.overlayTitle}>{overlayData.title}</Text>
                            <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
                                <X size={20} color="#6b7280" />
                            </TouchableOpacity>
                        </View>
                        <ScoreDetailCard
                            category={selectedCategory}
                            score={overlayData.score}
                            description={overlayData.desc}
                            color={overlayData.color}
                            valueLabel={valueLabel}
                            labelOverride={overlayData.title}
                        />
                    </View>
                </Animated.View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#FFFFFF',
        borderRadius: 24,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
        elevation: 4,
        marginHorizontal: 4,
    },
    overallRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    contentRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
    },
    ringWrapper: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 4,
    },
    legendContainer: {
        flex: 1,
        minWidth: 140,
        maxWidth: 240,
        justifyContent: 'center',
    },
    overallScoreContainer: {
        marginBottom: 16,
        alignItems: 'flex-end',
    },
    overallLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: '#8E8E93',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 2,
    },
    overallValue: {
        fontSize: 32,
        fontWeight: '800',
        color: '#1C1C1E',
        lineHeight: 36,
    },
    overallMax: {
        fontSize: 16,
        fontWeight: '600',
        color: '#AEAEB2',
    },
    badge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: '#e0f2fe',
        borderWidth: 1,
        borderColor: '#bae6fd',
    },
    badgeText: {
        fontSize: 11,
        fontWeight: '600',
        color: '#0369a1',
        letterSpacing: 0.3,
    },
    badgeSpacer: {
        width: 1,
        height: 1,
    },
    mutedText: {
        color: '#9ca3af',
    },
    mutedTextStrong: {
        color: '#9ca3af',
    },
    legendList: {
        gap: 12,
    },
    legendItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        flexShrink: 1,
    },
    legendIcon: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    legendContent: {
        flex: 1,
    },
    legendTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1C1C1E',
    },
    legendScore: {
        fontSize: 12,
        color: '#8E8E93',
        marginTop: 1,
        textAlign: 'right',
    },
    metaList: {
        marginTop: 12,
        gap: 4,
    },
    metaLine: {
        fontSize: 12,
        color: '#6B7280',
        fontWeight: '600',
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 50,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
    },
    overlayBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.3)',
        borderRadius: 24,
    },
    overlayCard: {
        width: '100%',
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 24,
        elevation: 10,
    },
    overlayHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    overlayTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1C1C1E',
    },
    closeButton: {
        padding: 4,
        backgroundColor: '#F2F2F7',
        borderRadius: 12,
    },
});
