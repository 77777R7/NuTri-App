#!/usr/bin/env node
/* eslint-disable no-console */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT_DIR = process.cwd();
const OUT_DIR = (() => {
  const override = process.env.BULK_E2E_OUT_DIR ? String(process.env.BULK_E2E_OUT_DIR) : "";
  if (!override.trim()) return path.join(ROOT_DIR, "output", `bulk-barcode-e2e-${Date.now()}`);
  return path.isAbsolute(override) ? override : path.join(ROOT_DIR, override);
})();

dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const API_BASE_URL = process.env.API_BASE_URL || process.env.RENDER_BASE_URL || "http://127.0.0.1:3001";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BULK_E2E_UPSERT_MAP =
  process.env.BULK_E2E_UPSERT_MAP === "1" || process.env.BULK_E2E_UPSERT_MAP === "true";
const REGRESSION_TOKEN = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";

const headers = {
  "Content-Type": "application/json",
  Accept: "text/event-stream",
};
if (REGRESSION_TOKEN) {
  headers["x-regression-token"] = REGRESSION_TOKEN;
} else {
  // Local/dev back-compat: do not require auth for maintainer testing.
  headers["x-auth-disabled"] = "1";
}

function toGtin14(digits) {
  const d = String(digits).replace(/\D/g, "");
  if (d.length === 14) return d;
  if (d.length === 13) return `0${d}`;
  if (d.length === 12) return `00${d}`;
  return null;
}

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

async function ensureDir(p) {
  await fs.promises.mkdir(p, { recursive: true });
}

async function fetchSse(url, payload, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: ctrl.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SSE request failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = null;
  let currentData = "";
  const events = [];

  const flushEvent = () => {
    if (!currentEvent) return;
    const data = currentData.trim();
    if (!data) {
      currentEvent = null;
      currentData = "";
      return;
    }
    const tMs = Date.now() - start;
    try {
      events.push({ tMs, event: currentEvent, data: JSON.parse(data) });
    } catch {
      events.push({ tMs, event: currentEvent, data });
    }
    currentEvent = null;
    currentData = "";
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        flushEvent();
        continue;
      }
      if (line.startsWith("event:")) {
        currentEvent = line.replace("event:", "").trim();
      } else if (line.startsWith("data:")) {
        currentData += line.replace("data:", "").trim();
      }
    }
  }

  flushEvent();
  clearTimeout(timeout);
  return events;
}

function pickBundles(events) {
  const bundles = events
    .filter((e) => e.event === "analysis_bundle" && e.data && typeof e.data === "object")
    .map((e) => ({ tMs: e.tMs, bundle: e.data }));
  const rev0 = bundles.find((b) => b.bundle?.meta?.revision === 0) || null;
  const rev1 = bundles.find((b) => b.bundle?.meta?.revision === 1) || null;
  const best = [...bundles].reverse().find((b) => b.bundle?.meta?.phase === "fast_ai") || null;
  return { rev0, rev1, best };
}

function summarizeBundle(bundle) {
  const meta = bundle?.meta || null;
  const sections = bundle?.sections || {};
  return {
    meta,
    sections: {
      overview: {
        dataStatus: sections?.overview?.dataStatus ?? null,
        cover: sections?.overview?.cover ?? null,
      },
      ingredients: {
        dataStatus: sections?.ingredients?.dataStatus ?? null,
        cover: sections?.ingredients?.cover ?? null,
      },
      usage: {
        dataStatus: sections?.usage?.dataStatus ?? null,
        cover: sections?.usage?.cover ?? null,
      },
      safety: {
        dataStatus: sections?.safety?.dataStatus ?? null,
        cover: sections?.safety?.cover ?? null,
      },
    },
  };
}

