import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HOME_PAGE_PATH = path.resolve(__dirname, "../../app/main/Home-Page.tsx");

test("recent scan save path preserves dosageText and imageUrl into Saved", async () => {
  const source = await readFile(HOME_PAGE_PATH, "utf8");
  assert.match(source, /dosageText: item\.dosageText \?\? '',/);
  assert.match(source, /imageUrl: item\.imageUrl \?\? null,/);
});
