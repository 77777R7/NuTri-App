import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SavedSupplement } from '@/types/saved-supplements';

const STORAGE_KEY = 'nu.savedSupplements:v1';

const parseJSON = <T>(value: string | null): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn('Failed to parse saved supplements storage JSON', error);
    return null;
  }
};

export const loadSavedSupplements = async (): Promise<SavedSupplement[]> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const parsed = parseJSON<SavedSupplement[]>(raw);
  return parsed ?? [];
};

export const saveSavedSupplements = async (supplements: SavedSupplement[]) => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(supplements));
};
