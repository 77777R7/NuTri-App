import type { SupabaseClient } from '@supabase/supabase-js';

import { buildSmartFilterConfig, normalizeAvoidItemsSelection } from '@/lib/onboarding-v2';
import type { ProfileDraft, TrialState } from '@/types/onboarding';
import type { Database } from '@/types/supabase';

type PublicClient = SupabaseClient<Database>;

const LEGACY_ACTIVITY_LEVEL_MAP: Record<string, string> = {
  sedentary: 'sedentary',
  light: 'light',
  lightly_active: 'light',
  moderate: 'moderate',
  moderately_active: 'moderate',
  active: 'active',
  very_active: 'very_active',
  highly_active: 'very_active',
};

const LEGACY_GENDER_MAP: Record<string, string> = {
  male: 'male',
  female: 'female',
  non_binary: 'non-binary',
  nonbinary: 'non-binary',
  other: 'other',
  prefer_not_to_say: 'prefer_not_to_say',
  prefernottosay: 'prefer_not_to_say',
};

const normalizeLegacyToken = (value?: string | null) =>
  value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') ?? '';

export const ensureUserProfileTable = async (client: PublicClient) => {
  const ddl = `
    create table if not exists public.user_profiles (
      user_id uuid primary key references auth.users(id) on delete cascade,
      age integer,
      gender text,
      age_range text,
      sex text,
      supplement_experience text,
      dietary_preferences text[],
      activity_level text,
      preferred_types text[],
      allergy_flags text[] not null default '{}'::text[],
      ingredient_restrictions text[] not null default '{}'::text[],
      adherence_blocker text,
      permission_preferences jsonb,
      smart_filter_config jsonb,
      onboarding_version text,
      onboarding_completed_at timestamp with time zone,
      first_action_preference text,
      location_country text,
      location_city text,
      health_goals text[],
      onboarding_completed boolean default false,
      trial_status text,
      trial_started_at timestamp with time zone,
      created_at timestamp with time zone default now(),
      updated_at timestamp with time zone default now()
    );

    alter table if exists public.user_profiles
      add column if not exists age_range text,
      add column if not exists sex text,
      add column if not exists supplement_experience text,
      add column if not exists dietary_preferences text[],
      add column if not exists activity_level text,
      add column if not exists preferred_types text[],
      add column if not exists allergy_flags text[] not null default '{}'::text[],
      add column if not exists ingredient_restrictions text[] not null default '{}'::text[],
      add column if not exists adherence_blocker text,
      add column if not exists permission_preferences jsonb,
      add column if not exists smart_filter_config jsonb,
      add column if not exists onboarding_version text,
      add column if not exists onboarding_completed_at timestamp with time zone,
      add column if not exists first_action_preference text,
      add column if not exists location_country text,
      add column if not exists location_city text,
      add column if not exists health_goals text[],
      add column if not exists onboarding_completed boolean default false,
      add column if not exists trial_status text,
      add column if not exists trial_started_at timestamp with time zone;

    drop trigger if exists user_profiles_set_updated_at on public.user_profiles;

    create trigger user_profiles_set_updated_at
      before update on public.user_profiles
      for each row
      execute procedure public.set_current_timestamp_updated_at();
  `;

  let error: unknown = null;

  try {
    const result = await (client.rpc as any)('exec_sql', { sql: ddl });
    error = result?.error ?? null;
  } catch (rpcError) {
    console.warn('[supabase] exec_sql rpc unavailable, attempting raw query', rpcError);
    const fallback = await client.from('user_profiles').select('user_id').limit(1);
    error = fallback.error ?? null;
  }

  if (error) {
    console.warn('[supabase] ensureUserProfileTable error', error);
  }
};

