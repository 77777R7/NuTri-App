"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.goalMatchScoringInternals = exports.scoreProductGoalMatches = void 0;
const goal_ingredient_map_v1_json_1 = __importDefault(require("../../../data/personalization/goal_ingredient_map.v1.json"));
const goalCatalog_1 = require("./goalCatalog");
const GOAL_INGREDIENT_MAP = goal_ingredient_map_v1_json_1.default;
const TIER_ORDER = ['no_match', 'weak_match', 'related', 'strong_match'];
const BASE_SCORE_BY_TIER = {
    no_match: 0,
    weak_match: 38,
    related: 66,
    strong_match: 88,
};
const EVIDENCE_GRADE_BONUS = {
    A: 8,
    B: 3,
    C: -12,
};
const CONVERTIBLE_UNIT_TO_MG = {
    mcg: 0.001,
    mg: 1,
    g: 1000,
};
const INGREDIENT_KEY_ALIASES = {
    coq10: 'coenzyme_q10',
    coenzymeq10: 'coenzyme_q10',
    vitaminb12: 'vitamin_b12',
    vitaminb_12: 'vitamin_b12',
    fishoil: 'omega_3',
    omega3: 'omega_3',
    omega_3fattyacids: 'omega_3',
    proteinblend: 'protein',
    wheyprotein: 'protein',
    creatinemonohydrate: 'creatine',
};
const normalizeTextKey = (value) => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
const normalizeFreeformToken = (value) => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
const canonicalizeIngredientKey = (value) => {
    const freeform = normalizeFreeformToken(value);
    return INGREDIENT_KEY_ALIASES[freeform] ?? normalizeTextKey(value);
};
const clampScore = (score) => Math.max(0, Math.min(100, Math.round(score)));
const compareTier = (left, right) => TIER_ORDER.indexOf(left) - TIER_ORDER.indexOf(right);
const minTier = (left, right) => compareTier(left, right) <= 0 ? left : right;
const downgradeTier = (tier) => {
    const currentIndex = TIER_ORDER.indexOf(tier);
    return TIER_ORDER[Math.max(0, currentIndex - 1)] ?? 'no_match';
};
const applyTierCap = (tier, capTier) => minTier(tier, capTier);
const scoreToTier = (score) => {
    if (score >= 85)
        return 'strong_match';
    if (score >= 60)
        return 'related';
    if (score >= 30)
        return 'weak_match';
    return 'no_match';
};
const makeReason = (code, ruleId, source, params) => ({
    code,
    ruleId,
    source,
    ...(params ? { params } : {}),
});
const normalizeEvidenceGrade = (value) => {
    if (value === 'A' || value === 'B' || value === 'C')
        return value;
    return null;
};
const normalizeDisclosureQuality = (productDisclosure, ingredientDisclosure) => ingredientDisclosure ?? productDisclosure ?? 'unknown';
const normalizeUnit = (value) => {
    if (!value)
        return null;
    const normalized = normalizeFreeformToken(value);
    if (normalized === 'mcg' || normalized === 'ug')
        return 'mcg';
    if (normalized === 'mg' || normalized === 'milligram' || normalized === 'milligrams')
        return 'mg';
    if (normalized === 'g' || normalized === 'gram' || normalized === 'grams')
        return 'g';
    return normalized || null;
};
const convertDose = (amount, unit) => {
    const factor = CONVERTIBLE_UNIT_TO_MG[unit];
    if (!factor)
        return null;
    return amount * factor;
};
const evaluateDose = (amount, unit, floor, floorUnit) => {
    if (floor == null || !floorUnit) {
        return { status: 'not_applicable' };
    }
    if (typeof amount !== 'number' || amount <= 0) {
        return { status: 'unknown' };
    }
    const normalizedUnit = normalizeUnit(unit);
    const normalizedFloorUnit = normalizeUnit(floorUnit);
    if (!normalizedUnit || !normalizedFloorUnit) {
        return { status: 'unknown' };
    }
    if (normalizedUnit === normalizedFloorUnit) {
        return amount >= floor ? { status: 'meets' } : { status: 'below' };
    }
    const amountInMg = convertDose(amount, normalizedUnit);
    const floorInMg = convertDose(floor, normalizedFloorUnit);
    if (amountInMg == null || floorInMg == null) {
        return { status: 'unknown' };
    }
    return amountInMg >= floorInMg ? { status: 'meets' } : { status: 'below' };
};
const normalizeIngredientKey = (ingredient) => {
    const candidates = [ingredient.ingredientKey, ingredient.ingredientLabel, ingredient.name]
        .filter((value) => typeof value === 'string' && value.trim().length > 0)
        .map((value) => canonicalizeIngredientKey(value));
    return candidates[0] ?? null;
};
const getIngredientLookupTokens = (ingredient) => Array.from(new Set([ingredient.ingredientKey, ingredient.ingredientLabel, ingredient.name]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .map((value) => canonicalizeIngredientKey(value))));
const tokenMatchesIngredientKey = (token, ingredientKey) => token === ingredientKey ||
    token.startsWith(`${ingredientKey}_`) ||
    token.endsWith(`_${ingredientKey}`) ||
    token.includes(`_${ingredientKey}_`);
