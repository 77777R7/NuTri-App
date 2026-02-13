/**
 * OCR Cache Layer
 * Uses Supabase to cache OCR results and avoid redundant API calls
 */

import type { LabelDraft } from './labelAnalysis.js';
import { supabase } from './supabase.js';
import type { AiSupplementAnalysis } from './types.js';
import {
    LABEL_ANALYSIS_VERSION,
    LABEL_OCR_ENGINE,
    LABEL_OCR_PARAMS_VERSION,
    LABEL_PARSER_VERSION,
    buildAnalysisCacheKey,
    buildParseCacheKey,
    buildVersionedOcrCacheKey,
    normalizePreprocessProfile,
} from './labelScanVersion.js';

// ============================================================================
// TYPES
// ============================================================================

export interface CachedOcrResult {
    imageHash: string;
    cacheKey: string;
    cacheMode: "strict" | "legacy_read";
    visionRaw: unknown | null;
    parsedIngredients: LabelDraft | null;
    analysis: AiSupplementAnalysis | null;
    confidence: number;
    parserVersion: string;
    preprocessProfile: string;
    ocrEngine: string;
    ocrParamsVersion: string;
    createdAt: string;
}

export interface CachedParseResult {
    parseCacheKey: string;
    ocrCacheKey: string;
    parsedIngredients: LabelDraft;
    diagnostics: unknown | null;
    parserVersion: string;
    createdAt: string;
}

export interface CachedAnalysisResult {
    analysisCacheKey: string;
    parseCacheKey: string;
    analysis: AiSupplementAnalysis;
    analysisStatus: string | null;
    analysisIssues: string[];
    llmMs: number | null;
    analysisVersion: string;
    createdAt: string;
}

interface OcrCacheRow {
    image_hash: string;
    vision_raw: unknown | null;
    parsed_ingredients: unknown | null;
    analysis: unknown | null;
    confidence: number;
    parser_version?: string | null;
    preprocess_profile?: string | null;
    ocr_engine?: string | null;
    ocr_params_version?: string | null;
    original_image_hash?: string | null;
    created_at: string;
}

interface ParseCacheRow {
    parse_cache_key: string;
    ocr_cache_key: string;
    parsed_ingredients: unknown;
    diagnostics: unknown | null;
    parser_version: string | null;
    created_at: string;
}

interface AnalysisCacheRow {
    analysis_cache_key: string;
    parse_cache_key: string;
    analysis: unknown;
    analysis_status: string | null;
    analysis_issues: string[] | null;
    llm_ms: number | null;
    analysis_version: string | null;
    created_at: string;
}

// ============================================================================
// CACHE OPERATIONS
// ============================================================================

/**
 * Get cached result by image hash
 */
export async function getCachedResult(
    imageHash: string,
    options?: { preprocessProfile?: string | null },
): Promise<CachedOcrResult | null> {
    const cacheKey = buildVersionedOcrCacheKey(imageHash, options?.preprocessProfile);
    const { data, error } = await supabase
        .from('ocr_cache')
        .select('*')
        .eq('image_hash', cacheKey)
        .single();

    const toCachedResult = (row: OcrCacheRow, mode: "strict" | "legacy_read"): CachedOcrResult => ({
        imageHash: row.original_image_hash?.trim() || imageHash,
        cacheKey: row.image_hash,
        cacheMode: mode,
        visionRaw: row.vision_raw,
        parsedIngredients: (row.parsed_ingredients ?? null) as LabelDraft | null,
        analysis: row.analysis as AiSupplementAnalysis | null,
        confidence: row.confidence,
        parserVersion: row.parser_version ?? LABEL_PARSER_VERSION,
        preprocessProfile: normalizePreprocessProfile(row.preprocess_profile),
        ocrEngine: row.ocr_engine ?? LABEL_OCR_ENGINE,
        ocrParamsVersion: row.ocr_params_version ?? LABEL_OCR_PARAMS_VERSION,
        createdAt: row.created_at,
    });

    if (!error && data) {
        return toCachedResult(data as OcrCacheRow, "strict");
    }

    if (error?.code !== 'PGRST116') {
        console.warn('[OcrCache] Get error:', error?.message);
        return null;
    }

    const allowLegacyRead =
        process.env.OCR_CACHE_ALLOW_LEGACY_READ === '1'
        || process.env.OCR_CACHE_ALLOW_LEGACY_READ === 'true';
    if (!allowLegacyRead) {
        return null;
    }

    const { data: legacyData, error: legacyError } = await supabase
        .from('ocr_cache')
        .select('*')
        .eq('image_hash', imageHash)
        .single();
    if (legacyError || !legacyData) {
        if (legacyError?.code !== 'PGRST116') {
            console.warn('[OcrCache] Legacy read error:', legacyError?.message);
        }
        return null;
    }

    return toCachedResult(legacyData as OcrCacheRow, "legacy_read");
}

