/**
 * OCR Cache Layer
 * Uses Supabase to cache OCR results and avoid redundant API calls
 */

import type { LabelDraft } from './labelAnalysis.js';
import { supabase } from './supabase.js';
import type { AiSupplementAnalysis } from './types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface CachedOcrResult {
    imageHash: string;
    visionRaw: unknown | null;
    parsedIngredients: LabelDraft;
    analysis: AiSupplementAnalysis | null;
    confidence: number;
    createdAt: string;
}

interface OcrCacheRow {
    image_hash: string;
    vision_raw: unknown | null;
    parsed_ingredients: unknown;
    analysis: unknown | null;
    confidence: number;
    created_at: string;
}

// ============================================================================
// CACHE OPERATIONS
// ============================================================================

/**
 * Get cached result by image hash
 */
export async function getCachedResult(imageHash: string): Promise<CachedOcrResult | null> {
    const { data, error } = await supabase
        .from('ocr_cache')
        .select('*')
        .eq('image_hash', imageHash)
        .single();

    if (error || !data) {
        if (error?.code !== 'PGRST116') {
            // PGRST116 = no rows found, not an error
            console.warn('[OcrCache] Get error:', error?.message);
        }
        return null;
    }

    const row = data as OcrCacheRow;
    return {
        imageHash: row.image_hash,
        visionRaw: row.vision_raw,
        parsedIngredients: row.parsed_ingredients as LabelDraft,
        analysis: row.analysis as AiSupplementAnalysis | null,
        confidence: row.confidence,
        createdAt: row.created_at,
    };
}

/**
 * Save result to cache
 */
export async function setCachedResult(
    imageHash: string,
    payload: {
        visionRaw?: unknown;
        parsedIngredients: LabelDraft;
        analysis?: AiSupplementAnalysis | null;
        confidence: number;
    }
): Promise<void> {
    const { error } = await supabase.from('ocr_cache').upsert(
        {
            image_hash: imageHash,
            vision_raw: payload.visionRaw ?? null,
            parsed_ingredients: payload.parsedIngredients,
            analysis: payload.analysis ?? null,
            confidence: payload.confidence,
            // P0: Do not update created_at on upsert to preserve TTL and original creation time
        },
        { onConflict: 'image_hash' }
    );

    if (error) {
        console.error('[OcrCache] Set error:', error.message);
    }
}

/**
 * Update analysis for existing cache entry
 */
export async function updateCachedAnalysis(
    imageHash: string,
    analysis: AiSupplementAnalysis
): Promise<void> {
    const { error } = await supabase
        .from('ocr_cache')
        .update({ analysis })
        .eq('image_hash', imageHash);

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
