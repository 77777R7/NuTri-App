import assert from "node:assert/strict";
import test from "node:test";

import AsyncStorage from "@react-native-async-storage/async-storage";

import { loadMealTimePrefs, saveMealTimePrefs, updateMealTimePrefSlot } from "./meal-time-prefs";

test("meal-time-prefs: rejects invalid HH:MM ranges", async () => {
  const current = {
    breakfast: "08:00",
    lunch: "12:30",
    dinner: "18:30",
    bedtime: "22:00",
    updatedAt: new Date().toISOString(),
  };

  const unchanged = await updateMealTimePrefSlot("u1", "breakfast", "99:99", current);
  assert.deepEqual(unchanged, current);
});

test("meal-time-prefs: storage keys are user-scoped", async () => {
  const store = new Map<string, string>();
  const originalGetItem = (AsyncStorage as any).getItem;
  const originalSetItem = (AsyncStorage as any).setItem;

  (AsyncStorage as any).getItem = async (key: string) => store.get(key) ?? null;
  (AsyncStorage as any).setItem = async (key: string, value: string) => {
    store.set(key, value);
  };

  try {
    await saveMealTimePrefs("userA", {
      breakfast: "07:30",
      lunch: "12:15",
      dinner: "18:10",
      bedtime: "22:10",
      updatedAt: new Date().toISOString(),
    });
    await saveMealTimePrefs("userB", {
      breakfast: "09:00",
      lunch: "13:00",
      dinner: "20:00",
      bedtime: "23:30",
      updatedAt: new Date().toISOString(),
    });

    const a = await loadMealTimePrefs("userA");
    const b = await loadMealTimePrefs("userB");
    assert.equal(a?.breakfast, "07:30");
    assert.equal(b?.breakfast, "09:00");
    assert.notEqual(a?.breakfast, b?.breakfast);
  } finally {
    (AsyncStorage as any).getItem = originalGetItem;
    (AsyncStorage as any).setItem = originalSetItem;
  }
});

