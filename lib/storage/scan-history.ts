import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ScanHistoryItem } from '@/types/scan-history';

const STORAGE_KEY = 'nu.scanHistory:v1';

const parseJSON = <T>(value: string | null): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn('Failed to parse scan history storage JSON', error);
    return null;
  }
};

export const loadScanHistory = async (): Promise<ScanHistoryItem[]> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const parsed = parseJSON<ScanHistoryItem[]>(raw);
  return parsed ?? [];
};

export const saveScanHistory = async (history: ScanHistoryItem[]) => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(history));
};
