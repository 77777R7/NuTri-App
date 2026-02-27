import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRecordFactsViewModel } from '@/lib/scan/recordFactsViewModel';

test('record facts vm prefers bundle ingredient rows over facts rows', () => {
  const vm = buildRecordFactsViewModel({
    bundle: {
      meta: {
        sourceType: 'dsld',
        sourceTypeFinal: true,
        authoritativeIdentity: { type: 'dsldLabelId', value: 'label-1' },
      },
      sections: {
        ingredients: {
          cover: {
            items: [{ name: 'Vitamin C', dose: '1000 mg' }],
          },
        },
        usage: { detail: { scheduleFromLabel: [] } },
        safety: { detail: { warnings: [] } },
      },
    } as any,
    facts: {
      ingredients: {
        actives: [{ name: 'Biotin', amount: 10, unit: 'mg' }],
      },
      usage: { directionsText: null },
      safety: { labelWarnings: [] },
    } as any,
  });

  assert.equal(vm.ingredientCount, 1);
  assert.equal(vm.ingredientRows[0]?.name, 'Vitamin C');
  assert.equal(vm.ingredientRows[0]?.doseLine, '1000 mg');
  assert.equal(vm.regulatoryIds.dsldLabelId, 'label-1');
});

test('record facts vm falls back to facts ingredient rows when bundle cover is empty', () => {
  const vm = buildRecordFactsViewModel({
    bundle: {
      meta: {
        sourceType: 'lnhpd',
        authoritativeIdentity: { type: 'npn', value: '80000001' },
      },
      sections: {
        ingredients: { cover: { items: [] } },
        usage: { detail: { scheduleFromLabel: [] } },
        safety: { detail: { warnings: [] } },
      },
    } as any,
    facts: {
      meta: { source: 'lnhpd' },
      serving: { servingSizeText: '1 capsule' },
      ingredients: {
        actives: [{ name: 'Vitamin C', amount: 1000, unit: 'mg' }, { name: '', amount: 5, unit: 'mg' }],
      },
      usage: { directionsText: 'Take one capsule daily.' },
      safety: { labelWarnings: ['Do not exceed suggested use.'] },
      dataQuality: { missingReasons: ['missing_units'] },
    } as any,
  });

  assert.equal(vm.ingredientCount, 1);
  assert.equal(vm.ingredientRows[0]?.name, 'Vitamin C');
  assert.equal(vm.perServingDoseLine, 'Vitamin C 1000 mg');
  assert.equal(vm.servingSizeText, '1 capsule');
  assert.equal(vm.directionsPresent, true);
  assert.equal(vm.warningsPresent, true);
  assert.equal(vm.regulatoryIds.npn, '80000001');
  assert.equal(vm.dataQualityFlags.includes('missing_units'), true);
});

test('record facts vm adds strict missing flags when fields are absent', () => {
  const vm = buildRecordFactsViewModel({
    bundle: {
      meta: {
        sourceType: 'web',
        authoritativeIdentity: { type: 'gtin14', value: '00000000000000' },
      },
      sections: {
        ingredients: { cover: { items: [] } },
        usage: { detail: { scheduleFromLabel: [] } },
        safety: { detail: { warnings: [] } },
      },
    } as any,
    facts: null,
  });

  assert.equal(vm.ingredientCount, 0);
  assert.equal(vm.dataQualityFlags.includes('missing_directions'), true);
  assert.equal(vm.dataQualityFlags.includes('missing_warnings'), true);
  assert.equal(vm.dataQualityFlags.includes('missing_amounts'), true);
});
