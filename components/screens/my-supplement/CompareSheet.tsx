import React, { useCallback, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { X } from "lucide-react-native";

import {
  formatGoalFitConfidenceValue,
  summarizeGoalFitReasons,
} from "@/lib/personalization/goalFitCopy";
import { getGoalDisplayLabel } from "@/lib/personalization/uiLabels";
import type { GoalCompareEntry } from "@/types/personalization";

const FIT_PRIORITY: Record<GoalCompareEntry["tier"], number> = {
  strong_match: 4,
  related: 3,
  weak_match: 2,
  no_match: 1,
  not_enough_structured_data: 0,
};

const EVIDENCE_PRIORITY: Record<GoalCompareEntry["confidence"]["evidence"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const LABEL_PRIORITY: Record<GoalCompareEntry["confidence"]["labelCompleteness"], number> = {
  full: 3,
  partial: 2,
  weak: 1,
};

const OVERLAP_PRIORITY: Record<GoalCompareEntry["confidence"]["overlapRisk"], number> = {
  none: 3,
  watch: 2,
  high: 1,
};

const ROUTINE_PRIORITY: Record<GoalCompareEntry["confidence"]["routineFit"], number> = {
  easy: 3,
  moderate: 2,
  complex: 1,
};

const buildKeyDifferences = (
  entry: GoalCompareEntry,
  currentEntry: GoalCompareEntry | undefined,
  goalLabel: string,
) => {
  if (!currentEntry || entry.productId === currentEntry.productId) {
    return [`Your current reference point for ${goalLabel}.`];
  }

  const highlights: string[] = [];
  const fitDelta = FIT_PRIORITY[entry.tier] - FIT_PRIORITY[currentEntry.tier];
  if (fitDelta > 0) {
    highlights.push(`Stronger match for ${goalLabel} than your current pick.`);
  } else if (fitDelta < 0) {
    highlights.push(`Lower priority for ${goalLabel} than your current pick.`);
  }

  const evidenceDelta =
    EVIDENCE_PRIORITY[entry.confidence.evidence] - EVIDENCE_PRIORITY[currentEntry.confidence.evidence];
  if (evidenceDelta > 0) {
    highlights.push("Stronger goal-specific evidence signal.");
  } else if (evidenceDelta < 0) {
    highlights.push("Goal-specific evidence is lighter than your current pick.");
  }

  const labelDelta =
    LABEL_PRIORITY[entry.confidence.labelCompleteness] -
    LABEL_PRIORITY[currentEntry.confidence.labelCompleteness];
  if (labelDelta > 0) {
    highlights.push("Cleaner label disclosure.");
  } else if (labelDelta < 0) {
    highlights.push("More label gaps than your current pick.");
  }

  const overlapDelta =
    OVERLAP_PRIORITY[entry.confidence.overlapRisk] - OVERLAP_PRIORITY[currentEntry.confidence.overlapRisk];
  if (overlapDelta > 0) {
    highlights.push("Lower overlap risk in your current stack.");
  } else if (overlapDelta < 0) {
    highlights.push("Higher overlap risk in your current stack.");
  }

  const routineDelta =
    ROUTINE_PRIORITY[entry.confidence.routineFit] - ROUTINE_PRIORITY[currentEntry.confidence.routineFit];
  if (routineDelta > 0) {
    highlights.push("Easier to keep as a daily routine.");
  } else if (routineDelta < 0) {
    highlights.push("A little harder to keep daily.");
  }

  return highlights.slice(0, 3);
};

export function CompareSheet({
  visible,
  entries,
  goalKey,
  onClose,
  tintColor,
}: {
  visible: boolean;
  entries: GoalCompareEntry[];
  goalKey?: GoalCompareEntry["goalKey"];
  onClose: () => void;
  tintColor?: string;
}) {
  const goalLabel = goalKey ? getGoalDisplayLabel(goalKey) : "your current goal";
  const currentEntry = entries[0];
  const [expandedEntryIds, setExpandedEntryIds] = useState<Record<string, boolean>>({});
  const toggleDetails = useCallback((productId: string) => {
    setExpandedEntryIds((current) => ({
      ...current,
      [productId]: !current[productId],
    }));
  }, []);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFillObject} />
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.eyebrow}>See differences</Text>
              <Text style={styles.title}>What changes between these picks for {goalLabel}</Text>
              <Text style={styles.subtitle}>
                Only the biggest differences are shown first.
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <X size={18} color="#0f172a" />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {entries.map((entry, index) => (
              <View key={entry.productId} style={styles.entryGlassBlock}>
                <View
                  style={[
                    StyleSheet.absoluteFillObject,
                    { backgroundColor: tintColor ?? "rgba(147,197,253,0.42)" },
                  ]}
                />
                <View style={styles.entryGlassRing}>
                  <BlurView intensity={24} tint="light" style={StyleSheet.absoluteFillObject} />
                  <View style={styles.entryGlassRingBorder} />
                  <LinearGradient
                    colors={[
                      "rgba(255,255,255,0.40)",
                      "rgba(255,255,255,0.12)",
                      "rgba(255,255,255,0.00)",
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <View pointerEvents="none" style={styles.entryGlassHighlightEdge} />
                </View>

                <View style={styles.entryContent}>
                  {(() => {
                    const detailsVisible = expandedEntryIds[entry.productId] ?? false;
                    const hasAdvancedDetails =
                      entry.whyNotStronger.length > 0 ||
                      entry.holdbacks.length > 0 ||
                      entry.confidence.labelCompleteness !== "full" ||
                      entry.confidence.overlapRisk !== "none" ||
                      entry.confidence.routineFit !== "easy";

                    return (
                      <>
                  <View style={styles.metricGrid}>
                    {buildKeyDifferences(entry, currentEntry, goalLabel).map((highlight, highlightIndex) => (
                      <View key={`${entry.productId}-highlight-${highlightIndex}`} style={styles.highlightPill}>
                        <Text style={styles.highlightPillText}>{highlight}</Text>
                      </View>
                    ))}
                  </View>

                  <View style={styles.entryHeader}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.entryTitle}>{entry.title ?? "Saved supplement"}</Text>
                      <Text style={styles.entryMeta}>
                        {[entry.brandName, entry.dosageText].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                    {index === 0 ? (
                      <View style={styles.currentBadge}>
                        <Text style={styles.currentBadgeText}>Current</Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.summaryBlock}>
                    <Text style={styles.summaryLabel}>Why it fits</Text>
                    <Text style={styles.summaryText}>
                      {summarizeGoalFitReasons(entry.whyFit, "No strong fit reason surfaced.")}
                    </Text>
                  </View>

                  {detailsVisible ? (
                    <>
                      <View style={styles.detailDivider} />
                      <View style={styles.detailFactsRow}>
                        <Text style={styles.detailFact}>
                          Label: {formatGoalFitConfidenceValue(entry.confidence.labelCompleteness)}
                        </Text>
                        <Text style={styles.detailFact}>
                          Overlap: {formatGoalFitConfidenceValue(entry.confidence.overlapRisk)}
                        </Text>
                        <Text style={styles.detailFact}>
                          Routine: {formatGoalFitConfidenceValue(entry.confidence.routineFit)}
                        </Text>
                      </View>
                      <View style={styles.summaryBlock}>
                        <Text style={styles.summaryLabel}>Why it is not stronger</Text>
                      <Text style={styles.summaryText}>
                        {summarizeGoalFitReasons(
                          entry.whyNotStronger,
                          "It looks relevant, but it is not moving above our stronger picks yet.",
                        )}
                      </Text>
                      </View>
                      {entry.holdbacks.length > 0 ? (
                        <View style={styles.summaryBlock}>
                          <Text style={styles.summaryLabel}>What may need a closer look</Text>
                          <Text style={styles.summaryText}>
                            {summarizeGoalFitReasons(
                              entry.holdbacks,
                              "No major holdback stands out on the current label.",
                            )}
                          </Text>
                        </View>
                      ) : null}
                    </>
                  ) : null}

                  {hasAdvancedDetails ? (
                    <Pressable
                      onPress={() => toggleDetails(entry.productId)}
                      style={styles.detailToggle}
                    >
                      <Text style={styles.detailToggleText}>
                        {detailsVisible ? "Show less" : "See full reasoning"}
                      </Text>
                    </Pressable>
                  ) : null}
                      </>
                    );
                  })()}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15,23,42,0.28)",
  },
  sheet: {
    maxHeight: "78%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderCurve: "continuous",
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#eef2f7",
  },
  headerTextWrap: { flex: 1, gap: 4 },
  eyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#2563eb",
    includeFontPadding: false,
  },
  title: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    color: "#475569",
    includeFontPadding: false,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderCurve: "continuous",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { flexGrow: 0 },
  scrollContent: { padding: 20, gap: 14 },
  entryGlassBlock: {
    minHeight: 220,
    borderRadius: 40,
    borderCurve: "continuous",
    overflow: "hidden",
    position: "relative",
  },
  entryGlassRing: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 36,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.20)",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2,
  },
  entryGlassHighlightEdge: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 36,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  entryGlassRingBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.30)",
  },
  entryContent: {
    minHeight: 220,
    paddingHorizontal: 32,
    paddingVertical: 32,
    justifyContent: "flex-start",
    gap: 14,
  },
  entryHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  entryTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  entryMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: "#64748b",
    includeFontPadding: false,
  },
  currentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderCurve: "continuous",
    backgroundColor: "#dbeafe",
  },
  currentBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    color: "#1d4ed8",
    includeFontPadding: false,
  },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  highlightPill: {
    borderRadius: 999,
    borderCurve: "continuous",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.78)",
    borderWidth: 1,
    borderColor: "rgba(191,219,254,0.92)",
  },
  highlightPillText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    color: "#1d4ed8",
    includeFontPadding: false,
  },
  detailDivider: {
    height: 1,
    backgroundColor: "rgba(148,163,184,0.18)",
  },
  detailFactsRow: {
    gap: 4,
  },
  detailFact: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    color: "#475569",
    includeFontPadding: false,
  },
  summaryBlock: { gap: 4 },
  summaryLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: "#1e293b",
    includeFontPadding: false,
  },
  summaryText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    color: "#334155",
    includeFontPadding: false,
  },
  detailToggle: {
    minHeight: 38,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    borderRadius: 999,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.88)",
    borderWidth: 1,
    borderColor: "rgba(203,213,225,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  detailToggleText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
});
