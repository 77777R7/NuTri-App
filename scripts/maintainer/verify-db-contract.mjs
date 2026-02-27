#!/usr/bin/env node
/* eslint-disable no-console */

import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[verify-db-contract] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const failures = [];

const checkTable = async (tableName) => {
  const { error } = await supabase.from(tableName).select("*", { head: true, count: "exact" }).limit(1);
  if (error) {
    failures.push({ requirement: `table:${tableName}`, details: error.message || "missing_or_unreadable" });
  } else {
    console.info(`[verify-db-contract] ok table:${tableName}`);
  }
};

await checkTable("barcode_scans");
await checkTable("barcode_regulatory_map");
await checkTable("negative_cache");
await checkTable("snapshots");

const { data: resolverProbe, error: resolverError } = await supabase.rpc("resolve_catalog_by_variants", {
  p_variants: ["00000000000000"],
});
if (resolverError) {
  failures.push({ requirement: "function:resolve_catalog_by_variants", details: resolverError.message || "rpc_failed" });
} else {
  const count = Array.isArray(resolverProbe) ? resolverProbe.length : 0;
  console.info(`[verify-db-contract] ok function:resolve_catalog_by_variants (rows=${count})`);
}

const { data: contractRows, error: contractError } = await supabase.rpc("verify_barcode_contract");
if (contractError) {
  failures.push({ requirement: "function:verify_barcode_contract", details: contractError.message || "rpc_failed" });
} else {
  const rows = Array.isArray(contractRows) ? contractRows : [];
  for (const row of rows) {
    const requirement = String(row?.requirement ?? "unknown_requirement");
    const ok = Boolean(row?.ok);
    const details = String(row?.details ?? "");
    if (!ok) {
      failures.push({ requirement, details: details || "contract_check_failed" });
    } else {
      console.info(`[verify-db-contract] ok ${requirement}`);
    }
  }
}

if (failures.length > 0) {
  console.error("[verify-db-contract] FAILED");
  for (const failure of failures) {
    console.error(` - ${failure.requirement}: ${failure.details}`);
  }
  process.exit(1);
}

console.info("[verify-db-contract] PASS");
