import type { SupabaseClient } from '@supabase/supabase-js';

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
      dietary_preferences text[],
      activity_level text,
      location_country text,
      location_city text,
      health_goals text[],
      onboarding_completed boolean default false,
      trial_status text,
      trial_started_at timestamp with time zone,
      created_at timestamp with time zone default now(),
      updated_at timestamp with time zone default now()
    );

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
  return {
    height: draft?.height ?? null,
    weight: draft?.weight ?? null,
    age: draft?.age ?? null,
    gender: draft?.gender ?? null,
    dietary_preferences: draft?.diets ?? null,
    activity_level: draft?.activity ?? null,
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
    trial_status: trial.status,
    trial_started_at: trial.startedAt ?? null,
  };

  const { error } = await client.from('user_profiles').upsert(payload, { onConflict: 'user_id' });

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
