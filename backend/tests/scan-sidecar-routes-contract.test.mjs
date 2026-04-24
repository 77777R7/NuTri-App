import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");
const ROUTES_PATH = path.resolve(__dirname, "../src/routes/scanSidecarRoutes.ts");

test("deferred scan sidecar routes are registered from a dedicated module", async () => {
  const serverSource = await readFile(SERVER_PATH, "utf8");
  const routesSource = await readFile(ROUTES_PATH, "utf8");

  assert.match(serverSource, /import \{ registerScanSidecarRoutes \} from "\.\/routes\/scanSidecarRoutes\.js";/);
  assert.match(serverSource, /registerScanSidecarRoutes\(app, \{/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/product-overview-ai\/v1"/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/summary\/ingredient"/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/summary\/usage"/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/summary\/safety"/);

  assert.match(routesSource, /export const registerScanSidecarRoutes = /);
  assert.match(routesSource, /app\.post\("\/api\/product-overview-ai\/v1", deps\.verifySupabaseToken/);
  assert.match(routesSource, /app\.post\("\/api\/summary\/ingredient", deps\.verifySupabaseToken/);
  assert.match(routesSource, /app\.post\("\/api\/summary\/usage", deps\.verifySupabaseToken/);
  assert.match(routesSource, /app\.post\("\/api\/summary\/safety", deps\.verifySupabaseToken/);
  assert.match(routesSource, /recordScanSidecarCacheStatus\("product_overview_ai", "hit"\)/);
  assert.match(routesSource, /applyLegacyShadowHeaders\(req, res, "\/api\/summary\/safety"\)/);
});
