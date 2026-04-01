import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { X } from "lucide-react-native";

import {
  summarizeGoalFitReasons,
} from "@/lib/personalization/goalFitCopy";
import {
  getDecisionModifierDisplayLabel,
  getDietLaneDisplayLabel,
  getReviewBundleDisplayLabel,
  getTimingAnchorDisplayLabel,
} from "@/lib/personalization/uiLabels";
import type {
  ActivityPlan,
  DietReviewLane,
  StackAudit,
} from "@/types/personalization";

const formatFocusAreas = (focusAreas?: string[]) =>
  (focusAreas ?? [])
    .map((area) => area.trim())
    .filter(Boolean)
    .join(", ");

export function StackAuditCard({
  audit,
  dietLanes,
  activityPlan,
}: {
  audit: StackAudit;
  dietLanes?: DietReviewLane[];
  activityPlan?: ActivityPlan;
}) {
  const [detailsVisible, setDetailsVisible] = useState(false);
  const primaryDietLane = dietLanes?.[0];
  const dietBundleLabel = getReviewBundleDisplayLabel(primaryDietLane?.reviewBundleKey);
  const dietFocusAreas = formatFocusAreas(primaryDietLane?.focusAreas);
  const activityBundleLabel = getReviewBundleDisplayLabel(activityPlan?.reviewBundleKey);
  const activityModifierLabel = getDecisionModifierDisplayLabel(activityPlan?.decisionModifier);
  const activityAnchorLabel = activityPlan?.suggestedTimingAnchors[0]
    ? getTimingAnchorDisplayLabel(activityPlan.suggestedTimingAnchors[0])
    : null;

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Why these picks?</Text>
        <Text style={styles.title}>{audit.headline}</Text>
        <Text style={styles.body}>
          Open this if you want the fuller story behind these picks.
        </Text>
        <Pressable onPress={() => setDetailsVisible(true)} style={styles.openButton}>
          <Text style={styles.openButtonText}>See details</Text>
        </Pressable>
      </View>

      <Modal visible={detailsVisible} transparent animationType="fade" onRequestClose={() => setDetailsVisible(false)}>
        <View style={styles.overlay}>
          <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFillObject} />
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setDetailsVisible(false)} />

          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderTextWrap}>
                <Text style={styles.eyebrow}>Why these picks?</Text>
                <Text style={styles.title}>{audit.headline}</Text>
                <Text style={styles.body}>{audit.summary}</Text>
              </View>
              <Pressable onPress={() => setDetailsVisible(false)} style={styles.closeButton}>
                <X size={18} color="#0f172a" />
              </Pressable>
            </View>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {primaryDietLane || activityBundleLabel || activityModifierLabel || activityAnchorLabel ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Context</Text>
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
                  <Text style={styles.sectionTitle}>Still forward</Text>
                  {audit.kept.map((item) => (
                    <View key={item.productId} style={styles.row}>
                      <Text style={styles.rowTitle}>{item.title ?? item.productId}</Text>
                      <Text style={styles.rowBody}>
                        {summarizeGoalFitReasons(
                          item.reasons,
                          "We kept this forward because the label gives us enough clear fit signals.",
                        )}
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
                          "We are holding this back until the label is clearer or the safety signal is stronger.",
                        )}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
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
  sheetHeader: {
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
  sheetHeaderTextWrap: {
    flex: 1,
    gap: 4,
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
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 24,
    gap: 14,
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
  openButton: {
    minHeight: 42,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    borderRadius: 999,
    borderCurve: "continuous",
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  openButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: "#ffffff",
    includeFontPadding: false,
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
