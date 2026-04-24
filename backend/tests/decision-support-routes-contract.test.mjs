import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");
const ROUTES_PATH = path.resolve(__dirname, "../src/routes/decisionSupportRoutes.ts");

test("decision support route is registered from a dedicated route module", async () => {
  const serverSource = await readFile(SERVER_PATH, "utf8");
  const routesSource = await readFile(ROUTES_PATH, "utf8");

  assert.match(serverSource, /import \{ registerDecisionSupportRoutes \} from "\.\/routes\/decisionSupportRoutes\.js";/);
  assert.match(serverSource, /registerDecisionSupportRoutes\(app, \{/);
  assert.doesNotMatch(serverSource, /app\.get\("\/api\/decision-support\/v1"/);

  assert.match(routesSource, /export const registerDecisionSupportRoutes = /);
  assert.match(routesSource, /app\.get\("\/api\/decision-support\/v1", deps\.verifySupabaseToken/);
  assert.match(routesSource, /buildDecisionSupportDigestMismatchPayload/);
  assert.match(routesSource, /decisionSupportFetchCount/);
  assert.match(routesSource, /personalizedResultLane/);
});
