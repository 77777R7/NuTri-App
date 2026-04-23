import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");

test("regression token is marked before auth-bypass short-circuit", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const routeSet = source.indexOf("const regressionAuthRoutes = new Set");
  const middlewareStart = source.indexOf("const verifySupabaseToken = async");
  assert.ok(routeSet >= 0, "missing regressionAuthRoutes");
  assert.ok(middlewareStart >= 0, "missing verifySupabaseToken");

  const middleware = source.slice(middlewareStart, source.indexOf("const authHeader", middlewareStart));
  const regressionCheck = middleware.indexOf("regressionAuthRoutes.has(req.path)");
  const authDisabledCheck = middleware.indexOf("if (authDisabled)");
  const authBypassCheck = middleware.indexOf("if (allowBypass)");
  const marker = middleware.indexOf("(req as AuthenticatedRequest).regressionAuth = true");

  assert.ok(regressionCheck >= 0, "missing regression token check in auth middleware");
  assert.ok(authDisabledCheck >= 0, "missing authDisabled branch");
  assert.ok(authBypassCheck >= 0, "missing allowBypass branch");
  assert.ok(marker >= 0, "missing regressionAuth marker");
  assert.ok(regressionCheck < authDisabledCheck, "regression token must be checked before authDisabled");
  assert.ok(regressionCheck < authBypassCheck, "regression token must be checked before auth bypass");
  assert.ok(marker < authBypassCheck, "regressionAuth must be set before auth bypass can return");
  assert.match(
    middleware,
    /const hasBypassRegressionMarker =[\s\S]*\(authDisabled \|\| allowBypass\) && hasRegressionTokenHeader/,
    "staging auth-disabled regression marker should still set regressionAuth",
  );
});

test("authority regression sample defaults to stable LNHPD scan-history sample without forced LNHPD timeout", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  assert.match(source, /process\.env\.AUTHORITY_REGRESSION_SAMPLE_BARCODE \?\? "00628747100045"/);
  assert.match(source, /process\.env\.AUTHORITY_REGRESSION_SAMPLE_HISTORICAL_NPN \?\? "80062961"/);

  const activeStart = source.indexOf("const authorityRegressionScenarioActive =");
  assert.ok(activeStart >= 0, "missing authority regression sample guard");
  const activeBlock = source.slice(activeStart, source.indexOf("let regulatoryMapStatus", activeStart));
  assert.doesNotMatch(
    activeBlock,
    /authorityFailMode\s*=\s*"timeout"/,
    "regression sample should not force LNHPD fetch timeout unless requested by header",
  );
});
