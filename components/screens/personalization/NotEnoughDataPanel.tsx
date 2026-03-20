import React from "react";
import { StyleSheet, Text, View } from "react-native";

export function NotEnoughDataPanel({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <View style={styles.panel}>
      <Text style={styles.eyebrow}>Coverage note</Text>
      <Text style={styles.title}>We held back {count} products with weaker structured data.</Text>
      <Text style={styles.body}>
        Goal Navigator only ranks products when the label data is complete enough to explain why they fit.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 24,
    borderCurve: "continuous",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(226,232,240,0.9)",
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 8,
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
    fontSize: 16,
    lineHeight: 22,
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
});
