#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const outDirArg = getArg("out-dir") || process.env.MAINTAINER_GATES_OUT_DIR || path.join("output", "maintainer-gates");
const OUTPUT_DIR = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
const REPORT_PATH = path.join(OUTPUT_DIR, "governance_policy_report.json");

const parseBooleanLoose = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on", "enforce", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return null;
};

const detectExecutionEnv = (apiBase) => {
  const explicit = String(process.env.MAINTAINER_GATES_ENV || "").trim().toLowerCase();
  if (explicit === "local" || explicit === "staging" || explicit === "prod") return explicit;
  const url = String(apiBase || "").toLowerCase();
  if (url.includes("127.0.0.1") || url.includes("localhost")) return "local";
  if (url.includes("staging")) return "staging";
  if (url.includes("prod") || url.includes("onrender.com") || url.includes("render.com")) return "prod";
  return "unknown";
};

const API_BASE_URL =
  getArg("api-base-url") ||
  process.env.API_BASE_URL ||
  process.env.RENDER_BASE_URL ||
  "http://127.0.0.1:3001";

const env = detectExecutionEnv(API_BASE_URL);
const migrationBatchId =
  String(process.env.MIGRATION_BATCH_ID || process.env.RELEASE_MIGRATION_BATCH_ID || "").trim() || null;
const dbWriteMode =
  String(process.env.DB_WRITE_MODE || process.env.BARCODE_METADATA_WRITE_MODE || "").trim() || null;
const shadowWindowHoursRaw = process.env.RELEASE_SHADOW_WINDOW_HOURS ?? process.env.SHADOW_WINDOW_HOURS ?? "";
const shadowWindowHours = Number(shadowWindowHoursRaw);

const flagsSnapshot = {
  KEY_CONTRACT_V2: process.env.KEY_CONTRACT_V2 ?? null,
  WRITE_GUARD_V2: process.env.WRITE_GUARD_V2 ?? null,
  METADATA_READONLY: process.env.METADATA_READONLY ?? null,
  STAGE0_PROTOCOL_UNIFIED: process.env.STAGE0_PROTOCOL_UNIFIED ?? null,
};

const checks = [
  {
    key: "migration_batch_id_present",
    requiredInProd: true,
    pass: Boolean(migrationBatchId),
    detail: migrationBatchId ? "migration batch id provided" : "migration batch id missing",
  },
  {
    key: "db_write_mode_set",
    requiredInProd: true,
    pass: Boolean(dbWriteMode),
    detail: dbWriteMode ? `dbWriteMode=${dbWriteMode}` : "dbWriteMode missing",
  },
  {
    key: "key_contract_declared",
    requiredInProd: true,
    pass: parseBooleanLoose(flagsSnapshot.KEY_CONTRACT_V2) !== null,
    detail:
      parseBooleanLoose(flagsSnapshot.KEY_CONTRACT_V2) !== null
        ? `KEY_CONTRACT_V2=${String(flagsSnapshot.KEY_CONTRACT_V2)}`
        : "KEY_CONTRACT_V2 not declared",
  },
  {
    key: "write_guard_declared",
    requiredInProd: true,
    pass: parseBooleanLoose(flagsSnapshot.WRITE_GUARD_V2) !== null,
    detail:
      parseBooleanLoose(flagsSnapshot.WRITE_GUARD_V2) !== null
        ? `WRITE_GUARD_V2=${String(flagsSnapshot.WRITE_GUARD_V2)}`
        : "WRITE_GUARD_V2 not declared",
  },
  {
    key: "shadow_window_hours_declared",
    requiredInProd: true,
    pass: Number.isFinite(shadowWindowHours) && shadowWindowHours >= 48,
    detail: Number.isFinite(shadowWindowHours)
      ? `shadowWindowHours=${shadowWindowHours}`
      : "shadow window hours not declared",
  },
];

const blockingReasons = [];
const warnings = [];
for (const check of checks) {
  if (check.pass) continue;
  if (env === "prod" && check.requiredInProd) {
    blockingReasons.push(`governance_${check.key}_failed`);
  } else {
    warnings.push(`governance_${check.key}_warning`);
  }
}

const pass = blockingReasons.length === 0;
const report = {
  generatedAt: new Date().toISOString(),
  apiBaseUrl: API_BASE_URL,
  env,
  pass,
  blockingReasons,
  warnings,
  migrationBatchId,
  dbWriteMode,
  flagsSnapshot,
  checks,
};

await fs.mkdir(OUTPUT_DIR, { recursive: true });
await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
console.log(`[governance-policy] report=${REPORT_PATH}`);

if (!pass) {
  console.error(`[governance-policy] failed: ${blockingReasons.join(",")}`);
  process.exit(1);
}
