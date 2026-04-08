export type DecisionSupportProfileRow = {
  age: number | null;
  age_range: string | null;
  gender: string | null;
  sex: string | null;
  dietary_preference: string | null;
  dietary_preferences: string[] | null;
  activity_level: string | null;
  supplement_experience: string | null;
  preferred_types: string[] | null;
  adherence_blocker: string | null;
  location: string | null;
  location_country: string | null;
  location_city: string | null;
  health_goals: string[] | null;
  allergy_flags: string[] | null;
  ingredient_restrictions: string[] | null;
};

const pickLocalArray = (
  localValue: string[] | null | undefined,
  remoteValue: string[] | null | undefined,
): string[] | null => {
  if (Array.isArray(localValue) && localValue.length > 0) {
    return localValue;
  }

  if (Array.isArray(remoteValue) && remoteValue.length > 0) {
    return remoteValue;
  }

  return null;
};

export const mergeDecisionSupportProfileRows = (params: {
  remoteProfile: DecisionSupportProfileRow | null;
  localProfile: DecisionSupportProfileRow | null;
}): DecisionSupportProfileRow | null => {
  const { remoteProfile, localProfile } = params;
  if (!remoteProfile) return localProfile;
  if (!localProfile) return remoteProfile;

  return {
    ...remoteProfile,
    health_goals: pickLocalArray(localProfile.health_goals, remoteProfile.health_goals),
    allergy_flags: pickLocalArray(localProfile.allergy_flags, remoteProfile.allergy_flags),
    ingredient_restrictions: pickLocalArray(
      localProfile.ingredient_restrictions,
      remoteProfile.ingredient_restrictions,
    ),
  };
};
