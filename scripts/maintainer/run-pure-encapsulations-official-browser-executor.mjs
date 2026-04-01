#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildPureSoftFieldRecoveryBundle,
  canRecoverPureSoftFieldRow,
} from "./lib/pure-soft-field-recovery.mjs";
import { fetchViaScrapling } from "./lib/scrapling-fetcher.mjs";
import {
  buildOverlayCandidateFromScrapling,
  normalizeScraplingResult,
} from "./lib/scrapling-normalizers.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const DEFAULT_RESOLVED_JSON = path.join(
  ROOT,
  "output",
  "pure_encapsulations_official_url_resolver_v3",
  "resolved_rows.json",
);
const DEFAULT_UNRESOLVED_JSON = path.join(
  ROOT,
  "output",
  "pure_encapsulations_official_url_resolver_v3",
  "unresolved_rows.json",
);
const DEFAULT_OUT_DIR = path.join(
  ROOT,
  "output",
  `pure_encapsulations_official_browser_executor_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
);

const RESOLVED_JSON = path.resolve(ROOT, getArg("resolved-json", DEFAULT_RESOLVED_JSON));
const UNRESOLVED_JSON = path.resolve(ROOT, getArg("unresolved-json", DEFAULT_UNRESOLVED_JSON));
const OUT_DIR = path.resolve(ROOT, getArg("out-dir", DEFAULT_OUT_DIR));
const SCRAPLING_MODE = getArg("mode", "plain");

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};

const isUnavailable = (normalized) => {
  const title = String(normalized?.title ?? "").toLowerCase();
  const body = String(normalized?.bodyText ?? "").toLowerCase();
  return (
    title.includes("temporarily unavailable") ||
    title.includes("404 not found") ||
    title.includes("page not found") ||
    body.includes("temporarily unavailable") ||
    body.includes("nestlé") ||
    body.includes("nestle") ||
    body.includes("404 not found")
  );
};

const buildDiscoveryItem = (row, reasonCode, extra = {}) => ({
  productId: row.productId ?? null,
  title: row.title ?? null,
  sourceTypes: row.sourceTypes ?? [],
  reasonCode,
  browserDiscoveryQueries: row.browserDiscoveryQueries ?? [
    `site:pureencapsulations.com "${row.title}"`,
    `site:pureencapsulations.com "Pure Encapsulations" "${row.title}"`,
    `site:pureencapsulationspro.com "${row.title}"`,
  ],
  productPageUrl: row.productPageUrl ?? null,
  pdfUrl: row.pdfUrl ?? null,
  ...extra,
});

const main = async () => {
  const resolvedRows = await readJson(RESOLVED_JSON);
  const unresolvedRows = await readJson(UNRESOLVED_JSON);

  const directAttemptResults = [];
  const candidateResults = [];
  const discoveryQueue = [];

  for (const row of resolvedRows) {
    try {
      const raw = await fetchViaScrapling({
        url: row.productPageUrl,
        productId: row.productId ?? null,
        title: row.title ?? null,
        brandName: "Pure Encapsulations",
        mode: SCRAPLING_MODE,
      });
      if (!raw?.ok) {
        directAttemptResults.push({
          productId: row.productId,
          title: row.title,
          productPageUrl: row.productPageUrl,
          outcome: raw?.errorCode ?? "scrapling_failed",
          raw,
        });
        discoveryQueue.push(buildDiscoveryItem(row, "direct_fetch_failed", { directFetchOutcome: raw?.errorCode ?? "scrapling_failed" }));
        continue;
      }

      const normalized = normalizeScraplingResult(raw);
      if (isUnavailable(normalized)) {
        directAttemptResults.push({
          productId: row.productId,
          title: row.title,
          productPageUrl: row.productPageUrl,
          outcome: "official_page_unavailable",
          pageTitle: normalized.title ?? null,
          pageUrl: normalized.finalUrl ?? normalized.pageUrl ?? row.productPageUrl,
        });
        discoveryQueue.push(
          buildDiscoveryItem(row, "official_page_unavailable", {
            directFetchOutcome: "official_page_unavailable",
            pageTitle: normalized.title ?? null,
          }),
        );
        continue;
      }

      const candidate = buildOverlayCandidateFromScrapling({
        normalizedResult: normalized,
        queueEntry: row,
        brandName: "Pure Encapsulations",
      });
      const result = {
        productId: row.productId,
        title: row.title,
        productPageUrl: row.productPageUrl,
        pdfUrl: row.pdfUrl ?? null,
        outcome: "scrapling_candidate_built",
        pageUrl: normalized.finalUrl ?? normalized.pageUrl ?? row.productPageUrl,
        sectionKeys: Object.keys(candidate.descriptionSections ?? {}),
        factRows: candidate.supplementFacts?.nutritionalFacts?.length ?? 0,
        hasPrimaryImage: Boolean(candidate.productCatalogImage),
        extractionWarnings: candidate.fetchDiagnostics?.extractionWarnings ?? [],
        candidate,
      };
      directAttemptResults.push(result);
      candidateResults.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      directAttemptResults.push({
        productId: row.productId,
        title: row.title,
        productPageUrl: row.productPageUrl,
        outcome: "executor_failed",
        error: message,
      });
      discoveryQueue.push(buildDiscoveryItem(row, "executor_failed", { error: message }));
    }
  }

  for (const row of unresolvedRows) {
    if (canRecoverPureSoftFieldRow(row)) {
      try {
        const bundle = await buildPureSoftFieldRecoveryBundle({ row });
        if (bundle?.result) {
          candidateResults.push(bundle.result);
          directAttemptResults.push({
            ...bundle.result,
            outcome: "soft_field_recovery_candidate_built",
          });
          continue;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        discoveryQueue.push(buildDiscoveryItem(row, "soft_field_recovery_failed", { error: message }));
        continue;
      }
    }
    discoveryQueue.push(buildDiscoveryItem(row, row.resolutionCode ?? "resolver_unresolved", {
      topHistoryCandidates: row.topHistoryCandidates ?? [],
    }));
  }

  const softFieldRecoveredCount = candidateResults.filter((row) => row.softFieldRecovery).length;
  const summary = {
    generatedAt: new Date().toISOString(),
    resolvedInputCount: resolvedRows.length,
    unresolvedInputCount: unresolvedRows.length,
    candidateBuiltCount: candidateResults.length,
    softFieldRecoveredCount,
    unavailableCount: directAttemptResults.filter((row) => row.outcome === "official_page_unavailable").length,
    directFailureCount: directAttemptResults.filter((row) => row.outcome === "direct_fetch_failed" || row.outcome === "executor_failed").length,
    browserDiscoveryQueueCount: discoveryQueue.length,
  };

  const scraplingReport = {
    generatedAt: summary.generatedAt,
    inputs: {
      resolvedJson: RESOLVED_JSON,
      unresolvedJson: UNRESOLVED_JSON,
      mode: SCRAPLING_MODE,
    },
    selectedCount: candidateResults.length,
    results: candidateResults,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await writeJson(path.join(OUT_DIR, "summary.json"), summary);
  await writeJson(path.join(OUT_DIR, "direct_attempt_results.json"), directAttemptResults);
  await writeJson(path.join(OUT_DIR, "browser_discovery_queue.json"), discoveryQueue);
  await writeJson(path.join(OUT_DIR, "scrapling_official_fallback_report.json"), scraplingReport);

  const md = [
    "# Pure Encapsulations Official Browser Executor",
    "",
    `- resolvedInputCount: ${summary.resolvedInputCount}`,
    `- unresolvedInputCount: ${summary.unresolvedInputCount}`,
    `- candidateBuiltCount: ${summary.candidateBuiltCount}`,
    `- softFieldRecoveredCount: ${summary.softFieldRecoveredCount}`,
    `- unavailableCount: ${summary.unavailableCount}`,
    `- directFailureCount: ${summary.directFailureCount}`,
    `- browserDiscoveryQueueCount: ${summary.browserDiscoveryQueueCount}`,
    "",
    "## Direct Attempts",
    ...directAttemptResults.map(
      (row) => `- ${row.productId} | ${row.title} | ${row.outcome}${row.pageTitle ? ` | title=${row.pageTitle}` : ""}`,
    ),
    "",
    "## Discovery Queue",
    ...discoveryQueue.slice(0, 50).map(
      (row) => `- ${row.productId ?? "null"} | ${row.title} | ${row.reasonCode} | ${row.browserDiscoveryQueries?.[0] ?? "none"}`,
    ),
  ].join("\n");
  await writeText(path.join(OUT_DIR, "summary.md"), `${md}\n`);

  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
