import type { SupabaseClient } from '@supabase/supabase-js';

import { buildSmartFilterConfig, normalizeAvoidItemsSelection } from '@/lib/onboarding-v2';
import type { ProfileDraft, TrialState } from '@/types/onboarding';
import type { Database } from '@/types/supabase';

type PublicClient = SupabaseClient<Database>;
type UserProfileDraftSeedRow = {
  user_id: string;
  age: number | null;
  gender: string | null;
  age_range: string | null;
  sex: string | null;
  supplement_experience: string | null;
  dietary_preferences: string[] | null;
  activity_level: string | null;
  preferred_types: string[] | null;
  allergy_flags: string[] | null;
  ingredient_restrictions: string[] | null;
  adherence_blocker: string | null;
  onboarding_version: string | null;
  onboarding_completed_at: string | null;
  onboarding_completed: boolean | null;
  first_action_preference: string | null;
  location_country: string | null;
  location_city: string | null;
  health_goals: string[] | null;
  updated_at: string | null;
};

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

const sanitizeString = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const sanitizeStringArray = (values?: string[] | null) => {
  if (!Array.isArray(values)) return undefined;
  const next = values.map(value => sanitizeString(value)).filter(Boolean) as string[];
  return next.length > 0 ? next : undefined;
};

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
      premium_status text,
      premium_entitlement text,
      premium_source text,
      premium_customer_id text,
      premium_product_id text,
      premium_store text,
      premium_expires_at timestamp with time zone,
      premium_will_renew boolean,
      premium_period_type text,
      premium_updated_at timestamp with time zone,
      first_completed_scan_id text,
      first_scan_reveal_state text,
      first_scan_reveal_scan_id text,
      first_scan_reveal_granted_at timestamp with time zone,
      first_scan_paywall_seen_at timestamp with time zone,
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
      add column if not exists trial_started_at timestamp with time zone,
      add column if not exists premium_status text,
      add column if not exists premium_entitlement text,
      add column if not exists premium_source text,
      add column if not exists premium_customer_id text,
      add column if not exists premium_product_id text,
      add column if not exists premium_store text,
      add column if not exists premium_expires_at timestamp with time zone,
      add column if not exists premium_will_renew boolean,
      add column if not exists premium_period_type text,
      add column if not exists premium_updated_at timestamp with time zone,
      add column if not exists first_completed_scan_id text,
      add column if not exists first_scan_reveal_state text,
      add column if not exists first_scan_reveal_scan_id text,
      add column if not exists first_scan_reveal_granted_at timestamp with time zone,
      add column if not exists first_scan_paywall_seen_at timestamp with time zone;

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

export type UserPremiumEntitlementWrite = {
  premium_status: string;
  premium_entitlement?: string | null;
  premium_source?: string | null;
  premium_customer_id?: string | null;
  premium_product_id?: string | null;
  premium_store?: string | null;
  premium_expires_at?: string | null;
  premium_will_renew?: boolean | null;
  premium_period_type?: string | null;
  premium_updated_at?: string;
};

