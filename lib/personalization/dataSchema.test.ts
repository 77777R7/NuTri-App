import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADHERENCE_BLOCKER_OPTIONS,
  AGE_RANGE_OPTIONS,
  GOAL_OPTIONS,
  SUPPLEMENT_EXPERIENCE_OPTIONS,
} from '@/lib/onboarding-v2';
import activityGoalMap from '@/data/personalization/activity_goal_map.v1.json';
import blockerBehaviorRules from '@/data/personalization/blocker_behavior_rules.v1.json';
import dietReviewLanes from '@/data/personalization/diet_nutrient_lane_map.v1.json';
import explanationTemplates from '@/data/personalization/explanation_templates.v1.json';
import featureFlags from '@/data/personalization/feature_flags.v1.json';
import goalCatalog from '@/data/personalization/goal_catalog.v1.json';
import goalIngredientMap from '@/data/personalization/goal_ingredient_map.v1.json';
import goalIngredientMapV2 from '@/data/personalization/goal_ingredient_map.v2.json';
import safetyRules from '@/data/personalization/safety_rules.v1.json';
import activityGoalMapSchema from '@/data/personalization/schemas/activity_goal_map.schema.json';
import blockerBehaviorRulesSchema from '@/data/personalization/schemas/blocker_behavior_rules.schema.json';
import dietReviewLanesSchema from '@/data/personalization/schemas/diet_nutrient_lane_map.schema.json';
import explanationTemplatesSchema from '@/data/personalization/schemas/explanation_templates.schema.json';
import featureFlagsSchema from '@/data/personalization/schemas/feature_flags.schema.json';
import goalCatalogSchema from '@/data/personalization/schemas/goal_catalog.schema.json';
import goalIngredientMapSchema from '@/data/personalization/schemas/goal_ingredient_map.schema.json';
import goalIngredientMapV2Schema from '@/data/personalization/schemas/goal_ingredient_map.v2.schema.json';
import safetyRulesSchema from '@/data/personalization/schemas/safety_rules.schema.json';
import { projectLegacyGoalIngredientMap } from '@/lib/personalization/core/goalMatchOntology';

const GOAL_KEYS = [
  'sleep',
  'energy',
  'immunity',
  'recovery',
  'focus',
  'libido_enhancement',
  'stress_support',
  'weight_management',
] as const;

const TYPE_KEYS = ['vitamin', 'mineral', 'herb', 'probiotic', 'protein'] as const;

const BLOCKER_KEYS = [
  'busy_day_forgetfulness',
  'routine_changes_day_to_day',
  'goal_fit_uncertainty',
  'label_and_dosage_confusion',
  'weak_tracking_habit',
  'already_consistent',
] as const;

const EXPERIENCE_LEVELS = [
  'brand_new',
  'tried_a_few',
  'regular_user',
  'structured_stack',
] as const;

const GOAL_LABEL_BY_KEY: Record<string, string> = {
  sleep: 'Sleep',
  energy: 'Energy',
  immunity: 'Immunity',
  recovery: 'Recovery',
  focus: 'Focus',
  libido_enhancement: 'Libido Enhancement',
  stress_support: 'Stress Support',
  weight_management: 'Weight Management',
};

const BLOCKER_LABEL_BY_KEY: Record<string, string> = {
  busy_day_forgetfulness: 'I forget when my day gets busy',
  routine_changes_day_to_day: 'My routine changes day to day',
  goal_fit_uncertainty: 'I am not sure which supplements fit my goals',
  label_and_dosage_confusion: 'Labels and dosage are confusing',
  weak_tracking_habit: 'I do not have a good daily tracking habit',
  already_consistent: 'I am already consistent',
};

const GROUPED_TO_LEGACY_TIER = {
  strong_match: 'strong',
  related: 'supporting',
  weak_match: 'exploratory',
} as const;

