#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import dotenv from "dotenv";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const API_BASE_URL = process.env.API_BASE_URL || process.env.RENDER_BASE_URL || "http://127.0.0.1:3001";
const REGRESSION_TOKEN = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";
const SSE_TIMEOUT_MS = Math.max(8_000, Number(process.env.AUTH_FAIL_PROBE_SSE_TIMEOUT_MS || 30_000));
const FIXTURE_PATH = path.join(ROOT_DIR, "scripts", "maintainer", "fixtures", "authority_fail_samples.json");
const OUT_DIR = path.join(ROOT_DIR, "output", `authority-failure-probe-${Date.now()}`);

const readJson = async (filePath) => JSON.parse(await fs.promises.readFile(filePath, "utf8"));

const pickString = (...values) => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const parseSse = async (body) => {
  const reader = body?.getReader();
  if (!reader) {
    return {
      doneSeen: false,
      sourceType: null,
      terminalCode: null,
      reasonCode: null,
      authorityFailureReason: null,
      rev1Seen: false,
      revision1Ms: null,
      eventCount: 0,
    };
  }

  const start = performance.now();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = null;
  let currentData = "";
  let doneSeen = false;
  let sourceType = null;
  let terminalCode = null;
  let reasonCode = null;
  let authorityFailureReason = null;
  let rev1Seen = false;
  let revision1Ms = null;
  let eventCount = 0;

  const flush = () => {
    if (!currentEvent) return;
    const raw = currentData.trim();
    let payload = raw;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw;
      }
    }
    eventCount += 1;
    if (currentEvent === "analysis_bundle" && payload && typeof payload === "object") {
      const meta = payload?.meta ?? {};
      const revision = Number(meta?.revision);
      if (!rev1Seen && Number.isFinite(revision) && revision >= 1) {
        rev1Seen = true;
        revision1Ms = Math.round(performance.now() - start);
      }
      sourceType = pickString(meta?.sourceType, sourceType);
      authorityFailureReason = pickString(meta?.authorityFailureReason, authorityFailureReason);
    }
    if (currentEvent === "error" && payload && typeof payload === "object") {
      terminalCode = pickString(payload?.code, terminalCode, "ERROR");
      reasonCode = pickString(payload?.reasonCode, reasonCode);
      authorityFailureReason = pickString(payload?.authorityFailureReason, authorityFailureReason);
    }
    if (currentEvent === "done") {
      doneSeen = true;
      terminalCode = terminalCode || "DONE";
    }
    currentEvent = null;
    currentData = "";
  };

  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) {
        flush();
        if (doneSeen) break;
        continue;
      }
      if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
      if (line.startsWith("data:")) currentData += line.slice(5).trim();
    }
    if (doneSeen) break;
  }
  flush();
  return {
    doneSeen,
    sourceType,
    terminalCode,
    reasonCode,
    authorityFailureReason,
    rev1Seen,
    revision1Ms,
    eventCount,
  };
};

const probeOne = async (sample) => {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), SSE_TIMEOUT_MS);
  const headers = {
    "content-type": "application/json",
    "x-regression-token": REGRESSION_TOKEN,
    "x-regression-debug": "1",
    "x-authority-fail-mode": sample.mode,
  };
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(`${API_BASE_URL}/api/enrich-stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({ barcode: sample.barcode }),
      signal: ctrl.signal,
    });
    if (!response.ok) {
      return {
        sample,
        startedAt,
        completedAt: new Date().toISOString(),
        pass: false,
        httpStatus: response.status,
        error: `HTTP_${response.status}`,
      };
    }
    const parsed = await parseSse(response.body);
    const expected = sample.expectedAuthorityFailureReason;
    const got = parsed.authorityFailureReason;
    const pass = parsed.doneSeen && got === expected;
    return {
      sample,
      startedAt,
      completedAt: new Date().toISOString(),
      pass,
      httpStatus: response.status,
      sse: parsed,
      expectation: {
        expectedAuthorityFailureReason: expected,
        actualAuthorityFailureReason: got,
      },
    };
  } catch (error) {
    const abortError = error?.name === "AbortError";
    return {
      sample,
      startedAt,
      completedAt: new Date().toISOString(),
      pass: false,
      httpStatus: null,
      error: abortError ? "AbortError" : String(error?.message ?? error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const main = async () => {
  if (!REGRESSION_TOKEN) {
    throw new Error("REGRESSION token missing. Set RENDER_REGRESSION_TOKEN or REGRESSION_AUTH_TOKEN.");
  }
  const fixture = await readJson(FIXTURE_PATH);
  if (!Array.isArray(fixture) || fixture.length === 0) {
    throw new Error(`Fixture missing or empty: ${FIXTURE_PATH}`);
  }

  const results = [];
  for (const sample of fixture) {
    // eslint-disable-next-line no-await-in-loop
    const result = await probeOne(sample);
    results.push(result);
    console.log(
      `[authority-failure-probe] barcode=${sample.barcode} mode=${sample.mode} pass=${result.pass ? "yes" : "no"} reason=${result?.expectation?.actualAuthorityFailureReason ?? result.error ?? "none"}`,
    );
  }

  const passCount = results.filter((row) => row.pass).length;
  const failCount = results.length - passCount;
  const countsByExpected = {};
  const countsByActual = {};
  for (const row of results) {
    const expected = row?.sample?.expectedAuthorityFailureReason ?? "none";
    const actual = row?.expectation?.actualAuthorityFailureReason ?? row?.error ?? "none";
    countsByExpected[expected] = (countsByExpected[expected] ?? 0) + 1;
    countsByActual[actual] = (countsByActual[actual] ?? 0) + 1;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl: API_BASE_URL,
    total: results.length,
    passCount,
    failCount,
    passRate: results.length > 0 ? passCount / results.length : 0,
    countsByExpected,
    countsByActual,
  };

  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2), "utf8");
  await fs.promises.writeFile(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

  console.log(`[authority-failure-probe] wrote ${path.join(OUT_DIR, "results.json")}`);
  console.log(`[authority-failure-probe] wrote ${path.join(OUT_DIR, "summary.json")}`);
  console.log(
    `[authority-failure-probe] total=${summary.total} pass=${summary.passCount} fail=${summary.failCount} rate=${(summary.passRate * 100).toFixed(1)}%`,
  );

  if (failCount > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error("[authority-failure-probe] failed:", error);
  process.exit(1);
});
