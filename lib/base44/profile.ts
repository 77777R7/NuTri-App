import { base44 } from './client';
import type { UserProfile } from './types';

export async function loadCurrentProfile(): Promise<UserProfile | null> {
  const { id } = await base44.auth.me();
  const rows = await base44.UserProfile.filter({ id });
  return rows[0] ?? null;
}

export async function upsertProfile(patch: Partial<UserProfile>) {
  const { id } = await base44.auth.me();
  const existing = await loadCurrentProfile();
  const next: UserProfile = { id, ...existing, ...patch };
  await base44.UserProfile.upsert(next);
  return next;
}
