import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeScienceIngredientCandidates,
  parseIngredientNameWithForm,
} from '@/lib/scan/scienceIngredientSnapshot';

test('parseIngredientNameWithForm extracts base/form for supplemental facts labels', () => {
  const parsed = parseIngredientNameWithForm('Vitamin C (as Ascorbic Acid).');
  assert.equal(parsed.baseName, 'Vitamin C');
  assert.equal(parsed.form, 'As Ascorbic Acid');
  assert.equal(parsed.formValue, 'Ascorbic Acid');
  assert.equal(parsed.displayName, 'Vitamin C (As Ascorbic Acid)');
  assert.deepEqual(parsed.aliasNames, []);
});

test('parseIngredientNameWithForm captures trailing trademark alias labels', () => {
  const parsed = parseIngredientNameWithForm(
    'Astaxanthin (from Haematococcus pluvialis microalgae extract) (Icelandic Astalif™ ).',
  );
  assert.equal(parsed.baseName, 'Astaxanthin');
  assert.equal(parsed.form, 'From Haematococcus pluvialis microalgae extract');
  assert.equal(parsed.formValue, 'Haematococcus pluvialis microalgae extract');
  assert.equal(parsed.displayName, 'Astaxanthin (From Haematococcus pluvialis microalgae extract)');
  assert.deepEqual(parsed.aliasNames, ['Icelandic Astalif']);
});

test('mergeScienceIngredientCandidates dedupes vitamin c rows and keeps best name/dose', () => {
  const merged = mergeScienceIngredientCandidates({
    candidates: [
      { name: 'Vitamin C', dose: '1000 mg', source: 'decision_overview' },
      { name: 'Vitamin C', dose: '1000 mg', source: 'ingredients_items' },
      { name: 'Vitamin C (as Ascorbic Acid).', dose: '', source: 'science_snapshot' },
      { name: 'Vitamin C.', dose: null, source: 'record_facts' },
    ],
  });

  assert.equal(merged.all.length, 1);
  assert.equal(merged.top3.length, 1);
  assert.equal(merged.overflowCount, 0);
  assert.equal(merged.all[0]?.name, 'Vitamin C (As Ascorbic Acid)');
  assert.equal(merged.all[0]?.dose, '1000 mg');
  assert.equal(merged.all[0]?.formValue, 'Ascorbic Acid');
});

test('mergeScienceIngredientCandidates limits cover to top3 and reports overflow', () => {
  const merged = mergeScienceIngredientCandidates({
    candidates: [
      { name: 'Vitamin C', dose: '1000 mg', source: 'decision_overview' },
      { name: 'Zinc', dose: '15 mg', source: 'decision_overview' },
      { name: 'Vitamin D3', dose: '50 mcg', source: 'decision_overview' },
      { name: 'Selenium', dose: '200 mcg', source: 'ingredients_items' },
      { name: 'Copper', dose: '2 mg', source: 'record_facts' },
    ],
  });

  assert.equal(merged.all.length, 5);
  assert.equal(merged.top3.length, 3);
  assert.equal(merged.overflowCount, 2);
  assert.equal(new Set(merged.all.map((row) => row.key)).size, merged.all.length);
});

test('mergeScienceIngredientCandidates merges trademark alias rows into one astaxanthin entry', () => {
  const merged = mergeScienceIngredientCandidates({
    candidates: [
      { name: 'Icelandic Astalif', dose: '12 mg', source: 'decision_overview' },
      {
        name: 'Astaxanthin (from Haematococcus pluvialis microalgae extract) (Icelandic Astalif™ ).',
        dose: '',
        source: 'science_snapshot',
      },
      {
        name: 'Astaxanthin',
        dose: '12 mg',
        source: 'ingredients_items',
      },
    ],
  });

  assert.equal(merged.all.length, 1);
  assert.equal(merged.top3.length, 1);
  assert.equal(merged.all[0]?.dose, '12 mg');
  assert.match(merged.all[0]?.name ?? '', /^Astaxanthin/i);
  assert.equal(merged.all[0]?.formValue, 'Haematococcus pluvialis microalgae extract');
});

test('mergeScienceIngredientCandidates prefers iHerb science snapshot name over official alias name', () => {
  const merged = mergeScienceIngredientCandidates({
    candidates: [
      { name: 'Astaxanthin (Icelandic Astalif™ )', dose: '', source: 'science_snapshot' },
      { name: 'Icelandic Astalif', dose: '12 mg', source: 'decision_overview' },
    ],
  });

  assert.equal(merged.all.length, 1);
  assert.equal(merged.all[0]?.name, 'Astaxanthin');
  assert.equal(merged.all[0]?.dose, '12 mg');
});

test('mergeScienceIngredientCandidates falls back to official name when iHerb snapshot is unavailable', () => {
  const merged = mergeScienceIngredientCandidates({
    candidates: [
      { name: 'Icelandic Astalif', dose: '12 mg', source: 'decision_overview' },
    ],
  });

  assert.equal(merged.all.length, 1);
  assert.equal(merged.all[0]?.name, 'Icelandic Astalif');
  assert.equal(merged.all[0]?.dose, '12 mg');
});
