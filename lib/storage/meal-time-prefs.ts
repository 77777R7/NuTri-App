import AsyncStorage from "@react-native-async-storage/async-storage";

export type MealTimePrefs = {
  breakfast: string;
  lunch: string;
  dinner: string;
  bedtime: string;
  updatedAt: string;
};

type MealSlot = "breakfast" | "lunch" | "dinner" | "bedtime";

const isValidTime = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hoursText, minutesText] = value.split(":");
  const hours = Number.parseInt(hoursText, 10);
  const minutes = Number.parseInt(minutesText, 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return false;
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

const toValidPrefs = (raw: unknown): MealTimePrefs | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Partial<MealTimePrefs>;
  if (
    !isValidTime(candidate.breakfast) ||
    !isValidTime(candidate.lunch) ||
    !isValidTime(candidate.dinner) ||
    !isValidTime(candidate.bedtime)
  ) {
    return null;
  }
  return {
    breakfast: candidate.breakfast,
    lunch: candidate.lunch,
    dinner: candidate.dinner,
    bedtime: candidate.bedtime,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
  };
};

const keyForUser = (userId: string) => `mealTimePrefs:${userId}`;

export const loadMealTimePrefs = async (userId: string): Promise<MealTimePrefs | null> => {
  if (!userId) return null;
  const raw = await AsyncStorage.getItem(keyForUser(userId));
  if (!raw) return null;
  try {
    return toValidPrefs(JSON.parse(raw));
  } catch (error) {
    console.warn("[meal-time-prefs] Failed to parse JSON", error);
    return null;
  }
};

export const saveMealTimePrefs = async (userId: string, prefs: MealTimePrefs): Promise<void> => {
  if (!userId) return;
  await AsyncStorage.setItem(keyForUser(userId), JSON.stringify(prefs));
};

export const updateMealTimePrefSlot = async (
  userId: string,
  slot: MealSlot,
  time: string,
  current: MealTimePrefs | null,
): Promise<MealTimePrefs | null> => {
  if (!userId || !isValidTime(time)) return current;
  const base: MealTimePrefs = current ?? {
    breakfast: "08:00",
    lunch: "12:30",
    dinner: "18:30",
    bedtime: "22:00",
    updatedAt: new Date().toISOString(),
  };
  const next: MealTimePrefs = {
    ...base,
    [slot]: time,
    updatedAt: new Date().toISOString(),
  };
  await saveMealTimePrefs(userId, next);
  return next;
};
