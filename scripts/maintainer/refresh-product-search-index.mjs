#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "../..");

dotenv.config({ path: path.join(ROOT_DIR, ".env") });
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env"), override: false });

const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const startedAt = performance.now();
const batchSize = Number.parseInt(process.env.SEARCH_INDEX_REFRESH_BATCH_SIZE ?? "1000", 10);
const safeBatchSize = Number.isFinite(batchSize) && batchSize > 0 ? Math.min(batchSize, 2000) : 1000;
const maxBatches = Number.parseInt(process.env.SEARCH_INDEX_REFRESH_MAX_BATCHES ?? "200", 10);
const safeMaxBatches = Number.isFinite(maxBatches) && maxBatches > 0 ? maxBatches : 200;
const shouldRunProbes = process.env.SEARCH_INDEX_REFRESH_PROBES !== "0";
const probeTerms = (process.env.SEARCH_INDEX_PROBE_TERMS ?? "magnesium,vitamin d,omega 3,probiotic,ashwagandha")
  .split(",")
  .map((term) => term.trim().toLowerCase())
  .filter(Boolean)
  .slice(0, 8);

const PRODUCT_SEARCH_INDEX_PROBE_SELECT =
  "id,product_id,brand_name,title,quality_rank,brand_popularity,source_updated_at";
const POPULAR_FALLBACK_BRANDS = [
  "Swanson",
  "NOW Foods",
  "Nutricost",
  "Solgar",
  "Solaray",
  "Source Naturals",
  "California Gold Nutrition",
  "Nature's Way",
  "Nature Made",
  "Nature's Bounty",
  "Healthy Origins",
  "Pure Encapsulations",
  "Carlson",
  "Garden of Life",
  "Nordic Naturals",
  "Sports Research",
  "Natrol",
  "Centrum",
  "Qunol",
];
const SIGNAL_PROBES = [
  { label: "signal_magnesium", families: ["magnesium"] },
  { label: "signal_vitamin_d", families: ["vitamin_d"] },
  { label: "signal_omega_3", families: ["omega_3"] },
  { label: "signal_probiotic", families: ["probiotic"] },
  { label: "signal_ashwagandha", families: ["ashwagandha"] },
];

const orderRuntimeSearchIndexQuery = (query) =>
  query
    .order("quality_rank", { ascending: false })
    .order("brand_popularity", { ascending: false })
    .order("source_updated_at", { ascending: false, nullsFirst: false });

const runTimedProbe = async (label, buildQuery) => {
  const probeStartedAt = performance.now();
  const { data, error } = await buildQuery();
  if (error) {
    throw new Error(`${label} probe failed: ${error.message}`);
  }
  return {
    label,
    rows: Array.isArray(data) ? data.length : 0,
    durationMs: Math.round(performance.now() - probeStartedAt),
  };
};

const runProductSearchIndexProbes = async () => {
  if (!shouldRunProbes) return [];

  const probes = [];
  probes.push(
    await runTimedProbe("popular_brand_bootstrap", () =>
      orderRuntimeSearchIndexQuery(
        supabase
          .from("product_search_index")
          .select(PRODUCT_SEARCH_INDEX_PROBE_SELECT)
          .in("brand_name", POPULAR_FALLBACK_BRANDS),
      ).limit(320),
    ),
  );

  for (const term of probeTerms) {
    probes.push(
      await runTimedProbe(`query_${term.replace(/[^a-z0-9]+/g, "_")}`, () =>
        orderRuntimeSearchIndexQuery(
          supabase
            .from("product_search_index")
            .select(PRODUCT_SEARCH_INDEX_PROBE_SELECT)
            .ilike("search_text", `%${term}%`),
        ).limit(220),
      ),
    );
  }

  for (const probe of SIGNAL_PROBES) {
    probes.push(
      await runTimedProbe(probe.label, () =>
        orderRuntimeSearchIndexQuery(
          supabase
            .from("product_search_index")
            .select(PRODUCT_SEARCH_INDEX_PROBE_SELECT)
            .overlaps("ingredient_families", probe.families),
        ).limit(120),
      ),
    );
  }

  return probes;
};

let refreshedRows = 0;
let afterId = 0;
let batches = 0;
let done = false;

while (!done) {
  if (batches >= safeMaxBatches) {
    throw new Error(`refresh_product_search_index_batch exceeded ${safeMaxBatches} batches.`);
  }

  const { data, error } = await supabase.rpc("refresh_product_search_index_batch", {
    p_after_id: afterId,
    p_batch_size: safeBatchSize,
  });
  if (error) {
    throw new Error(`refresh_product_search_index_batch failed: ${error.message}`);
  }

  const batch = Array.isArray(data) ? data[0] : data;
  const processedCount = Number(batch?.processed_count ?? 0);
  const lastOverlayId = Number(batch?.last_overlay_id ?? afterId);
  done = Boolean(batch?.done);

  if (processedCount > 0 && lastOverlayId <= afterId) {
    throw new Error(`refresh_product_search_index_batch did not advance past overlay id ${afterId}.`);
  }

  refreshedRows += processedCount;
  afterId = lastOverlayId;
  batches += 1;

  if (batches % 10 === 0 || done) {
    console.error(
      JSON.stringify({
        stage: "refresh_product_search_index_batch",
        batches,
        refreshedRows,
        lastOverlayId,
        done,
      }),
    );
  }
}

const { data: prunedRows, error: pruneError } = await supabase.rpc("prune_product_search_index");
if (pruneError) {
  throw new Error(`prune_product_search_index failed: ${pruneError.message}`);
}

const { count: indexedRows, error: countError } = await supabase
  .from("product_search_index")
  .select("*", { head: true, count: "exact" });
if (countError) {
  throw new Error(`product_search_index count failed: ${countError.message}`);
}

const probes = await runProductSearchIndexProbes();
const { refreshPersistedProductSearchHomeBootstrap } = await import(
  "../../backend/src/productSearch.ts"
);
const homeBootstrap = await refreshPersistedProductSearchHomeBootstrap();
const homeCategories = Object.keys(homeBootstrap.categories).length;

console.log(
  JSON.stringify(
    {
      refreshedRows,
      prunedRows,
      indexedRows: indexedRows ?? 0,
      homeCategories,
      batches,
      batchSize: safeBatchSize,
      probes,
      durationMs: Math.round(performance.now() - startedAt),
    },
    null,
    2,
  ),
);
