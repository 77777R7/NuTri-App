import { Activity, AlertTriangle, Check, Shield, Zap } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type ContentSection = {
    verdict: string;
    highlights: string[];
    warnings?: string[];
};

type ScoreDetailCardProps = {
    category: 'effectiveness' | 'safety' | 'practicality';
    score: number;
    maxScore?: number;
    description: ContentSection;
    color: string;
};

export const ScoreDetailCard = ({
    category,
    score,
    maxScore = 10,
    description,
    color,
}: ScoreDetailCardProps) => {
    const Icon = category === 'effectiveness' ? Zap : category === 'safety' ? Shield : Activity;
    const label = category === 'practicality' ? 'Practicality' : category.charAt(0).toUpperCase() + category.slice(1);

    // Calculate progress percentage
    const progress = Math.min(Math.max(score / maxScore, 0), 1);

    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <View style={[styles.iconBox, { backgroundColor: `${color}20` }]}>
                    <Icon size={20} color={color} />
                </View>
                <Text style={styles.title}>{label}</Text>
                <View style={styles.scoreBadge}>
                    <Text style={[styles.scoreValue, { color }]}>{score.toFixed(1)}</Text>
                    <Text style={styles.scoreMax}>/{maxScore}</Text>
                </View>
            </View>

            <View style={styles.progressContainer}>
                <View style={styles.track} />
                <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: color }]} />
            </View>

            <View style={styles.content}>
                {/* Verdict */}
                <Text style={styles.verdict}>{description.verdict}</Text>

                {/* Highlights */}
                {description.highlights.length > 0 && (
                    <View style={styles.section}>
                        {description.highlights.map((item, index) => (
                            <View key={`highlight-${index}`} style={styles.bulletRow}>
                                <Check size={16} color="#10b981" style={styles.bulletIcon} />
                                <Text style={styles.bulletText}>{item}</Text>
                            </View>
                        ))}
                    </View>
                )}

                {/* Warnings */}
                {description.warnings && description.warnings.length > 0 && (
                    <View style={[styles.section, styles.warningSection]}>
                        {description.warnings.map((item, index) => (
                            <View key={`warning-${index}`} style={styles.bulletRow}>
                                <AlertTriangle size={16} color="#f59e0b" style={styles.bulletIcon} />
                                <Text style={styles.warningText}>{item}</Text>
                            </View>
                        ))}
                    </View>
                )}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 20,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#f4f4f5',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    iconBox: {
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: '#111827',
        flex: 1,
    },
    scoreBadge: {
        flexDirection: 'row',
        alignItems: 'baseline',
        backgroundColor: '#f9fafb',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 10,
    },
    scoreValue: {
        fontSize: 18,
        fontWeight: '800',
    },
    scoreMax: {
        fontSize: 12,
        color: '#9ca3af',
        fontWeight: '600',
        marginLeft: 2,
    },
    progressContainer: {
        height: 8,
        borderRadius: 4,
        backgroundColor: '#f4f4f5',
        marginBottom: 16,
        overflow: 'hidden',
        position: 'relative',
    },
    track: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#f4f4f5',
    },
    fill: {
        height: '100%',
        borderRadius: 4,
    },
    content: {
        gap: 12,
    },
    verdict: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1f2937',
        lineHeight: 24,
    },
    section: {
        gap: 8,
        marginTop: 4,
    },
    warningSection: {
        marginTop: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
    },
    bulletRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
    },
    bulletIcon: {
        marginTop: 3,
    },
    bulletText: {
        fontSize: 14,
        color: '#4b5563',
        lineHeight: 20,
        flex: 1,
    },
    warningText: {
        fontSize: 14,
        color: '#b45309',
        lineHeight: 20,
        flex: 1,
    },
});
