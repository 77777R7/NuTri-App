import React from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { getGoalDisplayLabel } from "@/lib/personalization/uiLabels";
import type { GoalKey } from "@/types/personalization";

export function GoalNavigatorGoalTabs({
  goals,
  selectedGoal,
  onSelectGoal,
}: {
  goals: GoalKey[];
  selectedGoal: GoalKey;
  onSelectGoal: (goalKey: GoalKey) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {goals.map((goalKey) => {
        const active = goalKey === selectedGoal;
        return (
          <Pressable
            key={goalKey}
            onPress={() => onSelectGoal(goalKey)}
            style={[styles.tab, active && styles.tabActive]}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>
              {getGoalDisplayLabel(goalKey)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 10,
    paddingBottom: 4,
  },
  tab: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.88)",
    borderWidth: 1,
    borderColor: "rgba(203,213,225,0.88)",
    alignItems: "center",
    justifyContent: "center",
  },
  tabActive: {
    backgroundColor: "#dbeafe",
    borderColor: "rgba(96,165,250,0.54)",
  },
  tabText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: "#334155",
    includeFontPadding: false,
  },
  tabTextActive: {
    color: "#1d4ed8",
  },
});
