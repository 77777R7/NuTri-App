const LOW_SIGNAL_MORNING = /^morning\s*\(with breakfast\)\.?$/i;

export type TimingSuggestionSource = "label" | "general";
export type TimingSuggestionKind =
  | "meal_based"
  | "post_workout"
  | "between_meals"
  | "bedtime"
  | "anytime"
  | "before_meals"
  | "after_meals"
  | "unknown";
export type TimingReasonKind = "label_says_with_meals" | "fat_soluble" | "reduce_nausea" | "unknown";

export type TimingSuggestion = {
  text: string;
  source: TimingSuggestionSource;
  kind: TimingSuggestionKind;
  withFood: boolean;
  reasonKind: TimingReasonKind;
};

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const pickFirstText = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    if (isText(value)) return value.trim();
  }
  return "";
};

const sanitizeTiming = (timing: string | null | undefined): string | null => {
  const text = isText(timing) ? timing.trim() : "";
  if (!text) return null;
  if (LOW_SIGNAL_MORNING.test(text)) return null;
  return text;
};

export const normalizeTimingText = (timing: string | null | undefined): string | null => {
  const raw = isText(timing) ? timing.trim() : "";
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/[.!?]+$/g, "").trim();

  if (/\bmorning\s+or\s+dinner\b/.test(normalized) && /\b(with|after)\s+(a\s+)?meals?\b/.test(normalized)) {
    return "Breakfast or dinner (with a meal)";
  }

  const hasTimeWindow = /\b(morning|afternoon|evening|bedtime|night|dinner|lunch|breakfast|post-workout|anytime)\b/.test(
    normalized,
  );

  if (!hasTimeWindow) {
    if (/\bwith\b\s+(a\s+)?meals?\b/.test(normalized) || /\bafter\b\s+meals?\b/.test(normalized)) {
      return "Anytime (with meals)";
    }
    if (/\bbefore\b\s+meals?\b/.test(normalized)) {
      return "Anytime (before meals)";
    }
  }

  return raw;
};

const stripMealParenthetical = (text: string): string =>
  text
    .replace(/\s*\((with|before|after)\s+[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();

const inferTimingKind = (text: string): TimingSuggestionKind => {
  const normalized = text.toLowerCase();
  if (/\bpost[-\s]?workout\b/.test(normalized)) return "post_workout";
  if (/\bbetween meals\b/.test(normalized)) return "between_meals";
  if (/\bbedtime\b/.test(normalized)) return "bedtime";
  if (/\bbefore meals\b/.test(normalized) || /\(before meals\)/.test(normalized)) return "before_meals";
  if (/\bafter meals\b/.test(normalized)) return "after_meals";
  if (/\bbreakfast\b|\blunch\b|\bdinner\b|\bmorning\b|\bevening\b/.test(normalized)) return "meal_based";
  if (/\banytime\b/.test(normalized)) return "anytime";
  return "unknown";
};

export const buildTimingSuggestion = (params: {
  factsStatus: "full" | "partial" | "none";
  labelRawText?: string | null;
  usageTiming?: string | null;
  factsTimingHint?: string | null;
  fallbackTiming: string;
  usageWithFood?: boolean | null;
  factsWithMeals?: boolean | null;
  fallbackWithFood: boolean;
  usageWithFoodReason?: string | null;
  labelHasWithMealsSignal?: boolean;
  activeNames?: string[];
}): TimingSuggestion => {
  const labelRaw = isText(params.labelRawText) ? params.labelRawText.trim() : "";
  const sourceForcedGeneral = params.factsStatus === "partial" && !labelRaw;

  const baseTiming = pickFirstText(
    sanitizeTiming(params.usageTiming),
    params.factsTimingHint,
    params.fallbackTiming,
  );
  const normalizedText = normalizeTimingText(baseTiming) ?? "Anytime";
  const baselineWithFood =
    typeof params.usageWithFood === "boolean"
      ? params.usageWithFood
      : typeof params.factsWithMeals === "boolean"
      ? params.factsWithMeals
      : params.fallbackWithFood;

  const analysisReason = isText(params.usageWithFoodReason) ? params.usageWithFoodReason.trim() : "";
  const labelHasMeals = Boolean(params.labelHasWithMealsSignal);
  const names = (params.activeNames ?? []).map((name) => name.toLowerCase().trim());

  let reasonKind: TimingReasonKind = "unknown";
  if (analysisReason === "label_says_with_meals" && labelHasMeals) {
    reasonKind = "label_says_with_meals";
  } else if (analysisReason === "fat_soluble" || analysisReason === "reduce_nausea") {
    reasonKind = analysisReason;
  } else if (labelHasMeals) {
    reasonKind = "label_says_with_meals";
  } else if (names.some((n) => n.includes("astaxanthin") || n.includes("vitamin d"))) {
    reasonKind = "fat_soluble";
  } else if (names.some((n) => n === "zinc" || n === "iron" || n === "magnesium")) {
    reasonKind = "reduce_nausea";
  }

  const labelSignalsPresent =
    !!labelRaw && (labelHasMeals || Boolean(params.factsTimingHint) || typeof params.factsWithMeals === "boolean");
  const source: TimingSuggestionSource = sourceForcedGeneral ? "general" : labelSignalsPresent ? "label" : "general";

  if (source !== "label" && reasonKind === "label_says_with_meals") {
    reasonKind = "unknown";
  }

  let withFood = baselineWithFood;
  if (source === "general") {
    if (reasonKind === "fat_soluble" || reasonKind === "reduce_nausea") {
      withFood = true;
    } else if (reasonKind === "unknown") {
      withFood = false;
    }
  }

  const displayText = withFood ? normalizedText : stripMealParenthetical(normalizedText);

  return {
    text: displayText || "Anytime",
    source,
    kind: inferTimingKind(normalizedText),
    withFood,
    reasonKind,
  };
};
