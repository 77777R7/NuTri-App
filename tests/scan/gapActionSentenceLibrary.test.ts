import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGapActionSentences } from '../../lib/scan/gapActionSentenceLibrary';

test('buildGapActionSentences returns actionable two-line guidance for missing directions', () => {
  const lines = buildGapActionSentences(['missing_directions'], 'usage');
  assert.ok(lines.length >= 2);
  assert.match(lines[0], /record|direction/i);
  assert.match(lines[1], /capture|add|scan/i);
});
