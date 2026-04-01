"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSmartFilterConfig = exports.resolveTypeTags = exports.resolveVisibleGoalTags = exports.canonicalizeGoal = exports.ADHERENCE_BLOCKER_OPTIONS = exports.TYPE_OPTIONS = exports.LEGACY_DEFAULT_GOALS = exports.GOAL_OPTIONS = exports.SUPPLEMENT_EXPERIENCE_OPTIONS = exports.SEX_OPTIONS = exports.AGE_RANGE_OPTIONS = exports.ONBOARDING_TOTAL_STEPS = void 0;
exports.ONBOARDING_TOTAL_STEPS = 12;
exports.AGE_RANGE_OPTIONS = [
    '13-17',
    '18-24',
    '25-34',
    '35-44',
    '45-54',
    '55+',
];
exports.SEX_OPTIONS = ['Male', 'Female', 'Other', 'Prefer not to say'];
exports.SUPPLEMENT_EXPERIENCE_OPTIONS = [
    'Brand new',
    'Tried a few',
    'Regular user',
    'Structured stack',
];
exports.GOAL_OPTIONS = [
    'Sleep',
    'Energy',
    'Immunity',
    'Recovery',
    'Focus',
    'Libido Enhancement',
    'Stress Support',
    'Weight Management',
];
exports.LEGACY_DEFAULT_GOALS = ['Sleep', 'Energy', 'Immunity', 'Recovery', 'Focus'];
exports.TYPE_OPTIONS = ['Vitamin', 'Mineral', 'Herb', 'Probiotic', 'Protein'];
exports.ADHERENCE_BLOCKER_OPTIONS = [
    'I forget when my day gets busy',
    'My routine changes day to day',
    'I am not sure which supplements fit my goals',
    'Labels and dosage are confusing',
    'I do not have a good daily tracking habit',
    'I am already consistent',
];
const normalize = (value) => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
const GOAL_ALIAS_TO_CANONICAL = {
    boostenergy: 'Energy',
    energy: 'Energy',
    improvesleep: 'Sleep',
    sleep: 'Sleep',
    supportimmunity: 'Immunity',
    immunity: 'Immunity',
    enhancefocus: 'Focus',
    focus: 'Focus',
    managestress: 'Stress Support',
    stresssupport: 'Stress Support',
    buildmuscle: 'Recovery',
    recovery: 'Recovery',
    weightmanagement: 'Weight Management',
    generalwellness: 'Recovery',
    libidoenhancement: 'Libido Enhancement',
};
const canonicalizeGoal = (value) => {
    const key = normalize(value);
    if (!key)
        return null;
    const direct = exports.GOAL_OPTIONS.find((goal) => normalize(goal) === key);
    if (direct)
        return direct;
    return GOAL_ALIAS_TO_CANONICAL[key] ?? null;
};
exports.canonicalizeGoal = canonicalizeGoal;
const resolveVisibleGoalTags = (goals) => {
    const seen = new Set();
    (goals ?? []).forEach((goal) => {
        const canonical = (0, exports.canonicalizeGoal)(goal);
        if (canonical)
            seen.add(canonical);
    });
    if (seen.size === 0) {
        return [...exports.LEGACY_DEFAULT_GOALS];
    }
    return exports.GOAL_OPTIONS.filter((goal) => seen.has(goal));
};
exports.resolveVisibleGoalTags = resolveVisibleGoalTags;
const resolveTypeTags = (types) => {
    const allowed = new Set(exports.TYPE_OPTIONS);
    const selected = (types ?? []).filter((type) => typeof type === 'string' && allowed.has(type));
    return Array.from(new Set(selected));
};
exports.resolveTypeTags = resolveTypeTags;
const buildSmartFilterConfig = (input) => ({
    visibleGoals: (0, exports.resolveVisibleGoalTags)(input.goals),
    preselectedTypes: (0, exports.resolveTypeTags)(input.preferredTypes),
    preselectedTiming: [],
});
exports.buildSmartFilterConfig = buildSmartFilterConfig;
