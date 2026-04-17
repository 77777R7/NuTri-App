#!/usr/bin/env node
/* eslint-disable no-console */

import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  loadFullDbSweepConfig,
  renderFullDbSweepMarkdown,
  summarizeDiscoveryRows,
  writeFullDbSweepSummary,
} from "./lib/full-db-sweep-discovery.mjs";

const parseArgs = () => {
  const values = {
    configPath: "data/validation/full-db-sweep-discovery.v1.json",
    outDir: null,
    maxRows: 10000,
    dryRun: false,
    printMarkdown: false,
  };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--config" && next) {
      values.configPath = next;
      index += 1;
    } else if (arg === "--out-dir" && next) {
      values.outDir = next;
      index += 1;
    } else if (arg === "--max-rows" && next) {
      values.maxRows = Number(next);
      index += 1;
    } else if (arg === "--dry-run") {
      values.dryRun = true;
    } else if (arg === "--print-markdown") {
      values.printMarkdown = true;
    }
  }
  return values;
};

const fetchDiscoveryRows = async ({ supabase, config, maxRows }) => {
  const rows = [];
  const batchSize = Number(config.batchSize) || 1000;
  let offset = 0;

  while (rows.length < maxRows) {
    const upper = Math.min(offset + batchSize - 1, maxRows - 1);
    const { data, error } = await supabase
      .from(config.tableName)
      .select(config.selectColumns)
      .range(offset, upper);
    if (error) {
      throw new Error(`full-db-sweep read failed: ${error.message}`);
    }
    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...data);
    if (data.length < batchSize) break;
    offset += batchSize;
  }

  return rows.slice(0, maxRows);
};

const main = async () => {
  const args = parseArgs();
  const config = await loadFullDbSweepConfig(args.configPath);

  if (args.dryRun) {
    console.log(JSON.stringify({
      configPath: args.configPath,
      tableName: config.tableName,
      batchSize: config.batchSize,
      maxRows: args.maxRows,
      outDir: args.outDir || config.outDir,
    }, null, 2));
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rows = await fetchDiscoveryRows({
    supabase,
    config,
    maxRows: Number(args.maxRows) || 10000,
  });
  const summary = summarizeDiscoveryRows(rows, {
    maxExamplesPerLane: config.maxExamplesPerLane,
  });
  const outputs = await writeFullDbSweepSummary({
    summary,
    outDir: args.outDir || config.outDir,
  });

  if (args.printMarkdown) {
    console.log(renderFullDbSweepMarkdown(summary));
  }

  console.error(`[full-db-sweep] rows=${summary.total}`);
  console.error(`[full-db-sweep] wrote ${outputs.jsonPath}`);
  console.error(`[full-db-sweep] wrote ${outputs.mdPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
