import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const ROOT_DIR = process.cwd().endsWith(`${path.sep}backend`)
  ? process.cwd()
  : path.join(process.cwd(), "backend");

test("runtime and backfill both use shared LNHPD inferred-actives module", async () => {
  const serverPath = path.join(ROOT_DIR, "src", "server.ts");
  const backfillPath = path.join(ROOT_DIR, "scripts", "backfill-v4-scores.ts");

  const [serverSource, backfillSource] = await Promise.all([
    readFile(serverPath, "utf8"),
    readFile(backfillPath, "utf8"),
  ]);

  assert.match(
    serverSource,
    /import\s+\{[\s\S]*inferLnhpdActivesFromProductName[\s\S]*\}\s+from\s+"\.\/lnhpd\/inferredActives\.js"/,
  );
  assert.match(
    backfillSource,
    /import\s+\{\s*inferLnhpdActivesFromProductName\s*\}\s+from\s+"\.\.\/src\/lnhpd\/inferredActives\.js"/,
  );
  assert.match(serverSource, /inferLnhpdActivesFromProductName\(/);
  assert.match(backfillSource, /inferLnhpdActivesFromProductName\(/);

  assert.doesNotMatch(
    backfillSource,
    /const\s+inferLnhpdActivesFromProductName\s*=\s*\(/,
    "backfill script should not keep a duplicate local inference implementation",
  );
});
