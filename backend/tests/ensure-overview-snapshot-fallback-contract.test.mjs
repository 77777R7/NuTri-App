import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");

test("ensure-overview snapshot fallback does not coerce barcode into npn identity", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  assert.match(source, /const snapshotNpn = normalizeNpnValue\(snapshot\.regulatory\.npn \?\? null\);/);
  assert.match(source, /if \(snapshotNpn\) \{/);
  assert.match(source, /identityType: "webCanonicalId"/);
  assert.match(source, /const identityType: FactsIdentityType = npn \? "npn" : "webCanonicalId";/);
});
