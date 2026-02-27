import assert from 'node:assert/strict';
import test from 'node:test';

import { isNutritionLabelLikeIngredient } from '../../lib/scan/isNutritionLabelLikeIngredient';

test('flags nutrition-label rows even when name includes amount suffix', () => {
  assert.equal(isNutritionLabelLikeIngredient('Calories'), true);
  assert.equal(isNutritionLabelLikeIngredient('Calories 15 cal'), true);
  assert.equal(isNutritionLabelLikeIngredient('Total Fat'), true);
  assert.equal(isNutritionLabelLikeIngredient('Total Fat 1.5 g'), true);
  assert.equal(isNutritionLabelLikeIngredient('Dietary Fiber 4 g'), true);
});

test('does not flag actual active ingredients', () => {
  assert.equal(isNutritionLabelLikeIngredient('Vitamin C'), false);
  assert.equal(isNutritionLabelLikeIngredient('Melatonin 3 mg'), false);
  assert.equal(isNutritionLabelLikeIngredient('Wild Alaska Pollock Fish Oil Concentrate'), false);
});
