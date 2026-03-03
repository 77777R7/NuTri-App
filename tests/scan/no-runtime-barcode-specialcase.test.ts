import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import test from "node:test";

test("runtime sources do not hardcode barcode literals", () => {
  const cmd = [
    "rg -n --no-heading",
    "'\"[0-9]{12,14}\"'",
    "backend/src",
  ].join(" ");
  let output = "";
  try {
    output = execSync(cmd, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = String((error as { stderr?: string })?.stderr ?? "");
    // rg returns non-zero when no match is found.
    if (!/no matches found|^$/i.test(stderr.trim())) {
      throw error;
    }
    output = "";
  }
  assert.equal(
    output,
    "",
    `runtime barcode literals must be fixture-only; found:\n${output}`,
  );
});
