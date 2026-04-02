import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  getDecisionModifierDisplayLabel,
  getDietLaneDisplayLabel,
  getReviewBundleDisplayLabel,
  getTimingAnchorDisplayLabel,
} from "@/lib/personalization/uiLabels";
import type { ActivityPlan, DietReviewLane } from "@/types/personalization";

const formatFocusAreas = (focusAreas?: string[]) =>
  (focusAreas ?? [])
    .map((area) => area.trim())
    .filter(Boolean)
    .join(", ");

export function GoalNavigatorContextCard({
  dietLanes,
  activityPlan,
}: {
  dietLanes: DietReviewLane[];
  activityPlan: ActivityPlan;
}) {
  const primaryDietLane = dietLanes[0];
  const dietBundleLabel = getReviewBundleDisplayLabel(primaryDietLane?.reviewBundleKey);
  const dietFocusAreas = formatFocusAreas(primaryDietLane?.focusAreas);
  const activityBundleLabel = getReviewBundleDisplayLabel(activityPlan.reviewBundleKey);
  const activityModifierLabel = getDecisionModifierDisplayLabel(activityPlan.decisionModifier);
  const activityAnchorLabel = activityPlan.suggestedTimingAnchors[0]
    ? getTimingAnchorDisplayLabel(activityPlan.suggestedTimingAnchors[0])
    : null;

  if (!primaryDietLane && !activityBundleLabel && !activityModifierLabel && !activityAnchorLabel) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Why these are forward</Text>
      <Text style={styles.title}>Diet and activity are shaping this pass.</Text>

      {primaryDietLane ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Diet review bundle</Text>
          <Text style={styles.sectionBody}>
            {getDietLaneDisplayLabel(primaryDietLane.laneKey)}
            {dietBundleLabel ? ` is compiling through ${dietBundleLabel.toLowerCase()}` : " is active"}
            {dietFocusAreas ? ` and is putting extra weight on ${dietFocusAreas}` : ""}.
          </Text>
        </View>
      ) : null}

      {activityBundleLabel || activityModifierLabel || activityAnchorLabel ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Activity modifier</Text>
          <Text style={styles.sectionBody}>
            {activityModifierLabel ?? "Your activity plan"} is nudging picks
            {activityBundleLabel ? ` through ${activityBundleLabel.toLowerCase()}` : ""}
            {activityAnchorLabel ? ` and making ${activityAnchorLabel.toLowerCase()} the most natural anchor` : ""}.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: 1,
    borderColor: "rgba(226,232,240,0.9)",
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 10,
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
  section: {
    gap: 4,
  },
  sectionTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  sectionBody: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    color: "#475569",
    includeFontPadding: false,
  },
});
