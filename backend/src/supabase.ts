import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Explicitly load .env from current directory
const result = dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const debug = process.env.SUPABASE_DEBUG === "1" || process.env.NODE_ENV !== "production";

if (debug) {
    console.log('[Supabase] Loading env from:', path.resolve(process.cwd(), '.env'));
    console.log('[Supabase] Dotenv result error:', result.error);
    console.log('[Supabase] SUPABASE_URL exists:', !!process.env.SUPABASE_URL);
    console.log('[Supabase] SUPABASE_SERVICE_ROLE_KEY exists:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
    console.log('[Supabase] SUPABASE_ANON_KEY exists:', !!process.env.SUPABASE_ANON_KEY);
}

const supabaseUrl = process.env.SUPABASE_URL ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!supabaseUrl) {
    console.warn('[Supabase] Missing SUPABASE_URL');
}

if (!serviceRoleKey) {
    throw new Error('[Supabase] Missing SUPABASE_SERVICE_ROLE_KEY (required for ocr_cache writes with RLS enabled)');
}

export const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
        persistSession: false,
    },
});
