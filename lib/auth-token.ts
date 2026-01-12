import { supabase } from '@/lib/supabase';
import { AUTH_DISABLED } from '@/lib/auth-mode';

export const getAccessToken = async (): Promise<string | null> => {
  if (AUTH_DISABLED) {
    return null;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
};

export const withAuthHeaders = async (
  headers: Record<string, string> = {},
  tokenOverride?: string | null,
): Promise<Record<string, string>> => {
  const nextHeaders = { ...headers };

  if (AUTH_DISABLED) {
    if (!nextHeaders['X-Auth-Disabled']) {
      nextHeaders['X-Auth-Disabled'] = '1';
    }
    return nextHeaders;
  }

  const token = tokenOverride ?? (await getAccessToken());
  if (!token || nextHeaders.Authorization) {
    return nextHeaders;
  }
  return { ...nextHeaders, Authorization: `Bearer ${token}` };
};
