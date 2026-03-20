import React from "react";
import { useLocalSearchParams } from "expo-router";

import { GoalNavigatorScreen } from "@/components/screens/personalization/GoalNavigatorScreen";

export default function GoalNavigatorPage() {
  const params = useLocalSearchParams<{ goal?: string }>();

  return <GoalNavigatorScreen initialGoal={params.goal} />;
}
