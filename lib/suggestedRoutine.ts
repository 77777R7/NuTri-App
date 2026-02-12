export type SuggestedRoutineSlotLabel = "Breakfast" | "Lunch" | "Dinner" | "Bedtime";

export type SuggestedRoutineSlot = {
  label: SuggestedRoutineSlotLabel;
  time: string;
  withFood: boolean;
};

export type SuggestedRoutineV0 = {
  slots: SuggestedRoutineSlot[];
  rationale: string;
  confidence: "high" | "medium" | "low";
  source: "label" | "heuristic";
  whenToTake: string;
  howToTake: string;
};

type ParsedDirections = {
  timesPerDay: number | null;
  withMeals: boolean | null;
  timingHints: Array<"morning" | "evening" | "bedtime" | "with_meals" | "before_meals" | "after_meals">;
};

const SLOT_BASE_TIMES: Record<SuggestedRoutineSlotLabel, string[]> = {
  Breakfast: ["08:00", "09:30"],
  Lunch: ["12:30", "14:00"],
  Dinner: ["18:30", "20:30", "22:00"],
  Bedtime: ["22:00"],
};

const clampTimesPerDay = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 1) return null;
  return Math.min(4, rounded);
};

const defaultLabelsForTimesPerDay = (timesPerDay: number): SuggestedRoutineSlotLabel[] => {
  if (timesPerDay <= 1) return ["Dinner"];
  if (timesPerDay === 2) return ["Breakfast", "Dinner"];
  if (timesPerDay === 3) return ["Breakfast", "Lunch", "Dinner"];
  return ["Breakfast", "Lunch", "Dinner", "Bedtime"];
};

const labelsFromHints = (
  hints: ParsedDirections["timingHints"],
  timesPerDay: number | null,
): SuggestedRoutineSlotLabel[] => {
  const count = timesPerDay ?? 1;

  if (hints.includes("bedtime")) {
    if (count > 1) {
      const rest = defaultLabelsForTimesPerDay(Math.max(1, count - 1)).filter((label) => label !== "Bedtime");
      return ["Bedtime", ...rest];
    }
    return ["Bedtime"];
  }
  if (hints.includes("evening")) return ["Dinner"];
  if (hints.includes("morning")) return ["Breakfast"];
  if (hints.includes("with_meals") || hints.includes("after_meals")) return ["Dinner"];
  if (hints.includes("before_meals")) return ["Breakfast"];
  return ["Dinner"];
};

const assignSlots = (labels: SuggestedRoutineSlotLabel[], withFood: boolean): SuggestedRoutineSlot[] => {
  const counts: Record<SuggestedRoutineSlotLabel, number> = {
    Breakfast: 0,
    Lunch: 0,
    Dinner: 0,
    Bedtime: 0,
  };

  return labels.map((label) => {
    const idx = counts[label];
    counts[label] += 1;
    const candidates = SLOT_BASE_TIMES[label];
    const time = candidates[Math.min(idx, candidates.length - 1)];
    return { label, time, withFood };
  });
};

const uniqueLabels = (labels: SuggestedRoutineSlotLabel[]): SuggestedRoutineSlotLabel[] => {
  const out: SuggestedRoutineSlotLabel[] = [];
  const seen = new Set<SuggestedRoutineSlotLabel>();
  for (const label of labels) {
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
};

export const buildSuggestedRoutineV0 = (params: {
  parsed: ParsedDirections | null | undefined;
  parseConfidence: number | null | undefined;
  rawDirectionsText: string | null | undefined;
  withFoodFallback: boolean;
}): SuggestedRoutineV0 => {
  const parsed = params.parsed ?? {
    timesPerDay: null,
    withMeals: null,
    timingHints: [],
  };
  const hints = parsed.timingHints ?? [];
  const timesPerDay = clampTimesPerDay(parsed.timesPerDay);
  const hasLabelSignal =
    Boolean((params.rawDirectionsText ?? "").trim()) ||
    timesPerDay !== null ||
    parsed.withMeals !== null ||
    hints.length > 0;

  const withFood = parsed.withMeals === null ? params.withFoodFallback : parsed.withMeals;
  const preferredLabels = timesPerDay ? defaultLabelsForTimesPerDay(timesPerDay) : labelsFromHints(hints, timesPerDay);

  let labels = [...preferredLabels];
  if (hints.length > 0) {
    labels = labelsFromHints(hints, timesPerDay ?? preferredLabels.length);
    if (timesPerDay && labels.length < timesPerDay) {
      const filler = defaultLabelsForTimesPerDay(timesPerDay);
      while (labels.length < timesPerDay) labels.push(filler[labels.length] ?? "Dinner");
    }
  }

  if (withFood) {
    labels = labels.map((label) => (label === "Bedtime" ? "Dinner" : label));
  }

  const slots = assignSlots(labels, withFood);
  const whenToTake = uniqueLabels(slots.map((slot) => slot.label)).join(" + ");
  const howToTake = hints.includes("before_meals")
    ? "Before meals when possible"
    : withFood
    ? "With meals"
    : "Empty stomach if tolerated";

  const rationale = (() => {
    const raw = (params.rawDirectionsText ?? "").trim();
    if (raw) return `Based on label: ${raw}`;
    if (timesPerDay) return `Based on parsed frequency: ${timesPerDay} ${timesPerDay === 1 ? "time" : "times"} daily.`;
    if (hints.length > 0) return "Based on label timing hints.";
    return "Heuristic suggestion from available facts.";
  })();

  const parseConfidence = typeof params.parseConfidence === "number" ? params.parseConfidence : 0;
  const confidence: SuggestedRoutineV0["confidence"] =
    timesPerDay !== null && parseConfidence >= 0.6 ? "high" : timesPerDay !== null || hints.length > 0 ? "medium" : "low";

  return {
    slots,
    rationale,
    confidence,
    source: hasLabelSignal ? "label" : "heuristic",
    whenToTake: whenToTake || "Dinner",
    howToTake,
  };
};
