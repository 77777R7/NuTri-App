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
const outDir = getArg("out-dir", path.join(ROOT, "output", "legacy-readiness"));
const outJson = getArg("out-json", path.join(outDir, "legacy_runtime_usage_report.json"));
const outMd = getArg("out-md", path.join(outDir, "legacy_runtime_usage_report.md"));
const authDisabledHeader = String(getArg("auth-disabled-header", "1")).trim() === "1";

const safeText = (value) => String(value ?? "").trim();

const fetchJson = async (url, timeoutMs = 10000) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        ...(authDisabledHeader ? { "X-Auth-Disabled": "1" } : {}),
      },
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => null);
    return {
      ok: res.ok,
      status: res.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# Legacy Runtime Usage Report");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- baseUrl: ${report.baseUrl}`);
  lines.push(`- freezeShadowOnly: ${report.freezeShadowOnly}`);
  lines.push(`- p0.status: ${report.status.p0}`);
  lines.push(`- p1.status: ${report.status.p1}`);
  lines.push("");

  lines.push("## Totals");
  lines.push("");
  lines.push(`- totalCalls: ${report.totals.totalCalls}`);
  lines.push(`- mobileUiCalls: ${report.totals.mobileUiCalls}`);
  lines.push("");

  lines.push("## Calls by Surface");
  lines.push("");
  for (const [surface, count] of Object.entries(report.totals.bySurface ?? {})) {
    lines.push(`- ${surface}: ${count}`);
  }

  lines.push("");
  lines.push("## Calls by Route");
  lines.push("");
  for (const [route, count] of Object.entries(report.totals.byRoute ?? {})) {
    lines.push(`- ${route}: ${count}`);
  }

  const sessions = Object.values(report.bySession ?? {});
  lines.push("");
  lines.push("## Session Visibility Touch");
  lines.push("");
  if (sessions.length === 0) {
    lines.push("- No session-level legacy usage tracked yet.");
  } else {
    sessions
      .sort((a, b) => String(b.lastSeenAt ?? "").localeCompare(String(a.lastSeenAt ?? "")))
      .slice(0, 50)
      .forEach((row) => {
        lines.push(`- ${safeText(row.sessionId)} | total=${row.total} | visibleUiTouched=${Boolean(row.visibleUiTouched)} | lastSeenAt=${safeText(row.lastSeenAt)}`);
      });
  }

  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- P0 requires freeze shadow mode on and zero mobile UI legacy calls.");
  lines.push("- P1 tracks consistency items that are non-blocking for visible UI.");

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(outDir, { recursive: true });

  const resp = await fetchJson(`${baseUrl}/internal/legacy-runtime-usage`, 12000);
  if (!resp.ok || !resp.body) {
    throw new Error(`Failed to fetch /internal/legacy-runtime-usage (${resp.status}): ${resp.error ?? "unknown_error"}`);
  }

  const payload = resp.body;
  const mobileUiCalls = Number(payload?.totals?.mobileUiCalls ?? 0);
  const freezeShadowOnly = Boolean(payload?.freezeShadowOnly);

  const report = {
    schemaVersion: "legacy_runtime_readiness_report.v1",
    generatedAt: new Date().toISOString(),
    baseUrl,
    freezeShadowOnly,
    status: {
      p0: freezeShadowOnly && mobileUiCalls === 0 ? "pass" : "fail",
      p1: "info",
    },
    totals: {
      totalCalls: Number(payload?.totals?.totalCalls ?? 0),
      mobileUiCalls,
      bySurface: payload?.totals?.bySurface ?? {},
      byRoute: payload?.totals?.byRoute ?? {},
    },
    today: payload?.today ?? null,
    byDay: payload?.byDay ?? {},
    bySession: payload?.bySession ?? {},
    notes: [
      "legacyVisibleFallback should remain 0 on the client telemetry stream during freeze-shadow period.",
      "mobile_ui_legacy_call_count should remain 0 under normal app flow.",
    ],
  };

  await fs.writeFile(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(outMd, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: report.status.p0 === "pass",
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
