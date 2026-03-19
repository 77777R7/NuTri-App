import assert from 'node:assert/strict';
import test from 'node:test';

import { formatBrandForPill, formatDoseForPill } from './supplementDisplay';

test('formatDoseForPill: supports IU + UI alias', () => {
  assert.equal(formatDoseForPill('1000 IU'), '1000 IU');
  assert.equal(formatDoseForPill('2000 ui'), '2000 IU');
});

test('formatDoseForPill: CFU compaction', () => {
  assert.equal(formatDoseForPill('10 billion CFU'), '10B CFU');
  assert.equal(formatDoseForPill('3\u00d710^9 cfu'), '3B CFU');
  assert.equal(formatDoseForPill('10B ufc'), '10B CFU');
});

test('formatDoseForPill: count units beat instructions', () => {
  assert.equal(formatDoseForPill('Adults: 1 tablet, 2 times daily'), '1 tablet');
});

test('formatDoseForPill: instruction-only strings are rejected', () => {
  assert.equal(formatDoseForPill('Take with food'), null);
});

test('formatDoseForPill: basic mass units', () => {
  assert.equal(formatDoseForPill('25 g'), '25 g');
  assert.equal(formatDoseForPill('1,250 mg'), '1250 mg');
  assert.equal(formatDoseForPill('1,040 mg'), '1040 mg');
});

test('formatBrandForPill: extracts consumer brand from corporate chains', () => {
  assert.equal(
    formatBrandForPill('Nestle Canada Inc dba Atrium Innovations Genestra Brands'),
    'Genestra',
  );
  assert.equal(formatBrandForPill('Atrium Innovations Genestra Brands'), 'Genestra');
  assert.equal(formatBrandForPill('Genestra Brands'), 'Genestra');
});

test('formatBrandForPill: dba group lists prefer parent company (avoid mislabel)', () => {
  assert.equal(
    formatBrandForPill(
      "Nestle Canada Inc dba Atrium Innovations Genestra Brands Pure Encapsulations Garden of Life Canada Trophic Canada SISU Wobenzym Bountiful Canada Vitamins Nature's Bounty Vital Proteins Canada",
    ),
    'Nestle Canada',
  );
});

test('formatBrandForPill: keeps normal brands stable', () => {
  assert.equal(formatBrandForPill('The Vitamin Shoppe Brands'), 'The Vitamin Shoppe');
  assert.equal(formatBrandForPill('Sports Research'), 'Sports Research');
  assert.equal(formatBrandForPill('NOW Foods, Inc.'), 'NOW Foods');
});
