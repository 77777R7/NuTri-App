import React from "react";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ConfidenceBadge } from "@/components/screens/personalization/ConfidenceBadge";
import {
  formatGoalFitConfidenceValue,
  GOAL_FIT_TIER_LABELS,
  summarizeGoalFitReasons,
} from "@/lib/personalization/goalFitCopy";
import type { GoalNavigatorCandidate } from "@/types/personalization";

export function GoalNavigatorResultCard({
  candidate,
  tintColor,
  saved,
  onOpen,
  onSave,
}: {
  candidate: GoalNavigatorCandidate;
  tintColor: string;
  saved: boolean;
  onOpen: () => void;
  onSave: () => void;
}) {
  const display = candidate.evaluation.display;

  return (
    <View style={styles.glassBlock}>
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: tintColor }]} />
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
            <Text style={styles.title}>{display?.title ?? "Coverage-ready supplement"}</Text>
            <Text style={styles.meta}>
              {[display?.brandName, display?.dosageText].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <View style={styles.fitBadge}>
            <Text style={styles.fitBadgeText}>{GOAL_FIT_TIER_LABELS[candidate.tier]}</Text>
          </View>
        </View>

        <View style={styles.metricRow}>
          <ConfidenceBadge
            label="Evidence"
            value={formatGoalFitConfidenceValue(candidate.goalFitCard.confidence.evidence)}
          />
          <ConfidenceBadge
            label="Label"
            value={formatGoalFitConfidenceValue(candidate.goalFitCard.confidence.labelCompleteness)}
          />
          <ConfidenceBadge
            label="Routine"
            value={formatGoalFitConfidenceValue(candidate.goalFitCard.confidence.routineFit)}
          />
        </View>

        <Text style={styles.summaryText}>
          {summarizeGoalFitReasons(candidate.goalFitCard.whyFit, "Structured facts show a usable fit signal.")}
        </Text>

        <View style={styles.actionRow}>
          <Pressable onPress={onOpen} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>View fit details</Text>
          </Pressable>
          <Pressable
            onPress={onSave}
            style={[styles.secondaryButton, saved && styles.secondaryButtonSaved]}
            disabled={saved}
          >
            <Text style={[styles.secondaryButtonText, saved && styles.secondaryButtonTextSaved]}>
              {saved ? "Saved" : "Save"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  glassBlock: {
    minHeight: 210,
    borderRadius: 36,
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
    borderRadius: 32,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.20)",
  },
  glassRingBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.30)",
  },
  glassHighlightEdge: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 32,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  content: {
    minHeight: 210,
    paddingHorizontal: 28,
    paddingVertical: 28,
    gap: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  headerTextWrap: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: "#64748b",
    includeFontPadding: false,
  },
  fitBadge: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(191,219,254,0.92)",
    justifyContent: "center",
  },
  fitBadgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: "#1d4ed8",
    includeFontPadding: false,
  },
  metricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  summaryText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: "#334155",
    includeFontPadding: false,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: "#ffffff",
    includeFontPadding: false,
  },
  secondaryButton: {
    minWidth: 92,
    minHeight: 44,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.88)",
    borderWidth: 1,
    borderColor: "rgba(203,213,225,0.95)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  secondaryButtonSaved: {
    backgroundColor: "#dbeafe",
    borderColor: "rgba(96,165,250,0.54)",
  },
  secondaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  secondaryButtonTextSaved: {
    color: "#1d4ed8",
  },
});
