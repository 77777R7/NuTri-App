#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_BARCODES = ["00029537001069", "026664275110", "00690290532093", "00678226014301", "000000000000"];
const baseUrl = process.env.RENDER_BASE_URL || "https://nutri-app-qn0u.onrender.com";
const barcodes = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_BARCODES;
const CAPTURE_WAIT_TIMEOUT_MS = Number(process.env.RENDER_CAPTURE_WAIT_TIMEOUT_MS || 10000);

const headers = {
  "Content-Type": "application/json",
  Accept: "text/event-stream",
};
if (process.env.RENDER_REGRESSION_TOKEN) {
  headers["x-regression-token"] = process.env.RENDER_REGRESSION_TOKEN;
} else {
  // Back-compat for non-production environments only.
  headers["x-auth-disabled"] = "1";
}

const isAbortLike = (error) => {
  if (!error) return false;
  const message = typeof error?.message === "string" ? error.message : String(error);
  const name = typeof error?.name === "string" ? error.name : "";
  return name === "AbortError" || /\btimeout\b|\babort(ed|ing)?\b/i.test(message);
};

const pickTerminalEvent = (events) =>
  [...events].reverse().find((item) => item?.event === "done" || item?.event === "finalize") ?? null;

async function fetchSse(url, payload, timeoutMs = 25000) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const events = [];

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`SSE request failed: ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;
    let currentData = "";

    const flushEvent = () => {
      if (!currentEvent) return;
      const data = currentData.trim();
      if (!data) {
        currentEvent = null;
        currentData = "";
        return;
      }
      try {
        events.push({ event: currentEvent, data: JSON.parse(data) });
      } catch {
        events.push({ event: currentEvent, data });
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
    return {
      events,
      timedOut,
      error: null,
      lastEvent: events.length ? events[events.length - 1].event : null,
      terminalEvent: pickTerminalEvent(events)?.event ?? null,
    };
  } catch (error) {
    if (timedOut || isAbortLike(error)) {
      return {
        events,
        timedOut: true,
        error: error instanceof Error ? error.message : String(error),
        lastEvent: events.length ? events[events.length - 1].event : null,
        terminalEvent: pickTerminalEvent(events)?.event ?? null,
      };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function pickBundle(events) {
  const bundles = events.filter((e) => e.event === "analysis_bundle").map((e) => e.data);
  if (!bundles.length) return null;
  const fast = [...bundles].reverse().find((b) => b?.meta?.phase === "fast_ai");
  return fast ?? bundles[bundles.length - 1];
}

function summarizeBundle(bundle) {
  if (!bundle) return null;
  const { meta, sections } = bundle;
  return {
    meta,
    overview: sections?.overview,
    ingredients: sections?.ingredients,
    usage: sections?.usage,
    safety: sections?.safety,
  };
}

async function fetchDetail(bundle) {
  const meta = bundle?.meta;
  if (!meta?.authoritativeIdentity || !meta?.factsDigestHash) return null;
  const payload = {
    identity: meta.authoritativeIdentity,
    section: "ingredients_detail",
    locale: meta.locale || "en",
    promptVersion: meta.promptVersion,
    factsDigestHash: meta.factsDigestHash,
    limit: 6,
    cursor: 0,
  };
  const res = await fetch(`${baseUrl}/api/analysis-section`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  return { status: res.status, data };
}

function inferKbUsage(detailData) {
  const meta = detailData?.meta || {};
  if (meta.fallbackUsed === "kb_dsld") return true;
  const sentenceIds = detailData?.debug?.formSentenceIds;
  if (!sentenceIds || typeof sentenceIds !== "object") return false;
  return Object.values(sentenceIds).some((v) => typeof v === "string" && v.startsWith("s_"));
}

async function run() {
  for (const barcode of barcodes) {
    console.log(`\\n=== Barcode ${barcode} ===`);
    const sse = await fetchSse(`${baseUrl}/api/enrich-stream`, { barcode }, CAPTURE_WAIT_TIMEOUT_MS);
    if (!sse.terminalEvent) {
      console.log(
        JSON.stringify(
          {
            status: "capture_failed_timeout",
            timedOut: sse.timedOut,
            timeoutMs: CAPTURE_WAIT_TIMEOUT_MS,
            lastEvent: sse.lastEvent ?? null,
            error: sse.error ?? null,
          },
          null,
          2,
        ),
      );
      continue;
    }
    const bundle = pickBundle(sse.events);
    if (!bundle) {
      console.log("No analysis_bundle received.");
      continue;
    }
    const summary = summarizeBundle(bundle);
    console.log("analysis_bundle summary:");
    console.log(JSON.stringify(summary, null, 2));

    const detailRes = await fetchDetail(bundle);
    if (!detailRes) {
      console.log("detail: unavailable (missing meta)");
      continue;
    }
    console.log("\\nanalysis-section response:");
    console.log(JSON.stringify(detailRes, null, 2));

    const kbUsed = inferKbUsage(detailRes.data);
    console.log(`\\nKB likely used: ${kbUsed ? "YES" : "NO"}`);
  }
}

run().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
