import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const homePath = path.resolve(process.cwd(), 'app/main/Home-Page.tsx');
const source = fs.readFileSync(homePath, 'utf8');

test('home bottom nav fade scales with screen height instead of fixed blur coverage', () => {
  assert.match(source, /height:\s*bottomFadeHeight/);
  assert.match(source, /intensity=\{bottomFadeIntensity\}/);
  assert.match(source, /windowHeight \* BOTTOM_FADE_CUSHION_RATIO/);
  assert.match(source, /bottomInset \+ PLUS_BUTTON_SIZE \+ bottomFadeCushion/);
  assert.doesNotMatch(source, /BOTTOM_FADE_EXTRA/);
  assert.doesNotMatch(source, /Math\.max\(160,\s*bottomInset/);
});
