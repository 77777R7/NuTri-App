import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");
const OPS_ROUTES_PATH = path.resolve(__dirname, "../src/routes/opsRoutes.ts");

test("ops routes are registered from a dedicated route module", async () => {
  const serverSource = await readFile(SERVER_PATH, "utf8");
  const routesSource = await readFile(OPS_ROUTES_PATH, "utf8");

  assert.match(serverSource, /import \{ registerOpsRoutes \} from "\.\/routes\/opsRoutes\.js";/);
  assert.match(serverSource, /registerOpsRoutes\(app, \{\s*getMetricsSnapshot,\s*recordScanUxMetric,\s*\}\);/s);
  assert.doesNotMatch(serverSource, /app\.get\("\/internal\/metrics"/);
  assert.doesNotMatch(serverSource, /app\.get\("\/health"/);

  assert.match(routesSource, /export const registerOpsRoutes = /);
  assert.match(routesSource, /app\.get\("\/internal\/metrics"/);
  assert.match(routesSource, /getMetricsSnapshot\(\)/);
  assert.match(routesSource, /app\.post\("\/api\/scan-ux-metrics"/);
  assert.match(routesSource, /recordScanUxMetric/);
  assert.match(routesSource, /app\.get\("\/health"/);
  assert.match(routesSource, /googleCse/);
  assert.match(routesSource, /deepseek/);
});
