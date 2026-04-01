const readBooleanEnv = (value: string | undefined) =>
  value === "1" || value === "true";

// Default off so research UI never leaks into the normal production lane.
export const PERSONALIZATION_RESEARCH_UI_ENABLED = readBooleanEnv(
  process.env.EXPO_PUBLIC_PERSONALIZATION_RESEARCH_UI_ENABLED,
);
