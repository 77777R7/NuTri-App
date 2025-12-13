/**
 * NuTri Score v2.0 - AI-Driven Scoring System
 * 
 * This scoring system derives scores directly from AI analysis results,
 * using structured data (primaryActive, ulWarnings, allergens) for adjustments.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface PrimaryActive {
    name: string;
    form: string | null;
    formQuality: 'high' | 'medium' | 'low' | 'unknown';
    formNote: string | null;
    dosageValue: number | null;
    dosageUnit: string | null;
    evidenceLevel: 'strong' | 'moderate' | 'weak' | 'none';
    evidenceSummary: string | null;
}

export interface IngredientAnalysis {
    name: string;
    dosageAssessment?: 'adequate' | 'underdosed' | 'overdosed' | 'unknown';
    evidenceLevel?: 'strong' | 'moderate' | 'weak' | 'none';
    formQuality?: 'high' | 'medium' | 'low' | 'unknown';
}

export interface EfficacyData {
    score?: number;  // 0-10 from AI
    primaryActive?: PrimaryActive | null;
    ingredients?: IngredientAnalysis[];
    overallAssessment?: string;
    marketingVsReality?: string;
    coreBenefits?: string[];
}

export interface ULWarning {
    ingredient: string;
    currentDose: string;
    ulLimit: string;
    riskLevel: 'moderate' | 'high';
}

export interface SafetyData {
    score?: number;  // 0-10 from AI
    ulWarnings?: ULWarning[];
    allergens?: string[];
    interactions?: string[];
    redFlags?: string[];
    consultDoctorIf?: string[];
}

export interface ValueData {
    score?: number;  // 0-10 from AI
    costPerServing?: number | null;
    alternatives?: string[];
}

export interface SocialData {
    score?: number;  // 0-5 from AI
    summary?: string;
}

export interface AnalysisInput {
    efficacy: EfficacyData;
    safety: SafetyData;
    value: ValueData;
    social: SocialData;
}

export interface ScoreBreakdown {
    effectiveness: number;  // 0-100
    safety: number;         // 0-100
    value: number;          // 0-100
    overall: number;        // 0-100
    label: string;
    details: {
        effectivenessFactors: string[];
        safetyFactors: string[];
        valueFactors: string[];
    };
}

// ============================================================================
// UTILITIES
// ============================================================================

const clamp = (value: number, min: number, max: number): number => {
    return Math.max(min, Math.min(max, value));
};

// ============================================================================
// EFFECTIVENESS SCORING (0-100)
// ============================================================================

function computeEffectiveness(efficacy: EfficacyData): { score: number; factors: string[] } {
    const factors: string[] = [];

    // Base: AI's assessment (50% weight, scaled to 0-50)
    const aiScore = efficacy.score ?? 5;  // Default to 5/10 if missing
    const baseScore = aiScore * 5;  // 0-50
    factors.push(`AI assessment: ${aiScore}/10`);

    // Evidence modifier (-10 to +15)
    let evidenceMod = 0;
    const evidenceLevel = efficacy.primaryActive?.evidenceLevel ?? 'none';
    switch (evidenceLevel) {
        case 'strong': evidenceMod = 15; factors.push('+15 Strong evidence'); break;
        case 'moderate': evidenceMod = 8; factors.push('+8 Moderate evidence'); break;
        case 'weak': evidenceMod = 0; factors.push('±0 Weak evidence'); break;
        case 'none': evidenceMod = -10; factors.push('-10 No evidence'); break;
    }

    // Form quality modifier (-5 to +10)
    let formMod = 0;
    const formQuality = efficacy.primaryActive?.formQuality ?? 'unknown';
    switch (formQuality) {
        case 'high': formMod = 10; factors.push('+10 High-quality form'); break;
        case 'medium': formMod = 3; factors.push('+3 Medium-quality form'); break;
        case 'low': formMod = -5; factors.push('-5 Low-quality form'); break;
        case 'unknown': formMod = 0; break;
    }

    // Dosage modifier (-15 to +5)
    let doseMod = 0;
    const ingredients = efficacy.ingredients ?? [];
    if (ingredients.length > 0) {
        const assessment = ingredients[0].dosageAssessment;
        switch (assessment) {
            case 'adequate': doseMod = 5; factors.push('+5 Adequate dosage'); break;
            case 'underdosed': doseMod = -10; factors.push('-10 Underdosed'); break;
            case 'overdosed': doseMod = -15; factors.push('-15 Overdosed'); break;
        }
    }

    // Marketing reality check
    let marketingPenalty = 0;
    if (efficacy.marketingVsReality?.toLowerCase().includes('unsupported')) {
        marketingPenalty = -8;
        factors.push('-8 Unsupported claims');
    }

    // Core benefits bonus
    let benefitsBonus = 0;
    if ((efficacy.coreBenefits?.length ?? 0) >= 3) {
        benefitsBonus = 5;
        factors.push('+5 Clear benefits');
    }

    const total = clamp(baseScore + 25 + evidenceMod + formMod + doseMod + marketingPenalty + benefitsBonus, 0, 100);

    return { score: Math.round(total), factors };
}

// ============================================================================
// SAFETY SCORING (0-100)
// ============================================================================

function computeSafety(safety: SafetyData): { score: number; factors: string[] } {
    const factors: string[] = [];

    // Base: AI's assessment (50% weight, scaled to 0-50)
    const aiScore = safety.score ?? 7;  // Default to 7/10 if missing (conservative)
    const baseScore = aiScore * 5;  // 0-50
    factors.push(`AI assessment: ${aiScore}/10`);

    // UL warnings penalty (-20 per high risk, -10 per moderate)
    let ulPenalty = 0;
    for (const w of safety.ulWarnings ?? []) {
        if (w.riskLevel === 'high') {
            ulPenalty -= 20;
            factors.push(`-20 High UL risk: ${w.ingredient}`);
        } else {
            ulPenalty -= 10;
            factors.push(`-10 Moderate UL: ${w.ingredient}`);
        }
    }

    // Allergen penalty (-5 if any)
    const allergenCount = safety.allergens?.length ?? 0;
    let allergenPenalty = 0;
    if (allergenCount > 0) {
        allergenPenalty = -5;
        factors.push(`-5 Contains ${allergenCount} allergen(s)`);
    }

    // Interaction penalty (-8 per interaction, max -24)
    const interactionCount = safety.interactions?.length ?? 0;
    const interactionPenalty = Math.max(-24, -interactionCount * 8);
    if (interactionCount > 0) {
        factors.push(`${interactionPenalty} ${interactionCount} interaction(s)`);
    }

    // Red flags penalty (-15 per flag, max -30)
    const redFlagCount = safety.redFlags?.length ?? 0;
    const redFlagPenalty = Math.max(-30, -redFlagCount * 15);
    if (redFlagCount > 0) {
        factors.push(`${redFlagPenalty} ${redFlagCount} red flag(s)`);
    }

    // No issues bonus
    if (ulPenalty === 0 && allergenPenalty === 0 && interactionPenalty === 0 && redFlagCount === 0) {
        factors.push('+10 No safety concerns');
    }

    const noIssuesBonus = (ulPenalty === 0 && allergenPenalty === 0 && interactionPenalty === 0 && redFlagCount === 0) ? 10 : 0;

    const total = clamp(baseScore + 40 + ulPenalty + allergenPenalty + interactionPenalty + redFlagPenalty + noIssuesBonus, 0, 100);

    return { score: Math.round(total), factors };
}

// ============================================================================
// VALUE SCORING (0-100)
// ============================================================================

function computeValue(value: ValueData, social: SocialData): { score: number; factors: string[] } {
    const factors: string[] = [];

    // Base: AI's assessment (60% weight, scaled to 0-60)
    const aiScore = value.score ?? 5;  // Default to 5/10 if missing
    const baseScore = aiScore * 6;  // 0-60
    factors.push(`AI assessment: ${aiScore}/10`);

    // Brand reputation from social (0-20)
    const socialScore = social.score ?? 3;  // Default to 3/5
    const brandScore = socialScore * 4;  // 0-20
    if (socialScore >= 4) {
        factors.push(`+${brandScore} Strong brand reputation`);
    } else if (socialScore >= 3) {
        factors.push(`+${brandScore} Good brand reputation`);
    } else {
        factors.push(`+${brandScore} Limited brand data`);
    }

    // Price data: neutral if missing, bonus if available and affordable
    // No penalty for missing price data - supplement value depends on efficacy, not price availability
    let priceBonus = 0;
    if (value.costPerServing != null) {
        // Has price data - give small bonus for transparency
        if (value.costPerServing <= 0.30) {
            priceBonus = 8;
            factors.push(`+8 Affordable ($${value.costPerServing.toFixed(2)}/serving)`);
        } else if (value.costPerServing <= 0.75) {
            priceBonus = 5;
            factors.push(`+5 Fair price ($${value.costPerServing.toFixed(2)}/serving)`);
        } else {
            priceBonus = 2;
            factors.push(`+2 Premium price ($${value.costPerServing.toFixed(2)}/serving)`);
        }
    }
    // No else clause - missing price = 0, not a penalty

    // Alternatives awareness - informational only, no penalty
    const altCount = value.alternatives?.length ?? 0;
    if (altCount > 0) {
        factors.push(`ℹ️ ${altCount} alternative(s) mentioned`);
    }

    // Increased base bonus from 10 to 20 to compensate for removed penalties
    const total = clamp(baseScore + brandScore + 20 + priceBonus, 0, 100);

    return { score: Math.round(total), factors };
}

// ============================================================================
// OVERALL SCORING & LABEL
// ============================================================================

function computeOverallAndLabel(eff: number, saf: number, val: number): { score: number; label: string } {
    // Weighted combination
    const rawOverall = 0.40 * eff + 0.35 * saf + 0.25 * val;
    const overall = Math.round(rawOverall);

    // Label assignment with safety override
    let label: string;

    // Safety override: if safety is dangerously low, override label
    if (saf < 40) {
        label = '⚠️ Safety Concern';
    } else if (overall >= 80) {
        label = '✅ Strongly Recommended';
    } else if (overall >= 65) {
        label = '👍 Recommended';
    } else if (overall >= 50) {
        label = '🤔 Consider Carefully';
    } else if (overall >= 35) {
        label = '⚡ Limited Evidence';
    } else {
        label = '❌ Not Recommended';
    }

    return { score: overall, label };
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

export function computeSmartScores(analysis: AnalysisInput): ScoreBreakdown {
    const { efficacy, safety, value, social } = analysis;

    const effResult = computeEffectiveness(efficacy);
    const safResult = computeSafety(safety);
    const valResult = computeValue(value, social);

    const { score: overall, label } = computeOverallAndLabel(
        effResult.score,
        safResult.score,
        valResult.score
    );

    return {
        effectiveness: effResult.score,
        safety: safResult.score,
        value: valResult.score,
        overall,
        label,
        details: {
            effectivenessFactors: effResult.factors,
            safetyFactors: safResult.factors,
            valueFactors: valResult.factors,
        },
    };
}

// Legacy export for compatibility (maps old SupplementMeta to new system)
export type SupplementMeta = Record<string, unknown>;

export function computeScores(meta: SupplementMeta): ScoreBreakdown {
    // This is a compatibility shim - the new system doesn't use SupplementMeta
    // Instead, we return default scores that will be overridden by computeSmartScores
    return {
        effectiveness: 50,
        safety: 70,
        value: 50,
        overall: 55,
        label: '🤔 Consider Carefully',
        details: {
            effectivenessFactors: ['Legacy scoring - no data'],
            safetyFactors: ['Legacy scoring - no data'],
            valueFactors: ['Legacy scoring - no data'],
        },
    };
}
