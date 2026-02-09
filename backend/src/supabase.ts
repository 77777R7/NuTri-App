import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from "node:fs";
import path from 'path';

const resolveEnvCandidates = (): string[] => {
  const cwd = process.cwd();
  const candidates = [
    // Typical: run from repo root
    path.resolve(cwd, ".env"),
    path.resolve(cwd, "backend", ".env"),
    // Typical: run from backend/
    path.resolve(cwd, "..", ".env"),
  ];
  // De-dupe while preserving order
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = path.normalize(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

type DotenvLoad = { path: string; loaded: boolean; error: string | null };

const loadEnv = (): DotenvLoad[] => {
  const loads: DotenvLoad[] = [];
  for (const candidate of resolveEnvCandidates()) {
    if (!fs.existsSync(candidate)) {
      loads.push({ path: candidate, loaded: false, error: "missing" });
      continue;
    }
    const result = dotenv.config({ path: candidate });
    loads.push({
      path: candidate,
      loaded: true,
      error: result.error ? String(result.error) : null,
    });
  }
  return loads;
};

// Load .env files opportunistically. This keeps local scripts robust whether run from repo root or backend/.
const loads = loadEnv();

const debug = process.env.SUPABASE_DEBUG === "1" || process.env.NODE_ENV !== "production";

// Map Expo vars -> backend vars when only public config is present.
if (!process.env.SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
}
if (!process.env.SUPABASE_ANON_KEY && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
  process.env.SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
}

if (debug) {
  console.log("[Supabase] dotenv loads:", loads);
  console.log("[Supabase] cwd:", process.cwd());
  console.log("[Supabase] SUPABASE_URL exists:", !!process.env.SUPABASE_URL);
  console.log("[Supabase] SUPABASE_SERVICE_ROLE_KEY exists:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log("[Supabase] SUPABASE_ANON_KEY exists:", !!process.env.SUPABASE_ANON_KEY);
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
