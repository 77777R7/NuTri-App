import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");
const ROUTE_PATH = path.resolve(__dirname, "../src/routes/enrichStreamRoute.ts");

test("enrich-stream route is registered from a dedicated module", async () => {
  const serverSource = await readFile(SERVER_PATH, "utf8");
  const routeSource = await readFile(ROUTE_PATH, "utf8");

  assert.match(serverSource, /import \{ registerEnrichStreamRoute \} from "\.\/routes\/enrichStreamRoute\.js";/);
  assert.match(serverSource, /registerEnrichStreamRoute\(app, \{/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/enrich-stream"/);
  assert.match(serverSource, /app\.get\("\/api\/client-runtime-flags"/);
  assert.match(serverSource, /app\.post\("\/api\/ensure-overview"/);

  assert.match(routeSource, /export const registerEnrichStreamRoute = /);
  assert.match(routeSource, /const enrichStreamBodySchema = z/);
  assert.match(routeSource, /app\.post\("\/api\/enrich-stream", deps\.verifySupabaseToken/);
});
