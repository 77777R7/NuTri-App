import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { ConfidenceBadge } from "@/components/screens/personalization/ConfidenceBadge";
import {
  formatGoalFitConfidenceValue,
  summarizeGoalFitReasons,
} from "@/lib/personalization/goalFitCopy";
import {
  getDecisionModifierDisplayLabel,
  getDietLaneDisplayLabel,
  getReviewBundleDisplayLabel,
  getDecisionModeDisplayLabel,
  getSupportStateDisplayLabel,
  getTimingAnchorDisplayLabel,
} from "@/lib/personalization/uiLabels";
import type {
  ActivityPlan,
  DietReviewLane,
  PreferenceVector,
  StackAudit,
} from "@/types/personalization";

const formatFocusAreas = (focusAreas?: string[]) =>
  (focusAreas ?? [])
    .map((area) => area.trim())
    .filter(Boolean)
    .join(", ");

export function StackAuditCard({
  audit,
  preferenceVector,
  dietLanes,
  activityPlan,
}: {
  audit: StackAudit;
  preferenceVector: PreferenceVector;
  dietLanes?: DietReviewLane[];
  activityPlan?: ActivityPlan;
}) {
  const primaryDietLane = dietLanes?.[0];
  const dietBundleLabel = getReviewBundleDisplayLabel(primaryDietLane?.reviewBundleKey);
  const dietFocusAreas = formatFocusAreas(primaryDietLane?.focusAreas);
  const activityBundleLabel = getReviewBundleDisplayLabel(activityPlan?.reviewBundleKey);
  const activityModifierLabel = getDecisionModifierDisplayLabel(activityPlan?.decisionModifier);
  const activityAnchorLabel = activityPlan?.suggestedTimingAnchors[0]
    ? getTimingAnchorDisplayLabel(activityPlan.suggestedTimingAnchors[0])
    : null;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Stack Audit</Text>
      <Text style={styles.title}>{audit.headline}</Text>
      <Text style={styles.body}>{audit.summary}</Text>

      <View style={styles.metricRow}>
        <ConfidenceBadge label="State" value={getSupportStateDisplayLabel(audit.supportState)} />
        <ConfidenceBadge
          label="Overlap"
          value={formatGoalFitConfidenceValue(audit.overlapRisk)}
        />
        <ConfidenceBadge
          label="Mode"
          value={getDecisionModeDisplayLabel(preferenceVector.decisionMode)}
        />
      </View>

      {primaryDietLane || activityBundleLabel || activityModifierLabel || activityAnchorLabel ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bundle steering</Text>
          {primaryDietLane ? (
            <Text style={styles.rowBody}>
              {getDietLaneDisplayLabel(primaryDietLane.laneKey)}
              {dietBundleLabel ? ` is running through ${dietBundleLabel.toLowerCase()}` : " is active"}
              {dietFocusAreas ? ` and is biasing this stack toward ${dietFocusAreas}` : ""}.
            </Text>
          ) : null}
          {activityBundleLabel || activityModifierLabel || activityAnchorLabel ? (
            <Text style={styles.rowBody}>
              {activityModifierLabel ?? "Your activity plan"} is shaping selection
              {activityBundleLabel ? ` through ${activityBundleLabel.toLowerCase()}` : ""}
              {activityAnchorLabel ? ` with ${activityAnchorLabel.toLowerCase()} as the easiest anchor` : ""}.
            </Text>
          ) : null}
        </View>
      ) : null}

      {audit.kept.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Kept forward</Text>
          {audit.kept.map((item) => (
            <View key={item.productId} style={styles.row}>
              <Text style={styles.rowTitle}>{item.title ?? item.productId}</Text>
              <Text style={styles.rowBody}>
                {summarizeGoalFitReasons(item.reasons, "Structured fit signals kept this forward.")}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {audit.heldBack.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Held back</Text>
          {audit.heldBack.map((item) => (
            <View key={item.productId} style={styles.row}>
              <Text style={styles.rowTitle}>{item.title ?? item.productId}</Text>
              <Text style={styles.rowBody}>
                {summarizeGoalFitReasons(
                  item.reasons,
                  "We are holding this back until the label or safety signal is stronger.",
                )}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 28,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: 1,
    borderColor: "rgba(203,213,225,0.9)",
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 12,
  },
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
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    color: "#475569",
    includeFontPadding: false,
  },
  metricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  row: {
    gap: 3,
    paddingTop: 2,
  },
  rowTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  rowBody: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: "#475569",
    includeFontPadding: false,
  },
});
