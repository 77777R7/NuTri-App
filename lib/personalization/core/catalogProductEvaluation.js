"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.catalogProductEvaluationInternals = exports.evaluatePreparedCatalogProduct = exports.evaluateCatalogProduct = exports.prepareCatalogProduct = void 0;
const eligibilityPolicy_1 = require("./eligibilityPolicy");
const goalMatchScoring_1 = require("./goalMatchScoring");
const goalFitCardBuilder_1 = require("./goalFitCardBuilder");
const savedProductEvaluation_1 = require("./savedProductEvaluation");
const PROPRIETARY_BLEND_PATTERN = /\b(blend|complex|matrix|formula)\b/i;
const normalizeParsedUnit = (value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized)
        return null;
    if (normalized === "μg" || normalized === "µg" || normalized === "ug")
        return "mcg";
    if (normalized === "iu" || normalized === "ui")
        return "iu";
    if (normalized === "cfu")
        return "cfu";
    if (normalized === "spu")
        return "spu";
    if (normalized === "ml" || normalized === "milliliter" || normalized === "milliliters")
        return "ml";
    if (normalized === "mg" || normalized === "g" || normalized === "mcg")
        return normalized;
    return null;
};
const parseAmountText = (value) => {
    const trimmed = value?.trim();
    if (!trimmed)
        return { amount: null, unit: null };
    const cfuScaledMatch = trimmed.match(/(-?\d[\d,]*(?:\.\d+)?)\s*(billion|million)\s*cfu\b/i);
    if (cfuScaledMatch) {
        const amount = Number.parseFloat(cfuScaledMatch[1].replace(/,/g, ""));
        if (!Number.isFinite(amount)) {
            return { amount: null, unit: null };
        }
        const scale = cfuScaledMatch[2]?.toLowerCase();
        return {
            amount: scale === "billion" ? amount * 1e9 : amount * 1e6,
            unit: "cfu",
        };
    }
    const match = trimmed.match(/(-?\d[\d,]*(?:\.\d+)?)\s*(mcg|μg|µg|ug|mg|g|iu|ui|cfu|spu|ml)\b/i);
    if (!match)
        return { amount: null, unit: null };
    const amount = Number.parseFloat(match[1].replace(/,/g, ""));
    const unit = normalizeParsedUnit(match[2]);
    if (!Number.isFinite(amount) || !unit) {
        return { amount: null, unit: null };
    }
    return { amount, unit };
};
const pickFirstText = (...values) => {
    for (const value of values) {
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }
    return undefined;
};
const normalizeDisplayValue = (value) => {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};
const deriveTypeKeysFromContent = (input) => {
    const haystack = [
        input.title,
        input.brandName,
        input.description,
        input.suggestedUse,
        ...input.ingredients.map((ingredient) => ingredient.name),
    ]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .join(" ")
        .toLowerCase();
    const next = new Set();
    if (/\b(probiotic|lactobacillus|bifidobacter|saccharomyces|prebiotic|cfu)\b/.test(haystack)) {
        next.add("probiotic");
    }
    if (/\b(protein|whey|casein|isolate|collagen|amino acid|bcaa|eaa)\b/.test(haystack)) {
        next.add("protein");
    }
    if (/\b(vitamin|ascorbic|cholecalciferol|ergocalciferol|tocopherol|retinol|folate|folic acid|cobalamin|niacin|thiamin|riboflavin|biotin|pantothenic)\b/.test(haystack)) {
        next.add("vitamin");
    }
    if (/\b(magnesium|zinc|calcium|iron|selenium|copper|chromium|potassium|iodine|manganese|electrolyte)\b/.test(haystack)) {
        next.add("mineral");
    }
    if (/\b(ashwagandha|rhodiola|turmeric|elderberry|bacopa|ginseng|garlic|maca|valerian|mushroom|lion'?s mane|reishi|cordyceps|botanical|herbal?)\b/.test(haystack)) {
        next.add("herb");
    }
    return Array.from(next);
};
const buildIngredientInputs = (rows) => {
    const next = [];
    for (const row of rows) {
        const name = row.name?.trim();
        if (!name)
            continue;
        const parsedDose = parseAmountText(row.dose);
        next.push({
            ingredientLabel: name,
            name,
            amount: parsedDose.amount,
            unit: parsedDose.unit,
            disclosureQuality: parsedDose.amount != null ? "medium" : "low",
            proprietaryBlend: PROPRIETARY_BLEND_PATTERN.test(name),
        });
    }
    return next;
};
const deriveFactsStatus = (ingredients) => {
    if (ingredients.length === 0)
        return "none";
    const hasStructuredDose = ingredients.some((ingredient) => typeof ingredient.amount === "number" &&
        ingredient.amount > 0 &&
        typeof ingredient.unit === "string" &&
        ingredient.unit.length > 0 &&
        ingredient.proprietaryBlend !== true);
    return hasStructuredDose ? "full" : "partial";
};
const prepareCatalogProduct = (input) => {
    const overlayIngredients = (input.ingredients ?? []).filter((ingredient) => typeof ingredient?.name === "string" && ingredient.name.trim().length > 0);
    const ingredientInputs = buildIngredientInputs(overlayIngredients);
    const factsStatus = deriveFactsStatus(ingredientInputs);
    const typeKeys = deriveTypeKeysFromContent({
        title: input.title,
        brandName: input.brandName,
        description: input.description,
        suggestedUse: input.suggestedUse,
        ingredients: overlayIngredients,
    });
    const dosageText = pickFirstText(input.dosageText, overlayIngredients.find((ingredient) => ingredient.dose?.trim())?.dose) ?? "";
    return {
        productId: input.productId,
        sourceProductId: input.sourceProductId ?? null,
        barcode: input.barcode ?? null,
        externalUrl: input.externalUrl ?? null,
        title: normalizeDisplayValue(input.title),
        brandName: normalizeDisplayValue(input.brandName),
        dosageText: normalizeDisplayValue(dosageText),
        imageUrl: normalizeDisplayValue(input.imageUrl),
        description: input.description ?? null,
        suggestedUse: input.suggestedUse ?? null,
        factsStatus,
        overlayIngredients,
        typeKeys,
        ingredientInputs,
        savedProductSeed: {
            productId: input.productId,
            factsStatus,
            ...(typeKeys.length > 0 ? { typeKeys } : {}),
            display: {
                ...(normalizeDisplayValue(input.title) ? { title: normalizeDisplayValue(input.title) } : {}),
                ...(normalizeDisplayValue(input.brandName)
                    ? { brandName: normalizeDisplayValue(input.brandName) }
                    : {}),
                ...(normalizeDisplayValue(dosageText) ? { dosageText: normalizeDisplayValue(dosageText) } : {}),
                ...(normalizeDisplayValue(input.imageUrl) ? { imageUrl: normalizeDisplayValue(input.imageUrl) } : {}),
            },
        },
    };
};
exports.prepareCatalogProduct = prepareCatalogProduct;
const buildSavedProductInput = (input) => {
    const { preparedProduct } = input;
    const ingredientInputs = preparedProduct.ingredientInputs;
    const factsStatus = preparedProduct.factsStatus;
    const typeKeys = preparedProduct.typeKeys;
    const productGoalMatches = factsStatus === "full"
        ? (0, goalMatchScoring_1.scoreProductGoalMatches)({
            goals: [input.goalKey],
            ingredients: ingredientInputs,
            disclosureQuality: "high",
            proprietaryBlendWithoutClearActives: false,
        })
        : [];
    const requiresGenericSafetyPath = productGoalMatches.some((match) => (match.caps ?? []).includes("generic_safety_path"));
    const eligibility = factsStatus === "full"
        ? (0, eligibilityPolicy_1.evaluateEligibilityPolicy)({
            productGoalMatches,
            duplicateRisk: input.duplicateRisk,
            supplementExperience: input.supplementExperience ?? null,
            ageRange: input.ageRange ?? null,
            adherenceBlocker: input.adherenceBlocker ?? null,
            hasDietConstraintConflict: false,
            requiresGenericSafetyPath,
        })
        : undefined;
    return {
        savedProduct: {
            ...preparedProduct.savedProductSeed,
            ...(productGoalMatches.length > 0 ? { productGoalMatches } : {}),
            ...(eligibility ? { eligibility } : {}),
        },
        factsStatus,
        typeKeys,
        productGoalMatches,
        ...(eligibility ? { eligibility } : {}),
    };
};
const getGoalMatch = (evaluation, goalKey) => evaluation.productGoalMatches.find((match) => match.goalKey === goalKey);
const toTierPriority = (tier) => {
    switch (tier) {
        case "strong_match":
            return 4;
        case "related":
            return 3;
        case "weak_match":
            return 2;
        default:
            return 1;
    }
};
const evaluateCatalogProduct = (input) => {
    const preparedProduct = (0, exports.prepareCatalogProduct)(input);
    return (0, exports.evaluatePreparedCatalogProduct)({
        preparedProduct,
        goalKey: input.goalKey,
        preferredTypes: input.preferredTypes,
        duplicateRisk: input.duplicateRisk,
        supplementExperience: input.supplementExperience ?? null,
        ageRange: input.ageRange ?? null,
        adherenceBlocker: input.adherenceBlocker ?? null,
    });
};
exports.evaluateCatalogProduct = evaluateCatalogProduct;
const evaluatePreparedCatalogProduct = (input) => {
    const { savedProduct, factsStatus, typeKeys } = buildSavedProductInput({
        preparedProduct: input.preparedProduct,
        goalKey: input.goalKey,
        duplicateRisk: input.duplicateRisk,
        supplementExperience: input.supplementExperience ?? null,
        ageRange: input.ageRange ?? null,
        adherenceBlocker: input.adherenceBlocker ?? null,
    });
    const evaluationSet = (0, savedProductEvaluation_1.evaluateSavedProducts)({
        prioritizedGoals: [input.goalKey],
        savedProducts: {
            [input.preparedProduct.productId]: savedProduct,
        },
    });
    const savedProductEvaluation = evaluationSet.savedProductEvaluations[input.preparedProduct.productId];
    const goalFitCard = (0, goalFitCardBuilder_1.buildGoalFitCard)({
        evaluation: savedProductEvaluation,
        goalKey: input.goalKey,
    });
    const goalMatch = getGoalMatch(savedProductEvaluation, input.goalKey);
    const preferredTypeMatch = (input.preferredTypes ?? []).length > 0 &&
        typeKeys.some((typeKey) => (input.preferredTypes ?? []).includes(typeKey));
    const candidate = savedProductEvaluation.coverage.status === "coverage_ready" && goalFitCard
        ? ({
            productId: input.preparedProduct.productId,
            goalKey: input.goalKey,
            tier: goalFitCard.tier,
            score: goalMatch?.score ?? 0,
            typeKeys,
            preferredTypeMatch,
            ...(input.preparedProduct.sourceProductId
                ? { sourceProductId: input.preparedProduct.sourceProductId }
                : {}),
            ...(input.preparedProduct.barcode ? { barcode: input.preparedProduct.barcode } : {}),
            ...(input.preparedProduct.externalUrl ? { externalUrl: input.preparedProduct.externalUrl } : {}),
            evaluation: savedProductEvaluation,
            goalFitCard,
        })
        : undefined;
    return {
        coverageStatus: factsStatus === "full" ? "coverage_ready" : "not_enough_structured_data",
        savedProductEvaluation,
        goalFitCard,
        ...(candidate ? { candidate } : {}),
    };
};
exports.evaluatePreparedCatalogProduct = evaluatePreparedCatalogProduct;
exports.catalogProductEvaluationInternals = {
    buildIngredientInputs,
    buildSavedProductInput,
    deriveFactsStatus,
    deriveTypeKeysFromContent,
    evaluatePreparedCatalogProduct: exports.evaluatePreparedCatalogProduct,
    normalizeParsedUnit,
    parseAmountText,
    prepareCatalogProduct: exports.prepareCatalogProduct,
    toTierPriority,
};
