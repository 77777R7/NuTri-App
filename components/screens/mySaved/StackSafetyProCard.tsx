import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronRight, Lock, ShieldCheck, TriangleAlert } from "lucide-react-native";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { StackDuplicateGroup, StackLevelSafetySummary, StackSafetyMeta } from "./types";
import { buildStackSafetyProCardViewModel, type StackSafetyCardTone } from "./stackSafetyPresentation";

const toneAccent: Record<StackSafetyCardTone, string> = {
  locked: "#0f172a",
  over: "#b91c1c",
  near: "#b45309",
  below: "#1d4ed8",
  overlap: "#475569",
  clear: "#047857",
  limited: "#475569",
};

const toneTint: Record<StackSafetyCardTone, string> = {
  locked: "rgba(15,23,42,0.08)",
  over: "rgba(239,68,68,0.10)",
  near: "rgba(245,158,11,0.12)",
  below: "rgba(37,99,235,0.10)",
  overlap: "rgba(100,116,139,0.10)",
  clear: "rgba(16,185,129,0.10)",
  limited: "rgba(100,116,139,0.10)",
};

export function StackSafetyProCard({
  isPremium,
  savedCount,
  overlapCount,
  summary,
  duplicateGroups,
  meta,
  onPress,
}: {
  isPremium: boolean;
  savedCount: number;
  overlapCount: number;
  summary?: StackLevelSafetySummary | null;
  duplicateGroups?: StackDuplicateGroup[];
  meta?: StackSafetyMeta | null;
  onPress: () => void;
}) {
  const vm = useMemo(
    () =>
      buildStackSafetyProCardViewModel({
        isPremium,
        savedCount,
        overlapCount,
        summary,
        duplicateGroups,
        meta,
      }),
    [duplicateGroups, isPremium, meta, overlapCount, savedCount, summary],
  );
  const accent = toneAccent[vm.tone];
  const tint = toneTint[vm.tone];
  const Icon = vm.tone === "over" || vm.tone === "near" ? TriangleAlert : vm.tone === "locked" ? Lock : ShieldCheck;

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressed]} onPress={onPress}>
      <BlurView intensity={18} tint="light" style={StyleSheet.absoluteFillObject} />
      <LinearGradient
        colors={["rgba(255,255,255,0.88)", "rgba(255,255,255,0.62)", "rgba(255,255,255,0.40)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        colors={[tint, "rgba(255,255,255,0)"]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.inner}>
        <View style={styles.iconWrap}>
          <Icon size={18} color={accent} />
        </View>
        <View style={styles.textWrap}>
          <View style={styles.eyebrowRow}>
            <Text style={styles.eyebrow}>{vm.eyebrow}</Text>
            <View style={[styles.badge, { backgroundColor: tint }]}>
              <Text style={[styles.badgeText, { color: accent }]}>{vm.badge}</Text>
            </View>
          </View>
          <Text style={styles.title}>{vm.title}</Text>
          <Text style={styles.body}>{vm.body}</Text>
          {vm.evidenceLine ? <Text style={styles.evidence}>{vm.evidenceLine}</Text> : null}
        </View>
        <View style={styles.chevronWrap}>
          <ChevronRight size={18} color="#64748b" />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderRadius: 28,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.70)",
    backgroundColor: "rgba(255,255,255,0.72)",
    shadowColor: "#0f172a",
    shadowOpacity: 0.09,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  cardPressed: {
    transform: [{ scale: 0.99 }],
  },
  inner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    padding: 16,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 999,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.78)",
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
    gap: 7,
  },
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: "#64748b",
    includeFontPadding: false,
  },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderCurve: "continuous",
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "900",
    includeFontPadding: false,
  },
  title: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
    color: "#0f172a",
    includeFontPadding: false,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: "#64748b",
    includeFontPadding: false,
  },
  evidence: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: "#475569",
    includeFontPadding: false,
  },
  chevronWrap: {
    paddingTop: 12,
  },
});
