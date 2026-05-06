const collectParams = (input: string): Record<string, string> => {
  const params = new URLSearchParams(input);
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
};

export const parseAuthRedirectParams = (url: string): Record<string, string> => {
  const params: Record<string, string> = {};

  try {
    const parsed = new URL(url);

    if (parsed.search) {
      Object.assign(params, collectParams(parsed.search.slice(1)));
    }

    if (parsed.hash) {
      const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
      const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash;
      if (hashQuery) {
        Object.assign(params, collectParams(hashQuery));
      }
    }
  } catch {
    const [_, query] = url.split('?');
    if (query) {
      Object.assign(params, collectParams(query));
    }
  }

  return params;
};

export const encodeAuthRedirectParam = (target: string): string => encodeURIComponent(target);

export const normalizeAuthRedirectParam = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;

  try {
    const decoded = decodeURIComponent(trimmed);
    return decoded.startsWith('/') && !decoded.startsWith('//') ? decoded : trimmed;
  } catch {
    return trimmed;
  }
};
