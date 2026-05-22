import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  ALLERGY_FLAG_OPTIONS,
  INGREDIENT_RESTRICTION_OPTIONS,
  PRIMARY_ALLERGY_UI_OPTIONS,
  RESTRICTION_UI_OPTIONS,
  SECONDARY_ALLERGY_UI_OPTIONS,
} from '@/lib/onboarding-v2';

const layoutSource = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/app/onboarding/_layout.tsx',
  'utf8',
);

const allergySource = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/app/onboarding/allergy.tsx',
  'utf8',
);

const goalsSource = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/app/onboarding/goals.tsx',
  'utf8',
);

test('allergy step exposes the intended supplement-first primary options', () => {
  assert.deepEqual(
    PRIMARY_ALLERGY_UI_OPTIONS.map((option) => option.label),
    ['Fish', 'Shellfish', 'Dairy', 'Soy', 'Tree nuts', 'Peanuts'],
  );
  assert.deepEqual(
    RESTRICTION_UI_OPTIONS.map((option) => option.label),
    ['Gluten', 'Gelatin / animal-based'],
  );
  assert.deepEqual(
    SECONDARY_ALLERGY_UI_OPTIONS.map((option) => option.label),
    ['Egg', 'Sesame', 'Wheat'],
  );
});

test('allergy enums remain canonical and deduplicated', () => {
  const combined = [...ALLERGY_FLAG_OPTIONS, ...INGREDIENT_RESTRICTION_OPTIONS];
  assert.equal(new Set(combined).size, combined.length);
  assert.ok(ALLERGY_FLAG_OPTIONS.includes('fish'));
  assert.ok(INGREDIENT_RESTRICTION_OPTIONS.includes('gelatin_animal_based'));
});

test('compact onboarding flow ends active QA at allergy', () => {
  assert.match(layoutSource, /<Stack\.Screen name="goals" \/>/);
  assert.match(layoutSource, /<Stack\.Screen name="allergy" \/>/);
  assert.match(layoutSource, /<Stack\.Screen name="plan-preview" \/>/);
  assert.match(goalsSource, /pathname:\s*'\/onboarding\/allergy'/);
  assert.doesNotMatch(layoutSource, /<Stack\.Screen name="types" \/>/);
  assert.doesNotMatch(layoutSource, /<Stack\.Screen name="blocker" \/>/);
});

test('allergy QA hero screen preserves route flow', () => {
  assert.match(allergySource, /pathname:\s*'\/onboarding\/goals'/);
  assert.match(allergySource, /router\.replace\('\/onboarding\/done'\)/);
  assert.doesNotMatch(allergySource, /router\.replace\('\/onboarding\/plan-preview'\)/);
});

test('allergy post-scan mode returns to the same scan result with applied guide copy', () => {
  assert.match(allergySource, /isPostScanMode\(params\.mode\)/);
  assert.match(allergySource, /sanitizePostScanReturnTo\(params\.returnTo\)/);
  assert.match(allergySource, /appendPersonalizedGuideApplied\(safeReturnTo\)/);
  assert.match(allergySource, /continueLabel=\{isPostScan \? 'Show my result' : isProfileEdit \? 'Save answers' : 'Continue'\}/);
  assert.match(allergySource, /skipLabel=\{isPostScan \? 'Skip and show my result' : isProfileEdit \? 'Keep current answers' : undefined\}/);
  assert.match(allergySource, /backgroundColor: 'rgba\(17,17,17,0\.72\)'/);
});

test('allergy QA hero screen preserves saveDraft step and analytics contract', () => {
  assert.match(allergySource, /normalizeAvoidItemsSelection\(selected\)/);
  assert.match(allergySource, /avoidItems:\s*normalized\.avoidItems/);
  assert.match(allergySource, /allergyFlags:\s*normalized\.allergyFlags/);
  assert.match(allergySource, /ingredientRestrictions:\s*normalized\.ingredientRestrictions/);
  assert.match(allergySource, /,\s*6,\s*\)/);
  assert.match(allergySource, /trackOnboardingEvent\('question_answered'/);
  assert.match(allergySource, /question:\s*'avoid_items'/);
  assert.match(allergySource, /answerCount:\s*selected\.length/);
  assert.match(allergySource, /answers:\s*selected/);
});

test('allergy QA hero screen still uses canonical grouped option sources', () => {
  assert.match(allergySource, /PRIMARY_ALLERGY_UI_OPTIONS\.map/);
  assert.match(allergySource, /SECONDARY_ALLERGY_UI_OPTIONS\.map/);
  assert.match(allergySource, /RESTRICTION_UI_OPTIONS\.map/);
  assert.match(allergySource, /NO_KNOWN_ALLERGIES_LABEL/);
});

test('allergy QA hero screen preserves the no-known-allergies exclusivity branch', () => {
  assert.match(allergySource, /if \(item === NO_KNOWN_ALLERGIES_LABEL\)/);
  assert.match(
    allergySource,
    /const withoutNoKnown = current\.filter\([\s\S]*?NO_KNOWN_ALLERGIES_LABEL[\s\S]*?\);/,
  );
});
