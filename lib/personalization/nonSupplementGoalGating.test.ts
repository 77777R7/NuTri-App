import assert from 'node:assert/strict';
import test from 'node:test';

import { assessNonSupplementGoalGate } from '@/lib/personalization/core/nonSupplementGoalGating';

test('non-supplement goal gate blocks high-confidence pantry surfaces by source zip', () => {
  const decision = assessNonSupplementGoalGate({
    title: 'Buddha Teas, Peppermint Tea, 18 Tea Bags',
    brandName: 'Buddha Teas',
    sourceZipPath: 'buddha-teas.json',
  });

  assert.equal(decision.shouldGate, true);
  assert.equal(decision.reasonCode, 'out_of_scope_non_supplement');
  assert.ok(decision.matchedRules.some((rule) => rule.type === 'source_zip'));
});

test('non-supplement goal gate blocks SweetLeaf sweetener source zips', () => {
  const decision = assessNonSupplementGoalGate({
    title: 'SweetLeaf Stevia, Monk Fruit Organic Sweetener, Granular, 80 Packets',
    brandName: 'SweetLeaf Stevia',
    sourceZipPath: 'sweetleaf-stevia.json',
  });

  assert.equal(decision.shouldGate, true);
  assert.ok(decision.matchedRules.some((rule) => rule.type === 'source_zip'));
});

test('non-supplement goal gate blocks True Citrus drink-enhancer source zips', () => {
  const decision = assessNonSupplementGoalGate({
    title: 'True Citrus, True Lemon, Crystallized Lemon, 2.12 oz (60 g)',
    brandName: 'True Citrus',
    sourceZipPath: 'true-citrus.json',
  });

  assert.equal(decision.shouldGate, true);
  assert.ok(decision.matchedRules.some((rule) => rule.type === 'source_zip'));
});

test('non-supplement goal gate keeps excluded source zips blocked even when weak drop phrasing appears', () => {
  const decision = assessNonSupplementGoalGate({
    title: 'SweetLeaf Stevia, Water Drops, Strawberry Kiwi, 1.62 fl oz',
    brandName: 'SweetLeaf Stevia',
    sourceZipPath: 'sweetleaf-stevia.json',
  });

  assert.equal(decision.shouldGate, true);
});

test('non-supplement goal gate blocks Walden Farms pantry condiment source zips', () => {
  const decision = assessNonSupplementGoalGate({
    title: 'Walden Farms, Honey Barbecue Sauce, 12 fl oz',
    brandName: 'Walden Farms',
    sourceZipPath: 'walden-farms.json',
  });

  assert.equal(decision.shouldGate, true);
  assert.ok(decision.matchedRules.some((rule) => rule.type === 'source_zip'));
});

test('non-supplement goal gate blocks pantry title phrases when no supplement override exists', () => {
  const decision = assessNonSupplementGoalGate({
    title: 'Comvita, Manuka Honey, UMF 15+, 17.6 oz',
    brandName: 'Comvita',
    sourceZipPath: 'comvita.json',
  });

  assert.equal(decision.shouldGate, true);
  assert.ok(decision.matchedRules.some((rule) => rule.type === 'title_phrase' && rule.value === 'manuka honey'));
});

test('non-supplement goal gate blocks high-confidence pantry title phrases for mixed sources', () => {
  const decision = assessNonSupplementGoalGate({
    title: 'Pure Indian Foods, Mango Raisin Chutney, 8.5 oz',
    brandName: 'Pure Indian Foods',
    sourceZipPath: 'pure-indian-foods.json',
  });

  assert.equal(decision.shouldGate, true);
  assert.ok(decision.matchedRules.some((rule) => rule.type === 'title_phrase' && rule.value === 'chutney'));
});

test('non-supplement goal gate blocks Pure Indian Foods pantry-like mixed-source titles by source-specific phrase', () => {
  const decision = assessNonSupplementGoalGate({
    title: 'Pure Indian Foods, Organic Virgin PrimalFat Coconut Ghee, 15 oz (425 g)',
    brandName: 'Pure Indian Foods',
    sourceZipPath: 'pure-indian-foods.json',
  });

  assert.equal(decision.shouldGate, true);
  assert.ok(decision.matchedRules.some((rule) => rule.type === 'title_phrase' && rule.value === 'ghee'));
});

test('non-supplement goal gate does not block Pure Indian Foods supplement powders', () => {
  const decision = assessNonSupplementGoalGate({
    title: 'Pure Indian Foods, Organic Ashwagandha Root Powder, 8 oz (227 g)',
    brandName: 'Pure Indian Foods',
    sourceZipPath: 'pure-indian-foods.json',
  });

  assert.equal(decision.shouldGate, false);
});

test('non-supplement goal gate blocks Nutricost Pantry products by source-specific phrase', () => {
  const decision = assessNonSupplementGoalGate({
    title: 'Nutricost, Pantry, Allulose, 1 lb (454 g)',
    brandName: 'Nutricost',
    sourceZipPath: 'nutricost.json',
  });

  assert.equal(decision.shouldGate, true);
  assert.ok(decision.matchedRules.some((rule) => rule.type === 'title_phrase' && rule.value === 'pantry'));
});

test('non-supplement goal gate does not block supplement capsules even when tea phrases appear', () => {
  const decision = assessNonSupplementGoalGate({
    title: 'NOW Foods, Green Tea Extract, 60 Veg Capsules',
    brandName: 'NOW Foods',
    sourceZipPath: 'now-foods.json',
  });

  assert.equal(decision.shouldGate, false);
});

test('non-supplement goal gate does not block protein powders by title override', () => {
  const decision = assessNonSupplementGoalGate({
    title: 'Ghost, Whey Protein, Peanut Butter Cereal Milk, 2 lb',
    brandName: 'Ghost',
    sourceZipPath: 'ghost.json',
  });

  assert.equal(decision.shouldGate, false);
  assert.equal(decision.reasonCode, null);
});

test('non-supplement goal gate does not block hyphenated soft-gel supplement titles', () => {
  const decision = assessNonSupplementGoalGate({
    title: 'Applied Nutrition, Green Tea Fat Burner, 30 Liquid Soft-Gels',
    brandName: 'Applied Nutrition',
    sourceZipPath: 'applied-nutrition.json',
  });

  assert.equal(decision.shouldGate, false);
});

test('non-supplement goal gate does not block superfood supplement titles', () => {
  const decision = assessNonSupplementGoalGate({
    title: 'ALLMAX, CytoGreens, Premium Green Superfood For Athletes, 1.2 lbs',
    brandName: 'ALLMAX',
    sourceZipPath: 'allmax.json',
  });

  assert.equal(decision.shouldGate, false);
});
