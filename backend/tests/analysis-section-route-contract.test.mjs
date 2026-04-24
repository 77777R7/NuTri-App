import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");
const ROUTE_PATH = path.resolve(__dirname, "../src/routes/analysisSectionRoute.ts");

test("analysis-section route is registered from a dedicated module", async () => {
  const serverSource = await readFile(SERVER_PATH, "utf8");
  const routeSource = await readFile(ROUTE_PATH, "utf8");

  assert.match(serverSource, /import \{ registerAnalysisSectionRoute \} from "\.\/routes\/analysisSectionRoute\.js";/);
  assert.match(serverSource, /registerAnalysisSectionRoute\(app, \{/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/analysis-section"/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/enrich-stream"/);
  assert.match(serverSource, /registerEnrichStreamRoute\(app, \{/);

  assert.match(routeSource, /export const registerAnalysisSectionRoute = /);
  assert.match(routeSource, /app\.post\("\/api\/analysis-section", deps\.verifySupabaseToken/);
  assert.match(routeSource, /const analysisSectionBodySchema = buildAnalysisSectionBodySchema/);
});
