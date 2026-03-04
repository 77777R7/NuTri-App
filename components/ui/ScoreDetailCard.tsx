import { Activity, AlertTriangle, Check, Shield, Zap } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type ContentSection = {
    verdict: string;
    highlights: string[];
    warnings?: string[];
    templateLoading?: boolean;
    templateSections?: Array<{
        title: string;
        items: Array<{
            label: string;
            status: 'verified' | 'missing' | 'unknown';
        }>;
    }>;
};

type ScoreDetailCardProps = {
    category: 'effectiveness' | 'safety' | 'practicality';
    score: number;
    maxScore?: number;
    description: ContentSection;
    color: string;
    valueLabel?: string;
    labelOverride?: string;
};

export const ScoreDetailCard = ({
    category,
    score,
    maxScore = 100,  // Changed from 10 to 100 - scores are now in 0-100 range
    description,
    color,
    valueLabel,
    labelOverride,
}: ScoreDetailCardProps) => {
    const Icon = category === 'effectiveness' ? Zap : category === 'safety' ? Shield : Activity;
    const label = labelOverride || (
        category === 'practicality'
            ? (valueLabel || 'Value')
            : category.charAt(0).toUpperCase() + category.slice(1)
    );
    const templateSections = Array.isArray(description.templateSections)
        ? description.templateSections
        : [];
    const hasTemplateSections = templateSections.length > 0;
    const templateLoading = description.templateLoading === true;

    const checklistSymbol = (status: 'verified' | 'missing' | 'unknown'): string => {
        if (status === 'verified') return '✅';
        if (status === 'missing') return '⛔';
        return '◻';
    };

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
                    <Text style={[styles.scoreValue, { color }]}>{Math.round(score)}</Text>
                    <Text style={styles.scoreMax}>/{maxScore}</Text>
                </View>
            </View>

            <View style={styles.progressContainer}>
                <View style={styles.track} />
                <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: color }]} />
            </View>

            <View style={styles.content}>
                {/* Verdict */}
                <Text style={styles.verdict} numberOfLines={3}>{description.verdict}</Text>

                {templateLoading ? (
                    <View style={styles.section}>
                        {[0, 1].map((sectionIdx) => (
                            <View
                                key={`template-skeleton-${sectionIdx}`}
                                style={sectionIdx > 0 ? styles.templateSectionWithGap : null}
                            >
                                <View style={styles.templateSkeletonTitle} />
                                {[0, 1, 2].map((itemIdx) => (
                                    <View key={`template-skeleton-item-${sectionIdx}-${itemIdx}`} style={styles.templateSkeletonRow}>
                                        <View style={styles.templateSkeletonIcon} />
                                        <View style={styles.templateSkeletonLine} />
                                    </View>
                                ))}
                            </View>
                        ))}
                    </View>
                ) : hasTemplateSections ? (
                    <View style={styles.section}>
                        {templateSections.map((section, sectionIdx) => (
                            <View
                                key={`template-section-${sectionIdx}`}
                                style={sectionIdx > 0 ? styles.templateSectionWithGap : null}
                            >
                                <Text style={styles.templateSectionTitle}>{section.title}</Text>
                                {section.items.map((item, itemIdx) => (
                                    <Text key={`template-item-${sectionIdx}-${itemIdx}`} style={styles.templateChecklistItemText}>
                                        {checklistSymbol(item.status)} {item.label}
                                    </Text>
                                ))}
                            </View>
                        ))}
                    </View>
                ) : (
                    <>
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
                    </>
                )}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 0,
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
        alignItems: 'flex-start',
        marginBottom: 12,
        gap: 8,
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
        flexShrink: 1,
        minWidth: 0,
    },
    scoreBadge: {
        flexDirection: 'row',
        alignItems: 'baseline',
        backgroundColor: '#f9fafb',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 10,
        marginLeft: 4,
        flexShrink: 0,
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
        fontSize: 15,
        fontWeight: '600',
        color: '#1f2937',
        lineHeight: 22,
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
        width: '100%',
    },
    bulletIcon: {
        marginTop: 3,
    },
    bulletText: {
        fontSize: 14,
        color: '#4b5563',
        lineHeight: 20,
        flex: 1,
        flexShrink: 1,
        minWidth: 0,
    },
    warningText: {
        fontSize: 14,
        color: '#b45309',
        lineHeight: 20,
        flex: 1,
        flexShrink: 1,
        minWidth: 0,
    },
    templateSectionWithGap: {
        marginTop: 10,
    },
    templateSectionTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: '#111827',
        marginBottom: 8,
    },
    templateChecklistItemText: {
        fontSize: 14,
        color: '#374151',
        lineHeight: 22,
        marginBottom: 4,
    },
    templateSkeletonTitle: {
        width: '55%',
        height: 14,
        borderRadius: 6,
        backgroundColor: '#E5E7EB',
        marginBottom: 10,
    },
    templateSkeletonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
    },
    templateSkeletonIcon: {
        width: 16,
        height: 16,
        borderRadius: 3,
        backgroundColor: '#E5E7EB',
    },
    templateSkeletonLine: {
        flex: 1,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#F3F4F6',
    },
});
