import type { SuggestedRoutineV0, SuggestedRoutineSlot } from "@/lib/suggestedRoutine";

type ApplyCopyInput = Pick<
  SuggestedRoutineV0,
  "requiresManualTime" | "timesPerDaySource" | "timesPerDaySuggested" | "displayMode"
> & {
  anchor: SuggestedRoutineSlot;
};

type AutosyncInput = {
  itemId: string;
  factsDigestHash: string | null;
  savedTime: string | null;
  timeTouched: boolean;
  requiresManualTime: boolean;
  anchor: SuggestedRoutineSlot;
  lastSyncKey: string | null;
};

export const buildApplyCopy = (
  input: ApplyCopyInput,
): { buttonText: string; notice: string | null } => {
  if (input.requiresManualTime) {
    return {
      buttonText: "Save chosen reminder",
      notice:
        input.timesPerDaySource === "label" && input.timesPerDaySuggested > 1
          ? `We'll save one reminder at your chosen time. Label suggests ${input.timesPerDaySuggested}x daily.`
          : "We'll save one reminder at your chosen time.",
    };
  }

  const anchorLabel = `${input.anchor.label} (${input.anchor.time})`;
  if (input.timesPerDaySource === "label" && input.timesPerDaySuggested > 1) {
    return {
      buttonText: `Save ${input.anchor.label} reminder`,
      notice: `We'll save one reminder at ${anchorLabel}. Label suggests ${input.timesPerDaySuggested}x daily.`,
    };
  }

  if (input.displayMode === "choice_slots") {
    return {
      buttonText: `Save ${input.anchor.label} reminder`,
      notice: `We'll save one reminder at ${anchorLabel}. Choose breakfast or dinner.`,
    };
  }

  return {
    buttonText: `Save ${input.anchor.label} reminder`,
    notice: `We'll save one reminder at ${anchorLabel}.`,
  };
};

export const shouldShowScheduleTimeCategoryPill = (
  savedTime: string | null,
  hasTimeCategory: boolean,
): boolean => Boolean(savedTime && hasTimeCategory);

export const shouldShowSuggestedPlanCard = (savedTime: string | null): boolean => !Boolean(savedTime);

export const buildScheduleHintText = (params: {
  savedTime: string | null;
  autosyncedPrefill: boolean;
}): string => {
  if (params.savedTime) return "Saved";
  if (params.autosyncedPrefill) return "Not saved yet (suggestion prefilled)";
  return "Not set (default shown)";
};

export const buildAnchorAutosyncKey = (params: {
  itemId: string;
  factsDigestHash: string | null;
  anchor: SuggestedRoutineSlot;
}): string =>
  [
    params.itemId,
    params.factsDigestHash ?? "none",
    params.anchor.label,
    params.anchor.time,
    params.anchor.withFood ? "food" : "empty",
  ].join(":");

export const shouldRunAnchorAutosync = (params: AutosyncInput): { shouldSync: boolean; syncKey: string | null } => {
  if (params.savedTime || params.timeTouched || params.requiresManualTime) {
    return { shouldSync: false, syncKey: null };
  }
  const syncKey = buildAnchorAutosyncKey({
    itemId: params.itemId,
    factsDigestHash: params.factsDigestHash,
    anchor: params.anchor,
  });
  if (params.lastSyncKey === syncKey) {
    return { shouldSync: false, syncKey };
  }
  return { shouldSync: true, syncKey };
};

export const buildAutosyncPatch = (anchor: SuggestedRoutineSlot): { time: string; withFood: boolean } => ({
  time: anchor.time,
  withFood: anchor.withFood,
});

export const isAnchorSlotActive = (slot: SuggestedRoutineSlot, anchor: SuggestedRoutineSlot): boolean =>
  slot.label === anchor.label && slot.time === anchor.time;
