import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeCoverBullets } from '@/lib/scan/neverBlank';

test('preview placeholder purge removes placeholder bullets', () => {
  const bullets = [
    { text: 'Details not provided by source.' },
    { text: 'Supports immune function.' },
    { text: 'Not provided by LNHPD for this NPN.' },
  ];

  const out = sanitizeCoverBullets(bullets, [
    'Limited detail from the registry record.',
    'Add a clear label photo to unlock ingredient-level analysis.',
  ]);

  assert.ok(out.length >= 1);
  assert.ok(out.some((row) => /supports immune function/i.test(row.text)));
  assert.ok(out.every((row) => !/not provided|unknown|n\/a|missing|unavailable/i.test(row.text)));
});

test('preview placeholder purge falls back when all input lines are placeholders', () => {
  const bullets = [{ text: 'Not provided by source.' }, { text: 'Unknown' }];
  const fallback = [
    'Limited detail from the registry record.',
    'Add a clear label photo to unlock ingredient-level analysis.',
  ];

  const out = sanitizeCoverBullets(bullets, fallback);
  assert.ok(out.length > 0);
  assert.ok(out.every((row) => !/not provided|unknown|n\/a|missing|unavailable/i.test(row.text)));
  assert.equal(out[0]?.text, fallback[0]);
});

test('preview placeholder purge handles usage and safety cover placeholders', () => {
  const usageBullets = [
    { text: 'Not provided.' },
    { text: 'Use the product label first for dosing decisions.' },
  ];
  const safetyBullets = [
    { text: 'Not provided by source.' },
    { text: 'Unavailable' },
  ];

  const usageOut = sanitizeCoverBullets(usageBullets, [
    'Usage guidance is limited by current source coverage.',
    'Scan the Directions panel to improve product-specific guidance.',
  ]);
  const safetyOut = sanitizeCoverBullets(safetyBullets, [
    'Safety data is limited in this source record.',
    'Check the package warning panel and consult a clinician if needed.',
  ]);

  assert.ok(usageOut.every((row) => !/not provided|unknown|n\/a|missing|unavailable/i.test(row.text)));
  assert.ok(safetyOut.every((row) => !/not provided|unknown|n\/a|missing|unavailable/i.test(row.text)));
  assert.equal(safetyOut[0]?.text, 'Safety data is limited in this source record.');
});
