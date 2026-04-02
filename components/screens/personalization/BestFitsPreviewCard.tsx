import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { ArrowRight } from "lucide-react-native";

type PreviewItem = {
  id: string;
  title: string;
  summary: string;
};

export function BestFitsPreviewCard({
  goalLabel,
  items,
  loading,
  onOpenGoalNavigator,
  secondaryAction,
}: {
  goalLabel: string;
  items: PreviewItem[];
  loading: boolean;
  onOpenGoalNavigator: () => void;
  secondaryAction?: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Personalized picks</Text>
      <Text style={styles.title}>Best fits for {goalLabel}</Text>
      <Text style={styles.body}>
        Start with the strongest next picks for this goal.
      </Text>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color="#2563eb" />
          <Text style={styles.loadingText}>Finding your clearest next picks…</Text>
        </View>
      ) : items.length > 0 ? (
        <View style={styles.list}>
          {items.map((item, index) => (
            <View key={item.id} style={[styles.itemRow, index > 0 ? styles.itemRowBorder : null]}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              <Text style={styles.itemSummary}>{item.summary}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>We do not have clear picks ready yet.</Text>
          <Text style={styles.emptyBody}>
            Open Explore by goal to see what is ready now and what still needs clearer label detail.
          </Text>
        </View>
      )}

      <View style={styles.actionRow}>
        <Pressable onPress={onOpenGoalNavigator} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Explore by goal</Text>
          <ArrowRight size={16} color="#ffffff" />
        </Pressable>
        {secondaryAction}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 28,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.96)",
    borderWidth: 1,
    borderColor: "rgba(226,232,240,0.9)",
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
    fontSize: 22,
    lineHeight: 28,
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
  loadingRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: "#475569",
    includeFontPadding: false,
  },
  list: {
    borderRadius: 20,
    borderCurve: "continuous",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "rgba(226,232,240,0.8)",
    overflow: "hidden",
  },
  itemRow: {
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  itemRowBorder: {
    borderTopWidth: 1,
    borderTopColor: "rgba(226,232,240,0.8)",
  },
  itemTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  itemSummary: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    color: "#475569",
    includeFontPadding: false,
  },
  emptyState: {
    gap: 4,
    paddingHorizontal: 2,
    paddingVertical: 8,
  },
  emptyTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  emptyBody: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    color: "#475569",
    includeFontPadding: false,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
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
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: "#ffffff",
    includeFontPadding: false,
  },
});
