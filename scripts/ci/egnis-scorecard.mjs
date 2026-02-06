#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const API_URL = process.env.GITHUB_API_URL || "https://api.github.com";

const RUN_ID = process.env.GITHUB_RUN_ID || "local";
const RUN_ATTEMPT = process.env.GITHUB_RUN_ATTEMPT || "1";

const REQUIRED_RUNS = Number(process.env.EGNIS_REQUIRED_RUNS || 10);
const NIGHTLY_RUNS = Number(process.env.EGNIS_NIGHTLY_RUNS || 14);
const TOKEN_HIT_RATE_THRESHOLD = Number(process.env.EGNIS_TOKEN_HIT_RATE_THRESHOLD || 0.85);
const FAIL_ON_NOT_READY = (process.env.EGNIS_FAIL_ON_NOT_READY || "0") === "1";

const SCORECARD_DIR = process.env.SCORECARD_ARTIFACT_DIR || "artifacts/egnis-scorecard";
const DSLD_OUT_DIR =
  process.env.DSLD_CANDIDATE_ARTIFACT_DIR || path.join(SCORECARD_DIR, "dsld-form-candidates");
const DSLD_SCAN_DIR = path.join(DSLD_OUT_DIR, `${RUN_ID}-${RUN_ATTEMPT}`);

const CORE_TOKENS = ["oxide", "citrate", "glycinate", "bisglycinate", "picolinate", "ascorbate"];

const ensureDir = async (dir) => fs.mkdir(dir, { recursive: true });

const fetchJson = async (url) => {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
};

