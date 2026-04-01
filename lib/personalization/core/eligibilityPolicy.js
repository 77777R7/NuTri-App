"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.eligibilityPolicyInternals = exports.evaluateEligibilityPolicy = void 0;
const safety_rules_v1_json_1 = __importDefault(require("../../../data/personalization/safety_rules.v1.json"));
const safety_guardrails_v2_json_1 = __importDefault(require("../../../data/personalization/safety_guardrails.v2.json"));
const SAFETY_RULES = safety_rules_v1_json_1.default;
const SAFETY_GUARDRAILS = safety_guardrails_v2_json_1.default;
const makeReason = (code, ruleId, source, params) => ({
    code,
    ruleId,
    source,
    ...(params ? { params } : {}),
});
const getDuplicateRule = (level) => SAFETY_RULES.eligibilityRules?.find((rule) => rule.appliesWhen?.duplicateRiskLevels?.includes(level ?? 'none')) ?? null;
const collectMatchCaps = (matches) => Array.from(new Set(matches.flatMap((match) => match.caps ?? [])));
const buildCapReasons = (caps) => {
    const reasons = [];
    if (caps.includes('low_disclosure')) {
        reasons.push(makeReason('low_disclosure_caps_strong_match', 'low_disclosure_caps_goal_match', 'observed'));
    }
    if (caps.includes('proprietary_blend')) {
        reasons.push(makeReason('proprietary_blend_caps_goal_match', 'proprietary_blend_caps_goal_match', 'observed'));
    }
    if (caps.includes('generic_safety_path')) {
        reasons.push(makeReason('ingredient_requires_generic_safety_path', 'sensitive_goal_generic_safety_path', 'catalog'));
    }
    return reasons;
};
const evaluateEligibilityPolicy = (input) => {
    const matches = input.productGoalMatches ?? [];
    const caps = collectMatchCaps(matches);
    const reasons = [];
    let eligible = true;
    let rankEligible = true;
    const duplicateRule = getDuplicateRule(input.duplicateRisk?.level);
    if (duplicateRule) {
        eligible = duplicateRule.outcome.eligible;
        rankEligible = duplicateRule.outcome.rankEligible;
        caps.push(...duplicateRule.outcome.caps);
        reasons.push(makeReason(duplicateRule.reasonCode, duplicateRule.ruleId, 'observed', {
            ingredientKeys: (input.duplicateRisk?.ingredientKeys ?? []).join(','),
            level: input.duplicateRisk?.level ?? 'none',
        }));
    }
    if (input.hasDietConstraintConflict) {
        eligible = false;
        rankEligible = false;
        caps.push('diet_constraint_conflict');
        reasons.push(makeReason('diet_constraint_exclusion', 'diet_constraint_exclusion', 'declared'));
    }
    if (input.requiresGenericSafetyPath) {
        caps.push('generic_safety_path');
    }
    reasons.push(...buildCapReasons(Array.from(new Set(caps))));
    const guardrails = Array.from(new Set(caps))
        .map((cap) => SAFETY_GUARDRAILS.guardrails?.find((guardrail) => guardrail.capKey === cap))
        .filter((guardrail) => !!guardrail);
    const cautionClass = !eligible
        ? 'blocked'
        : guardrails.some((guardrail) => guardrail.cautionClass === 'blocked')
            ? 'blocked'
            : guardrails.some((guardrail) => guardrail.cautionClass === 'review')
                ? 'review'
                : 'clear';
    const suppressionLevel = !eligible
        ? 'exclude'
        : !rankEligible || guardrails.some((guardrail) => guardrail.suppressionLevel === 'deprioritize')
            ? 'deprioritize'
            : 'none';
    return {
        eligible,
        rankEligible,
        caps: Array.from(new Set(caps)),
        reasons,
        cautionClass,
        suppressionLevel,
    };
};
exports.evaluateEligibilityPolicy = evaluateEligibilityPolicy;
exports.eligibilityPolicyInternals = {
    buildCapReasons,
    collectMatchCaps,
    getDuplicateRule,
};
