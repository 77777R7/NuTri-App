import { Platform } from 'react-native';

// NOTE:
// We avoid importing `expo-secure-store` at the top-level because expo-router's
// web/static render runs in Node, where SecureStore isn't available and can crash.
// This file provides a stable import target for TypeScript (`./supabaseStorage`)
// while loading the native adapter only on native platforms.

import type { SupabaseAuthStorage as WebStorageType } from './supabaseStorage.web';
import { storage as webStorage } from './supabaseStorage.web';

export type SupabaseAuthStorage = WebStorageType;

export const storage: SupabaseAuthStorage =
  Platform.OS === 'web'
    ? webStorage
    : // Lazy-require so Node/static render never evaluates SecureStore.
      (require('./supabaseStorage.native') as { storage: SupabaseAuthStorage }).storage;

