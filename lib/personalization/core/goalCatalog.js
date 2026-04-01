"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.goalCatalogInternals = exports.listActiveGoalCatalogEntries = exports.getDefaultGoalKeys = exports.getGoalLabel = exports.getGoalCatalogEntry = exports.normalizeGoalKeys = exports.normalizeGoalKey = exports.getGoalCatalog = void 0;
const onboarding_v2_1 = require("../../onboarding-v2");
const goal_catalog_v1_json_1 = __importDefault(require("../../../data/personalization/goal_catalog.v1.json"));
const V1_GOAL_CATALOG = goal_catalog_v1_json_1.default;
const GOAL_LABEL_TO_KEY = {
    Sleep: 'sleep',
    Energy: 'energy',
    Immunity: 'immunity',
    Recovery: 'recovery',
    Focus: 'focus',
    'Libido Enhancement': 'libido_enhancement',
    'Stress Support': 'stress_support',
    'Weight Management': 'weight_management',
};
const GOAL_OPTION_SET = new Set(onboarding_v2_1.GOAL_OPTIONS);
const isGoalOption = (value) => GOAL_OPTION_SET.has(value);
const normalizeCatalogToken = (value) => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
const goalLabelToKey = (label) => GOAL_LABEL_TO_KEY[label] ?? null;
let cachedCatalog = null;
const buildGoalCatalog = () => {
    const byGoalKey = new Map();
    const byNormalizedKey = new Map();
    const goals = V1_GOAL_CATALOG.goals.map((goal) => {
        const goalKey = goal.key ?? goal.goalKey;
        if (!goalKey) {
            throw new Error(`Goal catalog record missing key for label: ${goal.label}`);
        }
        const onboardingLabel = goal.onboardingLabel ?? goal.label;
        if (!isGoalOption(onboardingLabel)) {
            throw new Error(`Unsupported onboarding goal label: ${onboardingLabel}`);
        }
        const expectedGoalKey = goalLabelToKey(onboardingLabel);
        if (!expectedGoalKey || expectedGoalKey !== goalKey) {
            throw new Error(`Goal catalog label mismatch: ${onboardingLabel} -> ${goalKey}`);
        }
        const aliases = Array.from(new Set([goal.label, onboardingLabel, ...(goal.aliases ?? [])].filter(Boolean)));
        const active = goal.active ?? goal.defaultVisible ?? true;
        const defaultVisible = goal.defaultVisible ?? active;
        const normalizedTokens = Array.from(new Set([goalKey, goal.label, onboardingLabel, ...aliases]
            .map((token) => normalizeCatalogToken(token))
            .filter(Boolean)));
        const entry = {
            goalKey,
            label: goal.label,
            onboardingLabel,
            aliases,
            defaultPriority: goal.defaultPriority,
            summary: goal.summary ?? '',
            defaultVisible,
            active,
            allowedTypes: [...(goal.allowedTypes ?? [])],
            normalizedTokens,
        };
        byGoalKey.set(goalKey, entry);
        normalizedTokens.forEach((token) => {
            byNormalizedKey.set(token, goalKey);
        });
        return entry;
    });
    const defaultGoalKeys = onboarding_v2_1.LEGACY_DEFAULT_GOALS.map((label) => {
        const goalKey = goalLabelToKey(label);
        if (!goalKey) {
            throw new Error(`Unknown default goal label: ${label}`);
        }
        return goalKey;
    });
    return {
        schemaVersion: V1_GOAL_CATALOG.version ?? 'v1',
        version: V1_GOAL_CATALOG.version ?? 'v1',
        goals,
        byGoalKey,
        byNormalizedKey,
        defaultGoalKeys,
    };
};
const getGoalCatalog = () => {
    if (!cachedCatalog) {
        cachedCatalog = buildGoalCatalog();
    }
    return cachedCatalog;
};
exports.getGoalCatalog = getGoalCatalog;
const normalizeGoalKey = (value) => {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    const catalog = (0, exports.getGoalCatalog)();
    if (catalog.byGoalKey.has(trimmed)) {
        return trimmed;
    }
    const normalized = normalizeCatalogToken(trimmed);
    const directMatch = catalog.byNormalizedKey.get(normalized);
    if (directMatch) {
        return directMatch;
    }
    const onboardingLabel = (0, onboarding_v2_1.canonicalizeGoal)(trimmed);
    if (!onboardingLabel) {
        return null;
    }
    return goalLabelToKey(onboardingLabel);
};
exports.normalizeGoalKey = normalizeGoalKey;
const normalizeGoalKeys = (values) => {
    const seen = new Set();
    (values ?? []).forEach((value) => {
        const goalKey = (0, exports.normalizeGoalKey)(value);
        if (goalKey) {
            seen.add(goalKey);
        }
    });
    return Array.from(seen);
};
exports.normalizeGoalKeys = normalizeGoalKeys;
const getGoalCatalogEntry = (value) => {
    const goalKey = (0, exports.normalizeGoalKey)(value);
    if (!goalKey)
        return null;
    return (0, exports.getGoalCatalog)().byGoalKey.get(goalKey) ?? null;
};
exports.getGoalCatalogEntry = getGoalCatalogEntry;
const getGoalLabel = (value) => (0, exports.getGoalCatalogEntry)(value)?.label ?? null;
exports.getGoalLabel = getGoalLabel;
const getDefaultGoalKeys = () => [...(0, exports.getGoalCatalog)().defaultGoalKeys];
exports.getDefaultGoalKeys = getDefaultGoalKeys;
const listActiveGoalCatalogEntries = () => (0, exports.getGoalCatalog)().goals.filter((goal) => goal.active);
exports.listActiveGoalCatalogEntries = listActiveGoalCatalogEntries;
exports.goalCatalogInternals = {
    normalizeCatalogToken,
    goalLabelToKey,
};
