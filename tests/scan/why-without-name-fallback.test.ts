import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const SERVER_FILE = path.join(process.cwd(), 'backend/src/server.ts');
const KBRUNTIME_FILE = path.join(process.cwd(), 'backend/src/kbRuntime.ts');
const SCORE_FILE = path.join(process.cwd(), 'backend/src/scoring/v4ScoreEngine.ts');

test('without-name fallback wiring exists across score -> API schema -> kb lookup', () => {
  const scoreSource = fs.readFileSync(SCORE_FILE, 'utf8');
  const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');
  const kbSource = fs.readFileSync(KBRUNTIME_FILE, 'utf8');

  assert.ok(scoreSource.includes('ingredientCanonicalKey'));
  assert.ok(serverSource.includes('ingredientCanonicalKey'));
  assert.ok(kbSource.includes('ingredientCanonicalKey'));
  assert.ok(kbSource.includes('ingredient_canonical_key'));
});
