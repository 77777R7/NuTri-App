#!/usr/bin/env node
/* eslint-disable no-console */

const DEFAULT_PROBE_BARCODE = "00029537001069";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 15 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;

const baseUrl = process.env.RENDER_BASE_URL;
const expectedSha = process.env.EXPECTED_COMMIT_SHA || process.env.GITHUB_SHA;
const probeBarcode = process.env.RENDER_COMMIT_PROBE_BARCODE || DEFAULT_PROBE_BARCODE;
const timeoutMs = Number(process.env.RENDER_DEPLOY_WAIT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
const intervalMs = Number(process.env.RENDER_DEPLOY_WAIT_INTERVAL_MS || DEFAULT_INTERVAL_MS);
const requestTimeoutMs = Number(process.env.RENDER_DEPLOY_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS);

if (!baseUrl) {
  console.error("RENDER_BASE_URL is required");
  process.exit(1);
}

if (!expectedSha) {
  console.error("GITHUB_SHA (or EXPECTED_COMMIT_SHA) is required");
  process.exit(1);
}

const buildHeaders = () => {
  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (process.env.RENDER_AUTH_DISABLED_HEADER) {
    headers["x-auth-disabled"] = process.env.RENDER_AUTH_DISABLED_HEADER;
  }
  return headers;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function probeServerCommitSha() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const response = await fetch(`${baseUrl}/api/enrich-stream`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ barcode: probeBarcode }),
    signal: controller.signal,
  });
  if (!response.ok) {
    clearTimeout(timeout);
    throw new Error(`enrich-stream returned ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    clearTimeout(timeout);
    throw new Error("response body reader unavailable");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = null;
  let currentData = "";

  const flush = () => {
    if (!currentEvent) return null;
    const eventName = currentEvent;
    const dataRaw = currentData.trim();
    currentEvent = null;
    currentData = "";
    if (!dataRaw) return null;
    if (eventName !== "analysis_bundle") return null;
    try {
      const parsed = JSON.parse(dataRaw);
      return parsed?.meta?.serverCommitSha ?? null;
    } catch {
      return null;
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) {
          const sha = flush();
          if (sha) return sha;
          continue;
        }
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          currentData += line.slice(5).trim();
        }
      }
    }
    return flush();
  } finally {
    clearTimeout(timeout);
    try {
      await reader.cancel();
    } catch {}
  }
}

async function main() {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const sha = await probeServerCommitSha();
      console.log(`[wait-render] attempt=${attempt} serverCommitSha=${sha ?? "null"} expected=${expectedSha}`);
      if (sha === expectedSha) {
        console.log("[wait-render] deployment commit matched expected SHA");
        return;
      }
    } catch (error) {
      console.log(`[wait-render] attempt=${attempt} probe error=${String(error)}`);
    }
    await sleep(intervalMs);
  }

  console.error(`[wait-render] timeout after ${timeoutMs}ms waiting for serverCommitSha=${expectedSha}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(`[wait-render] fatal error: ${String(error)}`);
  process.exit(1);
});
