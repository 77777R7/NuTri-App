#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const baseUrl = String(getArg("base-url", "http://127.0.0.1:3001")).replace(/\/+$/, "");
const outDir = getArg("out-dir", path.join(ROOT, "output", "demo5_iherb"));
const outJson = getArg("out-json", path.join(outDir, "identity_stability_report.json"));
const outMd = getArg("out-md", path.join(outDir, "identity_stability_report.md"));
const attempts = Math.max(1, Number(getArg("attempts", "20")) || 20);
const timeoutMs = Math.max(5000, Number(getArg("timeout-ms", "32000")) || 32000);
const authDisabledHeader = String(getArg("auth-disabled-header", "1")).trim() === "1";

const samples = [
  { barcode: "00023249090021", label: "Sports Research Vitamin C" },
  { barcode: "00737870212539", label: "Life Extension Florassist GI" },
  { barcode: "00023249012566", label: "Sports Research Astaxanthin" },
  { barcode: "00853919008236", label: "Codeage A-D-K" },
];

const isAbortLike = (error) => {
  const name = typeof error?.name === "string" ? error.name : "";
  const message = typeof error?.message === "string" ? error.message : String(error ?? "");
  return name === "AbortError" || /\btimeout\b|\babort(ed|ing)?\b/i.test(message);
};

const fetchSse = async (url, payload, timeoutMsValue = 25000) => {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMsValue);
  const events = [];
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...(authDisabledHeader ? { "X-Auth-Disabled": "1" } : {}),
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`SSE request failed: ${res.status}`);
    if (!res.body) throw new Error("SSE response body missing");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let currentEvent = null;
    let currentData = "";
    let buffer = "";
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
    return { events, timedOut, error: null };
  } catch (error) {
    if (timedOut || isAbortLike(error)) {
      return { events, timedOut: true, error: error instanceof Error ? error.message : String(error) };
    }
    return { events, timedOut: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
};

const pickBundle = (events) => {
  const bundles = events
    .filter((event) => event?.event === "analysis_bundle" && event?.data && typeof event.data === "object")
    .map((event) => event.data);
  if (!bundles.length) return null;
  const rev1 = [...bundles].reverse().find((bundle) => bundle?.meta?.revision === 1);
  return rev1 ?? bundles[bundles.length - 1];
};

const identityKeyFromBundle = (bundle) => {
  const type = String(bundle?.meta?.authoritativeIdentity?.type ?? "").trim();
  const value = String(bundle?.meta?.authoritativeIdentity?.value ?? "").trim();
  if (!type || !value) return null;
  return `${type}:${value}`;
};

const runSample = async (sample) => {
  const rows = [];
  for (let i = 0; i < attempts; i += 1) {
    const sse = await fetchSse(`${baseUrl}/api/enrich-stream`, { barcode: sample.barcode }, timeoutMs);
    const bundle = pickBundle(sse.events);
    const identityKey = identityKeyFromBundle(bundle);
    const sourceType = String(bundle?.meta?.sourceType ?? "").trim() || null;
    const sourceTypeFinal = bundle?.meta?.sourceTypeFinal !== false;
    rows.push({
      attempt: i + 1,
      ok: Boolean(bundle),
      identityKey,
      sourceType,
      sourceTypeFinal,
      timedOut: sse.timedOut,
      error: sse.error,
    });
  }

  const identitySet = new Set(rows.map((row) => row.identityKey).filter(Boolean));
  const sourceSet = new Set(rows.map((row) => row.sourceType).filter(Boolean));
  const allFinal = rows.every((row) => row.sourceTypeFinal === true);
  const noErrors = rows.every((row) => !row.error);

  return {
    barcode: sample.barcode,
    label: sample.label,
    attempts,
    stableIdentity: identitySet.size === 1,
    stableSourceType: sourceSet.size === 1,
    allSourceTypeFinal: allFinal,
    noErrors,
    seenIdentityKeys: Array.from(identitySet),
    seenSourceTypes: Array.from(sourceSet),
    status:
      identitySet.size === 1 && sourceSet.size === 1 && allFinal
        ? "pass"
        : "identity_unstable_no_go",
    attemptsDetail: rows,
  };
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# Demo5 Identity Stability Report");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- baseUrl: ${report.baseUrl}`);
  lines.push(`- attemptsPerBarcode: ${report.attemptsPerBarcode}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- total: ${report.summary.total}`);
  lines.push(`- pass: ${report.summary.pass}`);
  lines.push(`- noGo: ${report.summary.noGo}`);
  lines.push("");

  lines.push("## Products");
  lines.push("");
  report.products.forEach((row, idx) => {
    lines.push(`${idx + 1}. ${row.label} (${row.barcode})`);
    lines.push(`   - status: ${row.status}`);
    lines.push(`   - stableIdentity: ${row.stableIdentity}`);
    lines.push(`   - stableSourceType: ${row.stableSourceType}`);
    lines.push(`   - allSourceTypeFinal: ${row.allSourceTypeFinal}`);
    lines.push(`   - seenIdentityKeys: ${row.seenIdentityKeys.join(", ") || "none"}`);
    lines.push(`   - seenSourceTypes: ${row.seenSourceTypes.join(", ") || "none"}`);
  });

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(outDir, { recursive: true });
  const products = [];
  for (const sample of samples) {
    products.push(await runSample(sample));
  }

  const summary = {
    total: products.length,
    pass: products.filter((row) => row.status === "pass").length,
    noGo: products.filter((row) => row.status !== "pass").length,
  };

  const report = {
    schemaVersion: "demo5_identity_stability.v1",
    generatedAt: new Date().toISOString(),
    baseUrl,
    attemptsPerBarcode: attempts,
    summary,
    products,
  };

  await fs.writeFile(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(outMd, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: summary.noGo === 0,
        summary,
        output: {
          outJson,
          outMd,
        },
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
