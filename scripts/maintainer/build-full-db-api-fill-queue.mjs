#!/usr/bin/env node
/* eslint-disable no-console */

import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import {
  buildExecutableQueueRow,
  loadBrandSupportIndex,
  summarizeApiFillQueue,
  writeApiFillQueueOutputs,
} from "./lib/full-db-api-fill-queue.mjs";
import { ROOT_DIR } from "./lib/science-validation-reporting.mjs";

dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env"), override: false });

const parseArgs = () => {
  const values = {
    outDir: "output/full_db_api_fill_queue",
    batchSize: 1000,
    maxRows: 0,
  };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--out-dir" && next) {
      values.outDir = next;
      index += 1;
    } else if (arg === "--batch-size" && next) {
      values.batchSize = Math.max(100, Number(next) || 1000);
      index += 1;
    } else if (arg === "--max-rows" && next) {
      values.maxRows = Math.max(0, Number(next) || 0);
      index += 1;
    }
  }
  return values;
};

const fetchOverlayCount = async (supabase) => {
  const { count, error } = await supabase
    .from("iherb_overlay_products")
    .select("*", { head: true, count: "exact" });
  if (error) throw new Error(`Failed to count iherb_overlay_products: ${error.message}`);
  return count ?? 0;
};

const fetchOverlayBatch = async ({ supabase, afterId, batchSize }) => {
  let query = supabase
    .from("iherb_overlay_products")
    .select(
      "id,product_id,brand_name,title,barcode_gtin14,upc_code,link,product_catalog_image,product_images,categories,supplement_facts,description_sections",
    )
    .order("id", { ascending: true })
    .limit(batchSize);

  if (afterId > 0) {
    query = query.gt("id", afterId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch overlay batch: ${error.message}`);
  return Array.isArray(data) ? data : [];
};

const main = async () => {
  const args = parseArgs();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const brandSupportIndex = await loadBrandSupportIndex();
  const totalRows = await fetchOverlayCount(supabase);

  const queueRows = [];
  let afterId = 0;
  let scanned = 0;
  const stopAt = args.maxRows > 0 ? Math.min(args.maxRows, totalRows) : totalRows;

  while (scanned < stopAt) {
    const batch = await fetchOverlayBatch({
      supabase,
      afterId,
      batchSize: Math.min(args.batchSize, stopAt - scanned || args.batchSize),
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      const queueRow = buildExecutableQueueRow({ row, brandSupportIndex });
      if (queueRow) queueRows.push(queueRow);
    }

    scanned += batch.length;
    afterId = Number(batch[batch.length - 1]?.id ?? afterId);
  }

  const summary = summarizeApiFillQueue(queueRows, { totalRows: scanned });
  const outputs = await writeApiFillQueueOutputs({
    queueRows,
    summary,
    outDir: args.outDir,
  });

  console.error(`[full-db-api-fill-queue] scanned=${scanned}`);
  console.error(`[full-db-api-fill-queue] queued=${summary?.totals?.queued ?? 0}`);
  console.error(`[full-db-api-fill-queue] lane_a_hard_facts=${summary?.totals?.lane_a_hard_facts ?? 0}`);
  console.error(
    `[full-db-api-fill-queue] lane_b_soft_fields_supplement_like=${summary?.totals?.lane_b_soft_fields_supplement_like ?? 0}`,
  );
  console.error(
    `[full-db-api-fill-queue] lane_c_food_like_route_honesty=${summary?.totals?.lane_c_food_like_route_honesty ?? 0}`,
  );
  console.error(`[full-db-api-fill-queue] wrote ${outputs.files.summary}`);
  console.error(`[full-db-api-fill-queue] wrote ${outputs.files.markdown}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
