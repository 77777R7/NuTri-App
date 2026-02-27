import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mapDsldFactsToFactsDTO } from '../dist/insights/factsMapper.js';

test('DSLD mapper preserves duplicate ingredient entries (no sum/merge)', () => {
  const dto = mapDsldFactsToFactsDTO({
    dsldLabelId: 275689,
    productName: 'Test Product',
    brandName: 'Test Brand',
    servingSize: '2 capsules',
    servingsPerContainer: 30,
    actives: [
      { name: 'Magnesium', amount: 50, unit: 'mg' },
      { name: 'Magnesium', amount: 100, unit: 'mg' },
    ],
    inactive: [],
    datasetVersion: 'v1',
    extractedAt: null,
    dsldPdf: null,
    dsldThumbnail: null,
  });

  const magnesiumRows = dto.ingredients.actives.filter((row) => row.name === 'Magnesium');
  assert.equal(magnesiumRows.length, 2);
  assert.equal(dto.dataQuality.missingReasons?.includes('multiple_label_entries'), true);
});
