import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

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

test("enrich-stream server dependency registration only passes runtime values", async () => {
  const serverSource = await readFile(SERVER_PATH, "utf8");
  const registerStart = serverSource.indexOf("registerEnrichStreamRoute(app, {");
  assert.ok(registerStart >= 0, "missing enrich-stream registration");

  const serverAst = ts.createSourceFile("server.ts", serverSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const runtimeValues = new Set([
    "app",
    "process",
    "console",
    "globalThis",
    "Buffer",
    "URL",
    "URLSearchParams",
    "AbortController",
    "AbortSignal",
    "TextDecoder",
    "TextEncoder",
    "setTimeout",
    "clearTimeout",
    "fetch",
    "performance",
    "Date",
    "Math",
    "JSON",
    "Number",
    "String",
    "Boolean",
    "Array",
    "Object",
    "Promise",
    "Map",
    "Set",
    "RegExp",
    "Error",
    "TypeError",
  ]);

  const addBindingName = (name) => {
    if (!name) return;
    if (ts.isIdentifier(name)) {
      runtimeValues.add(name.text);
      return;
    }
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) addBindingName(element.name);
      }
    }
  };

  const visit = (node) => {
    if (node.pos > registerStart) return;
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause?.name) runtimeValues.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) runtimeValues.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) runtimeValues.add(element.name.text);
      }
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) addBindingName(declaration.name);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      runtimeValues.add(node.name.text);
    } else if (ts.isClassDeclaration(node) && node.name) {
      runtimeValues.add(node.name.text);
    } else if (ts.isEnumDeclaration(node)) {
      runtimeValues.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(serverAst);

  const registerMatch = serverSource.match(/registerEnrichStreamRoute\(app, \{([\s\S]*?)\n\}\);/);
  assert.ok(registerMatch, "missing enrich-stream dependency object");
  const shorthandDeps = registerMatch[1]
    .split("\n")
    .map((line) => line.trim().replace(/,$/, ""))
    .filter((line) => /^[A-Za-z_$][\w$]*$/.test(line));

  const missing = shorthandDeps.filter((name) => !runtimeValues.has(name));
  assert.deepEqual(missing, []);
});
