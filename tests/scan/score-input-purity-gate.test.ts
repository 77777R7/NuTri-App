import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isNutritionLabelLikeIngredient } from '../../lib/scan/isNutritionLabelLikeIngredient';
import {
  isNutritionLabelLikeIngredientName,
  isNutritionLabelLikeNameKey,
} from '../../shared/scan/nutritionLabelLikeLexicon';

const SCORE_ENGINE_FILE = path.join(process.cwd(), 'backend/src/scoring/v4ScoreEngine.ts');
const RICHNESS_GATE_FILE = path.join(process.cwd(), 'scripts/maintainer/lib/regulatory-richness-gate.mjs');

test('shared nutrition lexicon catches nutrition-label rows with dose suffixes', () => {
  assert.equal(isNutritionLabelLikeNameKey('calories 15 cal'), true);
  assert.equal(isNutritionLabelLikeNameKey('total fat 1 5 g'), true);
  assert.equal(isNutritionLabelLikeIngredientName('Calories 15 cal'), true);
  assert.equal(isNutritionLabelLikeIngredientName('Total Fat 1.5 g'), true);
  assert.equal(isNutritionLabelLikeIngredientName('Vitamin C 1000 mg'), false);
});

test('frontend helper uses shared nutrition lexicon', () => {
  assert.equal(isNutritionLabelLikeIngredient('Calories 15 cal'), true);
  assert.equal(isNutritionLabelLikeIngredient('Total Fat 1.5 g'), true);
  assert.equal(isNutritionLabelLikeIngredient('Melatonin 3 mg'), false);
});

test('score engine emits purity diagnostics and blocks nutrition-like leakage', () => {
  const source = fs.readFileSync(SCORE_ENGINE_FILE, 'utf8');

  assert.ok(source.includes('nutritionLabelLikeFilteredCount'));
  assert.ok(source.includes('nutritionLabelLikeFilteredSamples'));
  assert.ok(source.includes('nutritionLabelLikeLeakCount'));
  assert.ok(source.includes('isNutritionLabelLikeNameKey'));
  assert.ok(source.includes('diagnostics: {'));
});

test('regulatory richness gate reads score purity diagnostics', () => {
  const source = fs.readFileSync(RICHNESS_GATE_FILE, 'utf8');

  assert.ok(source.includes('extractScorePurityDiagnostics'));
  assert.ok(source.includes('nutritionLabelLikeFilteredCount'));
  assert.ok(source.includes('nutritionLabelLikeFilteredSamples'));
  assert.ok(source.includes('nutritionLabelLikeLeakCount'));
});