const parseCsv = (csv) => {
  const lines = String(csv || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const parseLine = (line) => {
    const out = [];
    let cur = "";
    let i = 0;
    let inQuotes = false;
    while (i < line.length) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === "\"") {
          const next = line[i + 1];
          if (next === "\"") {
            cur += "\"";
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        cur += ch;
        i += 1;
        continue;
      }

      if (ch === "\"") {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ",") {
        out.push(cur);
        cur = "";
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
    }
    out.push(cur);
    return out;
  };

  const header = parseLine(lines[0]);
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = parseLine(line);
    const row = {};
    header.forEach((k, idx) => {
      row[k] = cols[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
};

const summarizeRuns = (runs, n) => {
  const recent = (runs || []).slice(0, n);
  return recent.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    conclusion: r.conclusion,
    html_url: r.html_url,
    head_sha: r.head_sha,
  }));
};

async function main() {
  await ensureDir(SCORECARD_DIR);

  const score = {
    generatedAt: new Date().toISOString(),
    repo: REPO ?? null,
    required: {
      workflow: "render-regression.yml",
      requiredRuns: REQUIRED_RUNS,
      recent: [],
      pass: false,
    },
    nightly: {
      workflow: "render-regression-nightly.yml",
      requiredRuns: NIGHTLY_RUNS,
      recent: [],
      pass: false,
    },
    kbCoverage: {
      source: "dsld-form-candidate-scan",
      scanDir: DSLD_SCAN_DIR,
      tokenHitRates: {},
      coreTokensPass: false,
      topActionList: {
        hasKbSentenceMissingTop50: null,
        hasFormUnresolvedRuntimeTop50: null,
        kbExcerptMissingTop10Empty: null,
        topRows: [],
      },
    },
    stopCondition: {
      ready: false,
      reasons: [],
    },
  };

  if (!REPO || !TOKEN) {
    score.stopCondition.reasons.push("missing GITHUB_REPOSITORY or GITHUB_TOKEN (cannot evaluate workflow history)");
  } else {
    const requiredRunsUrl = `${API_URL}/repos/${REPO}/actions/workflows/render-regression.yml/runs?branch=main&per_page=${REQUIRED_RUNS}`;
    const nightlyRunsUrl = `${API_URL}/repos/${REPO}/actions/workflows/render-regression-nightly.yml/runs?branch=main&per_page=${Math.max(
      NIGHTLY_RUNS,
      20,
    )}`;

    const required = await fetchJson(requiredRunsUrl);
    const nightly = await fetchJson(nightlyRunsUrl);
    const requiredRuns = required.workflow_runs ?? [];
    const nightlyRuns = nightly.workflow_runs ?? [];

    score.required.recent = summarizeRuns(requiredRuns, REQUIRED_RUNS);
    score.nightly.recent = summarizeRuns(nightlyRuns, NIGHTLY_RUNS);

    score.required.pass =
      score.required.recent.length >= REQUIRED_RUNS &&
      score.required.recent.every((r) => r.conclusion === "success");
    score.nightly.pass =
      score.nightly.recent.length >= NIGHTLY_RUNS &&
      score.nightly.recent.every((r) => r.conclusion === "success");
  }

  // KB coverage is evaluated from the local candidate scan outputs (run in the same workflow).
  try {
    const reportRaw = await fs.readFile(path.join(DSLD_SCAN_DIR, "kb_gap_report.json"), "utf-8");
    const report = JSON.parse(reportRaw);
    const tokenStats = report?.tokenStats ?? {};
    for (const token of Object.keys(tokenStats)) {
      const row = tokenStats[token] ?? {};
      const candidates = Number(row.candidates ?? 0);
      const kbHits = Number(row.kbHits ?? 0);
      const hitRate = candidates > 0 ? kbHits / candidates : null;
      score.kbCoverage.tokenHitRates[token] = {
        candidates,
        kbHits,
        kbGaps: Number(row.kbGaps ?? Math.max(0, candidates - kbHits)),
        hitRate,
      };
    }

    const coreRates = CORE_TOKENS.map((t) => score.kbCoverage.tokenHitRates[t]?.hitRate).filter(
      (v) => typeof v === "number",
    );
    score.kbCoverage.coreTokensPass =
      coreRates.length === CORE_TOKENS.length && coreRates.every((v) => v >= TOKEN_HIT_RATE_THRESHOLD);

    const actionCsv = await fs.readFile(path.join(DSLD_SCAN_DIR, "kb_gap_action_list.csv"), "utf-8");
    const rows = parseCsv(actionCsv)
      .map((r) => ({
        token: r.token,
        ingredient: r.ingredient,
        gapType: r.gapType,
        gap_detail: r.gap_detail,
        count: Number(r.count ?? 0),
        example: r.example_actives_excerpt,
      }))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

    const top50 = rows.slice(0, 50);
    const top10ExcerptMissing = rows.filter((r) => r.gapType === "kb_excerpt_missing").slice(0, 10);
    score.kbCoverage.topActionList.topRows = top50;
    score.kbCoverage.topActionList.hasKbSentenceMissingTop50 = top50.some((r) => r.gapType === "kb_sentence_missing");
    score.kbCoverage.topActionList.hasFormUnresolvedRuntimeTop50 = top50.some(
      (r) => r.gapType === "form_unresolved" && String(r.gap_detail || "").includes("runtime_entry_present"),
    );
    score.kbCoverage.topActionList.kbExcerptMissingTop10Empty = top10ExcerptMissing.length === 0;
  } catch (err) {
    score.stopCondition.reasons.push(`kb coverage evaluation failed: ${String(err)}`);
  }

  // Stop condition: minimal automated subset. (API 500/pending metrics come from regression suites.)
  if (!score.required.pass) score.stopCondition.reasons.push("required render regression not green for last N runs");
  if (!score.nightly.pass) score.stopCondition.reasons.push("nightly render regression not green for last N runs");
  if (!score.kbCoverage.coreTokensPass)
    score.stopCondition.reasons.push(`core token hit_rate < ${TOKEN_HIT_RATE_THRESHOLD} for one or more tokens`);
  if (score.kbCoverage.topActionList.hasKbSentenceMissingTop50)
    score.stopCondition.reasons.push("kb_sentence_missing appears in top action list (top50)");
  if (score.kbCoverage.topActionList.hasFormUnresolvedRuntimeTop50)
    score.stopCondition.reasons.push("form_unresolved(runtime_entry_present) appears in top action list (top50)");
  if (!score.kbCoverage.topActionList.kbExcerptMissingTop10Empty)
    score.stopCondition.reasons.push("kb_excerpt_missing present in top10 combos (must be cleared for launch-ready)");

  score.stopCondition.ready = score.stopCondition.reasons.length === 0;

  const scorePathJson = path.join(SCORECARD_DIR, "scorecard.json");
  await fs.writeFile(scorePathJson, JSON.stringify(score, null, 2));

  const mdLines = [
    `# EG-NIS Scorecard`,
    ``,
    `Generated: ${score.generatedAt}`,
    ``,
    `## Regression Gates`,
    ``,
    `- Required (last ${REQUIRED_RUNS}): ${score.required.pass ? "PASS" : "FAIL"}`,
    `- Nightly (last ${NIGHTLY_RUNS}): ${score.nightly.pass ? "PASS" : "FAIL"}`,
    ``,
    `## KB Coverage`,
    ``,
    `Threshold: hit_rate >= ${TOKEN_HIT_RATE_THRESHOLD} (core tokens: ${CORE_TOKENS.join(", ")})`,
    ``,
    `| token | candidates | kbHits | kbGaps | hitRate |`,
    `|---|---:|---:|---:|---:|`,
  ];
  for (const token of CORE_TOKENS) {
    const row = score.kbCoverage.tokenHitRates[token] ?? { candidates: 0, kbHits: 0, kbGaps: 0, hitRate: null };
    const hr = typeof row.hitRate === "number" ? row.hitRate.toFixed(2) : "";
    mdLines.push(`| ${token} | ${row.candidates} | ${row.kbHits} | ${row.kbGaps} | ${hr} |`);
  }
  mdLines.push("");
  mdLines.push(`## Action List (Top 10)`);
  mdLines.push("");
  mdLines.push(`| token | ingredient | gapType | count | example |`);
  mdLines.push(`|---|---|---|---:|---|`);
  for (const r of (score.kbCoverage.topActionList.topRows ?? []).slice(0, 10)) {
    mdLines.push(`| ${r.token} | ${r.ingredient} | ${r.gapType} | ${r.count} | ${String(r.example || "").slice(0, 80)} |`);
  }
  mdLines.push("");
  mdLines.push(`## Stop Condition`);
  mdLines.push("");
  mdLines.push(`Ready: ${score.stopCondition.ready ? "YES" : "NO"}`);
  if (score.stopCondition.reasons.length) {
    mdLines.push("");
    mdLines.push(`Reasons:`);
    for (const r of score.stopCondition.reasons) mdLines.push(`- ${r}`);
  }

  await fs.writeFile(path.join(SCORECARD_DIR, "scorecard.md"), mdLines.join("\n") + "\n");

  console.log(`[scorecard] wrote ${scorePathJson}`);
  console.log(`[scorecard] ready=${score.stopCondition.ready}`);

  // If desired, treat "not ready" as a failing CI signal while still producing artifacts.
  if (FAIL_ON_NOT_READY && !score.stopCondition.ready) {
    console.error(`[scorecard] stop_condition_not_ready`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[scorecard] fatal: ${String(err)}`);
  process.exit(1);
});
