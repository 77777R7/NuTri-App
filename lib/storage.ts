import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'nutri_jwt';
const isWeb = Platform.OS === 'web';

export const storeToken = async (token: string) => {
  if (isWeb) {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TOKEN_KEY, token);
    }
    return;
  }

  await SecureStore.setItemAsync(TOKEN_KEY, token);
};

export const getToken = async (): Promise<string | null> => {
  if (isWeb) {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(TOKEN_KEY);
  }

  if (typeof SecureStore.getItemAsync !== 'function') return null;
  return SecureStore.getItemAsync(TOKEN_KEY);
};

export const deleteToken = async () => {
  if (isWeb) {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(TOKEN_KEY);
    }
    return;
  }

  if (typeof SecureStore.deleteItemAsync === 'function') {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
};
