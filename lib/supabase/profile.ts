import type { SupabaseClient } from '@supabase/supabase-js';

import { buildSmartFilterConfig } from '@/lib/onboarding-v2';
import type { ProfileDraft, TrialState } from '@/types/onboarding';
import type { Database } from '@/types/supabase';

type PublicClient = SupabaseClient<Database>;

export const ensureUserProfileTable = async (client: PublicClient) => {
  const ddl = `
    create table if not exists public.user_profiles (
      user_id uuid primary key references auth.users(id) on delete cascade,
      height decimal,
      weight decimal,
      age integer,
      gender text,
      age_range text,
      sex text,
      supplement_experience text,
      dietary_preferences text[],
      activity_level text,
      preferred_types text[],
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
      execute procedure public.set_updated_at();
  `;

  const { error } = await (client.rpc as any)('exec_sql', { sql: ddl }).catch(async (rpcError: unknown) => {
    console.warn('[supabase] exec_sql rpc unavailable, attempting raw query', rpcError);
    return client.from('user_profiles').select('user_id').limit(1);
  });

  if (error) {
    console.warn('[supabase] ensureUserProfileTable error', error);
  }
};

const mapProfileDraft = (draft: ProfileDraft | null) => {
  const smartFilterConfig = buildSmartFilterConfig({
    goals: draft?.goals ?? null,
    preferredTypes: draft?.preferredTypes ?? null,
  });

  return {
    height: draft?.height ?? null,
    weight: draft?.weight ?? null,
    age: draft?.age ?? null,
    gender: draft?.gender ?? draft?.sex ?? null,
    age_range: draft?.ageRange ?? null,
    sex: draft?.sex ?? draft?.gender ?? null,
    supplement_experience: draft?.supplementExperience ?? null,
    dietary_preferences: draft?.diets ?? null,
    activity_level: draft?.activity ?? null,
    preferred_types: draft?.preferredTypes ?? null,
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

  if (error) {
    console.error('[supabase] Failed to upsert user profile', error);
    return { ok: false, error };
  }

  return { ok: true };
};

export const fetchUserProfile = async (client: PublicClient, userId: string) => {
  return client
    .from('user_profiles')
    .select('user_id, onboarding_completed, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
};
