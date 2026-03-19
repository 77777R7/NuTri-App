import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const workspaceRoot = '/Users/howard07/NuTriApp/nutri-app';

const read = (relativePath: string) =>
  fs.readFileSync(path.join(workspaceRoot, relativePath), 'utf8');

test('home check-in flow uses shared eligibility and hard-blocks future dates', () => {
  const source = read('app/main/Home-Page.tsx');

  assert.match(source, /import\s+\{\s*validateCheckInDateForItem\s*\}\s+from\s+'@\/lib\/check-in-eligibility'/);
  assert.match(source, /isFutureDate:\s*date\.getTime\(\)\s*>\s*today\.getTime\(\)/);
  assert.match(source, /\.filter\(item => validateCheckInDateForItem\(item, selectedDateKey, todayDateKey\)\.isValid\)/);
  assert.match(source, /void toggleCheckIn\(/);
  assert.match(
    source,
    /selectedDateKey,\s*item\.checkInKey,\s*item\.supplementId \?\? null,\s*\{\s*createdAt: item\.createdAt,\s*syncedToCheckIn: true \s*\}/s,
  );
});

test('progress screen computes expected sets by date eligibility and passes metadata to check-ins', () => {
  const source = read('components/screens/ProgressScreen.tsx');

  assert.match(source, /const resolveExpectedForDate = useCallback\(/);
  assert.match(source, /savedSupplements\.filter\(item => validateCheckInDateForItem\(item, dateKey, todayKey\)\.isValid\)/);
  assert.match(
    source,
    /toggleCheckIn\(todayKey,\s*item\.checkInKey,\s*item\.supplementId,\s*\{\s*createdAt: savedSupplements\.find\(saved => saved\.id === item\.id\)\?\.createdAt \?\? null,\s*syncedToCheckIn: true,\s*\}\)/s,
  );
  assert.match(
    source,
    /remaining\.map\(item => \(\{\s*key: item\.checkInKey,\s*supplementId: item\.supplementId,\s*createdAt: savedSupplements\.find\(saved => saved\.id === item\.id\)\?\.createdAt \?\? null,\s*syncedToCheckIn: true,\s*\}\)\)/s,
  );
});

test('daily check-in context rejects invalid writes through shared eligibility validation', () => {
  const source = read('contexts/DailyCheckInContext.tsx');

  assert.match(source, /import\s+\{\s*validateCheckInDateForItem\s*\}\s+from\s+'@\/lib\/check-in-eligibility'/);
  assert.match(source, /const isEntryEligible = useCallback\(/);
  assert.match(source, /if \(!isEntryEligible\(dateKey, meta\)\) return;/);
  assert.match(source, /entries\.filter\(entry => !existing\.has\(entry\.key\) && isEntryEligible\(dateKey, entry\)\)/);
});
