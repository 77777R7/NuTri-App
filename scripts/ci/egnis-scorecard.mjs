#!/usr/bin/env node
/* eslint-disable no-console */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

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
const execFileAsync = promisify(execFile);

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

async function unzipList(zipPath) {
  const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath], { maxBuffer: 50 * 1024 * 1024 });
  return String(stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

async function unzipExtractText(zipPath, innerPath) {
  const { stdout } = await execFileAsync("unzip", ["-p", zipPath, innerPath], { maxBuffer: 50 * 1024 * 1024 });
  return String(stdout || "");
}

async function downloadArtifactZip({ repo, runId, artifactPrefix, outDir }) {
  const artifacts = await fetchJson(`${API_URL}/repos/${repo}/actions/runs/${runId}/artifacts`);
  const list = artifacts?.artifacts ?? [];
  const matches = list.filter((a) => typeof a?.name === "string" && a.name.startsWith(artifactPrefix));
  if (!matches.length) return null;

  // Prefer the highest attempt number when multiple artifacts exist for the same run (reruns).
  const parseAttempt = (name) => {
    const m = String(name || "").match(/-(\\d+)$/);
    return m ? Number(m[1]) : 0;
  };
  matches.sort((a, b) => parseAttempt(b.name) - parseAttempt(a.name));
  const artifact = matches[0];
  const artifactId = artifact?.id;
  if (!artifactId) return null;

  const res = await fetch(`${API_URL}/repos/${repo}/actions/artifacts/${artifactId}/zip`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${TOKEN}`,
    },
    redirect: "follow",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`artifact download failed ${res.status}: ${text.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const zipPath = path.join(outDir, `${artifactPrefix}.zip`);
  await fs.writeFile(zipPath, buf);
  return { zipPath, artifactName: artifact.name, artifactId };
}

async function loadReleaseEvidenceFromRun({ repo, runId, outDir }) {
  const prefix = `render-regression-${runId}-`;
  const downloaded = await downloadArtifactZip({ repo, runId, artifactPrefix: prefix, outDir });
  if (!downloaded) return null;

  const files = await unzipList(downloaded.zipPath);
  const evidencePath = files.find((p) => p.endsWith("release-evidence.json")) ?? null;
  if (!evidencePath) return null;

  const raw = await unzipExtractText(downloaded.zipPath, evidencePath);
  const parsed = JSON.parse(raw);
  return { parsed, artifactName: downloaded.artifactName, evidencePath };
}

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
    status: r.status,
    conclusion: r.conclusion,
    html_url: r.html_url,
    head_sha: r.head_sha,
  }));
};