const mapProfileDraft = (draft: ProfileDraft | null) => {
  const normalizedAvoid = normalizeAvoidItemsSelection(draft?.avoidItems);
  const allergyFlags =
    draft?.allergyFlags && draft.allergyFlags.length > 0
      ? draft.allergyFlags
      : normalizedAvoid.allergyFlags;
  const ingredientRestrictions =
    draft?.ingredientRestrictions && draft.ingredientRestrictions.length > 0
      ? draft.ingredientRestrictions
      : normalizedAvoid.ingredientRestrictions;
  const smartFilterConfig = buildSmartFilterConfig({
    goals: draft?.goals ?? null,
    preferredTypes: draft?.preferredTypes ?? null,
  });
  const normalizedGender = LEGACY_GENDER_MAP[normalizeLegacyToken(draft?.gender ?? draft?.sex ?? null)] ?? null;
  const normalizedActivity = LEGACY_ACTIVITY_LEVEL_MAP[normalizeLegacyToken(draft?.activity ?? null)] ?? null;

  return {
    age: draft?.age ?? null,
    gender: normalizedGender,
    age_range: draft?.ageRange ?? null,
    sex: draft?.sex ?? draft?.gender ?? null,
    supplement_experience: draft?.supplementExperience ?? null,
    dietary_preferences: draft?.diets ?? null,
    activity_level: normalizedActivity,
    preferred_types: draft?.preferredTypes ?? null,
    allergy_flags: allergyFlags,
    ingredient_restrictions: ingredientRestrictions,
    adherence_blocker: draft?.adherenceBlocker ?? null,
    permission_preferences: draft?.permissionPreferences ?? null,
    smart_filter_config: draft?.smartFilterConfig ?? smartFilterConfig,
    onboarding_version: draft?.onboardingVersion ?? 'v2',
    onboarding_completed_at: draft?.onboardingCompletedAt ?? null,
    first_action_preference: draft?.firstActionPreference ?? null,
    location_country: draft?.location?.country ?? null,
    location_city: draft?.location?.city ?? null,
    health_goals: draft?.goals ?? null,
  };
};

const mapLiveCompatibleProfileDraft = (draft: ProfileDraft | null) => {
  const normalizedAvoid = normalizeAvoidItemsSelection(draft?.avoidItems);
  const allergyFlags =
    draft?.allergyFlags && draft.allergyFlags.length > 0
      ? draft.allergyFlags
      : normalizedAvoid.allergyFlags;
  const ingredientRestrictions =
    draft?.ingredientRestrictions && draft.ingredientRestrictions.length > 0
      ? draft.ingredientRestrictions
      : normalizedAvoid.ingredientRestrictions;
  const country = draft?.location?.country?.trim();
  const city = draft?.location?.city?.trim();
  const location = [city, country].filter(Boolean).join(', ') || null;
  const normalizedGender = LEGACY_GENDER_MAP[normalizeLegacyToken(draft?.gender ?? draft?.sex ?? null)] ?? null;
  const normalizedActivity = LEGACY_ACTIVITY_LEVEL_MAP[normalizeLegacyToken(draft?.activity ?? null)] ?? null;

  return {
    age: draft?.age ?? null,
    gender: normalizedGender,
    dietary_preference: draft?.diets?.[0] ?? null,
    activity_level: normalizedActivity,
    location,
    allergy_flags: allergyFlags,
    ingredient_restrictions: ingredientRestrictions,
  };
};

const isUserProfilesSchemaMismatchError = (error: { message?: string | null; details?: string | null; hint?: string | null } | null) => {
  const haystack = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`.toLowerCase();
  return (
    haystack.includes("user_profiles") &&
    (haystack.includes('schema cache') || haystack.includes('column') || haystack.includes('could not find'))
  );
};

export const upsertUserProfile = async (client: PublicClient, userId: string, draft: ProfileDraft | null, trial: TrialState) => {
  await ensureUserProfileTable(client);

  const payload = {
    user_id: userId,
    ...mapProfileDraft(draft),
    onboarding_completed: true,
    onboarding_completed_at: draft?.onboardingCompletedAt ?? new Date().toISOString(),
    trial_status: trial.status,
    trial_started_at: trial.startedAt ?? null,
  };

  const { error } = await client.from('user_profiles').upsert(payload as any, { onConflict: 'user_id' });

  if (error && isUserProfilesSchemaMismatchError(error)) {
    const compatiblePayload = {
      user_id: userId,
      ...mapLiveCompatibleProfileDraft(draft),
    };
    const fallback = await client.from('user_profiles').upsert(compatiblePayload as any, { onConflict: 'user_id' });
    if (!fallback.error) {
      return { ok: true, mode: 'live_compatible_fallback' as const };
    }
    console.error('[supabase] Failed to upsert user profile with live-compatible fallback', fallback.error);
    return { ok: false, error: fallback.error };
  }

  if (error) {
    console.error('[supabase] Failed to upsert user profile', error);
    return { ok: false, error };
  }

  return { ok: true, mode: 'full_payload' as const };
};

export const fetchUserProfile = async (client: PublicClient, userId: string) => {
  return client
    .from('user_profiles')
    .select('user_id, allergy_flags, ingredient_restrictions, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
};
