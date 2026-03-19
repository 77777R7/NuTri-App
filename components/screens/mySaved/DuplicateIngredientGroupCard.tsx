import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { StackDuplicateGroup } from "./types";

const statusLabel = (status: StackDuplicateGroup["status"]): string => {
  if (status === "over") return "Over UL";
  if (status === "near") return "Near UL";
  if (status === "below") return "Below UL";
  if (status === "not_comparable") return "Not comparable";
  return "Reference only";
};

export function DuplicateIngredientGroupCard({ group }: { group: StackDuplicateGroup }) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{group.ingredientDisplayName}</Text>
          <Text style={styles.subtitle}>
            {group.productCount} product{group.productCount === 1 ? "" : "s"} detected
          </Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{statusLabel(group.status)}</Text>
        </View>
      </View>

      <View style={styles.summaryRow}>
        <Text style={styles.summaryText}>
          Estimated total: {group.estimatedTotalDoseText ?? "Not enough data"}
        </Text>
        <Text style={styles.summaryText}>
          UL: {group.ulValueText ?? "No UL established"}
        </Text>
      </View>

      <View style={styles.productList}>
        {group.products.map((product) => (
          <View key={`${group.ingredientCanonicalKey}:${product.supplementId}`} style={styles.productRow}>
            <View style={styles.productBullet} />
            <View style={styles.productCopy}>
              <Text style={styles.productName}>{product.productName}</Text>
              <Text style={styles.productDose}>
                {product.dailyEstimatedDoseText ?? product.rawDoseText ?? "Dose unavailable"}
                {product.dailyDoseBasisLabel ? ` · ${product.dailyDoseBasisLabel}` : ""}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {group.scopeNote ? <Text style={styles.scopeNote}>{group.scopeNote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    backgroundColor: "rgba(255,255,255,0.62)",
    padding: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  titleWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: "#64748b",
    includeFontPadding: false,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(15,23,42,0.06)",
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    color: "#334155",
    includeFontPadding: false,
  },
  summaryRow: {
    gap: 4,
  },
  summaryText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: "#1f2937",
    includeFontPadding: false,
  },
  productList: {
    gap: 10,
  },
  productRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  productBullet: {
    width: 6,
    height: 6,
    borderRadius: 999,
    marginTop: 7,
    backgroundColor: "#94a3b8",
  },
  productCopy: {
    flex: 1,
    gap: 2,
  },
  productName: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "700",
    color: "#334155",
    includeFontPadding: false,
  },
  productDose: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    color: "#64748b",
    includeFontPadding: false,
  },
  scopeNote: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    color: "#64748b",
    includeFontPadding: false,
  },
});
