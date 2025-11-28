import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Explicitly load .env from current directory
const result = dotenv.config({ path: path.resolve(process.cwd(), '.env') });

console.log('[Supabase] Loading env from:', path.resolve(process.cwd(), '.env'));
console.log('[Supabase] Dotenv result error:', result.error);
console.log('[Supabase] SUPABASE_URL exists:', !!process.env.SUPABASE_URL);
console.log('[Supabase] SUPABASE_ANON_KEY exists:', !!process.env.SUPABASE_ANON_KEY);

const supabaseUrl = process.env.SUPABASE_URL ?? '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseKey) {
    console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
    },
});
