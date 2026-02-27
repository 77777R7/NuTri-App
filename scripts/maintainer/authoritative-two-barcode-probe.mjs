#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();

const args = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const exact = args.find((entry) => entry.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
};

const label = String(arg("--label", "before") || "before").trim().toLowerCase();
const roundsPerBarcode = Math.max(1, Number(arg("--rounds", "10")) || 10);
const timeoutMs = Math.max(1000, Number(arg("--timeout-ms", "12000")) || 12000);
const outDirArg = String(arg("--out-dir", "") || "").trim();
const apiBaseUrl = String(arg("--api-base-url", process.env.API_BASE_URL || "http://127.0.0.1:3001")).trim();
const apiUrl = `${apiBaseUrl.replace(/\/$/, "")}/api/enrich-stream`;
const barcodesArg = String(arg("--barcodes", "023249090021,029537001069")).trim();
const barcodes = barcodesArg
  .split(",")
  .map((value) => value.replace(/\D/g, ""))
  .filter((value) => value.length >= 8)
  .map((value) => (value.length >= 14 ? value.slice(-14) : value.padStart(14, "0")));

const outDir = (() => {
  if (outDirArg) return path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
  return path.join(ROOT_DIR, "output", `v1.6.8-authoritative-${label}`);
})();

const parseSseFrames = (text) => {
  const frames = [];
  const chunks = text.split(/\n\n+/);
  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/);
    let event = null;
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!event) continue;
    const raw = dataLines.join("");
    let data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
    }
    frames.push({ event, data });
  }
  return frames;
};

const countBy = (rows, keyFn) => {
  const out = {};
  for (const row of rows) {
    const key = keyFn(row) ?? "null";
    out[key] = (out[key] || 0) + 1;
  }
  return out;
};

const summarizeRows = (rows) => {
  const doneSeenRate = rows.length ? rows.filter((row) => row.doneSeen).length / rows.length : 0;
  const finalTrueRate = rows.length
    ? rows.filter((row) => row.rev1SourceTypeFinal === true).length / rows.length
    : 0;
  return {
    attempts: rows.length,
    doneSeenRate: Number(doneSeenRate.toFixed(3)),
    rev1SourceTypeCounts: countBy(rows, (row) => row.rev1SourceType),
    rev1SourceTypeFinalTrueRate: Number(finalTrueRate.toFixed(3)),
    terminalReasonCounts: countBy(rows, (row) => row.terminalReason),
    degradedWebBudgetCount: rows.filter((row) => row.degradedWebBudget).length,
  };
};

const runAttempt = async ({ barcode, round }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-auth-disabled": "1",
      },
      body: JSON.stringify({ barcode }),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    const frames = parseSseFrames(bodyText);
    const rev1 = frames.find(
      (frame) =>
        frame.event === "analysis_bundle" &&
        frame.data &&
        typeof frame.data === "object" &&
        frame.data.meta?.revision === 1,
    )?.data ?? null;
    const done = frames.find((frame) => frame.event === "done")?.data ?? null;
    const errors = frames
      .filter((frame) => frame.event === "error")
      .map((frame) => frame.data ?? null);
    const degradedWebBudget =
      errors.some((error) => error && error.reasonCode === "DEGRADED_WEB_BUDGET") ||
      done?.terminalReason === "DEGRADED_WEB_BUDGET";

    return {
      barcode,
      round,
      ok: true,
      status: response.status,
      requestId: response.headers.get("x-request-id") ?? null,
      elapsedMs: Date.now() - startedAt,
      rev1SourceType: rev1?.meta?.sourceType ?? null,
      rev1SourceTypeFinal:
        typeof rev1?.meta?.sourceTypeFinal === "boolean" ? rev1.meta.sourceTypeFinal : null,
      rev1IdentityType: rev1?.meta?.authoritativeIdentity?.type ?? null,
      rev1IdentityValue: rev1?.meta?.authoritativeIdentity?.value ?? null,
      stage0Winner: rev1?.meta?.stage0Winner ?? done?.stage0Winner ?? null,
      doneSeen: Boolean(done),
      doneReason: done?.reason ?? null,
      terminalReason: done?.terminalReason ?? null,
      errorReasonCodes: errors
        .map((error) => error?.reasonCode ?? error?.code ?? null)
        .filter(Boolean),
      degradedWebBudget,
      webParseProfile: done?.webParseProfile ?? null,
      eventCounts: countBy(frames, (frame) => frame.event),
    };
  } catch (error) {
    return {
      barcode,
      round,
      ok: false,
      requestId: null,
      elapsedMs: Date.now() - startedAt,
      error: error?.name === "AbortError" ? "CLIENT_TIMEOUT" : String(error?.message || error),
      rev1SourceType: null,
      rev1SourceTypeFinal: null,
      rev1IdentityType: null,
      rev1IdentityValue: null,
      stage0Winner: null,
      doneSeen: false,
      doneReason: null,
      terminalReason: null,
      errorReasonCodes: [error?.name === "AbortError" ? "CLIENT_TIMEOUT" : "REQUEST_ERROR"],
      degradedWebBudget: false,
      webParseProfile: null,
      eventCounts: {},
    };
  } finally {
    clearTimeout(timer);
  }
};

const buildMarkdown = ({ payload }) => {
  const lines = [
    `# v1.6.8 authoritative probe (${label})`,
    "",
    `- generatedAt: ${payload.generatedAt}`,
    `- apiUrl: ${payload.apiUrl}`,
    `- roundsPerBarcode: ${payload.roundsPerBarcode}`,
    "",
    "## Summary",
    "",
  ];
  for (const barcode of payload.barcodes) {
    const summary = payload.summary?.[barcode] ?? {};
    lines.push(
      `- ${barcode}: doneSeenRate=${summary.doneSeenRate}, rev1SourceTypeCounts=${JSON.stringify(summary.rev1SourceTypeCounts || {})}, rev1SourceTypeFinalTrueRate=${summary.rev1SourceTypeFinalTrueRate}, degradedWebBudgetCount=${summary.degradedWebBudgetCount}, terminalReasonCounts=${JSON.stringify(summary.terminalReasonCounts || {})}`,
    );
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  if (barcodes.length === 0) {
    throw new Error("No valid barcodes provided");
  }

  const attempts = [];
  for (const barcode of barcodes) {
    for (let round = 1; round <= roundsPerBarcode; round += 1) {
      const result = await runAttempt({ barcode, round });
      attempts.push(result);
      console.error(
        `[probe:${label}] ${barcode} #${round} rev1=${result.rev1SourceType ?? "null"} final=${result.rev1SourceTypeFinal ?? "null"} terminal=${result.terminalReason ?? "null"} degraded=${result.degradedWebBudget ? "yes" : "no"}`,
      );
    }
  }

  const summary = Object.fromEntries(
    barcodes.map((barcode) => [barcode, summarizeRows(attempts.filter((row) => row.barcode === barcode))]),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    label,
    apiUrl,
    roundsPerBarcode,
    timeoutMs,
    barcodes,
    summary,
    attempts,
  };

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "probe.json"), JSON.stringify(payload, null, 2));
  await fs.writeFile(path.join(outDir, "probe.md"), buildMarkdown({ payload }));

  console.log(
    JSON.stringify(
      {
        outDir,
        summary,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[authoritative-two-barcode-probe] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