const GOAL_KEY_SET = new Set<string>(GOAL_KEYS);
const TYPE_KEY_SET = new Set<string>(TYPE_KEYS);
const GOAL_OPTION_SET = new Set<string>(GOAL_OPTIONS);
const BLOCKER_OPTION_SET = new Set<string>(ADHERENCE_BLOCKER_OPTIONS);

type JsonSchema = {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: boolean;
  minItems?: number;
  uniqueItems?: boolean;
  minimum?: number;
  minLength?: number;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeTypes = (type?: string | string[]) => (type ? (Array.isArray(type) ? type : [type]) : []);

const valueMatchesType = (value: unknown, type: string) => {
  if (type === 'array') return Array.isArray(value);
  if (type === 'null') return value === null;
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'object') return isPlainObject(value);
  return typeof value === type;
};

const toStableJson = (value: unknown) => JSON.stringify(value);

const validateSchema = (schema: JsonSchema, value: unknown, path = '$'): void => {
  if (schema.const !== undefined) {
    assert.deepEqual(value, schema.const, `${path} should equal const ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum) {
    assert.ok(schema.enum.some((entry) => Object.is(entry, value)), `${path} should be one of ${schema.enum.join(', ')}`);
  }

  const allowedTypes = normalizeTypes(schema.type);
  if (allowedTypes.length > 0) {
    assert.ok(
      allowedTypes.some((type) => valueMatchesType(value, type)),
      `${path} should match type ${allowedTypes.join(' | ')}`,
    );
  }

  if (typeof value === 'string' && typeof schema.minLength === 'number') {
    assert.ok(value.length >= schema.minLength, `${path} should have minLength ${schema.minLength}`);
  }

  if (typeof value === 'number' && typeof schema.minimum === 'number') {
    assert.ok(value >= schema.minimum, `${path} should be >= ${schema.minimum}`);
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number') {
      assert.ok(value.length >= schema.minItems, `${path} should have at least ${schema.minItems} items`);
    }

    if (schema.uniqueItems) {
      const serialized = value.map((entry) => toStableJson(entry));
      assert.equal(new Set(serialized).size, serialized.length, `${path} should only contain unique items`);
    }

    if (schema.items) {
      value.forEach((entry, index) => validateSchema(schema.items as JsonSchema, entry, `${path}[${index}]`));
    }
  }

  if (isPlainObject(value)) {
    const properties = schema.properties ?? {};
    const required = schema.required ?? [];

    required.forEach((key) => {
      assert.ok(key in value, `${path}.${key} is required`);
    });

    Object.entries(value).forEach(([key, entry]) => {
      const childSchema = properties[key];
      if (!childSchema) {
        if (schema.additionalProperties === false) {
          assert.fail(`${path}.${key} is not allowed by schema`);
        }
        return;
      }

      validateSchema(childSchema, entry, `${path}.${key}`);
    });
  }
};

test('personalization phase 0 data files satisfy the checked-in JSON schemas', () => {
  const fixtures = [
    { name: 'goalCatalog', data: goalCatalog, schema: goalCatalogSchema },
    { name: 'goalIngredientMap', data: goalIngredientMap, schema: goalIngredientMapSchema },
    { name: 'goalIngredientMapV2', data: goalIngredientMapV2, schema: goalIngredientMapV2Schema },
    { name: 'blockerBehaviorRules', data: blockerBehaviorRules, schema: blockerBehaviorRulesSchema },
    { name: 'dietReviewLanes', data: dietReviewLanes, schema: dietReviewLanesSchema },
    { name: 'activityGoalMap', data: activityGoalMap, schema: activityGoalMapSchema },
    { name: 'safetyRules', data: safetyRules, schema: safetyRulesSchema },
    { name: 'explanationTemplates', data: explanationTemplates, schema: explanationTemplatesSchema },
    { name: 'featureFlags', data: featureFlags, schema: featureFlagsSchema },
  ];

  fixtures.forEach(({ name, data, schema }) => {
    assert.doesNotThrow(() => validateSchema(schema as JsonSchema, data, `$${name}`));
  });
});

test('goal catalog stays aligned to onboarding labels and allowed type enums', () => {
  assert.equal(goalCatalog.version, 'v1');
  assert.equal(goalCatalog.goals.length, GOAL_KEYS.length);
  assert.deepEqual(new Set(goalCatalog.goals.map((goal) => goal.key)), new Set(GOAL_KEYS));

  goalCatalog.goals.forEach((goal) => {
    assert.equal(goal.goalKey, goal.key);
    assert.equal(goal.label, GOAL_LABEL_BY_KEY[goal.key]);
    assert.equal(goal.onboardingLabel, goal.label);
    assert.ok(GOAL_OPTION_SET.has(goal.label));
    assert.equal(goal.active, true);
    assert.equal(goal.defaultVisible, true);
    goal.allowedTypes.forEach((type) => {
      assert.ok(TYPE_KEY_SET.has(type));
    });
  });
});

test('goal ingredient map grouped and compatibility projections stay in sync', () => {
  assert.equal(goalIngredientMap.version, 'v1');
  assert.deepEqual(new Set(goalIngredientMap.mappings.map((mapping) => mapping.goalKey)), new Set(GOAL_KEYS));

  const flatRows = goalIngredientMap.goalIngredientMap;
  const flatLookup = new Map(flatRows.map((row) => [`${row.goalKey}:${row.ingredientKey}`, row]));

  goalIngredientMap.mappings.forEach((mapping) => {
    assert.ok(mapping.ingredientMatches.length > 0);

    mapping.ingredientMatches.forEach((match) => {
      const flat = flatLookup.get(`${mapping.goalKey}:${match.ingredientKey}`);
      assert.ok(flat, `missing compatibility row for ${mapping.goalKey}:${match.ingredientKey}`);
      assert.equal(flat?.tier, GROUPED_TO_LEGACY_TIER[match.tier as keyof typeof GROUPED_TO_LEGACY_TIER]);
      assert.equal(flat?.evidenceGrade, match.evidenceGrade);
      assert.equal(flat?.minEffectiveDose, match.minEffectiveDose);
      assert.equal(flat?.unit, match.unit);
      assert.deepEqual(flat?.preferredForms, match.preferredForms);
      assert.deepEqual(flat?.caps, match.caps);
      assert.equal(flat?.rationale, match.rationale);
    });
  });

  assert.ok(
    flatRows.some(
      (row) =>
        row.goalKey === 'weight_management' &&
        row.ingredientKey === 'green_tea_extract' &&
        row.caps.includes('eligibility_requires_generic_safety_path'),
    ),
  );
});

test('goal ingredient map v2 can project a legacy-compatible view for overlapping rows', () => {
  assert.equal(goalIngredientMapV2.version, 'v2');
  assert.ok(goalIngredientMapV2.edges.length >= goalIngredientMap.goalIngredientMap.length);

  const projected = projectLegacyGoalIngredientMap();
  const projectedLookup = new Map(
    projected.goalIngredientMap.map((row) => [`${row.goalKey}:${row.ingredientKey}`, row] as const),
  );

  goalIngredientMap.goalIngredientMap.forEach((row) => {
    const projectedRow = projectedLookup.get(`${row.goalKey}:${row.ingredientKey}`);
    assert.ok(projectedRow, `missing projected legacy row for ${row.goalKey}:${row.ingredientKey}`);
    assert.equal(projectedRow?.tier, row.tier);
    assert.equal(projectedRow?.evidenceGrade, row.evidenceGrade);
    assert.equal(projectedRow?.minEffectiveDose, row.minEffectiveDose);
    assert.equal(projectedRow?.unit, row.unit);
    assert.deepEqual(projectedRow?.preferredForms, row.preferredForms);
    assert.deepEqual(projectedRow?.caps, row.caps);
  });
});

test('blocker strategies and experience modes cover the current onboarding options exactly', () => {
  assert.deepEqual(
    blockerBehaviorRules.blockerStrategies.map((entry) => entry.key),
    BLOCKER_KEYS,
  );

  blockerBehaviorRules.blockerStrategies.forEach((entry) => {
    assert.equal(entry.onboardingLabel, BLOCKER_LABEL_BY_KEY[entry.key]);
    assert.ok(BLOCKER_OPTION_SET.has(entry.onboardingLabel));
  });

  assert.deepEqual(
    safetyRules.experienceModes.map((entry) => entry.key),
    EXPERIENCE_LEVELS,
  );

  safetyRules.experienceModes.forEach((entry, index) => {
    assert.equal(entry.reasonCode, `experience.${entry.key}`);
    assert.ok(SUPPLEMENT_EXPERIENCE_OPTIONS[index]);
  });
});

test('diet lanes, activity plans, templates, and feature flags preserve conservative phase 0 invariants', () => {
  const laneKeys = new Set(dietReviewLanes.laneCatalog.map((lane) => lane.laneKey));
  assert.ok(laneKeys.has('diet_general_review'));

  dietReviewLanes.dietMappings.forEach((mapping) => {
    mapping.laneKeys.forEach((laneKey) => {
      assert.ok(laneKeys.has(laneKey), `missing lane ${laneKey} for diet ${mapping.dietKey}`);
    });
  });

  const planKeys = new Set(activityGoalMap.activityMappings.map((mapping) => mapping.planKey));
  [
    'activity_strength_support',
    'activity_endurance_support',
    'activity_mobility_support',
    'activity_performance_support',
    'activity_general_support',
  ].forEach((planKey) => {
    assert.ok(planKeys.has(planKey), `missing activity plan ${planKey}`);
  });

  activityGoalMap.activityMappings.forEach((mapping) => {
    mapping.suggestedGoals.forEach((goalKey) => assert.ok(GOAL_KEY_SET.has(goalKey)));
    mapping.suggestedTypes.forEach((typeKey) => assert.ok(TYPE_KEY_SET.has(typeKey)));
  });

  explanationTemplates.templates.forEach((entry) => {
    const placeholderSet = new Set(entry.placeholders);
    const templatePlaceholders = Array.from(entry.template.matchAll(/\{([a-zA-Z0-9_]+)\}/g)).map(
      (match) => match[1],
    );
    assert.deepEqual(new Set(templatePlaceholders), placeholderSet);
  });

  assert.deepEqual(featureFlags.flags, {
    enablePersonalizationV1: false,
    enableGoalMatchScoring: false,
    enableEligibilityPolicy: false,
    enablePlanPreviewPersonalization: false,
    enableSmartFilterPersonalization: false,
  });
});

test('safety compatibility rules cover the current runtime reader conditions', () => {
  assert.deepEqual(safetyRules.version, 'v1');
  assert.deepEqual(
    new Set(safetyRules.rules.map((rule) => rule.condition)),
    new Set([
      'duplicate_risk_level_high',
      'violates_declared_diet_constraint',
      'ingredient_requires_generic_safety_path',
      'disclosure_quality_low',
      'proprietary_blend_without_clear_actives',
    ]),
  );

  const capKeys = new Set(safetyRules.capsCatalog.map((cap) => cap.capKey));
  safetyRules.eligibilityRules.forEach((rule) => {
    rule.outcome.caps.forEach((cap) => {
      assert.ok(capKeys.has(cap), `missing cap catalog entry for ${cap}`);
    });
  });
  safetyRules.rules.forEach((rule) => {
    (rule.effect.caps ?? []).forEach((cap) => {
      assert.ok(capKeys.has(cap), `missing compatibility cap catalog entry for ${cap}`);
    });
  });

  assert.ok(AGE_RANGE_OPTIONS.includes('13-17'));
});
