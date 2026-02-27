import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(TEST_DIR, "..");
const SRC_DIR = path.join(BACKEND_ROOT, "src");
const ODS_DOMAIN = "ods.od.nih.gov";

const walkTsFiles = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkTsFiles(fullPath);
      out.push(...nested);
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".ts")) {
      out.push(fullPath);
    }
  }
  return out;
};

test("runtime backend source does not hardcode ODS host URLs", async () => {
  const files = await walkTsFiles(SRC_DIR);
  const offenders = [];

  for (const filePath of files) {
    // eslint-disable-next-line no-await-in-loop
    const content = await fs.readFile(filePath, "utf8");
    if (content.includes(ODS_DOMAIN)) {
      offenders.push(path.relative(BACKEND_ROOT, filePath));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Runtime source contains ODS host references: ${offenders.join(", ")}`,
  );
});
