import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_PATH = path.join('/Users/howard07/NuTriApp/nutri-app/components/scan/AnalysisDashboard.tsx');

test('modern dashboard modal is keyed by selectedTileType and remounts on tile switch', async () => {
  const source = await readFile(DASHBOARD_PATH, 'utf8');

  assert.match(source, /const \[selectedTileType, setSelectedTileType\] = useState<TileType \| null>\(null\);/);
  assert.match(source, /key=\{selectedTileType \?\? 'closed'\}/);
  assert.match(source, /onPress=\{\(\) => setSelectedTileType\(tile\.type\)\}/);
});
