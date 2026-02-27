import assert from 'node:assert/strict';
import test from 'node:test';

import { extractUlWarningItems, extractUlWarnings } from '@/lib/scan/useAnalysisBundleViewModel';

test('extractUlWarnings reads root ulWarnings path', () => {
  const rows = extractUlWarnings({
    explain: {
      ulWarnings: [{ ingredient: 'Vitamin D', currentDose: '1000 IU', ulLimit: '4000 IU', riskLevel: 'low' }],
    },
  } as any);

  assert.equal(rows.length, 1);
  assert.match(rows[0] ?? '', /Vitamin D/i);
  assert.match(rows[0] ?? '', /UL 4000 IU/i);
});

test('extractUlWarnings reads ulWarnings.entries rich payload with scope/source', () => {
  const rows = extractUlWarnings({
    explain: {
      ulWarnings: {
        entries: [
          {
            displayName: 'Magnesium',
            currentDose: '250 mg',
            ulLimit: '350 mg',
            riskLevel: 'low',
            scope: 'supplements_only',
            sourceUrl: 'https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/',
          },
        ],
      },
    },
  } as any);
  assert.equal(rows.length, 1);
  assert.match(rows[0] ?? '', /scope supplements only/i);
});

test('extractUlWarningItems exposes source label and link metadata', () => {
  const rows = extractUlWarningItems({
    explain: {
      ulWarnings: {
        entries: [
          {
            displayName: 'Magnesium',
            currentDose: '250 mg',
            ulLimit: '350 mg',
            riskLevel: 'low',
            scope: 'supplements_only',
            sourceUrl: 'https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/',
          },
        ],
      },
    },
  } as any);
  assert.equal(rows.length, 1);
  assert.match(rows[0]?.sourceLabel ?? '', /NIH ODS/i);
  assert.equal(rows[0]?.canOpenLink, true);
});

test('extractUlWarnings hides detailed UL entries for web unverified payloads', () => {
  const rows = extractUlWarnings({
    explain: {
      ulWarnings: {
        webDisplayEligible: false,
        entries: [
          {
            displayName: 'Zinc',
            currentDose: '40 mg',
            ulLimit: '40 mg',
            scope: 'total_intake',
          },
        ],
      },
    },
  } as any);
  assert.equal(rows.length, 1);
  assert.match(rows[0] ?? '', /hidden for unverified web hints/i);
});

test('extractUlWarnings reads nested safety/evidence paths', () => {
  const safetyRows = extractUlWarnings({
    explain: {
      safety: {
        ulWarnings: [{ ingredientName: 'Zinc', dailyAmount: '40 mg', upperLimit: '40 mg', severity: 'moderate' }],
      },
    },
  } as any);
  const evidenceRows = extractUlWarnings({
    explain: {
      evidence: {
        ulWarnings: [{ ingredient: 'Vitamin A', dose: '5000 IU', limit: '10000 IU' }],
      },
    },
  } as any);

  assert.equal(safetyRows.length, 1);
  assert.equal(evidenceRows.length, 1);
  assert.match(safetyRows[0] ?? '', /Zinc/i);
  assert.match(evidenceRows[0] ?? '', /Vitamin A/i);
});

test('extractUlWarnings returns readable fallback when no signal exists', () => {
  const rows = extractUlWarnings({ explain: { foo: 'bar' } } as any);
  assert.equal(rows.length, 1);
  assert.match(rows[0] ?? '', /No ODS upper-limit signal/i);
});
