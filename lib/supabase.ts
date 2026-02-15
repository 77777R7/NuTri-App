import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '../types/supabase';
import { ENV } from './env';
import { storage } from './supabaseStorage';

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
