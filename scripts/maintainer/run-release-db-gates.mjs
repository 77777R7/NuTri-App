#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT_DIR = process.cwd();
const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag) => args.includes(`--${flag}`);

if (hasFlag("help")) {
  console.log(`Usage:
  node scripts/maintainer/run-release-db-gates.mjs --env <staging|prod> --project-ref <supabase_project_ref> [options]

Options:
  --api-base-url <url>        API base URL for stable runner (default: http://127.0.0.1:3001)
  --supabase-url <url>        Override SUPABASE_URL for verify-db-contract/stable runner
  --service-role-key <key>    Override SUPABASE_SERVICE_ROLE_KEY for verify-db-contract/stable runner
  --out-root <path>           Output root (default: output/release-gates)
  --skip-stable               Skip stable runner before/after
`);
  process.exit(0);
}

const envName = String(getArg("env") || "").trim();
const projectRef = String(getArg("project-ref") || "").trim();
if (!envName || !projectRef) {
  console.error("[release-db-gates] --env and --project-ref are required");
  process.exit(1);
}

const apiBaseUrl = String(getArg("api-base-url") || process.env.API_BASE_URL || "http://127.0.0.1:3001");
const outRootArg = getArg("out-root") || path.join("output", "release-gates");
const outRoot = path.isAbsolute(outRootArg) ? outRootArg : path.join(ROOT_DIR, outRootArg);
const skipStable = hasFlag("skip-stable");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(outRoot, envName, timestamp);
const beforeDir = path.join(runDir, "before");
const afterDir = path.join(runDir, "after");
const diffDir = path.join(runDir, "diff");
const summaryPath = path.join(runDir, "release_db_gate_summary.json");
const migrationBeforePath = path.join(runDir, "migration_list.before.txt");

const KNOWN_REMOTE_ONLY = new Set([
  "20260212130000",
  "20260212142000",
  "20260212190000",
  "20260212200000",
]);

const baseEnv = {
  ...process.env,
  API_BASE_URL: apiBaseUrl,
};
if (getArg("supabase-url")) baseEnv.SUPABASE_URL = String(getArg("supabase-url"));
if (getArg("service-role-key")) baseEnv.SUPABASE_SERVICE_ROLE_KEY = String(getArg("service-role-key"));

const runCommand = async (cmd, commandArgs, options = {}) => {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, commandArgs, {
      cwd: ROOT_DIR,
      env: options.env ?? baseEnv,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr, command: [cmd, ...commandArgs].join(" ") });
    });
  });
};

const runAndRequire = async (cmd, commandArgs, options = {}) => {
  const result = await runCommand(cmd, commandArgs, options);
  if (result.code !== 0) {
    const err = new Error(`[release-db-gates] command failed: ${result.command}\n${result.stderr || result.stdout}`);
    err.result = result;
    throw err;
  }
  return result;
};

const parseRemoteOnlyVersions = (tableOutput) => {
  const rows = String(tableOutput ?? "").split(/\r?\n/);
  const versions = [];
  for (const row of rows) {
    const match = row.match(/^\s*(\d{14})?\s*\|\s*(\d{14})?\s*\|/);
    if (!match) continue;
    const local = match[1] ?? "";
    const remote = match[2] ?? "";
    if (!local && remote) versions.push(remote);
  }
  return versions;
};

const main = async () => {
  await fs.mkdir(beforeDir, { recursive: true });
  await fs.mkdir(afterDir, { recursive: true });
  await fs.mkdir(diffDir, { recursive: true });

  const steps = [];
  const pushStep = (name, result) => {
    steps.push({
      name,
      command: result.command,
      code: result.code,
      stdoutTail: String(result.stdout || "").split(/\r?\n/).slice(-30),
      stderrTail: String(result.stderr || "").split(/\r?\n/).slice(-30),
    });
  };

  const linkResult = await runAndRequire("supabase", ["link", "--project-ref", projectRef]);
  pushStep("supabase_link", linkResult);

  const migrationListBefore = await runAndRequire("supabase", ["migration", "list", "--linked"]);
  pushStep("migration_list_before", migrationListBefore);
  await fs.writeFile(migrationBeforePath, migrationListBefore.stdout, "utf8");

  const remoteOnlyVersions = parseRemoteOnlyVersions(migrationListBefore.stdout);
  if (remoteOnlyVersions.length > 0) {
    const unknown = remoteOnlyVersions.filter((value) => !KNOWN_REMOTE_ONLY.has(value));
    if (unknown.length > 0) {
      throw new Error(
        `[release-db-gates] unknown remote-only migrations detected: ${unknown.join(", ")}. Manual confirmation required.`,
      );
    }
    const repairResult = await runAndRequire("supabase", [
      "migration",
      "repair",
      "--status",
      "reverted",
      ...remoteOnlyVersions,
    ]);
    pushStep("migration_repair_reverted_known_remote_only", repairResult);
  }

  const buildResult = await runAndRequire("npm", ["--prefix", "backend", "run", "build"]);
  pushStep("backend_build", buildResult);

  if (!skipStable) {
    const stableBefore = await runAndRequire("node", [
      "scripts/maintainer/run-backend-gates-stable.mjs",
      "--manage-backend",
      "--out-dir",
      beforeDir,
      "--api-base-url",
      apiBaseUrl,
    ]);
    pushStep("stable_before", stableBefore);
  }

  const dbPush = await runAndRequire("supabase", ["db", "push", "--linked", "--include-all"]);
  pushStep("supabase_db_push", dbPush);

  const verifyContract = await runAndRequire("npm", ["run", "verify:db-contract"]);
  pushStep("verify_db_contract", verifyContract);

  if (!skipStable) {
    const stableAfter = await runAndRequire("node", [
      "scripts/maintainer/run-backend-gates-stable.mjs",
      "--manage-backend",
      "--out-dir",
      afterDir,
      "--api-base-url",
      apiBaseUrl,
    ]);
    pushStep("stable_after", stableAfter);

    const diffResult = await runAndRequire("node", [
      "scripts/maintainer/gate-report-diff.mjs",
      "--before-report",
      path.join(beforeDir, "gate_full_report.json"),
      "--after-report",
      path.join(afterDir, "gate_full_report.json"),
      "--out-dir",
      diffDir,
    ]);
    pushStep("gate_report_diff", diffResult);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    env: envName,
    projectRef,
    apiBaseUrl,
    runDir,
    beforeDir: skipStable ? null : beforeDir,
    afterDir: skipStable ? null : afterDir,
    diffDir: skipStable ? null : diffDir,
    migrationBeforePath,
    requiredMigration: "20260226100000_barcode_contract_v2.sql",
    remoteOnlyRevertedKnownSet: remoteOnlyVersions.filter((value) => KNOWN_REMOTE_ONLY.has(value)),
    steps,
    pass: true,
  };
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`[release-db-gates] PASS summary=${summaryPath}`);
};

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  const failureSummary = {
    generatedAt: new Date().toISOString(),
    env: envName,
    projectRef,
    runDir,
    pass: false,
    error: message,
  };
  await fs.mkdir(runDir, { recursive: true }).catch(() => undefined);
  await fs.writeFile(summaryPath, JSON.stringify(failureSummary, null, 2), "utf8").catch(() => undefined);
  console.error("[release-db-gates] failed", message);
  process.exit(1);
});
