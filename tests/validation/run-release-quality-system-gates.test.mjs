import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { ROOT_DIR } from "../../scripts/maintainer/lib/science-validation-reporting.mjs";

const execFileAsync = promisify(execFile);

test("release quality system dry-run defaults search replay to the frozen live slice config", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      path.join(ROOT_DIR, "scripts", "maintainer", "run-release-quality-system-gates.mjs"),
      "--dry-run",
    ],
    {
      cwd: ROOT_DIR,
      env: process.env,
      maxBuffer: 1024 * 1024 * 8,
    },
  );

  const payload = JSON.parse(stdout);
  assert.equal(payload.curatedBaselineConfigPath, "data/validation/live-replay-release-slice.v1.json");
  assert.equal(payload.searchConfigPath, "data/validation/live-replay-release-slice.v1.json");
  assert.equal(payload.searchPackPath, null);
  assert.ok(
    payload.runtimeConfigs.includes("data/validation/food-like-route-honesty-stable.v0.json"),
    "food-like route honesty stable pack should be part of release runtime gates",
  );
});

test("release quality system dry-run accepts an explicit raw search pack override", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      path.join(ROOT_DIR, "scripts", "maintainer", "run-release-quality-system-gates.mjs"),
      "--dry-run",
      "--search-pack",
      "data/validation/golden-journey-pack.v1.json",
    ],
    {
      cwd: ROOT_DIR,
      env: process.env,
      maxBuffer: 1024 * 1024 * 8,
    },
  );

  const payload = JSON.parse(stdout);
  assert.equal(payload.searchConfigPath, "data/validation/live-replay-release-slice.v1.json");
  assert.equal(payload.searchPackPath, "data/validation/golden-journey-pack.v1.json");
});
