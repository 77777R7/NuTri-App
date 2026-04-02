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

const typesSource = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/app/onboarding/types.tsx',
  'utf8',
);

const allergySource = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/app/onboarding/allergy.tsx',
  'utf8',
);

const blockerSource = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/app/onboarding/blocker.tsx',
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

test('onboarding flow inserts allergy between types and blocker', () => {
  assert.match(layoutSource, /<Stack\.Screen name="types" \/>/);
  assert.match(layoutSource, /<Stack\.Screen name="allergy" \/>/);
  assert.match(layoutSource, /<Stack\.Screen name="blocker" \/>/);
  assert.match(typesSource, /router\.replace\('\/onboarding\/allergy'\)/);
  assert.match(blockerSource, /router\.replace\('\/onboarding\/allergy'\)/);
});

test('allergy QA hero screen preserves route flow', () => {
  assert.match(allergySource, /router\.replace\('\/onboarding\/types'\)/);
  assert.match(allergySource, /router\.replace\('\/onboarding\/blocker'\)/);
});

test('allergy QA hero screen preserves saveDraft step and analytics contract', () => {
  assert.match(allergySource, /saveDraft\(\{ avoidItems: selected \}, 8\)/);
  assert.match(allergySource, /trackOnboardingEvent\('question_answered'/);
  assert.match(allergySource, /question:\s*'avoid_items'/);
  assert.match(allergySource, /answerCount:\s*selected\.length/);
  assert.match(allergySource, /answers:\s*selected/);
});

test('allergy QA hero screen still uses canonical grouped option sources', () => {
  assert.match(allergySource, /PRIMARY_ALLERGY_UI_OPTIONS\.map/);
  assert.match(allergySource, /SECONDARY_ALLERGY_UI_OPTIONS\.map/);
  assert.match(allergySource, /RESTRICTION_UI_OPTIONS\.map/);
  assert.match(allergySource, /No known allergies/);
});

test('allergy QA hero screen preserves the no-known-allergies exclusivity branch', () => {
  assert.match(allergySource, /if \(item === NO_KNOWN_ALLERGIES_LABEL\)/);
  assert.match(
    allergySource,
    /const withoutNoKnown = current\.filter\([\s\S]*?NO_KNOWN_ALLERGIES_LABEL[\s\S]*?\);/,
  );
});
