import { useEffect, useMemo, useRef, useState } from 'react';
import RNEventSource from 'react-native-sse';

import { Config } from '@/constants/Config';
import { withAuthHeaders } from '@/lib/auth-token';
import { buildBarcodeSnapshot } from '@/lib/snapshot';
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
    status: 'idle' | 'loading' | 'streaming' | 'complete' | 'error';
    error: string | null;
};

type AnalysisStateWithSnapshot = AnalysisState & {
    snapshot: SupplementSnapshot | null;
};

const shouldPreferExtractedBrand = (brandExtraction?: BrandExtraction | null) =>
    Boolean(brandExtraction?.brand) &&
    (brandExtraction?.confidence === 'high' || brandExtraction?.confidence === 'medium');

const sanitizeBrandCandidate = (value?: string | null) => {
    if (!value) return null;
    let cleaned = value.trim();
    if (!cleaned) return null;
    cleaned = cleaned.replace(/｜/g, '|');
    if (cleaned.includes('|')) {
        const [left] = cleaned.split('|');
        cleaned = left?.trim() ?? '';
    }
    const dashSplit = cleaned.split(/\s[\-\u2013\u2014]\s/);
    if (dashSplit.length > 1) {
        cleaned = dashSplit[0]?.trim() ?? cleaned;
    }
    cleaned = cleaned.replace(/[^\p{L}\p{N}\s\-’'®]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned || /^\d+$/.test(cleaned)) return null;
    return cleaned;
};

const resolveBrand = (
    brandExtraction: BrandExtraction | null | undefined,
    ...candidates: Array<string | null | undefined>
) => {
    const preferred = shouldPreferExtractedBrand(brandExtraction) ? sanitizeBrandCandidate(brandExtraction?.brand) : null;
    const ordered = [preferred, ...candidates.map(candidate => sanitizeBrandCandidate(candidate ?? null))];
    for (const value of ordered) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
};

export function useStreamAnalysis(barcode: string): AnalysisStateWithSnapshot {
    const [state, setState] = useState<AnalysisState>({
        brandExtraction: null,
        productInfo: null,
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
        error: null,
    });
    const [serverSnapshot, setServerSnapshot] = useState<SupplementSnapshot | null>(null);

    const eventSourceRef = useRef<RNEventSource | null>(null);

    useEffect(() => {
        if (!barcode) return;

        setState(prev => ({ ...prev, status: 'loading', error: null, analysisBundle: null }));
        setServerSnapshot(null);

        const API_URL = Config.searchApiBaseUrl.replace(/\/$/, '');
        let isActive = true;

        const startStream = async () => {
            const headers = await withAuthHeaders({ 'Content-Type': 'application/json' });
            if (!isActive) return;

            // Initialize SSE connection (POST method)
            const es = new RNEventSource(`${API_URL}/api/enrich-stream`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ barcode }),
            });

            eventSourceRef.current = es;

            // Listeners
            es.addEventListener('open', () => {
                console.log('[SSE] Connection Opened');
                setState(prev => ({ ...prev, status: 'streaming' }));
            });

            es.addEventListener('message', (event) => {
                // Standard message listener for debugging
            });

            // NEW: Brand Extraction (comes before product_info)
            es.addEventListener('brand_extracted' as any, (event: any) => {
                try {
                    const data = JSON.parse(event.data) as BrandExtraction;
                    console.log('[SSE] Brand Extracted:', data);
                    setState(prev => ({
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
                    const data = JSON.parse(event.data);
                    console.log('[SSE] Product Info:', data);
                    const nextProductInfo = data.productInfo ?? null;
                    setState(prev => ({
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
                    const data = JSON.parse(event.data);
                    const nextBrandExtraction = data.brandExtraction ?? null;
                    const nextProductInfo = data.productInfo ?? null;
                    const nextEfficacy = data.analysis_efficacy ?? data.efficacy ?? null;
                    const nextSafety = data.analysis_safety ?? data.safety ?? null;
                    const nextUsagePayload = data.analysis_usage ?? data.usagePayload ?? null;
                    const nextSources = data.analysis_sources ?? data.sources ?? null;
                    const nextAnalysis = data.analysis ?? null;
                    console.log('[SSE] Analysis Payload:', data);
                    setState(prev => ({
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
                    const data = JSON.parse(event.data) as AnalysisBundle;
                    if (!data?.meta || (data.meta.schemaVersion !== 3 && data.meta.schemaVersion !== 4)) return;
                    setState(prev => {
                        const prevBundle = prev.analysisBundle;
                        if (!prevBundle || data.meta.revision > prevBundle.meta.revision) {
                            return { ...prev, analysisBundle: data };
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
                    const data = JSON.parse(event.data) as EfficacyAnalysis;
                    console.log('[SSE] Efficacy:', data);
                    setState(prev => ({ ...prev, efficacy: data }));
                } catch (e) {
                    console.error('[SSE] Failed to parse result_efficacy:', e);
                }
            });

            // Safety Result (enhanced with UL warnings)
            es.addEventListener('result_safety' as any, (event: any) => {
                try {
                    const data = JSON.parse(event.data) as SafetyAnalysis;
                    console.log('[SSE] Safety:', data);
                    setState(prev => ({ ...prev, safety: data }));
                } catch (e) {
                    console.error('[SSE] Failed to parse result_safety:', e);
                }
            });

            // Usage/Value Result (split into usage, value, social)
            es.addEventListener('result_usage' as any, (event: any) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('[SSE] Usage:', data);
                    setState(prev => ({
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
                    setState(prev => ({
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
                console.log('[SSE] Done');
                setState(prev => ({ ...prev, status: 'complete' }));
                es.close();
            });

            // Error
            es.addEventListener('error', (event: any) => {
                console.error('[SSE] Error:', event);
                if (event.type === 'error' && event.data) {
                    try {
                        const errorData = JSON.parse(event.data);
                        if (errorData?.message === 'Product not found') {
                            console.info('[SSE] Not found:', errorData);
                            setState(prev => ({
                                ...prev,
                                status: 'complete',
                                error: null,
                            }));
                        } else {
                            setState(prev => ({
                                ...prev,
                                status: 'error',
                                error: errorData.message || 'Scan failed'
                            }));
                        }
                    } catch {
                        setState(prev => ({ ...prev, status: 'error', error: 'Connection failed' }));
                    }
                }
                es.close();
            });
        };

        startStream().catch((error) => {
            console.warn('[SSE] Stream init failed', error);
            setState(prev => ({ ...prev, status: 'error', error: 'Connection failed' }));
        });

        return () => {
            isActive = false;
            if (eventSourceRef.current) {
                eventSourceRef.current.removeAllEventListeners();
                eventSourceRef.current.close();
            }
        };
    }, [barcode]);

    const snapshot = useMemo(
        () => serverSnapshot ?? buildBarcodeSnapshot({ barcode, analysis: state }),
        [barcode, serverSnapshot, state],
    );

    return { ...state, snapshot };
}

// Export types for use in other components
export type {
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
