import type { RoutinePreferences } from "@/types/saved-supplements";

export const resolveRoutineTimeUserSet = (routine: RoutinePreferences | null | undefined): boolean => {
  const time = routine?.time?.trim() ?? "";
  if (!time) return false;
  if (routine?.timeUserSet === true) return true;
  if (routine?.timeUserSet === false) return false;
  return true;
};
