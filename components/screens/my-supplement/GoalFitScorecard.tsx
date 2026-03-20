import React from "react";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ConfidenceBadge } from "@/components/screens/personalization/ConfidenceBadge";
import {
  formatGoalFitConfidenceValue,
  formatGoalFitReason,
  GOAL_FIT_TIER_LABELS,
} from "@/lib/personalization/goalFitCopy";
import { getGoalDisplayLabel } from "@/lib/personalization/uiLabels";
import type { DecisionReason, GoalFitCard } from "@/types/personalization";

const renderReasonList = (title: string, reasons: DecisionReason[]) => {
  if (reasons.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.reasonList}>
        {reasons.slice(0, 3).map((reason, index) => (
          <View
            key={`${reason.code}-${index}`}
            style={styles.reasonRow}
          >
            <View style={styles.bullet} />
            <Text style={styles.reasonText}>{formatGoalFitReason(reason)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

export function GoalFitScorecard({
  card,
  onOpenCompare,
  compareEnabled,
  tintColor,
}: {
  card: GoalFitCard;
  onOpenCompare?: () => void;
  compareEnabled?: boolean;
  tintColor?: string;
}) {
  const goalLabel = card.goalKey ? getGoalDisplayLabel(card.goalKey) : "your current goal";

  return (
    <View style={styles.glassBlock}>
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: tintColor ?? "rgba(147,197,253,0.42)" }]} />
      <View style={styles.glassRing}>
        <BlurView intensity={24} tint="light" style={StyleSheet.absoluteFillObject} />
        <View style={styles.glassRingBorder} />
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
        <View pointerEvents="none" style={styles.glassHighlightEdge} />
      </View>

      <View style={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.eyebrow}>Goal-Fit Scorecard</Text>
            <Text style={styles.title}>How this fits {goalLabel}</Text>
          </View>
        </View>

        <View style={styles.confidenceGrid}>
          <ConfidenceBadge label="Fit" value={GOAL_FIT_TIER_LABELS[card.tier]} />
          <ConfidenceBadge
            label="Evidence"
            value={formatGoalFitConfidenceValue(card.confidence.evidence)}
          />
          <ConfidenceBadge
            label="Label"
            value={formatGoalFitConfidenceValue(card.confidence.labelCompleteness)}
          />
          <ConfidenceBadge
            label="Overlap"
            value={formatGoalFitConfidenceValue(card.confidence.overlapRisk)}
          />
          <ConfidenceBadge
            label="Routine"
            value={formatGoalFitConfidenceValue(card.confidence.routineFit)}
          />
        </View>

        {renderReasonList("Why it fits", card.whyFit)}
        {renderReasonList("Why it is not stronger", card.whyNotStronger)}
        {renderReasonList("What holds it back", card.holdbacks)}
        {renderReasonList("What changes in my current stack", card.stackContext ?? [])}

        {compareEnabled && onOpenCompare ? (
          <Pressable onPress={onOpenCompare} style={styles.compareButton}>
            <Text style={styles.compareButtonText}>Compare similar picks</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  glassBlock: {
    marginTop: 18,
    minHeight: 220,
    borderRadius: 40,
    borderCurve: "continuous",
    overflow: "hidden",
    position: "relative",
  },
  glassRing: {
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
  glassHighlightEdge: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 36,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  glassRingBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.30)",
  },
  content: {
    minHeight: 220,
    paddingHorizontal: 32,
    paddingVertical: 32,
    justifyContent: "flex-start",
    gap: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
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
    lineHeight: 26,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  confidenceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  reasonList: { gap: 8 },
  reasonRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bullet: {
    width: 6,
    height: 6,
    marginTop: 7,
    borderRadius: 999,
    backgroundColor: "#60a5fa",
  },
  reasonText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    color: "#334155",
    includeFontPadding: false,
  },
  compareButton: {
    minHeight: 44,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  compareButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: "#ffffff",
    includeFontPadding: false,
  },
});
