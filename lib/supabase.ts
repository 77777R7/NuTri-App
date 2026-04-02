import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import type { Database } from '../types/supabase';
import { ENV } from './env';
import { storage } from './supabaseStorage';

if (Platform.OS !== 'web') {
  require('react-native-url-polyfill/auto');
}

if (__DEV__) {
  console.log('[supabase:init]', {
    url: ENV.supabaseUrl,
    anonKeyPrefix: ENV.supabaseAnonKey?.slice(0, 12) ?? null,
  });
}

export const supabase = createClient<Database>(ENV.supabaseUrl, ENV.supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export async function testSupabase() {
  try {
    const { data, error } = await supabase.from('profiles').select('*').limit(1);
    console.log('✅ Test data:', data, 'error:', error);
  } catch (err) {
    console.error('❌ Supabase test failed:', err);
  }
}
