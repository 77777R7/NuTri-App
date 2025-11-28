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
    descriptions: {
        effectiveness: ContentSection;
        safety: ContentSection;
        practicality: ContentSection;
    };
};

export const InteractiveScoreRing = ({ scores, descriptions }: InteractiveScoreRingProps) => {
    const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

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
        p1.value = withDelay(100, withTiming(scores.effectiveness / 100, { duration: 1500, easing: Easing.out(Easing.exp) }));
        p2.value = withDelay(300, withTiming(scores.safety / 100, { duration: 1500, easing: Easing.out(Easing.exp) }));
        p3.value = withDelay(500, withTiming(scores.value / 100, { duration: 1500, easing: Easing.out(Easing.exp) }));
    }, [scores]);

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
        setSelectedCategory(category);
    };

    const handleClose = () => {
        setSelectedCategory(null);
    };

    const getOverlayData = () => {
        if (!selectedCategory) return null;
        switch (selectedCategory) {
            case 'effectiveness':
                return { score: scores.effectiveness, desc: descriptions.effectiveness, color: '#FA114F', title: 'Effectiveness' };
            case 'safety':
                return { score: scores.safety, desc: descriptions.safety, color: '#A6E533', title: 'Safety' };
            case 'practicality':
                return { score: scores.value, desc: descriptions.practicality, color: '#00DBDD', title: 'Value' };
        }
    };

    const overlayData = getOverlayData();

    return (
        <View style={styles.container}>
            <View style={styles.overallRow}>
                <View style={styles.overallScoreContainer}>
                    <Text style={styles.overallLabel}>NUTRI SCORE</Text>
                    <Text style={styles.overallValue}>
                        {Math.round(scores.overall)}
                        <Text style={styles.overallMax}>/100</Text>
                    </Text>
                </View>
            </View>

            <View style={styles.contentRow}>
                {/* Left Side: Rings */}
                <View style={styles.ringWrapper}>
                    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                        <Defs>
                            <LinearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
                                <Stop offset="0%" stopColor="#FA114F" />
                                <Stop offset="100%" stopColor="#FF4F80" />
                            </LinearGradient>
                            <LinearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="0%">
                                <Stop offset="0%" stopColor="#A6E533" />
                                <Stop offset="100%" stopColor="#CFFF60" />
                            </LinearGradient>
                            <LinearGradient id="grad3" x1="0%" y1="0%" x2="100%" y2="0%">
                                <Stop offset="0%" stopColor="#00DBDD" />
                                <Stop offset="100%" stopColor="#50F0F2" />
                            </LinearGradient>
                        </Defs>

                        {/* Background Tracks */}
                        <G rotation="-90" origin={`${center}, ${center}`}>
                            <Circle cx={center} cy={center} r={r1} stroke="rgba(250, 17, 79, 0.15)" strokeWidth={strokeWidth} fill="none" />
                            <Circle cx={center} cy={center} r={r2} stroke="rgba(166, 229, 51, 0.2)" strokeWidth={strokeWidth} fill="none" />
                            <Circle cx={center} cy={center} r={r3} stroke="rgba(0, 219, 221, 0.15)" strokeWidth={strokeWidth} fill="none" />

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
                        <TouchableOpacity style={styles.legendItem} onPress={() => handlePress('effectiveness')}>
                            <View style={[styles.legendIcon, { backgroundColor: '#FA114F' }]} />
                            <View style={styles.legendContent}>
                                <Text style={styles.legendTitle} numberOfLines={1}>Effectiveness</Text>
                                <Text style={styles.legendScore} numberOfLines={1}>{Math.round(scores.effectiveness)}/100</Text>
                            </View>
                            <ChevronRight size={16} color="#C7C7CC" />
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.legendItem} onPress={() => handlePress('safety')}>
                            <View style={[styles.legendIcon, { backgroundColor: '#A6E533' }]} />
                            <View style={styles.legendContent}>
                                <Text style={styles.legendTitle} numberOfLines={1}>Safety</Text>
                                <Text style={styles.legendScore} numberOfLines={1}>{Math.round(scores.safety)}/100</Text>
                            </View>
                            <ChevronRight size={16} color="#C7C7CC" />
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.legendItem} onPress={() => handlePress('practicality')}>
                            <View style={[styles.legendIcon, { backgroundColor: '#00DBDD' }]} />
                            <View style={styles.legendContent}>
                                <Text style={styles.legendTitle} numberOfLines={1}>Value</Text>
                                <Text style={styles.legendScore} numberOfLines={1}>{Math.round(scores.value)}/100</Text>
                            </View>
                            <ChevronRight size={16} color="#C7C7CC" />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            {/* Overlay Window */}
            {selectedCategory && overlayData && (
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
        justifyContent: 'flex-end',
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
