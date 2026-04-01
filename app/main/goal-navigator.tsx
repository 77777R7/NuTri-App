import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";

import { GoalNavigatorScreen } from "@/components/screens/personalization/GoalNavigatorScreen";
import { PERSONALIZATION_RESEARCH_UI_ENABLED } from "@/lib/personalization/researchFlags";

export default function GoalNavigatorPage() {
  const params = useLocalSearchParams<{ goal?: string }>();

  if (!PERSONALIZATION_RESEARCH_UI_ENABLED) {
    return <Redirect href="/main" />;
  }

  return <GoalNavigatorScreen initialGoal={params.goal} />;
}