const isCountedGateRun = (r) =>
  r &&
  r.status === "completed" &&
  typeof r.conclusion === "string" &&
  r.conclusion.length > 0 &&
  // GitHub cancels older runs on newer pushes; don't treat that as a product regression.
  r.conclusion !== "cancelled" &&
  r.conclusion !== "skipped";

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
    groundedness: {
      source: "render-regression artifacts (release-evidence.json)",
      requiredRuns: REQUIRED_RUNS,
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
    // Fetch more than we need and filter to completed, countable runs so in-progress/cancelled runs don't
    // randomly fail readiness checks.
    const requiredRunsUrl = `${API_URL}/repos/${REPO}/actions/workflows/render-regression.yml/runs?branch=main&per_page=${Math.max(
      REQUIRED_RUNS * 5,
      50,
    )}`;
    const nightlyRunsUrl = `${API_URL}/repos/${REPO}/actions/workflows/render-regression-nightly.yml/runs?branch=main&per_page=${Math.max(
      NIGHTLY_RUNS * 3,
      50,
    )}`;

    const required = await fetchJson(requiredRunsUrl);
    const nightly = await fetchJson(nightlyRunsUrl);
    const requiredRuns = (required.workflow_runs ?? []).filter(isCountedGateRun);
    const nightlyRuns = (nightly.workflow_runs ?? []).filter(isCountedGateRun);

    score.required.recent = summarizeRuns(requiredRuns, REQUIRED_RUNS);
    score.nightly.recent = summarizeRuns(nightlyRuns, NIGHTLY_RUNS);

    score.required.pass =
      score.required.recent.length >= REQUIRED_RUNS &&
      score.required.recent.every((r) => r.conclusion === "success");
    score.nightly.pass =
      score.nightly.recent.length >= NIGHTLY_RUNS &&
      score.nightly.recent.every((r) => r.conclusion === "success");

    // Groundedness evaluation: download recent required regression artifacts and assert
    // dsld_with_form* cases contain true KB evidence IDs and minimal evidence structure.
    try {
      const groundedDir = path.join(SCORECARD_DIR, "groundedness");
      await ensureDir(groundedDir);
      const runs = (score.required.recent || []).filter((r) => r.conclusion === "success").slice(0, REQUIRED_RUNS);
      const results = [];
      for (const run of runs) {
        const runId = run.id;
        if (!runId) continue;
        const loaded = await loadReleaseEvidenceFromRun({ repo: REPO, runId, outDir: groundedDir });
        if (!loaded || !Array.isArray(loaded.parsed)) {
          results.push({ runId, pass: false, reason: "missing_release_evidence" });
          continue;
        }

        const evidence = loaded.parsed;
        const dsldWithForm = evidence.filter(
          (c) =>
            String(c?.caseId || "").startsWith("dsld_with_form") &&
            String(c?.sourceType || "").toLowerCase() === "dsld" &&
            String(c?.requiredFormKeyword || "").trim().length > 0,
        );

        const failures = [];
        for (const c of dsldWithForm) {
          const cid = String(c.caseId || "");
          const sentenceHits = c?.formSentenceIdHits && typeof c.formSentenceIdHits === "object" ? c.formSentenceIdHits : null;
          const excerptHits = c?.formExcerptIdHits && typeof c.formExcerptIdHits === "object" ? c.formExcerptIdHits : null;
          const refHits = c?.formReferenceIdHits && typeof c.formReferenceIdHits === "object" ? c.formReferenceIdHits : null;
          const hasSentence = sentenceHits ? Object.values(sentenceHits).some((v) => typeof v === "string" && v.startsWith("s_")) : false;
          const hasExcerpt = excerptHits ? Object.values(excerptHits).some((v) => typeof v === "string" && v.startsWith("x_")) : false;
          const hasRef = refHits ? Object.values(refHits).some((v) => typeof v === "string" && v.startsWith("ref_")) : false;
          if (!hasSentence) failures.push(`${cid}:missing_sentence_id`);
          if (!hasExcerpt) failures.push(`${cid}:missing_excerpt_id`);
          if (!hasRef) failures.push(`${cid}:missing_reference_id`);

          const claims = Array.isArray(c?.groundednessClaims) ? c.groundednessClaims : null;
          const hasClaim = claims
            ? claims.some(
                (cl) =>
                  Array.isArray(cl?.supportingExcerptIds) &&
                  cl.supportingExcerptIds.some((x) => typeof x === "string" && x.startsWith("x_")) &&
                  (cl?.supportStrength === "strong" || cl?.supportStrength === "moderate" || cl?.supportStrength === "weak"),
              )
            : false;
          if (!hasClaim) failures.push(`${cid}:missing_groundedness_claim`);
        }

        results.push({
          runId,
          headSha: run.head_sha ?? null,
          conclusion: run.conclusion ?? null,
          pass: failures.length === 0,
          failures,
        });
      }

      score.groundedness.recent = results;
      score.groundedness.pass =
        results.length >= REQUIRED_RUNS && results.every((r) => r.pass === true);
    } catch (err) {
      score.stopCondition.reasons.push(`groundedness evaluation failed: ${String(err)}`);
    }
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
        triage: r.triage || null,
        gap_detail: r.gap_detail,
        count: Number(r.count ?? 0),
        example: r.example_actives_excerpt,
      }))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

    const top50 = rows.slice(0, 50);
    const top10ExcerptMissing = rows.filter((r) => r.gapType === "kb_excerpt_missing").slice(0, 10);
    score.kbCoverage.topActionList.topRows = top50;
    // Only block launch-ready on *actionable* KB gaps.
    // Parser normalization and noise triage should be tracked, but should not prevent KB iteration from progressing.
    score.kbCoverage.topActionList.hasKbSentenceMissingTop50 = top50.some(
      (r) => r.gapType === "kb_sentence_missing" && r.triage === "kb_missing",
    );
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
  if (!score.groundedness.pass) score.stopCondition.reasons.push("groundedness gate failed for last N required runs");
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
    `- Groundedness (last ${REQUIRED_RUNS} required artifacts): ${score.groundedness.pass ? "PASS" : "FAIL"}`,
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
  mdLines.push(`| token | ingredient | gapType | triage | count | example |`);
  mdLines.push(`|---|---|---|---|---:|---|`);
  for (const r of (score.kbCoverage.topActionList.topRows ?? []).slice(0, 10)) {
    mdLines.push(
      `| ${r.token} | ${r.ingredient} | ${r.gapType} | ${r.triage ?? ""} | ${r.count} | ${String(r.example || "").slice(0, 80)} |`,
    );
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
