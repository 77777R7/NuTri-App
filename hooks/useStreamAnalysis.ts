import { useEffect, useMemo, useRef, useState } from 'react';
import RNEventSource from 'react-native-sse';

import { Config } from '@/constants/Config';
import { withAuthHeaders } from '@/lib/auth-token';
import { AUTH_DISABLED } from '@/lib/auth-mode';
import { resolveBrand } from '@/lib/brand/resolveBrand';
import { getGuestScanSession } from '@/lib/scan/guestSession';
import type { SearchResultSeed } from '@/lib/scan/session';
import {
    resolveTrustedDisplayIdentity,
    type DisplayIdentityMode,
    type DisplayIdentitySourceAttribution,
} from '@/lib/scan/resolveTrustedDisplayIdentity';
import { buildBarcodeSnapshot } from '@/lib/snapshot';
import { hasMeaningfulPartialData, shouldTreatStreamErrorAsPartialComplete } from '@/lib/scan/streamStateMachine';
import type { SupplementSnapshot } from '@/types/supplementSnapshot';
import type { AnalysisBundle } from '@/types/analysisBundle';

// ============================================================================
// TYPES
// ============================================================================

// Brand extraction result from backend
type BrandExtraction = {
    brand: string | null;
    product: string | null;
    category: string | null;
    confidence: 'high' | 'medium' | 'low';
    source: 'rule' | 'ai';
};

// Enhanced source with quality indicators
type EnrichedSource = {
    title: string;
    link: string;
    domain?: string;
    isHighQuality?: boolean;
};

// Product info from backend
type ProductInfo = {
    brand: string | null;
    name: string | null;
    category?: string | null;
    image?: string | null;
};

type StreamLaunchOptions = {
    launchSource?: string | null;
    searchSeed?: SearchResultSeed | null;
    scanSessionId?: string | null;
    guestScanSessionId?: string | null;
};

// Ingredient analysis from enhanced efficacy
type IngredientAnalysis = {
    name: string;
    form: string | null;
    formQuality: 'high' | 'medium' | 'low' | 'unknown';
    formNote: string | null;
    dosageValue: number | null;
    dosageUnit: string | null;
    recommendedMin: number | null;
    recommendedMax: number | null;
    recommendedUnit: string | null;
    dosageAssessment: 'adequate' | 'underdosed' | 'overdosed' | 'unknown';
    evidenceLevel: 'strong' | 'moderate' | 'weak' | 'none';
    evidenceSummary: string | null;
};

// Primary active ingredient
type PrimaryActive = {
    name: string;
    form: string | null;
    formQuality: 'high' | 'medium' | 'low' | 'unknown';
    formNote: string | null;
    dosageValue: number | null;
    dosageUnit: string | null;
    evidenceLevel: 'strong' | 'moderate' | 'weak' | 'none';
    evidenceSummary: string | null;
};

// Enhanced efficacy analysis
type EfficacyAnalysis = {
    score?: number | null;
    verdict: string;
    primaryActive?: PrimaryActive | null;
    ingredients?: IngredientAnalysis[];
    overviewSummary?: string | null;
    coreBenefits?: string[];
    overallAssessment?: string;
    marketingVsReality?: string;
    // Legacy fields for backward compatibility
    benefits?: string[];
    activeIngredients?: { name: string; amount: string }[];
    mechanisms?: { name: string; amount: string; fill: number }[];
};

// UL Warning
type ULWarning = {
    ingredient: string;
    currentDose: string;
    ulLimit: string;
    riskLevel: 'moderate' | 'high';
};

// Enhanced safety analysis
type SafetyAnalysis = {
    score?: number | null;
    verdict: string;
    risks: string[];
    redFlags: string[];
    ulWarnings?: ULWarning[];
    allergens?: string[];
    interactions?: string[];
    consultDoctorIf?: string[];
    recommendation: string;
};

// Enhanced usage analysis
type UsageAnalysis = {
    summary: string;
    timing: string;
    withFood: boolean | null;
    frequency?: string;
    interactions?: string[];
};

type ValueAnalysis = {
    score?: number | null;
    verdict: string;
    analysis: string;
    costPerServing?: number | null;
    alternatives?: string[];
};

type SocialAnalysis = {
    score?: number | null;
    summary: string;
};

type AnalysisStatus = 'idle' | 'loading' | 'streaming' | 'complete' | 'not_found' | 'error';
type ErrorKind = 'none' | 'not_found' | 'unauthorized' | 'network' | 'server';

// Main analysis state
type AnalysisState = {
    brandExtraction: BrandExtraction | null;
    productInfo: ProductInfo | null;
    sources: EnrichedSource[];
    efficacy: EfficacyAnalysis | null;
    safety: SafetyAnalysis | null;
    usage: UsageAnalysis | null;
    value: ValueAnalysis | null;
    social: SocialAnalysis | null;
    meta: any | null;
    analysisMeta: {
        status: 'catalog_only' | 'label_enriched' | 'ai_enriched' | 'complete' | null;
        version: number | null;
        labelExtraction: {
            source: 'dsld' | 'label_scan' | 'lnhpd' | 'manual';
            fetchedAt: string | null;
            datasetVersion: string | null;
        } | null;
    } | null;
    analysisBundle: AnalysisBundle | null;
    status: AnalysisStatus;
    errorKind: ErrorKind;
    reasonCode: string | null;
    stage: string | null;
    requestId: string | null;
    lastSseEventType: string | null;
    watchdogReason: string | null;
    error: string | null;
};

type AnalysisStateWithSnapshot = AnalysisState & {
    snapshot: SupplementSnapshot | null;
    displayIdentityMode: DisplayIdentityMode;
    displayIdentitySourceAttribution: DisplayIdentitySourceAttribution;
    titleSanitized: boolean;
};

