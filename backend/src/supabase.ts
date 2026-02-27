import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const envCandidates = Array.from(
    new Set([
        path.resolve(process.cwd(), '.env'),
        path.resolve(process.cwd(), 'backend/.env'),
        path.resolve(process.cwd(), '../.env'),
        path.resolve(moduleDir, '../.env'),
    ]),
);

const loadedEnvPaths: string[] = [];
const dotenvErrors: string[] = [];

envCandidates.forEach((candidatePath) => {
    if (!existsSync(candidatePath)) return;
    const result = dotenv.config({ path: candidatePath, override: false });
    loadedEnvPaths.push(candidatePath);
    if (result.error) {
        dotenvErrors.push(`${candidatePath}: ${result.error.message}`);
    }
});

const debug = process.env.SUPABASE_DEBUG === "1" || process.env.NODE_ENV !== "production";

if (debug) {
    console.log('[Supabase] Env candidates:', envCandidates);
    console.log('[Supabase] Loaded env files:', loadedEnvPaths);
    if (dotenvErrors.length > 0) {
        console.log('[Supabase] Dotenv parse warnings:', dotenvErrors);
    }
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
