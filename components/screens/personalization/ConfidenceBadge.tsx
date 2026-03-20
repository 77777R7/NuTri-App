import React from "react";
import { StyleSheet, Text, View } from "react-native";

export function ConfidenceBadge({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.chip}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    minWidth: 82,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 14,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.88)",
    borderWidth: 1,
    borderColor: "rgba(203,213,225,0.95)",
    gap: 2,
  },
  label: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "800",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    includeFontPadding: false,
  },
  value: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
});