export type UserFirstScanRevealWrite = {
  first_completed_scan_id?: string | null;
  first_scan_reveal_state?: 'eligible' | 'granted' | 'paywall_seen' | 'converted' | null;
  first_scan_reveal_scan_id?: string | null;
  first_scan_reveal_granted_at?: string | null;
  first_scan_paywall_seen_at?: string | null;
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

export const upsertUserPremiumEntitlement = async (
  client: PublicClient,
  userId: string,
  entitlement: UserPremiumEntitlementWrite,
) => {
  await ensureUserProfileTable(client);

  const payload = {
    user_id: userId,
    premium_status: entitlement.premium_status,
    premium_entitlement: entitlement.premium_entitlement ?? null,
    premium_source: entitlement.premium_source ?? null,
    premium_customer_id: entitlement.premium_customer_id ?? null,
    premium_product_id: entitlement.premium_product_id ?? null,
    premium_store: entitlement.premium_store ?? null,
    premium_expires_at: entitlement.premium_expires_at ?? null,
    premium_will_renew: entitlement.premium_will_renew ?? null,
    premium_period_type: entitlement.premium_period_type ?? null,
    premium_updated_at: entitlement.premium_updated_at ?? new Date().toISOString(),
  };

  const { error } = await client.from('user_profiles').upsert(payload as any, { onConflict: 'user_id' });

  if (error) {
    console.error('[supabase] Failed to upsert premium entitlement', error);
    return { ok: false, error };
  }

  return { ok: true } as const;
};

export const fetchUserFirstScanReveal = async (client: PublicClient, userId: string) => {
  await ensureUserProfileTable(client);

  return client
    .from('user_profiles')
    .select(
      'first_completed_scan_id, first_scan_reveal_state, first_scan_reveal_scan_id, first_scan_reveal_granted_at, first_scan_paywall_seen_at',
    )
    .eq('user_id', userId)
    .maybeSingle<{
      first_completed_scan_id: string | null;
      first_scan_reveal_state: 'eligible' | 'granted' | 'paywall_seen' | 'converted' | null;
      first_scan_reveal_scan_id: string | null;
      first_scan_reveal_granted_at: string | null;
      first_scan_paywall_seen_at: string | null;
    }>();
};

export const upsertUserFirstScanReveal = async (
  client: PublicClient,
  userId: string,
  reveal: UserFirstScanRevealWrite,
) => {
  await ensureUserProfileTable(client);

  const payload = {
    user_id: userId,
    first_completed_scan_id: reveal.first_completed_scan_id ?? null,
    first_scan_reveal_state: reveal.first_scan_reveal_state ?? null,
    first_scan_reveal_scan_id: reveal.first_scan_reveal_scan_id ?? null,
    first_scan_reveal_granted_at: reveal.first_scan_reveal_granted_at ?? null,
    first_scan_paywall_seen_at: reveal.first_scan_paywall_seen_at ?? null,
  };

  const { error } = await client.from('user_profiles').upsert(payload as any, { onConflict: 'user_id' });

  if (error) {
    console.error('[supabase] Failed to upsert first scan reveal', error);
    return { ok: false, error };
  }

  return { ok: true } as const;
};

export const mapUserProfileRowToDraft = (row: UserProfileDraftSeedRow | null | undefined): ProfileDraft | null => {
  if (!row) return null;

  const draft: ProfileDraft = {};
  if (typeof row.age === 'number' && Number.isFinite(row.age)) {
    draft.age = row.age;
  }
  const gender = sanitizeString(row.gender);
  const sex = sanitizeString(row.sex);
  if (gender) draft.gender = gender;
  if (sex) draft.sex = sex;
  const ageRange = sanitizeString(row.age_range);
  if (ageRange) draft.ageRange = ageRange;
  const supplementExperience = sanitizeString(row.supplement_experience);
  if (supplementExperience) draft.supplementExperience = supplementExperience;
  const diets = sanitizeStringArray(row.dietary_preferences);
  if (diets) draft.diets = diets;
  const activity = sanitizeString(row.activity_level);
  if (activity) draft.activity = activity;
  const preferredTypes = sanitizeStringArray(row.preferred_types);
  if (preferredTypes) draft.preferredTypes = preferredTypes;
  const adherenceBlocker = sanitizeString(row.adherence_blocker);
  if (adherenceBlocker) draft.adherenceBlocker = adherenceBlocker;
  const goals = sanitizeStringArray(row.health_goals);
  if (goals) draft.goals = goals;
  const allergyFlags = sanitizeStringArray(row.allergy_flags);
  if (allergyFlags) draft.allergyFlags = allergyFlags as ProfileDraft['allergyFlags'];
  const ingredientRestrictions = sanitizeStringArray(row.ingredient_restrictions);
  if (ingredientRestrictions) {
    draft.ingredientRestrictions = ingredientRestrictions as ProfileDraft['ingredientRestrictions'];
  }
  const country = sanitizeString(row.location_country);
  const city = sanitizeString(row.location_city);
  if (country || city) {
    draft.location = {
      ...(country ? { country } : {}),
      ...(city ? { city } : {}),
    };
  }
  if (row.onboarding_version === 'v2') {
    draft.onboardingVersion = 'v2';
  }
  const onboardingCompletedAt = sanitizeString(row.onboarding_completed_at);
  if (onboardingCompletedAt) draft.onboardingCompletedAt = onboardingCompletedAt;
  const firstActionPreference = sanitizeString(row.first_action_preference);
  if (
    firstActionPreference === 'scan'
    || firstActionPreference === 'manual'
    || firstActionPreference === 'later'
  ) {
    draft.firstActionPreference = firstActionPreference;
  }

  return Object.keys(draft).length > 0 ? draft : null;
};

export const fetchUserProfileDraftSeed = async (client: PublicClient, userId: string) => {
  const result = await client
    .from('user_profiles')
    .select(
      'user_id, age, gender, age_range, sex, supplement_experience, dietary_preferences, activity_level, preferred_types, allergy_flags, ingredient_restrictions, adherence_blocker, onboarding_version, onboarding_completed_at, onboarding_completed, first_action_preference, location_country, location_city, health_goals, updated_at',
    )
    .eq('user_id', userId)
    .maybeSingle<UserProfileDraftSeedRow>();

  if (result.error || !result.data) {
    return {
      draft: null,
      updatedAt: undefined,
      completed: false,
      error: result.error ?? null,
    };
  }

  return {
    draft: mapUserProfileRowToDraft(result.data),
    updatedAt: sanitizeString(result.data.updated_at),
    completed: result.data.onboarding_completed === true || Boolean(result.data.onboarding_completed_at),
    error: null,
  };
};
