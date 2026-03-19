#!/usr/bin/env node
/* eslint-disable no-console */
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const SCRIPT_PATH = path.join(ROOT, "scripts", "maintainer", "run-week2-5-root-cause-wave.mjs");
const args = process.argv.slice(2);

try {
  execFileSync("node", [SCRIPT_PATH, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    maxBuffer: 1024 * 1024 * 32,
  });
} catch (error) {
  if (typeof error?.status === "number") {
    process.exit(error.status);
  }
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
