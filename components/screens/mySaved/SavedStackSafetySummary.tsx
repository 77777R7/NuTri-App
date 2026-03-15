import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { StackLevelSafetySummary, StackSafetyMeta } from "./types";

const statusLabel = (status: StackLevelSafetySummary["status"]): string | null => {
  if (status === "over") return "Over UL";
  if (status === "near") return "Near UL";
  if (status === "below") return "Below UL";
  if (status === "not_comparable") return "Estimate only";
  if (status === "no_ul_established") return "Reference only";
  return null;
};

export function SavedStackSafetySummary({
  summary,
  meta,
}: {
  summary: StackLevelSafetySummary;
  meta?: StackSafetyMeta | null;
}) {
  if (!summary.headline) return null;

  const badgeLabel = statusLabel(summary.status);
  const metaLines = [
    meta?.estimateBasisSummary ?? null,
    meta?.hiddenGroupNote ?? null,
    meta?.skippedSupplementNote ?? null,
  ].filter((line): line is string => Boolean(line));

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.headline}>{summary.headline}</Text>
        {badgeLabel ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badgeLabel}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.detailWrap}>
        {summary.detailLines.map((line) => (
          <View key={line} style={styles.bulletRow}>
            <View style={styles.bulletDot} />
            <Text style={styles.detailText}>{line}</Text>
          </View>
        ))}
      </View>
      {metaLines.length > 0 ? (
        <View style={styles.metaWrap}>
          {metaLines.map((line) => (
            <Text key={line} style={styles.metaText}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.14)",
    backgroundColor: "rgba(255,255,255,0.70)",
    padding: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headline: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "800",
    color: "#111827",
    includeFontPadding: false,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(239,68,68,0.10)",
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    color: "#b91c1c",
    includeFontPadding: false,
  },
  detailWrap: {
    gap: 8,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  bulletDot: {
    width: 6,
    height: 6,
    marginTop: 7,
    borderRadius: 999,
    backgroundColor: "#ef4444",
  },
  detailText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: "#475569",
    includeFontPadding: false,
  },
  metaWrap: {
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    color: "#64748b",
    includeFontPadding: false,
  },
});
