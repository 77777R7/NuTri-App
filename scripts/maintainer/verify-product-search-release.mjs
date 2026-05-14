#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

const node = process.execPath;

const checks = [
  {
    name: "Product Search smoke script syntax",
    command: node,
    args: ["--check", "scripts/maintainer/smoke-product-search-release.mjs"],
  },
  {
    name: "App alias import resolution",
    command: node,
    args: ["scripts/maintainer/check-app-alias-imports.mjs"],
  },
  {
    name: "App root provider contracts",
    command: node,
    args: ["scripts/maintainer/check-app-provider-contracts.mjs"],
  },
  {
    name: "Product Search UI and query-planning contracts",
    command: node,
    args: [
      "--import",
      "tsx",
      "--test",
      "tests/search/product-search-ui-contract.test.ts",
      "backend/tests/product-search-query-planning.test.ts",
    ],
  },
  {
    name: "Product Search replay and smoke verifier tests",
    command: node,
    args: [
      "--test",
      "tests/search/search-relevance-golden.test.mjs",
      "tests/search/search-golden-replay-runner.test.mjs",
      "tests/search/search-p0-release-pack.test.mjs",
      "tests/search/product-search-release-smoke.test.mjs",
    ],
  },
  {
    name: "Backend release build",
    command: "npm",
    args: ["--prefix", "backend", "run", "build"],
  },
];

const runCheck = ({ name, command, args }) =>
  new Promise((resolve) => {
    console.error(`\n[product-search-release] ${name}`);
    console.error(`[product-search-release] $ ${[command, ...args].join(" ")}`);
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: "inherit",
    });
    child.on("close", (code, signal) => {
      resolve({
        name,
        code: code ?? (signal ? 1 : 0),
        signal,
      });
    });
    child.on("error", (error) => {
      console.error(`[product-search-release] ${name} failed to start: ${error.message}`);
      resolve({
        name,
        code: 1,
        signal: null,
      });
    });
  });

const main = async () => {
  const results = [];
  for (const check of checks) {
    const result = await runCheck(check);
    results.push(result);
    if (result.code !== 0) break;
  }

  const failed = results.find((result) => result.code !== 0);
  const summary = {
    status: failed ? "fail" : "pass",
    passed: results.filter((result) => result.code === 0).length,
    total: checks.length,
    failed: failed?.name ?? null,
  };
  console.error(`\n[product-search-release] summary ${JSON.stringify(summary)}`);
  if (failed) process.exitCode = failed.code || 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
