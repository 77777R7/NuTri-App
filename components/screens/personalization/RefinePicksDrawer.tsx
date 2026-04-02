import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { SlidersHorizontal, X } from "lucide-react-native";

import { CritiqueChipBar } from "@/components/screens/personalization/CritiqueChipBar";
import type { PersonalizationControlKey, PreferenceVector } from "@/types/personalization";

type TriggerVariant = "button" | "pill";

export function RefinePicksDrawer({
  preferenceVector,
  onToggleChip,
  helperText = "Only change this if you want a different kind of result.",
  triggerLabel = "Refine picks",
  variant = "button",
}: {
  preferenceVector: PreferenceVector;
  onToggleChip: (input: { key: PersonalizationControlKey; active: boolean }) => void;
  helperText?: string;
  triggerLabel?: string;
  variant?: TriggerVariant;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        style={variant === "pill" ? styles.pillTrigger : styles.buttonTrigger}
      >
        <SlidersHorizontal size={16} color="#0f172a" />
        <Text style={variant === "pill" ? styles.pillTriggerText : styles.buttonTriggerText}>
          {triggerLabel}
        </Text>
      </Pressable>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay}>
          <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFillObject} />
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setVisible(false)} />

          <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={styles.headerTextWrap}>
                <Text style={styles.eyebrow}>Refine picks</Text>
                <Text style={styles.title}>Adjust how these picks lean.</Text>
                <Text style={styles.body}>{helperText}</Text>
              </View>
              <Pressable onPress={() => setVisible(false)} style={styles.closeButton}>
                <X size={18} color="#0f172a" />
              </Pressable>
            </View>

            <View style={styles.content}>
              <CritiqueChipBar
                preferenceVector={preferenceVector}
                onToggleChip={onToggleChip}
                showLabel={false}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15,23,42,0.28)",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderCurve: "continuous",
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  header: {
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
  headerTextWrap: {
    flex: 1,
    gap: 4,
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
    fontSize: 20,
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
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderCurve: "continuous",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 24,
  },
  buttonTrigger: {
    minHeight: 42,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.88)",
    borderWidth: 1,
    borderColor: "rgba(203,213,225,0.9)",
  },
  buttonTriggerText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
  pillTrigger: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.88)",
    borderWidth: 1,
    borderColor: "rgba(203,213,225,0.95)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  pillTriggerText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: "#0f172a",
    includeFontPadding: false,
  },
});
