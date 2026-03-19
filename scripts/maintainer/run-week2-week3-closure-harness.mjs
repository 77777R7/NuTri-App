import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const run = (command, args) => {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
};

run("node", ["scripts/maintainer/build-week2-product-surface-validation.mjs"]);
run("node", ["scripts/maintainer/run-week3-safety-harness.mjs"]);