async function fetchIngredientsDetail(meta, limit = 6, cursor = 0) {
  if (!meta?.authoritativeIdentity || !meta?.factsDigestHash) {
    return { status: 0, data: null, timingMs: 0 };
  }
  const payload = {
    identity: meta.authoritativeIdentity,
    section: "ingredients_detail",
    locale: meta.locale || "en",
    promptVersion: meta.promptVersion,
    factsDigestHash: meta.factsDigestHash,
    limit,
    cursor,
  };
  const t0 = Date.now();
  const res = await fetch(`${API_BASE_URL}/api/analysis-section`, {
    method: "POST",
    headers: { ...headers, Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const timingMs = Date.now() - t0;
  const data = await res.json().catch(() => null);
  return { status: res.status, data, timingMs };
}

function safePick(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== "object") return null;
    cur = cur[k];
  }
  return cur ?? null;
}

async function upsertBarcodeMapForCanada(caItems) {
  if (!BULK_E2E_UPSERT_MAP) {
    return { inserted: 0, skipped: caItems.length, mode: "disabled" };
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[bulk-e2e] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing; skipping map upserts.");
    return { inserted: 0, skipped: caItems.length, mode: "missing_env" };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();

  let inserted = 0;
  for (const it of caItems) {
    const gtin14 = toGtin14(it.barcode);
    if (!gtin14) continue;
    const record = {
      barcode_gtin14: gtin14,
      barcode_raw: String(it.barcode),
      npn: String(it.npn),
      confidence: 0.95,
      source: "bulk_e2e_manual",
      last_seen_at: now.toISOString(),
      expires_at: expiresAt,
      updated_at: now.toISOString(),
    };
    // eslint-disable-next-line no-await-in-loop
    const { error } = await supabase.from("barcode_regulatory_map").upsert(record, { onConflict: "barcode_gtin14" });
    if (!error) inserted += 1;
  }
  return { inserted, skipped: caItems.length - inserted, mode: "enabled" };
}

function buildTestSet() {
  const ca = [
    { barcode: "628747100045", npn: "80062961", url: "https://newrootsherbal.com/shop/acidophilus-ultra-11-billion" },
    { barcode: "628747200097", npn: "80036596", url: "https://newrootsherbal.com/shop/grapefruit-seed-extract-liquid-concentrate" },
    { barcode: "628747100113", npn: "80021829", url: "https://newrootsherbal.com/shop/super-fibre-psyllium-capsules" },
    { barcode: "628747100168", npn: "80100520", url: "https://newrootsherbal.com/shop/prolax" },
    { barcode: "628747100212", npn: "80066778", url: "https://newrootsherbal.com/shop/candida-stop" },
    { barcode: "628747100229", npn: "80041615", url: "https://newrootsherbal.com/shop/caprylic-acid-plus" },
    { barcode: "628747200264", npn: "80044382", url: "https://newrootsherbal.com/shop/pau-darco-taheebo-liquid-extract" },
    { barcode: "628747000277", npn: "80106954", url: "https://newrootsherbal.com/shop/vitamin-c-crystals" },
    { barcode: "628747000307", npn: "80066047", url: "https://newrootsherbal.com/shop/vitamin-c-calcium-ascorbate-crystals" },
    { barcode: "628747000567", npn: "80030361", url: "https://newrootsherbal.com/shop/ultra-max-36-billion" },
    { barcode: "628747100892", npn: "80021987", url: "https://newrootsherbal.com/shop/taurine" },
    { barcode: "628747108652", npn: "80010311", url: "https://newrootsherbal.com/shop/l-glutamine-capsules" },
    { barcode: "628747101240", npn: "80043836", url: "https://newrootsherbal.com/shop/pau-darco-taheebo-capsules" },
    { barcode: "628747201308", npn: "80035939", url: "https://newrootsherbal.com/shop/black-cumin-seed-oil-softgels-500-mg" },
    { barcode: "628747101486", npn: "80017685", url: "https://newrootsherbal.com/shop/l-methionine" },
  ];

  const us = [
    { barcode: "00883196120819", dsldLabelId: "264429", brand: "Genestra Brands", name: "Phyto-Gen Imu-gen" },
    { barcode: "00064435131173", dsldLabelId: "281185", brand: "TerraVita", name: "Mallow (Malva sylvestris) Flower Mint Flavor" },
    { barcode: "00649908268756", dsldLabelId: "329337", brand: "NutraBio", name: "KSM-66 Ashwagandha" },
    { barcode: "00074312131851", dsldLabelId: "62057", brand: "Nature's Bounty", name: "SAM-e 400 mg" },
    { barcode: "00819209022184", dsldLabelId: "251767", brand: "AN Amazing Nutrition", name: "Amazing Omega Norwegian Fish Oil 1,000 mg Fresh Lemon Flavor" },
    { barcode: "00818423021065", dsldLabelId: "207107", brand: "BIOVEA", name: "Biotin 500 mcg" },
    { barcode: "00035046009144", dsldLabelId: "7444", brand: "Windmill", name: "Super Omega 3 EPA/DHA Formula" },
    { barcode: "00782932123261", dsldLabelId: "29906", brand: "Flower Essence Services", name: "Lupine Flower Essence" },
    { barcode: "00064435130763", dsldLabelId: "287952", brand: "TerraVita", name: "Shiitake and Reishi Mushroom Combination Powder" },
    { barcode: "00812259003042", dsldLabelId: "260939", brand: "Quality of Life", name: "Allerfin" },
    { barcode: "00367703180065", dsldLabelId: "202305", brand: "Terry Naturally", name: "BioActive Vitamin B" },
    { barcode: "00850002207323", dsldLabelId: "307265", brand: "Kion", name: "Omega" },
    { barcode: "00851005007163", dsldLabelId: "229055", brand: "Racked", name: "BCAA Blood Raz" },
    { barcode: "00851335007154", dsldLabelId: "256558", brand: "Organixx", name: "T-Plexx" },
    { barcode: "00084783891253", dsldLabelId: "200338", brand: "Christopher's Original Formulas", name: "Herbal Iron Formula" },
  ];

  return { ca, us };
}

async function runOne(item) {
  const barcodeGtin14 = toGtin14(item.barcode) || String(item.barcode);
  const events = await fetchSse(`${API_BASE_URL}/api/enrich-stream`, { barcode: barcodeGtin14 });
  const { rev0, rev1, best } = pickBundles(events);
  const fastBundle = (best?.bundle || rev1?.bundle || rev0?.bundle) ?? null;

  const sse = {
    barcode: barcodeGtin14,
    sseEventCount: events.length,
    tRevision0Ms: rev0?.tMs ?? null,
    tRevision1Ms: rev1?.tMs ?? null,
    meta: fastBundle?.meta ?? null,
    bundleSummary: summarizeBundle(fastBundle),
    snapshotNpn: (() => {
      const snap = events.find((e) => e.event === "snapshot")?.data;
      return safePick(snap, ["regulatory", "npn"]);
    })(),
  };

  const meta = fastBundle?.meta || null;
  const ingredientsCover = safePick(fastBundle, ["sections", "ingredients", "cover"]);
  const totalCount = Number(ingredientsCover?.totalCount ?? 0);
  const shouldFetchDetail = totalCount > 0 && meta?.authoritativeIdentity && meta?.factsDigestHash;

  const detail = shouldFetchDetail ? await fetchIngredientsDetail(meta, 6, 0) : { status: 0, data: null, timingMs: 0 };

  return {
    input: item,
    sse,
    detail,
  };
}

async function main() {
  await ensureDir(OUT_DIR);
  const { ca, us } = buildTestSet();

  const mapRes = await upsertBarcodeMapForCanada(ca);
  console.log(`[bulk-e2e] API_BASE_URL=${API_BASE_URL}`);
  console.log(
    `[bulk-e2e] CA map upserts mode=${mapRes.mode} inserted=${mapRes.inserted} skipped=${mapRes.skipped}`,
  );

  const all = [
    ...ca.map((x) => ({ ...x, country: "CA" })),
    ...us.map((x) => ({ ...x, country: "US" })),
  ];

  const results = [];
  for (const it of all) {
    console.log(`[bulk-e2e] scanning ${it.country} ${it.barcode} ...`);
    // eslint-disable-next-line no-await-in-loop
    const r = await runOne(it).catch((err) => ({ input: it, error: String(err) }));
    results.push(r);
    await fs.promises.writeFile(path.join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
  }

  // lightweight summary
  const summary = results.map((r) => {
    const meta = r?.sse?.meta || null;
    const detailData = r?.detail?.data || null;
    return {
      country: r?.input?.country || null,
      barcode: r?.sse?.barcode || r?.input?.barcode || null,
      expectedNpn: r?.input?.npn || null,
      expectedDsldLabelId: r?.input?.dsldLabelId || null,
      sourceType: meta?.sourceType || null,
      identityType: meta?.authoritativeIdentity?.type || null,
      identityValue: meta?.authoritativeIdentity?.value || null,
      factsDigestHash: meta?.factsDigestHash || null,
      revision0Ms: r?.sse?.tRevision0Ms ?? null,
      revision1Ms: r?.sse?.tRevision1Ms ?? null,
      ingredientsTotal: safePick(r?.sse, ["bundleSummary", "sections", "ingredients", "cover", "totalCount"]) ?? null,
      detailStatus: r?.detail?.status ?? null,
      detailDataStatus: detailData?.dataStatus ?? null,
      detailTimingMs: r?.detail?.timingMs ?? null,
      detailFallbackUsed: safePick(detailData, ["meta", "fallbackUsed"]) ?? null,
      error: r?.error || null,
    };
  });

  const summaryPath = path.join(OUT_DIR, "summary.json");
  await fs.promises.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`[bulk-e2e] wrote ${summaryPath}`);

  // Print compact table to stdout
  console.log("\ncountry\tbarcode\tsource\tidentity\tingredients\tdetailStatus\tdetailDataStatus\tdetailMs\tfallback");
  for (const row of summary) {
    console.log(
      [
        row.country,
        row.barcode,
        row.sourceType,
        `${row.identityType || ""}:${row.identityValue || ""}`,
        row.ingredientsTotal,
        row.detailStatus,
        row.detailDataStatus,
        row.detailTimingMs,
        row.detailFallbackUsed || "",
      ].join("\t"),
    );
  }

  // Basic stats
  const bySource = {};
  for (const row of summary) {
    const key = row.sourceType || "unknown";
    bySource[key] = (bySource[key] || 0) + 1;
  }
  console.log("\n[bulk-e2e] counts by sourceType:", bySource);
  console.log(`[bulk-e2e] results dir: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error("bulk-e2e failed:", err);
  process.exit(1);
});