const normalizeAuditStatus = (value) => {
    if (!value)
        return null;
    const normalized = normalizeFreeformToken(value);
    return normalized || null;
};
const isAuditedStatus = (value) => value === 'approved' || value === 'verified' || value === 'reviewed' || value === 'captured';
const resolveEvidenceForGoal = (ingredient, goalKey) => (ingredient.evidence ?? []).find((row) => (0, goalCatalog_1.normalizeGoalKeys)([row.goalKey ?? row.goal ?? null])[0] === goalKey) ?? null;
const resolveEvidenceGrade = (evidence, row) => evidence
    ? normalizeEvidenceGrade(evidence.evidenceGrade ?? evidence.evidence_grade ?? null) ??
        row.evidenceGrade
    : null;
const resolveEvidenceFloor = (evidence, row) => {
    const value = evidence?.minEffectiveDose ?? evidence?.min_effective_dose ?? null;
    if (typeof value === 'number' && value > 0)
        return value;
    return typeof row.minEffectiveDose === 'number' && row.minEffectiveDose > 0
        ? row.minEffectiveDose
        : null;
};
const resolveEvidenceUnit = (evidence, row) => normalizeUnit(evidence?.unit ?? row.unit ?? null);
const resolveEvidenceAuditStatus = (evidence) => normalizeAuditStatus(evidence?.auditStatus ?? evidence?.audit_status ?? null);
const resolveIngredientAmount = (ingredient) => {
    if (ingredient.amountUnknown)
        return null;
    return typeof ingredient.amount === 'number' && ingredient.amount > 0 ? ingredient.amount : null;
};
const resolveIngredientUnit = (ingredient) => normalizeUnit(ingredient.amountUnitNormalized ?? ingredient.unit ?? ingredient.amountUnit ?? null);
const buildGoalIngredientIndex = () => {
    const byGoalKey = new Map();
    GOAL_INGREDIENT_MAP.mappings.forEach((mapping) => {
        byGoalKey.set(mapping.goalKey, mapping.ingredientMatches.map((match) => ({
            ...match,
            goalKey: mapping.goalKey,
            ingredientKey: canonicalizeIngredientKey(match.ingredientKey),
        })));
    });
    return byGoalKey;
};
const GOAL_INGREDIENT_INDEX = buildGoalIngredientIndex();
const findIngredientRows = (goalKey, ingredient) => {
    const goalRows = GOAL_INGREDIENT_INDEX.get(goalKey) ?? [];
    const tokens = getIngredientLookupTokens(ingredient);
    if (tokens.length === 0) {
        return [];
    }
    return goalRows.filter((row) => tokens.some((token) => tokenMatchesIngredientKey(token, row.ingredientKey)));
};
const scoreCandidate = (goalKey, ingredient, row, productDisclosureQuality, proprietaryBlendWithoutClearActives) => {
    const ingredientLabel = ingredient.ingredientLabel?.trim() ||
        ingredient.name?.trim() ||
        row.ingredientKey.replace(/_/g, ' ');
    const evidence = resolveEvidenceForGoal(ingredient, goalKey);
    const evidenceGrade = resolveEvidenceGrade(evidence, row);
    const evidenceFloor = resolveEvidenceFloor(evidence, row);
    const evidenceUnit = resolveEvidenceUnit(evidence, row);
    const evidenceAuditStatus = resolveEvidenceAuditStatus(evidence);
    const amount = resolveIngredientAmount(ingredient);
    const amountUnit = resolveIngredientUnit(ingredient);
    const disclosureQuality = normalizeDisclosureQuality(productDisclosureQuality, ingredient.disclosureQuality);
    let score = BASE_SCORE_BY_TIER[row.tier];
    let maxTier = row.tier;
    const caps = [];
    const reasons = [
        makeReason('goal_supported_by_ingredient', 'goal_map_match', 'catalog', {
            goalKey,
            ingredientKey: row.ingredientKey,
            ingredientLabel,
        }),
    ];
    if (evidenceGrade) {
        score += EVIDENCE_GRADE_BONUS[evidenceGrade];
        if (evidenceGrade === 'C') {
            maxTier = applyTierCap(maxTier, downgradeTier(row.tier));
            reasons.push(makeReason('evidence_grade_limited', 'goal_specific_evidence', 'catalog', {
                evidenceGrade,
                ingredientKey: row.ingredientKey,
            }));
        }
        else {
            reasons.push(makeReason('goal_specific_evidence_present', 'goal_specific_evidence', 'catalog', {
                evidenceGrade,
                ingredientKey: row.ingredientKey,
            }));
        }
    }
    else {
        if (row.tier === 'strong_match') {
            maxTier = applyTierCap(maxTier, 'related');
        }
        reasons.push(makeReason('goal_specific_evidence_missing', 'goal_specific_evidence', 'catalog', {
            ingredientKey: row.ingredientKey,
        }));
    }
    if (evidenceAuditStatus && !isAuditedStatus(evidenceAuditStatus)) {
        score -= 8;
        maxTier = applyTierCap(maxTier, downgradeTier(maxTier));
        reasons.push(makeReason('goal_specific_evidence_unreviewed', 'goal_specific_evidence', 'catalog', {
            auditStatus: evidenceAuditStatus,
            ingredientKey: row.ingredientKey,
        }));
    }
    const doseEvaluation = evaluateDose(amount, amountUnit, evidenceFloor, evidenceUnit);
    if (doseEvaluation.status === 'meets') {
        score += 8;
        reasons.push(makeReason('dose_meets_effective_floor', 'dose_floor_check', 'derived', {
            ingredientKey: row.ingredientKey,
        }));
    }
    else if (doseEvaluation.status === 'below') {
        score -= 24;
        maxTier = applyTierCap(maxTier, 'weak_match');
        reasons.push(makeReason('dose_below_effective_floor', 'dose_floor_check', 'derived', {
            ingredientKey: row.ingredientKey,
        }));
    }
    else if (doseEvaluation.status === 'unknown') {
        score -= 14;
        maxTier = applyTierCap(maxTier, downgradeTier(maxTier));
        reasons.push(makeReason('dose_not_disclosed', 'dose_floor_check', 'observed', {
            ingredientKey: row.ingredientKey,
        }));
    }
    const normalizedForm = normalizeTextKey(ingredient.formKey ?? ingredient.formLabel ?? ingredient.form ?? '');
    if (normalizedForm &&
        row.preferredForms.some((form) => canonicalizeIngredientKey(form) === normalizedForm)) {
        score += 3;
        reasons.push(makeReason('ingredient_form_preferred', 'ingredient_form_preference', 'catalog', {
            ingredientKey: row.ingredientKey,
            formKey: normalizedForm,
        }));
    }
    if (disclosureQuality === 'low') {
        score -= 18;
        maxTier = applyTierCap(maxTier, 'weak_match');
        caps.push('low_disclosure');
        reasons.push(makeReason('low_disclosure_caps_strong_match', 'low_disclosure_caps_goal_match', 'observed', {
            ingredientKey: row.ingredientKey,
        }));
    }
    if (proprietaryBlendWithoutClearActives || ingredient.proprietaryBlend) {
        score -= 20;
        maxTier = applyTierCap(maxTier, 'weak_match');
        caps.push('proprietary_blend');
        reasons.push(makeReason('proprietary_blend_caps_goal_match', 'proprietary_blend_caps_goal_match', 'observed', {
            ingredientKey: row.ingredientKey,
        }));
    }
    if (row.caps.includes('eligibility_requires_generic_safety_path') ||
        Boolean(evidence?.requiresGenericSafetyPath)) {
        caps.push('generic_safety_path');
        reasons.push(makeReason('ingredient_requires_generic_safety_path', 'generic_safety_path_guardrail', 'catalog', {
            ingredientKey: row.ingredientKey,
        }));
    }
    const confidence = {
        evidence: !evidenceGrade
            ? row.tier === 'strong_match'
                ? 'medium'
                : 'low'
            : evidenceAuditStatus && !isAuditedStatus(evidenceAuditStatus)
                ? 'medium'
                : evidenceGrade === 'A'
                    ? 'high'
                    : evidenceGrade === 'B'
                        ? 'medium'
                        : 'low',
        dose: doseEvaluation.status === 'meets' ||
            doseEvaluation.status === 'below' ||
            doseEvaluation.status === 'unknown'
            ? doseEvaluation.status
            : 'not_applicable',
        disclosure: disclosureQuality === 'high' && !proprietaryBlendWithoutClearActives && !ingredient.proprietaryBlend
            ? 'full'
            : disclosureQuality === 'low' || proprietaryBlendWithoutClearActives || ingredient.proprietaryBlend
                ? 'weak'
                : 'partial',
    };
    return {
        ingredientKey: row.ingredientKey,
        ingredientLabel,
        score: clampScore(score),
        tier: applyTierCap(scoreToTier(score), maxTier),
        reasons,
        caps: Array.from(new Set(caps)),
        confidence,
    };
};
const sortCandidates = (left, right) => {
    const tierDelta = compareTier(right.tier, left.tier);
    if (tierDelta !== 0)
        return tierDelta;
    return right.score - left.score;
};
const buildNoMatch = (goalKey) => ({
    goalKey,
    score: 0,
    tier: 'no_match',
    reasons: [
        makeReason('no_goal_support_detected', 'goal_map_match', 'derived', {
            goalKey,
        }),
    ],
    confidence: {
        evidence: 'low',
        dose: 'not_applicable',
        disclosure: 'weak',
    },
});
const getTargetGoals = (inputGoals) => {
    const normalized = (0, goalCatalog_1.normalizeGoalKeys)(inputGoals);
    if (normalized.length > 0) {
        return normalized;
    }
    return (0, goalCatalog_1.listActiveGoalCatalogEntries)().map((goal) => goal.goalKey);
};
const scoreProductGoalMatches = (input) => {
    const goals = getTargetGoals(input.goals);
    const ingredients = (input.ingredients ?? []).filter((ingredient) => getIngredientLookupTokens(ingredient).length > 0);
    return goals.map((goalKey) => {
        const candidates = ingredients.flatMap((ingredient) => findIngredientRows(goalKey, ingredient).map((row) => scoreCandidate(goalKey, ingredient, row, input.disclosureQuality, Boolean(input.proprietaryBlendWithoutClearActives))));
        if (candidates.length === 0) {
            return buildNoMatch(goalKey);
        }
        const sortedCandidates = [...candidates].sort(sortCandidates);
        const primary = sortedCandidates[0];
        const corroboratingMatches = sortedCandidates.filter((candidate, index) => index > 0 && candidate.tier !== 'no_match');
        const reasons = [...primary.reasons];
        const caps = Array.from(new Set(sortedCandidates.flatMap((candidate) => candidate.caps)));
        const corroborationBonus = Math.min(8, corroboratingMatches.length * 4);
        if (corroboratingMatches.length > 0) {
            reasons.push(makeReason('multiple_supporting_ingredients', 'goal_corroboration', 'derived', {
                count: corroboratingMatches.length + 1,
            }));
        }
        return {
            goalKey,
            score: clampScore(primary.score + corroborationBonus),
            tier: primary.tier,
            reasons,
            ...(caps.length > 0 ? { caps } : {}),
            confidence: primary.confidence,
        };
    });
};
exports.scoreProductGoalMatches = scoreProductGoalMatches;
exports.goalMatchScoringInternals = {
    canonicalizeIngredientKey,
    normalizeIngredientKey,
    normalizeTextKey,
    normalizeUnit,
    evaluateDose,
    scoreToTier,
};