/**
 * Save result to cache
 */
export async function setCachedResult(
    imageHash: string,
    payload: {
        visionRaw?: unknown;
        parsedIngredients: LabelDraft | null;
        analysis?: AiSupplementAnalysis | null;
        confidence: number;
        preprocessProfile?: string | null;
    }
): Promise<void> {
    const preprocessProfile = normalizePreprocessProfile(payload.preprocessProfile);
    const cacheKey = buildVersionedOcrCacheKey(imageHash, preprocessProfile);
    const { error } = await supabase.from('ocr_cache').upsert(
        {
            image_hash: cacheKey,
            original_image_hash: imageHash,
            vision_raw: payload.visionRaw ?? null,
            parsed_ingredients: payload.parsedIngredients,
            analysis: payload.analysis ?? null,
            confidence: payload.confidence,
            parser_version: LABEL_PARSER_VERSION,
            preprocess_profile: preprocessProfile,
            ocr_engine: LABEL_OCR_ENGINE,
            ocr_params_version: LABEL_OCR_PARAMS_VERSION,
            // P0: Do not update created_at on upsert to preserve TTL and original creation time
        },
        { onConflict: 'image_hash' }
    );

    if (error) {
        console.error('[OcrCache] Set error:', error.message);
    }
}

export async function getParseCachedResult(
    ocrCacheKey: string,
): Promise<CachedParseResult | null> {
    const parseCacheKey = buildParseCacheKey(ocrCacheKey);
    const { data, error } = await supabase
        .from('label_parse_cache')
        .select('*')
        .eq('parse_cache_key', parseCacheKey)
        .single();

    if (error) {
        if (error.code !== 'PGRST116' && error.code !== '42P01') {
            console.warn('[ParseCache] Get error:', error.message);
        }
        return null;
    }
    if (!data) return null;

    const row = data as ParseCacheRow;
    return {
        parseCacheKey: row.parse_cache_key,
        ocrCacheKey: row.ocr_cache_key,
        parsedIngredients: row.parsed_ingredients as LabelDraft,
        diagnostics: row.diagnostics,
        parserVersion: row.parser_version ?? LABEL_PARSER_VERSION,
        createdAt: row.created_at,
    };
}

export async function setParseCachedResult(
    ocrCacheKey: string,
    payload: {
        parsedIngredients: LabelDraft;
        diagnostics?: unknown | null;
    },
): Promise<void> {
    const parseCacheKey = buildParseCacheKey(ocrCacheKey);
    const { error } = await supabase
        .from('label_parse_cache')
        .upsert({
            parse_cache_key: parseCacheKey,
            ocr_cache_key: ocrCacheKey,
            parsed_ingredients: payload.parsedIngredients,
            diagnostics: payload.diagnostics ?? null,
            parser_version: LABEL_PARSER_VERSION,
        }, { onConflict: 'parse_cache_key' });

    if (error && error.code !== '42P01') {
        console.warn('[ParseCache] Set error:', error.message);
    }
}

