import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { registerEnrichStreamRoute } from "../src/routes/enrichStreamRoute.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROUTE_PATH = path.resolve(__dirname, "../src/routes/enrichStreamRoute.ts");

const createFakeApp = () => {
  const routes = new Map();
  return {
    routes,
    post(pathname, ...handlers) {
      routes.set(pathname, handlers);
    },
  };
};

const extractRouteDependencyNames = async () => {
  const source = await readFile(ROUTE_PATH, "utf8");
  const match = source.match(/  const \{\n([\s\S]*?)\n  \} = deps as Record<string, any>;/);
  assert.ok(match, "missing route dependency destructure");

  return match[1]
    .split("\n")
    .map((line) => line.trim().replace(/,$/, ""))
    .filter(Boolean);
};

test("enrich-stream module registers only the stream route", async () => {
  const app = createFakeApp();
  const deps = Object.fromEntries((await extractRouteDependencyNames()).map((name) => [name, () => null]));
  deps.verifySupabaseToken = (_req, _res, next) => next();
  deps.parseRequestBody = () => null;

  registerEnrichStreamRoute(app, deps);

  assert.deepEqual([...app.routes.keys()], ["/api/enrich-stream"]);
  const handlers = app.routes.get("/api/enrich-stream");
  assert.equal(handlers.length, 2);
});
