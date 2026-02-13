import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWhatsInsideDisplay } from './supplementFactsDisplay';

test('buildWhatsInsideDisplay: combines EPA + DHA into one omega-3 line', () => {
  const out = buildWhatsInsideDisplay({
    productName: 'Fish Oil',
    dosageText: null,
    actives: [
      { name: 'Eicosapentaenoic Acid (EPA)', amount: 180, unit: 'mg' },
      { name: 'Docosahexaenoic Acid (DHA)', amount: 120, unit: 'mg' },
      { name: 'Vitamin D3', amount: 25, unit: 'mcg' },
    ],
  });

  assert.equal(out.source, 'actives');
  assert.equal(out.lines[0], 'Omega-3 (EPA 180 mg + DHA 120 mg)');
});

test('buildWhatsInsideDisplay: keeps mixed EPA/DHA units in combined omega-3 line', () => {
  const out = buildWhatsInsideDisplay({
    productName: 'Fish Oil',
    dosageText: null,
    actives: [
      { name: 'Eicosapentaenoic Acid (EPA)', amount: 500, unit: 'mg' },
      { name: 'Docosahexaenoic Acid (DHA)', amount: 1, unit: 'g' },
    ],
  });

  assert.equal(out.source, 'actives');
  assert.equal(out.lines[0], 'Omega-3 (EPA 500 mg + DHA 1 g)');
});

test('buildWhatsInsideDisplay: dedupes canonical aliases (Vitamin D3 / Cholecalciferol)', () => {
  const out = buildWhatsInsideDisplay({
    productName: 'Vitamin D',
    dosageText: null,
    actives: [
      { name: 'Vitamin D3', amount: 25, unit: 'mcg' },
      { name: 'Cholecalciferol', amount: null, unit: null },
    ],
  });

  assert.equal(out.source, 'actives');
  const vitaminDLines = out.lines.filter((line) => line.toLowerCase().includes('vitamin d'));
  assert.equal(vitaminDLines.length, 1);
});

test('buildWhatsInsideDisplay: inferred requires whitelist + strength unit and rejects mL/oz', () => {
  const inferred = buildWhatsInsideDisplay({
    productName: 'Astaxanthin',
    dosageText: '12 mg',
    actives: [],
  });
  assert.equal(inferred.source, 'inferred');
  assert.equal(inferred.badgeLabel, 'Inferred');

  const mlDose = buildWhatsInsideDisplay({
    productName: 'Astaxanthin Liquid',
    dosageText: '5 mL',
    actives: [],
  });
  assert.equal(mlDose.source, 'dose');

  const ozDose = buildWhatsInsideDisplay({
    productName: 'Astaxanthin Liquid',
    dosageText: '1 oz',
    actives: [],
  });
  assert.equal(ozDose.source, 'dose');
});

test('buildWhatsInsideDisplay: infers Ester-C and NAC aliases with token boundaries', () => {
  const esterC = buildWhatsInsideDisplay({
    productName: 'Ester-C 1000',
    dosageText: '1000 mg',
    actives: [],
  });
  assert.equal(esterC.source, 'inferred');
  assert.equal(esterC.lines[0], 'Vitamin C - 1000 mg');

  const esterCUnicode = buildWhatsInsideDisplay({
    productName: 'Ester‑C 1000™',
    dosageText: '1000 mg',
    actives: [],
  });
  assert.equal(esterCUnicode.source, 'inferred');
  assert.equal(esterCUnicode.lines[0], 'Vitamin C - 1000 mg');

  const nac = buildWhatsInsideDisplay({
    productName: 'NAC 600',
    dosageText: '600 mg',
    actives: [],
  });
  assert.equal(nac.source, 'inferred');
  assert.equal(nac.lines[0], 'N-acetylcysteine (NAC) - 600 mg');

  const nacthNoise = buildWhatsInsideDisplay({
    productName: 'NACHT Sleep Blend',
    dosageText: '600 mg',
    actives: [],
  });
  assert.equal(nacthNoise.source, 'dose');
});

test('buildWhatsInsideDisplay: blocklist names do not infer actives', () => {
  const out = buildWhatsInsideDisplay({
    productName: 'Daily Multi Formula',
    dosageText: '25 mg',
    actives: [],
  });

  assert.equal(out.source, 'dose');
  assert.equal(out.badgeLabel, null);
});

test('buildWhatsInsideDisplay: clamps to top 2 lines with hiddenCount', () => {
  const out = buildWhatsInsideDisplay({
    productName: 'Mineral Complex',
    dosageText: null,
    actives: [
      { name: 'Magnesium', amount: 200, unit: 'mg' },
      { name: 'Zinc', amount: 15, unit: 'mg' },
      { name: 'Iron', amount: 8, unit: 'mg' },
    ],
  });

  assert.equal(out.lines.length, 2);
  assert.equal(out.hiddenCount, 1);
});