export async function getAnalysisCachedResult(
    parseCacheKey: string,
): Promise<CachedAnalysisResult | null> {
    const analysisCacheKey = buildAnalysisCacheKey(parseCacheKey);
    const { data, error } = await supabase
        .from('label_analysis_cache')
        .select('*')
        .eq('analysis_cache_key', analysisCacheKey)
        .single();

    if (error) {
        if (error.code !== 'PGRST116' && error.code !== '42P01') {
            console.warn('[AnalysisCache] Get error:', error.message);
        }
        return null;
    }
    if (!data) return null;

    const row = data as AnalysisCacheRow;
    return {
        analysisCacheKey: row.analysis_cache_key,
        parseCacheKey: row.parse_cache_key,
        analysis: row.analysis as AiSupplementAnalysis,
        analysisStatus: row.analysis_status,
        analysisIssues: Array.isArray(row.analysis_issues) ? row.analysis_issues : [],
        llmMs: row.llm_ms ?? null,
        analysisVersion: row.analysis_version ?? LABEL_ANALYSIS_VERSION,
        createdAt: row.created_at,
    };
}

export async function setAnalysisCachedResult(
    parseCacheKey: string,
    payload: {
        analysis: AiSupplementAnalysis;
        analysisStatus?: string | null;
        analysisIssues?: string[];
        llmMs?: number | null;
    },
): Promise<void> {
    const analysisCacheKey = buildAnalysisCacheKey(parseCacheKey);
    const { error } = await supabase
        .from('label_analysis_cache')
        .upsert({
            analysis_cache_key: analysisCacheKey,
            parse_cache_key: parseCacheKey,
            analysis: payload.analysis,
            analysis_status: payload.analysisStatus ?? null,
            analysis_issues: payload.analysisIssues ?? [],
            llm_ms: payload.llmMs ?? null,
            analysis_version: LABEL_ANALYSIS_VERSION,
        }, { onConflict: 'analysis_cache_key' });

    if (error && error.code !== '42P01') {
        console.warn('[AnalysisCache] Set error:', error.message);
    }
}

/**
 * Update analysis for existing cache entry
 */
export async function updateCachedAnalysis(
    imageHash: string,
    analysis: AiSupplementAnalysis,
    options?: { preprocessProfile?: string | null }
): Promise<void> {
    const cacheKey = buildVersionedOcrCacheKey(imageHash, options?.preprocessProfile);
    const { error } = await supabase
        .from('ocr_cache')
        .update({ analysis })
        .eq('image_hash', cacheKey);

    if (error) {
        console.error('[OcrCache] Update analysis error:', error.message);
    }
}

/**
 * Cleanup expired cache entries
 */
export async function cleanupExpiredCache(ttlDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ttlDays);

    const { data, error } = await supabase
        .from('ocr_cache')
        .delete()
        .lt('created_at', cutoff.toISOString())
        .select('image_hash');

    if (error) {
        console.error('[OcrCache] Cleanup error:', error.message);
        return 0;
    }

    const count = data?.length ?? 0;
    const cleanupAuxTable = async (tableName: 'label_parse_cache' | 'label_analysis_cache') => {
        const { error: auxError } = await supabase
            .from(tableName)
            .delete()
            .lt('created_at', cutoff.toISOString());
        if (auxError && auxError.code !== '42P01') {
            console.warn(`[OcrCache] Cleanup ${tableName} error:`, auxError.message);
        }
    };
    await cleanupAuxTable('label_parse_cache');
    await cleanupAuxTable('label_analysis_cache');
    if (count > 0) {
        console.log(`[OcrCache] Cleaned up ${count} expired entries`);
    }
    return count;
}

/**
 * Check if cache entry has completed analysis
 */
export function hasCompletedAnalysis(cached: CachedOcrResult): boolean {
    return cached.analysis !== null && cached.analysis.status === 'success';
}

/**
 * Check if cache entry only has draft (needs confirmation or re-analysis)
 */
export function hasDraftOnly(cached: CachedOcrResult): boolean {
    return cached.parsedIngredients !== null && cached.analysis === null;
}
