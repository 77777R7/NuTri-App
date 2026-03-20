import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { listPersonalizationControlChips } from "@/lib/personalization/core/critiqueEngine";
import type { PersonalizationControlKey, PreferenceVector } from "@/types/personalization";

export function CritiqueChipBar({
  preferenceVector,
  onToggleChip,
}: {
  preferenceVector: PreferenceVector;
  onToggleChip: (input: { key: PersonalizationControlKey; active: boolean }) => void;
}) {
  const chips = listPersonalizationControlChips(preferenceVector);

  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>Steer Personalization</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {chips.map((chip) => (
          <Pressable
            key={chip.key}
            onPress={() => onToggleChip({ key: chip.key, active: chip.active })}
            style={[styles.chip, chip.active && styles.chipActive]}
          >
            <Text style={[styles.chipText, chip.active && styles.chipTextActive]}>
              {chip.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
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
  row: {
    gap: 10,
    paddingBottom: 2,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.88)",
    borderWidth: 1,
    borderColor: "rgba(203,213,225,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: "#dbeafe",
    borderColor: "rgba(96,165,250,0.54)",
  },
  chipText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: "#334155",
    includeFontPadding: false,
  },
  chipTextActive: {
    color: "#1d4ed8",
  },
});