type SseNotFoundPayload = {
    schemaVersion?: number | null;
    code?: string | null;
    error?: string | null;
    stage?: string | null;
    reasonCode?: string | null;
    retryable?: boolean | null;
    requestId?: string | null;
    message?: string | null;
};

type ParsedStreamError =
    | {
        kind: 'not_found';
        message: string;
        reasonCode: string | null;
        stage: string | null;
        requestId: string | null;
      }
    | {
        kind: 'unauthorized' | 'network' | 'server';
        message: string;
        reasonCode: string | null;
        stage: string | null;
        requestId: string | null;
      };

const CORE_SECTION_KEYS = ['overview', 'ingredients', 'usage', 'safety'] as const;
const TERMINAL_STATUSES: ReadonlySet<AnalysisStatus> = new Set(['not_found', 'error', 'complete']);

const parsePositiveInt = (rawValue: string | undefined, fallback: number): number => {
    if (!rawValue) return fallback;
    const parsed = Number.parseInt(rawValue, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const STREAM_CONNECT_GUARD_MS = parsePositiveInt(process.env.EXPO_PUBLIC_SCAN_CONNECT_GUARD_MS, 20_000);
const STREAM_REV1_GUARD_MS = parsePositiveInt(process.env.EXPO_PUBLIC_SCAN_REV1_GUARD_MS, 45_000);
const STREAM_REV1_DONE_WATCHDOG_MS = parsePositiveInt(process.env.EXPO_PUBLIC_SCAN_REV1_DONE_WATCHDOG_MS, 12_000);
const SHOW_SCAN_DEBUG =
    process.env.EXPO_PUBLIC_SHOW_SCAN_DEBUG === 'true' ||
    process.env.EXPO_PUBLIC_SHOW_SCAN_DEBUG === '1';
const REQUEST_STREAM_MODE_RAW =
    typeof process.env.EXPO_PUBLIC_SCAN_STREAM_MODE === 'string'
        ? process.env.EXPO_PUBLIC_SCAN_STREAM_MODE.trim().toLowerCase()
        : '';
const USE_BUNDLE_ONLY_STREAM_MODE =
    REQUEST_STREAM_MODE_RAW === 'analysis_bundle_only'
    || REQUEST_STREAM_MODE_RAW === 'bundle_only'
    || REQUEST_STREAM_MODE_RAW === 'analysis_bundle';
const EXPECTED_DEGRADED_REASON_CODES = new Set([
    'BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH',
    'DEGRADED_WEB_BUDGET',
    'DEGRADED_EVENTLOOP',
    'REV1_WATCHDOG_TIMEOUT',
]);

const normalizeSeedText = (value?: string | null): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const buildSeededProductInfo = (seed?: SearchResultSeed | null): ProductInfo | null => {
    if (!seed) return null;
    const name = normalizeSeedText(seed.name);
    const brand = normalizeSeedText(seed.brand);
    const category = normalizeSeedText(seed.category);
    const image = normalizeSeedText(seed.imageUrl ?? null);
    if (!name && !brand && !category && !image) return null;
    return {
        brand,
        name,
        category,
        image,
    };
};

const buildInitialAnalysisState = (seed?: SearchResultSeed | null): AnalysisState => ({
    brandExtraction: null,
    productInfo: buildSeededProductInfo(seed),
    sources: [],
    efficacy: null,
    safety: null,
    usage: null,
    value: null,
    social: null,
    meta: null,
    analysisMeta: null,
    analysisBundle: null,
    status: 'idle',
    errorKind: 'none',
    reasonCode: null,
    stage: null,
    requestId: null,
    lastSseEventType: null,
    watchdogReason: null,
    error: null,
});

const buildSearchSeedFingerprint = (seed?: SearchResultSeed | null): string => {
    if (!seed) return '';
    return [
        normalizeSeedText(seed.productId),
        normalizeSeedText(seed.barcode ?? null),
        normalizeSeedText(seed.upcCode ?? null),
        normalizeSeedText(seed.name),
        normalizeSeedText(seed.brand),
        normalizeSeedText(seed.category),
        normalizeSeedText(seed.imageUrl ?? null),
        normalizeSeedText(seed.factsStatus ?? null),
        normalizeSeedText(seed.coverageStatus ?? null),
    ].join('|');
};

export const resolveTerminalStatus = (params: {
    previousStatus: AnalysisStatus;
    nextStatus: AnalysisStatus;
}): AnalysisStatus => {
    if (
        TERMINAL_STATUSES.has(params.previousStatus)
        && params.previousStatus !== params.nextStatus
    ) {
        return params.previousStatus;
    }
    return params.nextStatus;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const toOptionalString = (value: unknown): string | null =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const readSectionDataStatus = (
    bundle: AnalysisBundle,
    section: (typeof CORE_SECTION_KEYS)[number],
): string | null => {
    const status = (bundle as Record<string, any>)?.sections?.[section]?.dataStatus;
    return typeof status === 'string' ? status : null;
};

export const isUsableResultBundle = (bundle: AnalysisBundle | null | undefined): boolean => {
    if (!bundle?.meta) return false;
    if (!Number.isFinite(bundle.meta.revision) || bundle.meta.revision < 1) return false;
    const coreStatuses = CORE_SECTION_KEYS
        .map((section) => readSectionDataStatus(bundle, section))
        .filter((status): status is string => Boolean(status));
    if (coreStatuses.length !== CORE_SECTION_KEYS.length) return false;
    return !coreStatuses.every((status) => status === 'pending');
};

export const resolveDoneTerminalStatus = (state: Pick<
    AnalysisState,
    'analysisBundle'
>): 'complete' | 'error' =>
    isUsableResultBundle(state.analysisBundle)
        ? 'complete'
        : 'error';

const isLikelyNetworkError = (message: string): boolean => {
    const normalized = message.toLowerCase();
    return (
        normalized.includes('network')
        || normalized.includes('connect')
        || normalized.includes('connection')
        || normalized.includes('timed out')
        || normalized.includes('timeout')
        || normalized.includes('dns')
        || normalized.includes('offline')
        || normalized.includes('socket')
        || normalized.includes('failed to fetch')
    );
};

const parseNotFoundPayload = (payload: unknown): SseNotFoundPayload | null => {
    if (!isRecord(payload)) return null;
    return {
        schemaVersion:
            typeof payload.schemaVersion === 'number' && Number.isFinite(payload.schemaVersion)
                ? payload.schemaVersion
                : null,
        code: toOptionalString(payload.code),
        error: toOptionalString(payload.error),
        stage: toOptionalString(payload.stage),
        reasonCode: toOptionalString(payload.reasonCode),
        retryable: typeof payload.retryable === 'boolean' ? payload.retryable : null,
        requestId: toOptionalString(payload.requestId),
        message: toOptionalString(payload.message),
    };
};

export const parseStreamErrorEvent = (params: {
    payload?: unknown;
    xhrStatus?: number | null;
    fallbackMessage?: string | null;
}): ParsedStreamError => {
    const payload = parseNotFoundPayload(params.payload);
    const payloadMessage = payload?.message ?? payload?.error ?? null;
    const payloadCode = payload?.code?.toUpperCase() ?? null;
    const message = payloadMessage ?? toOptionalString(params.fallbackMessage) ?? 'Scan failed';
    const normalizedMessage = message.toLowerCase();
    const normalizedError = (payload?.error ?? '').toLowerCase();
    const isAuthErrorToken =
        normalizedMessage.includes('missing_authorization')
        || normalizedMessage.includes('invalid_or_expired_token')
        || normalizedMessage.includes('invalid_authorization')
        || normalizedMessage.includes('unauthorized')
        || normalizedError.includes('missing_authorization')
        || normalizedError.includes('invalid_or_expired_token')
        || normalizedError.includes('invalid_authorization')
        || normalizedError.includes('unauthorized');
    if (payloadCode === 'NOT_FOUND' || payloadMessage === 'Product not found') {
        return {
            kind: 'not_found',
            message: payloadMessage ?? 'Product not found',
            reasonCode: payload?.reasonCode ?? null,
            stage: payload?.stage ?? null,
            requestId: payload?.requestId ?? null,
        };
    }

    const statusCode = Number.isFinite(params.xhrStatus) ? Number(params.xhrStatus) : null;
    if (statusCode === 401 || statusCode === 403 || isAuthErrorToken) {
        return {
            kind: 'unauthorized',
            message: message || 'Unauthorized (please sign in or enable dev auth bypass)',
            reasonCode: payload?.reasonCode ?? null,
            stage: payload?.stage ?? null,
            requestId: payload?.requestId ?? null,
        };
    }

    if (isLikelyNetworkError(message)) {
        return {
            kind: 'network',
            message,
            reasonCode: payload?.reasonCode ?? null,
            stage: payload?.stage ?? null,
            requestId: payload?.requestId ?? null,
        };
    }

    return {
        kind: 'server',
        message,
        reasonCode: payload?.reasonCode ?? null,
        stage: payload?.stage ?? null,
        requestId: payload?.requestId ?? null,
    };
};

export function useStreamAnalysis(barcode: string, options?: StreamLaunchOptions): AnalysisStateWithSnapshot {
    const normalizedLaunchSource = typeof options?.launchSource === 'string'
        ? options.launchSource.trim().toLowerCase()
        : '';
    const searchSeed = options?.searchSeed ?? null;
    const scanSessionId = typeof options?.scanSessionId === 'string' && options.scanSessionId.trim().length > 0
        ? options.scanSessionId.trim()
        : null;
    const guestScanSessionId =
        typeof options?.guestScanSessionId === 'string' && options.guestScanSessionId.trim().length > 0
            ? options.guestScanSessionId.trim()
            : null;
    const searchSeedFingerprint = buildSearchSeedFingerprint(searchSeed);
    const [state, setState] = useState<AnalysisState>(() => buildInitialAnalysisState(searchSeed));
    const [serverSnapshot, setServerSnapshot] = useState<SupplementSnapshot | null>(null);

    const eventSourceRef = useRef<RNEventSource | null>(null);
    const hasBundleRef = useRef(false);
    const rev1SeenRef = useRef(false);
    const terminalLockedRef = useRef(false);
    const rev1DoneWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!barcode) {
            setState(buildInitialAnalysisState(searchSeed));
            setServerSnapshot(null);
            return;
        }

        let sawAnyActivity = false;

        setState({
            ...buildInitialAnalysisState(searchSeed),
            status: 'loading',
        });
        setServerSnapshot(null);
        hasBundleRef.current = false;
        rev1SeenRef.current = false;
        terminalLockedRef.current = false;

        const rawBaseUrl = Config.searchApiBaseUrl;
        const API_URL = rawBaseUrl.endsWith('/') ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
        let isActive = true;
        const clearRev1DoneWatchdog = () => {
            if (!rev1DoneWatchdogRef.current) return;
            clearTimeout(rev1DoneWatchdogRef.current);
            rev1DoneWatchdogRef.current = null;
        };
        const closeStream = () => {
            clearRev1DoneWatchdog();
            if (eventSourceRef.current) {
                eventSourceRef.current.removeAllEventListeners();
                eventSourceRef.current.close();
            }
        };

        const applyStateUpdate = (updater: (prev: AnalysisState) => AnalysisState) => {
            setState((prev) => {
                if (terminalLockedRef.current) return prev;
                const next = updater(prev);
                const resolvedStatus = resolveTerminalStatus({
                    previousStatus: prev.status,
                    nextStatus: next.status,
                });
                if (resolvedStatus !== next.status) {
                    return prev;
                }
                if (TERMINAL_STATUSES.has(resolvedStatus)) {
                    terminalLockedRef.current = true;
                }
                return next;
            });
        };
        const canSettleSearchLaunchAsPartial = (prev: AnalysisState): boolean =>
            normalizedLaunchSource === 'search' && hasMeaningfulPartialData(prev);

        const armRev1DoneWatchdog = () => {
            clearRev1DoneWatchdog();
            rev1DoneWatchdogRef.current = setTimeout(() => {
                if (!isActive || terminalLockedRef.current) return;
                applyStateUpdate((prev) => {
                    if (prev.status === 'complete' || prev.status === 'not_found' || prev.status === 'error') {
                        return prev;
                    }
                    const hasPartial = isUsableResultBundle(prev.analysisBundle) || hasMeaningfulPartialData(prev);
                    if (!hasPartial) {
                        return {
                            ...prev,
                            status: 'error',
                            errorKind: 'network',
                            reasonCode: prev.reasonCode ?? 'REV1_WATCHDOG_TIMEOUT',
                            stage: prev.stage ?? 'stream',
                            watchdogReason: 'REV1_WATCHDOG_TIMEOUT',
                            error: prev.error ?? 'Analysis stream timed out before completion.',
                        };
                    }
                    return {
                        ...prev,
                        status: 'complete',
                        errorKind: 'none',
                        reasonCode: prev.reasonCode ?? 'REV1_WATCHDOG_TIMEOUT',
                        stage: prev.stage ?? 'stream',
                        watchdogReason: 'REV1_WATCHDOG_TIMEOUT',
                        error: null,
                    };
                });
                closeStream();
            }, STREAM_REV1_DONE_WATCHDOG_MS);
        };

        const markActivity = () => {
            sawAnyActivity = true;
        };

        const markSseEvent = (eventType: string) => {
            applyStateUpdate((prev) => ({
                ...prev,
                lastSseEventType: eventType,
            }));
        };

        const connectGuard = setTimeout(() => {
            if (!isActive) return;
            if (sawAnyActivity) return;
            applyStateUpdate((prev) => {
                if (prev.status !== 'loading') return prev;
                if (canSettleSearchLaunchAsPartial(prev)) {
                    return {
                        ...prev,
                        status: 'complete',
                        errorKind: 'none',
                        reasonCode: prev.reasonCode ?? 'SEARCH_SEED_CONNECT_TIMEOUT',
                        stage: prev.stage ?? 'connect',
                        lastSseEventType: prev.lastSseEventType ?? 'connect_timeout',
                        error: null,
                    };
                }
                return {
                    ...prev,
                    status: 'error',
                    errorKind: 'network',
                    reasonCode: prev.reasonCode ?? 'CONNECT_TIMEOUT',
                    stage: prev.stage ?? 'connect',
                    lastSseEventType: prev.lastSseEventType ?? 'connect_timeout',
                    error: prev.error ?? 'Unable to connect while analyzing. Please retry.',
                };
            });
            closeStream();
        }, STREAM_CONNECT_GUARD_MS);

        const rev1Guard = setTimeout(() => {
            if (!isActive) return;
            applyStateUpdate((prev) => {
                if (prev.status !== 'loading' && prev.status !== 'streaming') return prev;
                const revision =
                    typeof prev.analysisBundle?.meta?.revision === 'number'
                        ? prev.analysisBundle.meta.revision
                        : null;
                if (revision != null && revision >= 1) return prev;
                if (canSettleSearchLaunchAsPartial(prev)) {
                    return {
                        ...prev,
                        status: 'complete',
                        errorKind: 'none',
                        reasonCode: prev.reasonCode ?? 'SEARCH_SEED_REV1_TIMEOUT',
                        stage: prev.stage ?? 'stream',
                        lastSseEventType: prev.lastSseEventType ?? 'rev1_timeout',
                        error: null,
                    };
                }
                return {
                    ...prev,
                    status: 'error',
                    errorKind: 'network',
                    reasonCode: prev.reasonCode ?? 'STREAM_TIMEOUT_REV1_MISSING',
                    stage: prev.stage ?? 'stream',
                    lastSseEventType: prev.lastSseEventType ?? 'rev1_timeout',
                    error: prev.error ?? 'We lost connection while analyzing. Please retry.',
                };
            });
            closeStream();
        }, STREAM_REV1_GUARD_MS);

        const startStream = async () => {
            const headers = await withAuthHeaders({
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
            });
            if (scanSessionId) {
                headers['X-Scan-Session-Id'] = scanSessionId;
            }
            if (guestScanSessionId) {
                const guestSession = await getGuestScanSession(guestScanSessionId);
                if (guestSession?.claimToken) {
                    headers['X-Guest-Scan-Session-Id'] = guestSession.guestScanSessionId;
                    headers['X-Guest-Scan-Claim-Token'] = guestSession.claimToken;
                }
            }
            if (!isActive) return;

            console.log('[SSE] Init:', {
                apiUrl: API_URL,
                authDisabled: AUTH_DISABLED,
                hasBearer: Boolean(headers.Authorization),
            });

            const streamPayload: Record<string, unknown> = USE_BUNDLE_ONLY_STREAM_MODE
                ? { barcode, streamMode: 'analysis_bundle_only' as const }
                : { barcode };
            if (normalizedLaunchSource) {
                streamPayload.launchSource = normalizedLaunchSource;
            }
            if (scanSessionId) {
                streamPayload.scanSessionId = scanSessionId;
            }
            if (searchSeed) {
                streamPayload.searchContext = {
                    productId: searchSeed.productId,
                    barcode: searchSeed.barcode ?? null,
                    upcCode: searchSeed.upcCode ?? null,
                    productName: searchSeed.name,
                    brandName: searchSeed.brand,
                    category: searchSeed.category,
                    factsStatus: searchSeed.factsStatus ?? null,
                    coverageStatus: searchSeed.coverageStatus ?? null,
                };
            }

            // Initialize SSE connection (POST method)
            const es = new RNEventSource(`${API_URL}/api/enrich-stream`, {
                method: 'POST',
                headers,
                // `EXPO_PUBLIC_SCAN_STREAM_MODE=analysis_bundle_only` can be enabled for soak/debug.
                // Product default is full mode so authoritative mappings are not prematurely short-circuited.
                body: JSON.stringify(streamPayload),
                // Mobile networks can drop long-lived SSE connections; allow reconnects so scans
                // can recover and hit backend caches instead of stalling the UI.
                pollingInterval: 5000,
            });

            eventSourceRef.current = es;

            // Listeners
            es.addEventListener('open', () => {
                markActivity();
                markSseEvent('open');
                console.log('[SSE] Connection Opened');
                applyStateUpdate(prev => ({ ...prev, status: 'streaming' }));
            });

            es.addEventListener('message', (event) => {
                // Standard message listener for debugging
            });

            // NEW: Brand Extraction (comes before product_info)
            es.addEventListener('brand_extracted' as any, (event: any) => {
                try {
                    markActivity();
                    markSseEvent('brand_extracted');
                    const data = JSON.parse(event.data) as BrandExtraction;
                    console.log('[SSE] Brand Extracted:', data);
                    applyStateUpdate(prev => ({
                        ...prev,
                        brandExtraction: data,
                        productInfo: prev.productInfo
                            ? {
                                ...prev.productInfo,
                                brand: resolveBrand(data, prev.productInfo.brand),
                            }
                            : prev.productInfo,
                    }));
                } catch (e) {
                    console.error('[SSE] Failed to parse brand_extracted:', e);
                }
            });

            // Product Info (enhanced with sources)
            es.addEventListener('product_info' as any, (event: any) => {
                try {
                    markActivity();
                    markSseEvent('product_info');
                    const data = JSON.parse(event.data);
                    console.log('[SSE] Product Info:', data);
                    const nextProductInfo = data.productInfo ?? null;
                    applyStateUpdate(prev => ({
                        ...prev,
                        productInfo: nextProductInfo
                            ? {
                                ...nextProductInfo,
                                brand: resolveBrand(prev.brandExtraction, nextProductInfo.brand),
                            }
                            : nextProductInfo,
                        sources: data.sources || [],
                    }));
                } catch (e) {
                    console.error('[SSE] Failed to parse product_info:', e);
                }
            });

            // Cached analysis payload (from snapshot.analysis_json)
            es.addEventListener('analysis_payload' as any, (event: any) => {
                try {
                    if (hasBundleRef.current) return;
                    markActivity();
                    markSseEvent('analysis_payload');
                    const data = JSON.parse(event.data);
                    const nextBrandExtraction = data.brandExtraction ?? null;
                    const nextProductInfo = data.productInfo ?? null;
                    const nextEfficacy = data.analysis_efficacy ?? data.efficacy ?? null;
                    const nextSafety = data.analysis_safety ?? data.safety ?? null;
                    const nextUsagePayload = data.analysis_usage ?? data.usagePayload ?? null;
                    const nextSources = data.analysis_sources ?? data.sources ?? null;
                    const nextAnalysis = data.analysis ?? null;
                    console.log('[SSE] Analysis Payload:', data);
                    applyStateUpdate(prev => ({
                        ...prev,
                        brandExtraction: nextBrandExtraction ?? prev.brandExtraction,
                        productInfo: nextProductInfo
                            ? {
                                brand: resolveBrand(nextBrandExtraction ?? prev.brandExtraction, nextProductInfo.brand, prev.productInfo?.brand),
                                name: nextProductInfo.name ?? prev.productInfo?.name ?? null,
                                category: nextProductInfo.category ?? prev.productInfo?.category ?? null,
                                image: nextProductInfo.image ?? prev.productInfo?.image ?? null,
                            }
                            : prev.productInfo,
                        efficacy: nextEfficacy ?? prev.efficacy,
                        safety: nextSafety ?? prev.safety,
                        usage: nextUsagePayload?.usage ?? prev.usage,
                        value: nextUsagePayload?.value ?? prev.value,
                        social: nextUsagePayload?.social ?? prev.social,
                        sources: Array.isArray(nextSources) && nextSources.length ? nextSources : prev.sources,
                        analysisMeta: nextAnalysis
                            ? {
                                status: nextAnalysis.status ?? null,
                                version: nextAnalysis.version ?? null,
                                labelExtraction: nextAnalysis.labelExtraction ?? null,
                            }
                            : prev.analysisMeta,
                    }));
                } catch (e) {
                    console.error('[SSE] Failed to parse analysis_payload:', e);
                }
            });

            // Analysis bundle v3 (unified UI)
            es.addEventListener('analysis_bundle' as any, (event: any) => {
                try {
                    markActivity();
                    markSseEvent('analysis_bundle');
                    const data = JSON.parse(event.data) as AnalysisBundle;
                    if (!data?.meta || (data.meta.schemaVersion !== 3 && data.meta.schemaVersion !== 4)) return;
                    hasBundleRef.current = true;
                    if (typeof data.meta.revision === 'number' && data.meta.revision >= 1) {
                        rev1SeenRef.current = true;
                        armRev1DoneWatchdog();
                    }
                    console.log('[SSE] Analysis Bundle:', {
                        schemaVersion: data.meta.schemaVersion,
                        sourceType: data.meta.sourceType,
                        phase: data.meta.phase,
                        revision: data.meta.revision,
                        identity: `${data.meta.authoritativeIdentity.type}:${data.meta.authoritativeIdentity.value}`,
                    });
                    applyStateUpdate(prev => {
                        const prevBundle = prev.analysisBundle;
                        if (!prevBundle || data.meta.revision > prevBundle.meta.revision) {
                            const metaRequestId =
                                typeof (data.meta as any)?.requestId === 'string'
                                    ? String((data.meta as any).requestId).trim()
                                    : null;
                            return {
                                ...prev,
                                analysisBundle: data,
                                requestId: metaRequestId || prev.requestId,
                                watchdogReason:
                                    typeof (data.meta as any)?.terminalReason === 'string'
                                        ? String((data.meta as any).terminalReason)
                                        : prev.watchdogReason,
                            };
                        }
                        return prev;
                    });
                } catch (e) {
                    console.error('[SSE] Failed to parse analysis_bundle:', e);
                }
            });

            // Efficacy Result (enhanced with ingredients)
            es.addEventListener('result_efficacy' as any, (event: any) => {
                try {
                    if (hasBundleRef.current) return;
                    markActivity();
                    markSseEvent('result_efficacy');
                    const data = JSON.parse(event.data) as EfficacyAnalysis;
                    console.log('[SSE] Efficacy:', data);
                    applyStateUpdate(prev => ({ ...prev, efficacy: data }));
                } catch (e) {
                    console.error('[SSE] Failed to parse result_efficacy:', e);
                }
            });

            // Safety Result (enhanced with UL warnings)
            es.addEventListener('result_safety' as any, (event: any) => {
                try {
                    if (hasBundleRef.current) return;
                    markActivity();
                    markSseEvent('result_safety');
                    const data = JSON.parse(event.data) as SafetyAnalysis;
                    console.log('[SSE] Safety:', data);
                    applyStateUpdate(prev => ({ ...prev, safety: data }));
                } catch (e) {
                    console.error('[SSE] Failed to parse result_safety:', e);
                }
            });

            // Usage/Value Result (split into usage, value, social)
            es.addEventListener('result_usage' as any, (event: any) => {
                try {
                    if (hasBundleRef.current) return;
                    markActivity();
                    markSseEvent('result_usage');
                    const data = JSON.parse(event.data);
                    console.log('[SSE] Usage:', data);
                    applyStateUpdate(prev => ({
                        ...prev,
                        usage: data.usage || null,
                        value: data.value || null,
                        social: data.social || null,
                    }));
                } catch (e) {
                    console.error('[SSE] Failed to parse result_usage:', e);
                }
            });

            // Snapshot payload (catalog or cached analysis)
            es.addEventListener('snapshot' as any, (event: any) => {
                try {
                    markActivity();
                    markSseEvent('snapshot');
                    const snapshot = JSON.parse(event.data) as SupplementSnapshot;
                    const snapshotProduct = snapshot.product;
                    const snapshotSources = snapshot.references?.items ?? [];
                    const analysisMeta = snapshot.analysis
                        ? {
                            status: snapshot.analysis.status ?? null,
                            version: snapshot.analysis.version ?? null,
                            labelExtraction: snapshot.analysis.labelExtraction ?? null,
                        }
                            : null;
                    applyStateUpdate(prev => ({
                        ...prev,
                        productInfo: {
                            brand: resolveBrand(prev.brandExtraction, prev.productInfo?.brand, snapshotProduct.brand),
                            name: prev.productInfo?.name ?? snapshotProduct.name ?? null,
                            category: prev.productInfo?.category ?? snapshotProduct.category ?? null,
                            image: prev.productInfo?.image ?? snapshotProduct.imageUrl ?? null,
                        },
                        sources: prev.sources.length
                            ? prev.sources
                            : snapshotSources.map((ref) => ({
                                title: ref.title,
                                link: ref.url,
                            })),
                        analysisMeta: analysisMeta ?? prev.analysisMeta,
                    }));
                    setServerSnapshot(snapshot);
                } catch (e) {
                    console.error('[SSE] Failed to parse snapshot:', e);
                }
            });

            // Completion
            es.addEventListener('done' as any, () => {
                markActivity();
                markSseEvent('done');
                console.log('[SSE] Done');
                clearRev1DoneWatchdog();
                applyStateUpdate(prev => {
                    if (resolveDoneTerminalStatus(prev) === 'complete') {
                        return {
                            ...prev,
                            status: 'complete',
                            errorKind: 'none',
                            reasonCode: null,
                            stage: null,
                            watchdogReason: prev.watchdogReason,
                            error: null,
                        };
                    }
                    if (hasMeaningfulPartialData(prev)) {
                        return {
                            ...prev,
                            status: 'complete',
                            errorKind: 'none',
                            reasonCode: prev.reasonCode ?? 'STREAM_DONE_PARTIAL',
                            stage: prev.stage,
                            watchdogReason: prev.watchdogReason,
                            error: null,
                        };
                    }
                    return {
                        ...prev,
                        status: 'error',
                        errorKind: 'network',
                        reasonCode: prev.reasonCode ?? 'STREAM_ENDED_BEFORE_USABLE_RESULT',
                        stage: prev.stage,
                        watchdogReason: prev.watchdogReason ?? (rev1SeenRef.current ? 'DONE_MISSING_FALLBACK' : null),
                        error: prev.error ?? 'Analysis interrupted before usable result',
                    };
                });
                closeStream();
            });

            // Error
            es.addEventListener('error', (event: any) => {
                markActivity();
                markSseEvent('error');
                clearRev1DoneWatchdog();
                const xhrStatus = typeof event?.xhrStatus === 'number' ? event.xhrStatus : null;
                if (event?.type === 'error' && event?.data) {
                    try {
                        const errorData = JSON.parse(event.data);
                        const parsed = parseStreamErrorEvent({
                            payload: errorData,
                            xhrStatus,
                            fallbackMessage: errorData?.message,
                        });
                        if (EXPECTED_DEGRADED_REASON_CODES.has(String(parsed.reasonCode ?? '').toUpperCase())) {
                            console.info('[SSE] Degraded terminal event:', {
                                reasonCode: parsed.reasonCode,
                                stage: parsed.stage,
                                requestId: parsed.requestId,
                            });
                        } else {
                            console.error('[SSE] Error:', event);
                        }
                        applyStateUpdate((prev) => {
                            if (parsed.kind === 'not_found') {
                                console.info('[SSE] Not found:', errorData);
                                if (isUsableResultBundle(prev.analysisBundle) || hasMeaningfulPartialData(prev)) {
                                    return {
                                        ...prev,
                                        status: 'complete',
                                        errorKind: 'none',
                                        reasonCode: parsed.reasonCode ?? 'NOT_FOUND_PARTIAL',
                                        stage: parsed.stage,
                                        requestId: parsed.requestId ?? prev.requestId,
                                        watchdogReason: prev.watchdogReason,
                                        error: null,
                                    };
                                }
                                return {
                                    ...prev,
                                    status: 'not_found',
                                    errorKind: 'not_found',
                                    reasonCode: parsed.reasonCode,
                                    stage: parsed.stage,
                                    requestId: parsed.requestId ?? prev.requestId,
                                    watchdogReason: prev.watchdogReason,
                                    error: null,
                                };
                            }
                            if (
                                shouldTreatStreamErrorAsPartialComplete({
                                    reasonCode: parsed.reasonCode,
                                    state: prev,
                                })
                            ) {
                                console.info('[SSE] Partial timeout fallback accepted', {
                                    reasonCode: parsed.reasonCode,
                                    stage: parsed.stage,
                                });
                                return {
                                    ...prev,
                                    status: 'complete',
                                    errorKind: 'none',
                                    reasonCode: parsed.reasonCode,
                                    stage: parsed.stage,
                                    requestId: parsed.requestId ?? prev.requestId,
                                    watchdogReason: parsed.reasonCode ?? prev.watchdogReason,
                                    error: null,
                                };
                            }
                            if (parsed.kind !== 'unauthorized' && canSettleSearchLaunchAsPartial(prev)) {
                                return {
                                    ...prev,
                                    status: 'complete',
                                    errorKind: 'none',
                                    reasonCode: parsed.reasonCode ?? prev.reasonCode ?? 'SEARCH_SEED_PARTIAL',
                                    stage: parsed.stage ?? prev.stage ?? 'stream',
                                    requestId: parsed.requestId ?? prev.requestId,
                                    watchdogReason: prev.watchdogReason,
                                    error: null,
                                };
                            }
                            if (rev1SeenRef.current && (isUsableResultBundle(prev.analysisBundle) || hasMeaningfulPartialData(prev))) {
                                return {
                                    ...prev,
                                    status: 'complete',
                                    errorKind: 'none',
                                    reasonCode: parsed.reasonCode ?? prev.reasonCode ?? 'DONE_MISSING_FALLBACK',
                                    stage: parsed.stage ?? prev.stage ?? 'stream',
                                    requestId: parsed.requestId ?? prev.requestId,
                                    watchdogReason: parsed.reasonCode ?? 'DONE_MISSING_FALLBACK',
                                    error: null,
                                };
                            }
                            if (isUsableResultBundle(prev.analysisBundle)) {
                                return {
                                    ...prev,
                                    status: 'complete',
                                    errorKind: 'none',
                                    reasonCode: null,
                                    stage: null,
                                    watchdogReason: prev.watchdogReason,
                                    error: null,
                                };
                            }
                            return {
                                ...prev,
                                status: 'error',
                                errorKind: parsed.kind,
                                reasonCode: parsed.reasonCode,
                                stage: parsed.stage,
                                requestId: parsed.requestId ?? prev.requestId,
                                watchdogReason: prev.watchdogReason,
                                error: parsed.message || 'Scan failed',
                            };
                        });
                    } catch {
                        console.error('[SSE] Error:', event);
                        const parsed = parseStreamErrorEvent({
                            xhrStatus,
                            fallbackMessage: event?.message ?? 'Connection failed',
                        });
                        applyStateUpdate((prev) => {
                            if (parsed.kind !== 'unauthorized' && canSettleSearchLaunchAsPartial(prev)) {
                                return {
                                    ...prev,
                                    status: 'complete',
                                    errorKind: 'none',
                                    reasonCode: prev.reasonCode ?? 'SEARCH_SEED_PARTIAL',
                                    stage: prev.stage ?? 'stream',
                                    watchdogReason: prev.watchdogReason,
                                    error: null,
                                };
                            }
                            if (rev1SeenRef.current && (isUsableResultBundle(prev.analysisBundle) || hasMeaningfulPartialData(prev))) {
                                return {
                                    ...prev,
                                    status: 'complete',
                                    errorKind: 'none',
                                    reasonCode: prev.reasonCode ?? 'DONE_MISSING_FALLBACK',
                                    stage: prev.stage ?? 'stream',
                                    watchdogReason: 'DONE_MISSING_FALLBACK',
                                    error: null,
                                };
                            }
                            if (isUsableResultBundle(prev.analysisBundle)) {
                                return {
                                    ...prev,
                                    status: 'complete',
                                    errorKind: 'none',
                                    reasonCode: null,
                                    stage: null,
                                    watchdogReason: prev.watchdogReason,
                                    error: null,
                                };
                            }
                            return {
                                ...prev,
                                status: 'error',
                                errorKind: parsed.kind,
                                reasonCode: parsed.reasonCode,
                                stage: parsed.stage,
                                watchdogReason: prev.watchdogReason,
                                error: parsed.message || 'Connection failed',
                            };
                        });
                    }
                } else {
                    const rawMessage = typeof event?.message === 'string' ? event.message : null;
                    const parsedPayload = (() => {
                        if (!rawMessage) return null;
                        try {
                            return JSON.parse(rawMessage);
                        } catch {
                            return null;
                        }
                    })();
                    const fallbackMessage =
                        typeof (parsedPayload as { message?: unknown } | null)?.message === 'string'
                            ? String((parsedPayload as any).message)
                            : rawMessage;
                    const parsed = parseStreamErrorEvent({
                        payload: parsedPayload,
                        xhrStatus,
                        fallbackMessage:
                            fallbackMessage && fallbackMessage.trim().length > 0
                                ? fallbackMessage
                                : xhrStatus === 401
                                    ? 'Unauthorized (please sign in or enable dev auth bypass)'
                                    : 'Could not connect to the server',
                    });
                    applyStateUpdate((prev) => {
                        if (parsed.kind !== 'unauthorized' && canSettleSearchLaunchAsPartial(prev)) {
                            return {
                                ...prev,
                                status: 'complete',
                                errorKind: 'none',
                                reasonCode: parsed.reasonCode ?? prev.reasonCode ?? 'SEARCH_SEED_PARTIAL',
                                stage: parsed.stage ?? prev.stage ?? 'stream',
                                requestId: parsed.requestId ?? prev.requestId,
                                watchdogReason: prev.watchdogReason,
                                error: null,
                            };
                        }
                        if (rev1SeenRef.current && (isUsableResultBundle(prev.analysisBundle) || hasMeaningfulPartialData(prev))) {
                            return {
                                ...prev,
                                status: 'complete',
                                errorKind: 'none',
                                reasonCode: parsed.reasonCode ?? prev.reasonCode ?? 'DONE_MISSING_FALLBACK',
                                stage: parsed.stage ?? prev.stage ?? 'stream',
                                requestId: parsed.requestId ?? prev.requestId,
                                watchdogReason: parsed.reasonCode ?? 'DONE_MISSING_FALLBACK',
                                error: null,
                            };
                        }
                        if (isUsableResultBundle(prev.analysisBundle)) {
                            return {
                                ...prev,
                                status: 'complete',
                                errorKind: 'none',
                                reasonCode: null,
                                stage: null,
                                watchdogReason: prev.watchdogReason,
                                error: null,
                            };
                        }
                        return {
                            ...prev,
                            status: 'error',
                            errorKind: parsed.kind,
                            reasonCode: parsed.reasonCode,
                            stage: parsed.stage,
                            requestId: parsed.requestId ?? prev.requestId,
                            watchdogReason: prev.watchdogReason,
                            error: parsed.message,
                        };
                    });
                }
                closeStream();
            });
        };

        startStream().catch((error) => {
            console.warn('[SSE] Stream init failed', error);
            applyStateUpdate(prev => {
                if (canSettleSearchLaunchAsPartial(prev)) {
                    return {
                        ...prev,
                        status: 'complete',
                        errorKind: 'none',
                        reasonCode: prev.reasonCode ?? 'SEARCH_SEED_CONNECTION_FAILED',
                        stage: prev.stage ?? 'stream',
                        watchdogReason: prev.watchdogReason,
                        error: null,
                    };
                }
                return {
                    ...prev,
                    status: 'error',
                    errorKind: 'network',
                    reasonCode: prev.reasonCode,
                    stage: prev.stage,
                    watchdogReason: prev.watchdogReason,
                    error: 'Connection failed',
                };
            });
        });

        return () => {
            isActive = false;
            clearTimeout(connectGuard);
            clearTimeout(rev1Guard);
            closeStream();
        };
    }, [barcode, guestScanSessionId, normalizedLaunchSource, scanSessionId, searchSeed, searchSeedFingerprint]);

    const snapshot = useMemo(
        () => serverSnapshot ?? buildBarcodeSnapshot({ barcode, analysis: state }),
        [barcode, serverSnapshot, state],
    );

    const trustedDisplayIdentity = useMemo(
        () =>
            resolveTrustedDisplayIdentity({
                bundleMeta: state.analysisBundle?.meta ?? null,
                productName: state.productInfo?.name ?? null,
                productSubtitle: [state.productInfo?.brand, state.productInfo?.category].filter(Boolean).join(' • '),
                barcode,
                authoritativeIdentity: state.analysisBundle?.meta?.authoritativeIdentity ?? null,
                sources: state.sources.map((source) => ({
                    domain: typeof source.domain === 'string' ? source.domain : null,
                    url: typeof source.link === 'string' ? source.link : null,
                    link: typeof source.link === 'string' ? source.link : null,
                })),
                showDebugWebHintSource: SHOW_SCAN_DEBUG,
            }),
        [
            barcode,
            state.analysisBundle?.meta,
            state.productInfo?.brand,
            state.productInfo?.category,
            state.productInfo?.name,
            state.sources,
        ],
    );

    return {
        ...state,
        snapshot,
        displayIdentityMode: trustedDisplayIdentity.displayIdentityMode,
        displayIdentitySourceAttribution: trustedDisplayIdentity.sourceAttributionUsed,
        titleSanitized: trustedDisplayIdentity.titleSanitized,
    };
}

// Export types for use in other components
export type {
    AnalysisStatus,
    ErrorKind,
    AnalysisState,
    AnalysisStateWithSnapshot,
    BrandExtraction,
    EfficacyAnalysis,
    EnrichedSource,
    IngredientAnalysis,
    ProductInfo,
    SafetyAnalysis,
    SocialAnalysis,
    ULWarning,
    UsageAnalysis,
    ValueAnalysis
};
