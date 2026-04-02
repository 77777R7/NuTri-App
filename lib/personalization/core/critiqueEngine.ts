import personalizationControlsData from "@/data/personalization/personalization_controls.v1.json";
import type {
  DecisionReason,
  FeedbackState,
  OverrideEvent,
  PersonalizationControlKey,
  PersonalizationProfile,
  PreferenceVector,
  SupportState,
} from "@/types/personalization";

type PersonalizationControlsFile = {
  version: string;
  controls: Array<{
    key: PersonalizationControlKey;
    label: string;
    field: keyof PreferenceVector;
    value: string;
    group: "decision" | "explanation" | "notification";
  }>;
};

export type CompiledPreferenceVector = {
  preferenceVector: PreferenceVector;
  reasons: DecisionReason[];
};

export type PersonalizationControlChip = {
  key: PersonalizationControlKey;
  label: string;
  field: keyof PreferenceVector;
  group: "decision" | "explanation" | "notification";
  value: string;
  active: boolean;
};

const PERSONALIZATION_CONTROLS = personalizationControlsData as PersonalizationControlsFile;

const buildReason = (
  code: string,
  params?: DecisionReason["params"],
): DecisionReason => ({
  code,
  ruleId: "personalization.controls.v1",
  source: "derived",
  ...(params ? { params } : {}),
});

const getDefaultPreferenceVector = (input: {
  profile: PersonalizationProfile;
  supportState: SupportState;
}): PreferenceVector => {
  const blocker = input.profile.declared.adherenceBlocker;
  const consistency = input.profile.observed.consistencyLevel;
  const experience = input.profile.declared.supplementExperience;

  const decisionMode: PreferenceVector["decisionMode"] =
    blocker === "label_and_dosage_confusion"
      ? "better_disclosure"
      : input.profile.observed.duplicateRisk.level === "high"
        ? "low_overlap"
        : experience === "brand_new"
          ? "simpler"
          : "best_fit";

  const explanationStyle: PreferenceVector["explanationStyle"] =
    blocker === "goal_fit_uncertainty" || blocker === "label_and_dosage_confusion"
      ? "compare"
      : experience === "structured_stack" || input.supportState === "optimize"
        ? "deep"
        : "brief";

  const notificationTolerance: PreferenceVector["notificationTolerance"] =
    blocker === "weak_tracking_habit" || consistency === "low"
      ? "high"
      : blocker === "already_consistent" || consistency === "high"
        ? "low"
        : "medium";

  return {
    decisionMode,
    explanationStyle,
    notificationTolerance,
  };
};

export const compilePreferenceVector = (input: {
  profile: PersonalizationProfile;
  supportState: SupportState;
  feedbackState?: FeedbackState;
}): CompiledPreferenceVector => {
  const defaultPreferenceVector = getDefaultPreferenceVector(input);
  const override = input.feedbackState?.overrides.controls ?? {};

  const preferenceVector: PreferenceVector = {
    decisionMode: override.decisionMode ?? defaultPreferenceVector.decisionMode,
    explanationStyle: override.explanationStyle ?? defaultPreferenceVector.explanationStyle,
    notificationTolerance:
      override.notificationTolerance ?? defaultPreferenceVector.notificationTolerance,
  };

  return {
    preferenceVector,
    reasons: [
      buildReason("preference_vector_compiled", {
        decisionMode: preferenceVector.decisionMode,
        explanationStyle: preferenceVector.explanationStyle,
        notificationTolerance: preferenceVector.notificationTolerance,
      }),
      ...(Object.keys(override).length > 0
        ? [
            buildReason("preference_vector_override_applied", {
              overrideFieldCount: Object.keys(override).length,
            }),
          ]
        : []),
    ],
  };
};

export const listPersonalizationControlChips = (
  preferenceVector: PreferenceVector,
): PersonalizationControlChip[] =>
  PERSONALIZATION_CONTROLS.controls.map((control) => ({
    ...control,
    active: preferenceVector[control.field] === control.value,
  }));

export const buildPersonalizationControlEvents = (input: {
  key: PersonalizationControlKey;
  active: boolean;
  timestamp?: string;
}): OverrideEvent[] => {
  const control = PERSONALIZATION_CONTROLS.controls.find((entry) => entry.key === input.key);
  if (!control) return [];

  return [
    {
      id: `ctrl_${control.key}_${(input.timestamp ?? new Date().toISOString()).replace(/[^0-9a-z]/gi, "")}`,
      timestamp: input.timestamp ?? new Date().toISOString(),
      source: "user",
      surface: "personalization_controls",
      action: input.active ? "remove" : "set",
      field: control.field,
      ...(input.active ? {} : { value: control.value }),
    },
  ];
};

export const critiqueEngineInternals = {
  getDefaultPreferenceVector,
  PERSONALIZATION_CONTROLS,
};
