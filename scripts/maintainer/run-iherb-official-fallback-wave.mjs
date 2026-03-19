#!/usr/bin/env node
/* eslint-disable no-console */
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const args = process.argv.slice(2);

if (!args.includes("--config-json")) {
  console.error("Missing --config-json. Example: node scripts/maintainer/run-iherb-official-fallback-wave.mjs --config-json data/iherb_official_fallback_configs/pure-encapsulations.json");
  process.exit(1);
}

const scriptPath = path.join(ROOT, "scripts", "maintainer", "refresh-iherb-overlay-p0-by-official-fallback.mjs");
execFileSync(process.execPath, [scriptPath, ...args], {
  stdio: "inherit",
});
