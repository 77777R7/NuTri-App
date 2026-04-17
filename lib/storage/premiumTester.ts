import AsyncStorage from '@react-native-async-storage/async-storage';

export type PremiumTestOverride = 'auto' | 'paid' | 'unpaid';

const STORAGE_KEY = 'nu.premium:test_override';

const normalizeOverride = (value: string | null): PremiumTestOverride => {
  if (value === 'paid' || value === 'unpaid') return value;
  return 'auto';
};

export const getPremiumTestOverride = async (): Promise<PremiumTestOverride> => {
  const value = await AsyncStorage.getItem(STORAGE_KEY);
  return normalizeOverride(value);
};

export const setPremiumTestOverride = async (value: PremiumTestOverride) => {
  if (value === 'auto') {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return;
  }

  await AsyncStorage.setItem(STORAGE_KEY, value);
};
