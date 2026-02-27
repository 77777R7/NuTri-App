import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const ROOT = '/Users/howard07/NuTriApp/nutri-app';
const HOOK_PATH = path.join(ROOT, 'hooks/useStreamAnalysis.ts');

test('not_found handler prioritizes partial/usable state before hard not_found page', async () => {
  const source = await readFile(HOOK_PATH, 'utf8');
  const start = source.indexOf("if (parsed.kind === 'not_found') {");
  assert.ok(start >= 0, 'missing not_found handler in useStreamAnalysis');
  const slice = source.slice(start, start + 1200);

  assert.match(
    slice,
    /isUsableResultBundle\(prev\.analysisBundle\)\s*\|\|\s*hasMeaningfulPartialData\(prev\)/,
    'not_found branch must guard on usable bundle or partial data before setting status=not_found',
  );
  assert.match(
    slice,
    /status:\s*'complete'/,
    'not_found branch must support complete route when partial data exists',
  );
  assert.match(
    slice,
    /status:\s*'not_found'/,
    'not_found fallback should remain for truly empty sessions',
  );
});
