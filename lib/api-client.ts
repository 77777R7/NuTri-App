import { ENV } from './env';

export type AuthenticatedRequestOptions = RequestInit & { token?: string | null };

const buildUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${ENV.apiBaseUrl}${normalizedPath}`;
};

async function request<T>(path: string, options: AuthenticatedRequestOptions = {}): Promise<T> {
  const url = buildUrl(path);
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const error = new Error(errorText || `Request failed with status ${response.status}`);
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export type SearchRequest = {
  query: string;
  category?: string;
  brand?: string;
  page?: number;
};

export type SearchSupplement = {
  id: string;
  name: string;
  brand: string;
  category: string;
  imageUrl?: string | null;
  relevanceScore?: number;
};

export type SearchResponse = {
  supplements: SearchSupplement[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  suggestions: {
    categories: string[];
    brands: string[];
    popularSearches: string[];
  };
};

export type SearchAPIResponse =
  | SearchResponse
  | {
      success: boolean;
      data: SearchResponse;
    };

export type AnalyzeRequest = {
  scanId?: string;
  text: string;
};

export type AnalyzeResponse = {
  ok: boolean;
  analysis: unknown;
};

export type TrackerEntry = {
  id: string;
  supplementId: string;
  takenAt: string;
};

export type Reminder = {
  id: string;
  supplementId: string;
  schedule: string;
  enabled: boolean;
};

export type ProfileResponse = {
  success: boolean;
  data?: {
    userId: string;
    email: string | null;
    role: string;
    subscriptionStatus: string;
    source: string;
  };
};

export type HomeDashboardResponse = {
  success: boolean;
  data?: {
    savedSupplements: Array<{
      id: string;
      name: string;
      brand: string;
      category: string;
      imageUrl?: string | null;
      addedAt: string;
    }>;
    recentUploads: Array<{
      id: string;
      createdAt: string;
      status: 'ready' | 'processing';
      title: string;
      brand?: string | null;
      imageUrl?: string | null;
    }>;
    overviewMetrics: Array<{
      key: string;
      label: string;
      current: number;
      target: number;
      progress: number;
      summary: string;
    }>;
  };
  message?: string;
};

export const apiClient = {
  search: (payload: SearchRequest, options?: AuthenticatedRequestOptions) =>
    request<SearchAPIResponse>(`/api/search?${new URLSearchParams({
      q: payload.query,
      ...(payload.category ? { category: payload.category } : {}),
      ...(payload.brand ? { brand: payload.brand } : {}),
      ...(payload.page ? { page: String(payload.page) } : {}),
    }).toString()}`, { method: 'GET', ...options }),

  analyze: (payload: AnalyzeRequest, options?: AuthenticatedRequestOptions) =>
    request<AnalyzeResponse>('/api/analyze', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...options,
    }),

  getTracker: (options?: AuthenticatedRequestOptions) =>
    request<{ entries: TrackerEntry[] }>('/api/tracker', { method: 'GET', ...options }),

  updateTracker: (entries: TrackerEntry[], options?: AuthenticatedRequestOptions) =>
    request<{ entries: TrackerEntry[] }>('/api/tracker', {
      method: 'POST',
      body: JSON.stringify({ entries }),
      ...options,
    }),

  getReminders: (options?: AuthenticatedRequestOptions) =>
    request<{ reminders: Reminder[] }>('/api/reminders', { method: 'GET', ...options }),

  updateReminders: (reminders: Reminder[], options?: AuthenticatedRequestOptions) =>
    request<{ reminders: Reminder[] }>('/api/reminders', {
      method: 'POST',
      body: JSON.stringify({ reminders }),
      ...options,
    }),

  me: (options?: AuthenticatedRequestOptions) => request<ProfileResponse>('/api/me', { method: 'GET', ...options }),

  authStart: (provider: 'google' | 'apple', redirectUri: string) =>
    request<{
      authorizationUrl: string;
      state: string;
      codeVerifier: string;
      expiresAt: string;
    }>(`/api/auth/mobile/start?${new URLSearchParams({ provider, redirectUri }).toString()}`, { method: 'GET' }),

  authExchange: (payload: { state: string; codeVerifier: string }) =>
    request<{
      token: string;
      expiresAt: string;
      expiresIn: number;
      user: {
        id: string;
        email?: string | null;
        role: string;
        subscription: string;
      };
    }>('/api/auth/mobile/exchange', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  homeDashboard: (options?: AuthenticatedRequestOptions) =>
    request<HomeDashboardResponse>('/api/mobile/home', { method: 'GET', ...options }),
};
