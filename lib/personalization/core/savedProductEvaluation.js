"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.savedProductEvaluationInternals = exports.projectSavedProductEvaluations = exports.evaluateSavedProducts = void 0;
const reasonCodes_1 = require("./reasonCodes");
const productEvaluationGate_1 = require("./productEvaluationGate");
const hasDisplayFields = (evaluation) => Boolean(evaluation.display?.title ||
    evaluation.display?.brandName ||
    evaluation.display?.dosageText ||
    evaluation.display?.imageUrl);
const TIER_PRIORITY = {
    strong_match: 4,
    related: 3,
    weak_match: 2,
    no_match: 1,
};
const toEligibilitySummary = (decision) => decision
    ? {
        eligible: decision.eligible,
        rankEligible: decision.rankEligible,
        caps: [...decision.caps],
    }
    : undefined;
const getTypeKeys = (savedProduct) => Array.from(new Set(savedProduct.typeKeys ?? []));
const getGoalTiers = (prioritizedGoals, matches) => Object.fromEntries(prioritizedGoals
    .map((goalKey) => {
    const match = matches.find((entry) => entry.goalKey === goalKey);
    return match ? [goalKey, match.tier] : null;
})
    .filter((entry) => entry != null));
const getMatchBucket = (prioritizedGoals, matches) => {
    const relevantMatches = prioritizedGoals.length > 0
        ? matches.filter((match) => prioritizedGoals.includes(match.goalKey))
        : matches;
    const bestMatch = relevantMatches
        .filter((match) => match.score > 0)
        .sort((left, right) => {
        const tierDelta = TIER_PRIORITY[right.tier] - TIER_PRIORITY[left.tier];
        if (tierDelta !== 0)
            return tierDelta;
        return right.score - left.score;
    })[0];
    return bestMatch?.tier ?? 'no_match';
};
const getHighlightedGoal = (prioritizedGoals, matches) => {
    const bestMatch = matches
        .filter((match) => prioritizedGoals.includes(match.goalKey) && match.score > 0)
        .sort((left, right) => {
        const tierDelta = TIER_PRIORITY[right.tier] - TIER_PRIORITY[left.tier];
        if (tierDelta !== 0)
            return tierDelta;
        return right.score - left.score;
    })[0];
    return bestMatch?.goalKey;
};
const buildNotEnoughStructuredDataMembership = (input) => ({
    productId: input.productId,
    factsStatus: input.factsStatus,
    coverageStatus: input.coverage.status,
    bucket: 'not_enough_structured_data',
    typeKeys: input.typeKeys,
    goalTiers: {},
    reasons: [...input.coverage.reasons],
});
const buildCoverageReadyMembership = (input) => {
    const bucket = getMatchBucket(input.prioritizedGoals, input.productGoalMatches);
    const highlightedGoal = getHighlightedGoal(input.prioritizedGoals, input.productGoalMatches);
    return {
        productId: input.productId,
        factsStatus: input.factsStatus,
        coverageStatus: input.coverage.status,
        bucket,
        typeKeys: input.typeKeys,
        ...(highlightedGoal ? { highlightedGoal } : {}),
        goalTiers: getGoalTiers(input.prioritizedGoals, input.productGoalMatches),
        ...(input.eligibility ? { eligibility: toEligibilitySummary(input.eligibility) } : {}),
        reasons: (0, reasonCodes_1.dedupeReasons)(input.coverage.reasons, input.productGoalMatches.flatMap((match) => match.reasons), input.eligibility?.reasons ?? [], [
            (0, reasonCodes_1.buildReason)(reasonCodes_1.REASON_CODES.smartFilterProductMembershipBucketed, reasonCodes_1.RULE_IDS.smartFilterProductMembershipBucketed, 'derived', {
                bucket,
                productId: input.productId,
                ...(highlightedGoal ? { highlightedGoal } : {}),
            }),
        ]),
    };
};
const evaluateSavedProduct = (input) => {
    const coverage = (0, productEvaluationGate_1.evaluateProductCoverageGate)({
        factsStatus: input.savedProduct.factsStatus,
    });
    const typeKeys = getTypeKeys(input.savedProduct);
    if (coverage.status !== 'coverage_ready') {
        const smartFilterMembership = buildNotEnoughStructuredDataMembership({
            productId: input.savedProduct.productId,
            factsStatus: input.savedProduct.factsStatus,
            typeKeys,
            coverage,
        });
        return {
            productId: input.savedProduct.productId,
            factsStatus: input.savedProduct.factsStatus,
            coverage,
            productGoalMatches: [],
            firstStackEligible: false,
            smartFilterMembership,
            ...(hasDisplayFields(input.savedProduct) ? { display: { ...input.savedProduct.display } } : {}),
            reasons: (0, reasonCodes_1.dedupeReasons)(coverage.reasons, smartFilterMembership.reasons, [
                (0, reasonCodes_1.buildReason)(reasonCodes_1.REASON_CODES.savedProductEvaluationCompiled, reasonCodes_1.RULE_IDS.savedProductEvaluationCompiled, 'derived', {
                    productId: input.savedProduct.productId,
                    coverageStatus: coverage.status,
                }),
            ]),
        };
    }
    const productGoalMatches = [...(input.savedProduct.productGoalMatches ?? [])];
    const eligibility = input.savedProduct.eligibility;
    const smartFilterMembership = buildCoverageReadyMembership({
        productId: input.savedProduct.productId,
        factsStatus: input.savedProduct.factsStatus,
        typeKeys,
        coverage,
        prioritizedGoals: input.prioritizedGoals,
        productGoalMatches,
        eligibility,
    });
    return {
        productId: input.savedProduct.productId,
        factsStatus: input.savedProduct.factsStatus,
        coverage,
        productGoalMatches,
        ...(eligibility ? { eligibility } : {}),
        firstStackEligible: (eligibility?.rankEligible ?? true) &&
            smartFilterMembership.bucket !== 'no_match' &&
            smartFilterMembership.bucket !== 'not_enough_structured_data',
        smartFilterMembership,
        ...(hasDisplayFields(input.savedProduct) ? { display: { ...input.savedProduct.display } } : {}),
        reasons: (0, reasonCodes_1.dedupeReasons)(coverage.reasons, productGoalMatches.flatMap((match) => match.reasons), eligibility?.reasons ?? [], smartFilterMembership.reasons, [
            (0, reasonCodes_1.buildReason)(reasonCodes_1.REASON_CODES.savedProductEvaluationCompiled, reasonCodes_1.RULE_IDS.savedProductEvaluationCompiled, 'derived', {
                productId: input.savedProduct.productId,
                coverageStatus: coverage.status,
                bucket: smartFilterMembership.bucket,
            }),
        ]),
    };
};
const evaluateSavedProducts = (input) => {
    const entries = Object.values(input.savedProducts).map((savedProduct) => evaluateSavedProduct({
        prioritizedGoals: input.prioritizedGoals,
        savedProduct,
    }));
    return entries.reduce((acc, evaluation) => {
        acc.coverage[evaluation.productId] = evaluation.coverage;
        acc.savedProductEvaluations[evaluation.productId] = evaluation;
        if (evaluation.coverage.status === 'coverage_ready') {
            acc.productGoalMatches[evaluation.productId] = evaluation.productGoalMatches;
            if (evaluation.eligibility) {
                acc.eligibility[evaluation.productId] = evaluation.eligibility;
            }
        }
        return acc;
    }, {
        coverage: {},
        savedProductEvaluations: {},
        productGoalMatches: {},
        eligibility: {},
    });
};
exports.evaluateSavedProducts = evaluateSavedProducts;
const projectSavedProductEvaluations = (evaluations) => Object.values(evaluations).reduce((acc, evaluation) => {
    acc.coverage[evaluation.productId] = evaluation.coverage;
    acc.savedProductEvaluations[evaluation.productId] = evaluation;
    if (evaluation.coverage.status === 'coverage_ready') {
        acc.productGoalMatches[evaluation.productId] = evaluation.productGoalMatches;
        if (evaluation.eligibility) {
            acc.eligibility[evaluation.productId] = evaluation.eligibility;
        }
    }
    return acc;
}, {
    coverage: {},
    savedProductEvaluations: {},
    productGoalMatches: {},
    eligibility: {},
});
exports.projectSavedProductEvaluations = projectSavedProductEvaluations;
exports.savedProductEvaluationInternals = {
    evaluateSavedProduct,
    getGoalTiers,
    getHighlightedGoal,
    getMatchBucket,
    getTypeKeys,
    projectSavedProductEvaluations: exports.projectSavedProductEvaluations,
};
