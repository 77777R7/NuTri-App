import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");
const ROUTES_PATH = path.resolve(__dirname, "../src/routes/scienceSidecarRoutes.ts");

test("science sidecar routes are registered from a dedicated module", async () => {
  const serverSource = await readFile(SERVER_PATH, "utf8");
  const routesSource = await readFile(ROUTES_PATH, "utf8");

  assert.match(serverSource, /import \{ registerScienceSidecarRoutes \} from "\.\/routes\/scienceSidecarRoutes\.js";/);
  assert.match(serverSource, /registerScienceSidecarRoutes\(app, \{/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/ingredient-overview\/v1"/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/scientific-background\/v1"/);
  assert.doesNotMatch(serverSource, /const ingredientOverviewBodySchema = /);
  assert.doesNotMatch(serverSource, /const scientificBackgroundBodySchema = /);

  assert.match(routesSource, /export const registerScienceSidecarRoutes = /);
  assert.match(routesSource, /app\.post\("\/api\/ingredient-overview\/v1", deps\.verifySupabaseToken/);
  assert.match(routesSource, /app\.post\("\/api\/scientific-background\/v1", deps\.verifySupabaseToken/);
  assert.match(routesSource, /buildScanSidecarCacheKey\(\{/);
  assert.match(routesSource, /recordScanSidecarCacheStatus\("scientific_background", "hit"\)/);
});
