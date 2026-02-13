import type { MealTimePrefs } from "./storage/meal-time-prefs";
import type { TimingSuggestionKind } from "./timingSuggestion";

export type SuggestedRoutineSlotLabel = "Breakfast" | "Lunch" | "Dinner" | "Bedtime" | "Flexible";

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
  timingKind: TimingSuggestionKind;
  requiresManualTime: boolean;
  displayMode: "single_anchor" | "choice_slots" | "flexible";
  timesPerDaySuggested: number;
  timesPerDaySource: "label" | "heuristic" | "unknown";
  applyAnchor: SuggestedRoutineSlot;
  applyNotice: string | null;
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
  Flexible: ["18:30"],
};

const isValidTime = (time: string | null | undefined): time is string =>
  typeof time === "string" && /^\d{2}:\d{2}$/.test(time.trim());

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

const resolveSlotTimes = (
  label: SuggestedRoutineSlotLabel,
  mealTimePrefs?: MealTimePrefs | null,
): string[] => {
  const fallback = SLOT_BASE_TIMES[label];
  if (!mealTimePrefs) return fallback;
  const override =
    label === "Breakfast"
      ? mealTimePrefs.breakfast
      : label === "Lunch"
      ? mealTimePrefs.lunch
      : label === "Dinner"
      ? mealTimePrefs.dinner
      : mealTimePrefs.bedtime;
  if (!isValidTime(override)) return fallback;
  return [override, ...fallback.filter((candidate) => candidate !== override)];
};

