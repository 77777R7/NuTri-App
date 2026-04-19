import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolvePreferredAnalysisProductIdentity,
  type AnalysisProductIdentity,
} from '../../backend/src/analysisProductIdentity';

test('prefers exact-barcode overlay display identity when regulatory identity is only a weak flavor label', () => {
  const digestIdentity: AnalysisProductIdentity = {
    name: 'Raspberry',
    brand: 'Pauling Labs',
    sourceAttribution: 'verified_regulatory',
    identityStable: true,
    sourceId: 'dsldLabelId:54975',
  };

  const resolved = resolvePreferredAnalysisProductIdentity({
    digestIdentity,
    overlayClaims: {
      provider: 'iherb',
      productId: '71402',
      barcodeGtin14: '00873024001045',
      upcCode: '873024001045',
      brandName: 'Ener-C',
      title: 'Ener-C, Bubbly Multi-Vitamin Drink Mix, Variety Pack, 1,000 mg, 30 Packets, 9.9 oz (282.9 g)',
      link: 'https://www.iherb.com/pr/ener-c-bubbly-multi-vitamin-drink-mix-variety-pack-1-000-mg-30-packets-9-9-oz-282-9-g/71402',
    },
    barcodeGtin14: '00873024001045',
  });

  assert.equal(resolved?.name, 'Ener-C, Bubbly Multi-Vitamin Drink Mix, Variety Pack, 1,000 mg, 30 Packets, 9.9 oz (282.9 g)');
  assert.equal(resolved?.brand, 'Ener-C');
  assert.equal(resolved?.sourceAttribution, 'label_record');
  assert.equal(resolved?.identityStable, true);
  assert.equal(resolved?.sourceId, 'iherb:71402');
});

test('keeps specific regulatory identity when it already carries product-family meaning', () => {
  const digestIdentity: AnalysisProductIdentity = {
    name: 'Glucosamine 500mg - Regular Strength',
    brand: 'Jamieson',
    sourceAttribution: 'verified_regulatory',
    identityStable: true,
    sourceId: 'lnhpd:80012345',
  };

  const resolved = resolvePreferredAnalysisProductIdentity({
    digestIdentity,
    overlayClaims: {
      provider: 'iherb',
      productId: '123',
      barcodeGtin14: '00665553227870',
      brandName: 'Jamieson',
      title: 'Jamieson, Glucosamine 500mg, Regular Strength, 240 Caplets',
      link: 'https://example.com/product/123',
    },
    barcodeGtin14: '00665553227870',
  });

  assert.deepEqual(resolved, digestIdentity);
});

test('prefers exact-barcode overlay identity when regulatory identity is a branded flavor shorthand', () => {
  const digestIdentity: AnalysisProductIdentity = {
    name: 'Nitro Tech Strawberry',
    brand: 'MuscleTech Performance Series',
    sourceAttribution: 'verified_regulatory',
    identityStable: true,
    sourceId: 'dsldLabelId:63630',
  };

  const resolved = resolvePreferredAnalysisProductIdentity({
    digestIdentity,
    overlayClaims: {
      provider: 'iherb',
      productId: '45234',
      barcodeGtin14: '00631656703269',
      upcCode: '631656703269',
      brandName: 'MuscleTech',
      title: 'MuscleTech, Nitro-Tech™ Whey Protein, Strawberry, 2.2 lbs (998 g)',
      link: 'https://www.iherb.com/pr/muscletech-nitro-tech-whey-protein-strawberry-2-2-lbs-998-g/45234',
    },
    barcodeGtin14: '00631656703269',
  });

  assert.equal(resolved?.name, 'MuscleTech, Nitro-Tech™ Whey Protein, Strawberry, 2.2 lbs (998 g)');
  assert.equal(resolved?.brand, 'MuscleTech');
  assert.equal(resolved?.sourceAttribution, 'label_record');
  assert.equal(resolved?.identityStable, true);
  assert.equal(resolved?.sourceId, 'iherb:45234');
});
