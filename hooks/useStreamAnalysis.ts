import { useEffect, useMemo, useRef, useState } from 'react';
import RNEventSource from 'react-native-sse';

import { Config } from '@/constants/Config';
import { withAuthHeaders } from '@/lib/auth-token';
import { buildBarcodeSnapshot } from '@/lib/snapshot';
import type { SupplementSnapshot } from '@/types/supplementSnapshot';

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
    score: number;
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
    score: number;
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
    score: number;
    verdict: string;
    analysis: string;
    costPerServing?: number | null;
    alternatives?: string[];
};

type SocialAnalysis = {
    score: number;
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
    status: 'idle' | 'loading' | 'streaming' | 'complete' | 'error';
    error: string | null;
};

type AnalysisStateWithSnapshot = AnalysisState & {
    snapshot: SupplementSnapshot | null;
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
        status: 'idle',
        error: null,
    });

    const eventSourceRef = useRef<RNEventSource | null>(null);

    useEffect(() => {
        if (!barcode) return;

        setState(prev => ({ ...prev, status: 'loading', error: null }));

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
                    setState(prev => ({
                        ...prev,
                        productInfo: data.productInfo,
                        sources: data.sources || [],
                    }));
                } catch (e) {
                    console.error('[SSE] Failed to parse product_info:', e);
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
                    setState(prev => ({
                        ...prev,
                        productInfo: {
                            brand: prev.productInfo?.brand ?? snapshotProduct.brand ?? null,
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
                    }));
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
                        setState(prev => ({
                            ...prev,
                            status: 'error',
                            error: errorData.message || 'Scan failed'
                        }));
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
        () => buildBarcodeSnapshot({ barcode, analysis: state }),
        [barcode, state],
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
