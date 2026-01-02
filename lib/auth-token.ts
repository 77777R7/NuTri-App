import { supabase } from '@/lib/supabase';

export const getAccessToken = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
};

export const withAuthHeaders = async (
  headers: Record<string, string> = {},
  tokenOverride?: string | null,
): Promise<Record<string, string>> => {
  const token = tokenOverride ?? (await getAccessToken());
  if (!token || headers.Authorization) {
    return headers;
  }
  return { ...headers, Authorization: `Bearer ${token}` };
};
