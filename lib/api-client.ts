import { ENV } from './env';
import { getAccessToken } from './auth-token';
import { AUTH_DISABLED } from './auth-mode';
import type {
  ExplanationResult,
  ExplanationSurface,
  GoalNavigatorRequest,
  GoalNavigatorResponse,
  PersonalizationSnapshot,
} from '@/types/personalization';

export type AuthenticatedRequestOptions = RequestInit & { token?: string | null };

const buildUrl = (path: string, baseUrl: string = ENV.apiBaseUrl) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
};

async function requestTo<T>(
  baseUrl: string,
  path: string,
  options: AuthenticatedRequestOptions = {},
): Promise<T> {
  const url = buildUrl(path, baseUrl);
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (AUTH_DISABLED) {
    headers.set('X-Auth-Disabled', '1');
  }
  const token = options.token ?? (await getAccessToken());
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
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

async function request<T>(path: string, options: AuthenticatedRequestOptions = {}): Promise<T> {
  return requestTo<T>(ENV.apiBaseUrl, path, options);
}

export type SearchRequest = {
  query: string;
  category?: string;
  brand?: string;
  page?: number;
  limit?: number;
};

export type SearchSupplement = {
  id: string;
  productId: string;
  barcode?: string | null;
  upcCode?: string | null;
  name: string;
  brand: string;
  category: string;
  categoryKey?: string | null;
  benefit: string;
  dose: string;
  imageUrl?: string | null;
  relevanceScore?: number;
  popularityScore?: number;
  matchReason?: string | null;
  factsStatus?: 'full' | 'partial' | 'none';
  coverageStatus?: 'coverage_ready' | 'not_enough_structured_data';
};

export type SearchResponse = {
  supplements: SearchSupplement[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore?: boolean;
    nextPage?: number | null;
    shown?: number;
    totalIsExact?: boolean;
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

export type SearchBootstrapResponse = {
  generatedAt: number;
  categories: Record<string, SearchSupplement[]>;
  paginationByCategory?: Record<string, SearchResponse['pagination']>;
};

export type SearchBootstrapAPIResponse =
  | SearchBootstrapResponse
  | {
      success: boolean;
      data: SearchBootstrapResponse;
    };

export type SearchProductDetailResponse = {
  product: {
    productId: string;
    barcode: string | null;
    upcCode: string | null;
    name: string;
    brand: string;
    category: string | null;
    benefit: string | null;
    dose: string | null;
    imageUrl: string | null;
    link: string | null;
    factsStatus: 'full' | 'partial' | 'none';
    coverageStatus: 'coverage_ready' | 'not_enough_structured_data';
  };
  defaultAnchor: {
    name: string | null;
    dose: string | null;
    sourceTier: string | null;
  };
  nutriScoreCardV2?: Record<string, unknown> | null;
  personalizedResultLane?: Record<string, unknown> | null;
  topBlockers?: Array<Record<string, unknown>> | null;
  overviewBlock?: {
    sourceStrip?: string[] | null;
    bestForBullets?: string[] | null;
    providesVerified?: {
      servingSize?: string | null;
      servingsPerContainer?: number | null;
      keyIngredients?: Array<{ name: string; dose?: string | null }> | null;
      dosageForm?: string | null;
      count?: string | null;
    } | null;
    missingInfo?: string[] | null;
  } | null;
  scienceBlock?: {
    ingredientSourceTier?: string | null;
    ingredientRows?: Array<{ name: string; dose?: string | null }> | null;
    ingredientSnapshotNames?: string[] | null;
    aiSummaryContract3?: [string, string, string] | null;
  } | null;
  ingredientOverview: {
    mode: 'single_anchor' | 'multi_anchor' | 'blend_anchor';
    titleLine: string | null;
    paragraph1: string;
    paragraph2: string | null;
    compareHint: string | null;
  } | null;
  ingredientOverviewSource: 'api' | 'fallback' | null;
  ingredientOverviewDiagnostics?: {
    liveWriterConfigured: boolean;
    liveWriterAttempted: boolean;
    liveWriterHit: boolean;
    attemptCount: number;
    timeoutMs: number;
    maxRetries: number;
    fallbackReason: string | null;
    lastError: string | null;
    parseFailureCount: number;
    gateRejectCount: number;
    timeoutCount: number;
    errorCount: number;
  } | null;
  scientificBackground: {
    mode: 'research_mode' | 'label_context_mode';
    selectedLabel: string;
    selectedDose: string | null;
    introLine: string | null;
    sections: Array<{
      heading: string;
      summary: string;
      bullets: string[];
      evidenceRead: string;
      shopperMeaning: string | null;
    }>;
    closingNote: string | null;
  } | null;
  scientificBackgroundSource: 'api' | 'fallback' | null;
  scientificBackgroundDiagnostics?: {
    liveWriterConfigured: boolean;
    liveWriterAttempted: boolean;
    liveWriterHit: boolean;
    attemptCount: number;
    timeoutMs: number;
    maxRetries: number;
    fallbackReason: string | null;
    lastError: string | null;
    parseFailureCount: number;
    gateRejectCount: number;
    timeoutCount: number;
    errorCount: number;
  } | null;
  deepDiveAsync?: {
    ingredientOverview?: {
      backgroundRefreshPending: boolean;
      recommendedRetryAfterMs: number | null;
    } | null;
    scientificBackground?: {
      backgroundRefreshPending: boolean;
      recommendedRetryAfterMs: number | null;
    } | null;
  } | null;
  usageBlock?: {
    directions?: {
      text?: string | null;
      lines?: string[] | null;
      sourceTier?: string | null;
      hasDirectionsTextVisible?: boolean | null;
    } | null;
  } | null;
  safetyBlock?: {
    labelWarnings?: Array<{ text?: string | null; label?: string | null } | string> | null;
    generalWatchouts?: Array<{ text?: string | null; label?: string | null } | string> | null;
    ulGuidance?: Array<{ text?: string | null; label?: string | null } | string> | null;
  } | null;
  suggestedUse: string | null;
  warnings: string | null;
  decisionDigest: string;
  decisionInputsHash?: string | null;
  personalizationScopeHash?: string | null;
  decisionContractVersion?: string | null;
};

export type SearchProductDetailAPIResponse =
  | SearchProductDetailResponse
  | {
      success: boolean;
      data: SearchProductDetailResponse;
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
    savedSupplements: {
      id: string;
      name: string;
      brand: string;
      category: string;
      imageUrl?: string | null;
      addedAt: string;
    }[];
    recentUploads: {
      id: string;
      createdAt: string;
      status: 'ready' | 'processing';
      title: string;
      brand?: string | null;
      imageUrl?: string | null;
    }[];
    overviewMetrics: {
      key: string;
      label: string;
      current: number;
      target: number;
      progress: number;
      summary: string;
    }[];
  };
  message?: string;
};

export type NutriTipSource = {
  title: string;
  url: string;
  publisher: string;
  regions: string[];
};

export type NutriTip = {
  id: string;
  title: string;
  coverText: string;
  detailMarkdown: string;
  pillar: string;
  pillarKey: 'safety' | 'label' | 'how_to' | 'ingredient' | 'habits' | 'marketing';
  riskLevel: 'low' | 'medium' | 'high';
  evidenceLevel: 'high' | 'moderate' | 'emerging';
  evidenceType: 'fact_sheet' | 'regulatory_guidance' | 'primary_study';
  jurisdictionScope: 'global' | 'mixed' | 'us' | 'canada';
  lastReviewed: string;
  primaryActionType: string;
  reviewCadenceDays: number;
  supplement: string;
  supplementKey: string;
  sources: NutriTipSource[];
  cautions: string[];
  tags: string[];
};

export type NutriTipRotation = {
  method: string;
  indexFormula: string;
  epoch: string;
  notes?: string;
};

export type NutriTipCadenceSlot = {
  day: number;
  pillarKey: NutriTip['pillarKey'];
};

export type NutriTipRotationAdvanced = {
  method: string;
  epoch: string;
  notes?: string;
  cadencePattern7Days: NutriTipCadenceSlot[];
  selectionFormula: string;
  requiresClientImplementation: boolean;
};

export type NutriTipRegionProfile = {
  marketName: string;
  regulator: string;
  regulatorNote: string;
  labelIdentifiersNote: string;
  adverseEventReportingHint: string;
};

export type NutriTipsData = {
  name: string;
  version: string;
  generatedAtUTC: string;
  tipsCount: number;
  defaultRegion: string;
  supportedRegions: string[];
  regionProfiles: Record<string, NutriTipRegionProfile>;
  rotation: NutriTipRotation;
  rotationAdvanced?: NutriTipRotationAdvanced;
  disclaimerShort: string;
  disclaimerFull: string;
  tips: NutriTip[];
};

export type NutriTipsResponse = {
  success: boolean;
  data?: NutriTipsData;
  message?: string;
};

export type PersonalizationExplainResponse = {
  payload: {
    snapshotId: string;
    rulesVersion: string;
    surface: ExplanationSurface;
    selectedGoals: string[];
    selectedTypes: string[];
    facts: Array<{
      factId: string;
      code: string;
      params?: Record<string, string | number | boolean>;
    }>;
  };
  result: ExplanationResult;
};

export type GoalNavigatorBundleDebugResponse = {
  run: {
    id: string;
    artifactKind: string;
    schemaVersion: string;
    rulesVersion: string;
    sourceTable: string;
    sourceRowCount: number;
    preparedCandidateCount: number;
    notEnoughStructuredDataCount: number;
    artifactPath: string | null;
    storageBucket: string | null;
    storagePath: string | null;
    artifactByteSize: number | null;
    artifactChecksum: string | null;
    isActive: boolean;
    activatedAt: string | null;
    generatedAt: string;
    createdAt: string;
    buildMeta: Record<string, unknown>;
  } | null;
  summary: {
    totalGapRows: number;
    returnedGapRows: number;
    gapCodeCounts: Record<string, number>;
    factsStatusCounts: Record<string, number>;
    priorities: Array<{
      key: string;
      affectedProducts: number;
      recommendedAction: string;
      sampleTitles: string[];
    }>;
  };
  gaps: Array<{
    id: string;
    productId: string;
    sourceProductId: string | null;
    title: string | null;
    brandName: string | null;
    factsStatus: string;
    gapCodes: string[];
    details: Record<string, unknown>;
    createdAt: string;
  }>;
  runtime: {
    currentBundle: {
      source: 'storage' | 'disk' | 'live' | null;
      activeRunId: string | null;
      generatedAt: string | null;
      loadedAt: string | null;
      storageBucket: string | null;
      storagePath: string | null;
      artifactPath: string | null;
    };
    counters: {
      storageHits: number;
      diskHits: number;
      liveHits: number;
      liveBuildCount: number;
      precomputedMissCount: number;
      fallbackToLiveBuildCount: number;
      totalLoads: number;
      precomputedHitRate: number;
    };
    lastErrors: {
      storage: string | null;
      disk: string | null;
    };
  };
};

export type EnsureOverviewFactActive = {
  name: string;
  amount: number | null;
  unit: string | null;
  amountText: string | null;
  source: 'label' | 'dsld' | 'lnhpd' | 'web';
  confidence: number | null;
};

export type EnsureOverviewFacts = {
  version: 'facts_v1';
  factsDigestHash: string;
  factsSourceVersion: string;
  product: {
    name: string | null;
    brandDisplay: string | null;
    dosageForm: string | null;
  };
  actives: EnsureOverviewFactActive[];
  directions: {
    rawText: string | null;
  };
  overlay: {
    provider: 'iherb';
    brandName: string | null;
    title: string | null;
    description: string | null;
    link: string | null;
    imageUrl: string | null;
    suggestedUse: string | null;
    warningsText: string | null;
    ingredients: Array<{
      name: string;
      dose: string | null;
    }>;
  } | null;
};

export type EnsureOverviewRequest = {
  supplementId?: string | null;
  barcode?: string | null;
  brandName?: string | null;
  productName: string;
  dosageText?: string | null;
  userSupplementId?: string | null;
};

export type EnsureOverviewResponse = {
  supplementId: string;
  analysisReady: boolean;
  source?: 'deepseek' | 'rule' | 'cache' | 'none';
  analysisData?: unknown | null;
  facts?: EnsureOverviewFacts | null;
  factsStatus?: 'full' | 'partial' | 'none';
  factsDigestHash?: string | null;
  factsSourceVersion?: string | null;
  aiStatus?: 'ready' | 'pending' | 'blocked' | 'none';
  aiRetryAfterSec?: number | null;
  aiBlockedReason?: string | null;
};

export const apiClient = {
  search: (payload: SearchRequest, options?: AuthenticatedRequestOptions) =>
    requestTo<SearchAPIResponse>(ENV.searchApiBaseUrl, `/api/search?${new URLSearchParams({
      q: payload.query,
      ...(payload.category ? { category: payload.category } : {}),
      ...(payload.brand ? { brand: payload.brand } : {}),
      ...(payload.page ? { page: String(payload.page) } : {}),
      ...(payload.limit ? { limit: String(payload.limit) } : {}),
    }).toString()}`, { method: 'GET', ...options }),

  searchBootstrap: (options?: AuthenticatedRequestOptions) =>
    requestTo<SearchBootstrapAPIResponse>(ENV.searchApiBaseUrl, '/api/search/bootstrap', {
      method: 'GET',
      ...options,
    }),

  searchProductDetail: (
    productId: string,
    options?: (AuthenticatedRequestOptions & { revalidateFallback?: boolean }),
  ) => {
    const { revalidateFallback, ...requestOptions } = options ?? {};
    const params = new URLSearchParams({ productId });
    if (revalidateFallback === true) {
      params.set('revalidateFallback', '1');
    }
    return requestTo<SearchProductDetailAPIResponse>(
      ENV.searchApiBaseUrl,
      `/api/search/product-detail?${params.toString()}`,
      {
        method: 'GET',
        ...requestOptions,
      },
    );
  },

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

  nutriTips: (options?: AuthenticatedRequestOptions) =>
    request<NutriTipsResponse>('/api/nutri-tips', { method: 'GET', ...options }),

  explainPersonalization: (
    payload: {
      snapshot: PersonalizationSnapshot;
      surface: ExplanationSurface;
    },
    options?: AuthenticatedRequestOptions,
  ) =>
    request<PersonalizationExplainResponse>('/api/personalization/explain', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...options,
    }),

  fetchGoalNavigator: (payload: GoalNavigatorRequest, options?: AuthenticatedRequestOptions) =>
    request<GoalNavigatorResponse>('/api/personalization/goal-navigator', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...options,
    }),

  fetchGoalNavigatorBundleDebug: (
    payload: { limit?: number } = {},
    options?: AuthenticatedRequestOptions,
  ) =>
    request<GoalNavigatorBundleDebugResponse>(
      `/api/personalization/debug/goal-navigator-bundle?${new URLSearchParams({
        ...(payload.limit ? { limit: String(payload.limit) } : {}),
      }).toString()}`,
      {
        method: 'GET',
        ...options,
      },
    ),

  ensureOverview: (payload: EnsureOverviewRequest, options?: AuthenticatedRequestOptions) =>
    request<EnsureOverviewResponse>('/api/ensure-overview', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...options,
    }),
};