const assignSlots = (
  labels: SuggestedRoutineSlotLabel[],
  withFood: boolean,
  mealTimePrefs?: MealTimePrefs | null,
): SuggestedRoutineSlot[] => {
  const counts: Record<SuggestedRoutineSlotLabel, number> = {
    Breakfast: 0,
    Lunch: 0,
    Dinner: 0,
    Bedtime: 0,
    Flexible: 0,
  };

  return labels.map((label) => {
    const idx = counts[label];
    counts[label] += 1;
    const candidates = resolveSlotTimes(label, mealTimePrefs);
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

const parseMinutes = (timeText: string | null | undefined): number | null => {
  const text = typeof timeText === "string" ? timeText.trim() : "";
  if (!/^\d{2}:\d{2}$/.test(text)) return null;
  const [hText, mText] = text.split(":");
  const hour = Number.parseInt(hText, 10);
  const minute = Number.parseInt(mText, 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
};

const circularMinutesDistance = (a: number, b: number): number => {
  const diff = Math.abs(a - b);
  return Math.min(diff, 24 * 60 - diff);
};

const pickAnchorSlot = (slots: SuggestedRoutineSlot[], params: {
  existingRoutineTime?: string | null;
  existingTimeUserSet?: boolean;
}): SuggestedRoutineSlot => {
  const firstSlot = slots[0] ?? { label: "Dinner", time: "18:30", withFood: true };
  if (!slots.length) return firstSlot;

  if (params.existingTimeUserSet) {
    const existingMinutes = parseMinutes(params.existingRoutineTime);
    if (existingMinutes != null) {
      let bestSlot = slots[0];
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const slot of slots) {
        const slotMinutes = parseMinutes(slot.time);
        if (slotMinutes == null) continue;
        const distance = circularMinutesDistance(existingMinutes, slotMinutes);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestSlot = slot;
        }
      }
      return bestSlot;
    }
  }

  return slots.find((slot) => slot.label === "Dinner") ?? firstSlot;
};

const labelsFromTimingKind = (timingKind: TimingSuggestionKind): SuggestedRoutineSlotLabel[] | null => {
  if (timingKind === "post_workout" || timingKind === "between_meals") return ["Flexible"];
  if (timingKind === "bedtime") return ["Bedtime"];
  if (timingKind === "meal_based") return ["Breakfast", "Dinner"];
  if (timingKind === "before_meals") return ["Breakfast"];
  if (timingKind === "after_meals") return ["Dinner"];
  if (timingKind === "anytime") return ["Dinner"];
  return null;
};

const toWhenToTakeText = (timingKind: TimingSuggestionKind, labels: SuggestedRoutineSlotLabel[]): string => {
  if (timingKind === "post_workout") return "Post-workout";
  if (timingKind === "between_meals") return "Between meals";
  if (timingKind === "bedtime") return "Bedtime";
  if (timingKind === "before_meals") return "Before meals";
  if (timingKind === "after_meals") return "After meals";
  if (timingKind === "meal_based") return "Breakfast + Dinner";
  if (timingKind === "anytime") return "Anytime";

  const deduped = uniqueLabels(labels);
  const text = deduped.join(" + ");
  return text || "Dinner";
};

export const buildSuggestedRoutineV0 = (params: {
  parsed: ParsedDirections | null | undefined;
  parseConfidence: number | null | undefined;
  rawDirectionsText: string | null | undefined;
  withFoodFallback: boolean;
  timingKind?: TimingSuggestionKind;
  existingRoutineTime?: string | null;
  existingTimeUserSet?: boolean;
  mealTimePrefs?: MealTimePrefs | null;
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
  const labelFromKind = labelsFromTimingKind(params.timingKind ?? "unknown");
  const preferredLabels = labelFromKind ?? (timesPerDay ? defaultLabelsForTimesPerDay(timesPerDay) : labelsFromHints(hints, timesPerDay));

  let labels = [...preferredLabels];
  if (!labelFromKind && hints.length > 0) {
    labels = labelsFromHints(hints, timesPerDay ?? preferredLabels.length);
    if (timesPerDay && labels.length < timesPerDay) {
      const filler = defaultLabelsForTimesPerDay(timesPerDay);
      while (labels.length < timesPerDay) labels.push(filler[labels.length] ?? "Dinner");
    }
  }

  if (withFood) {
    labels = labels.map((label) => (label === "Bedtime" ? "Dinner" : label));
  }

  const slots = assignSlots(labels, withFood, params.mealTimePrefs ?? null);
  const requiresManualTime = slots.some((slot) => slot.label === "Flexible");
  const applyAnchor = pickAnchorSlot(slots, {
    existingRoutineTime: params.existingRoutineTime ?? null,
    existingTimeUserSet: Boolean(params.existingTimeUserSet),
  });
  const slotLabels = slots.map((slot) => slot.label);
  const baseWhenToTake = toWhenToTakeText(params.timingKind ?? "unknown", slotLabels);
  const howToTake = requiresManualTime
    ? "Around your workout or between meals"
    : hints.includes("before_meals")
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
  const timesPerDaySource: SuggestedRoutineV0["timesPerDaySource"] =
    timesPerDay !== null && parseConfidence >= 0.6 && (hints.length > 0 || Boolean((params.rawDirectionsText ?? "").trim()))
      ? "label"
      : timesPerDay !== null || hints.length > 0
      ? "heuristic"
      : "unknown";
  const rawTimesPerDaySuggested = Math.max(1, timesPerDay ?? slots.length ?? 1);
  // Trust guardrail: only label-backed frequency may claim multi-dose cadence.
  const timesPerDaySuggested = timesPerDaySource === "label" ? rawTimesPerDaySuggested : 1;
  const hasBreakfastDinnerChoice =
    uniqueLabels(slotLabels).includes("Breakfast") &&
    uniqueLabels(slotLabels).includes("Dinner") &&
    params.timingKind === "meal_based";
  const displayMode: SuggestedRoutineV0["displayMode"] = requiresManualTime
    ? "flexible"
    : hasBreakfastDinnerChoice && timesPerDaySource !== "label"
    ? "choice_slots"
    : "single_anchor";
  const whenToTake = displayMode === "choice_slots" ? "Breakfast or Dinner" : baseWhenToTake;
  const anchorLabel = `${applyAnchor.label} (${applyAnchor.time})`;
  const applyNotice = (() => {
    if (requiresManualTime) {
      return timesPerDaySource === "label" && timesPerDaySuggested > 1
        ? `We'll save one reminder at your chosen time. Label suggests ${timesPerDaySuggested}x daily.`
        : "We'll save one reminder at your chosen time.";
    }
    if (timesPerDaySource === "label" && timesPerDaySuggested > 1) {
      return `We'll save one reminder at ${anchorLabel}. Label suggests ${timesPerDaySuggested}x daily.`;
    }
    if (displayMode === "choice_slots") {
      return `We'll save one reminder at ${anchorLabel}. Choose breakfast or dinner.`;
    }
    return `We'll save one reminder at ${anchorLabel}.`;
  })();

  return {
    slots,
    rationale,
    confidence,
    source: hasLabelSignal ? "label" : "heuristic",
    timingKind: params.timingKind ?? "unknown",
    requiresManualTime,
    displayMode,
    timesPerDaySuggested,
    timesPerDaySource,
    applyAnchor,
    applyNotice,
    whenToTake: whenToTake || "Dinner",
    howToTake,
  };
};
