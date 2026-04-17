import fs from "node:fs/promises";
import path from "node:path";
import {
  ROOT_DIR,
  writeJson,
  writeText,
} from "./science-validation-reporting.mjs";
import {
  extractSearchSupplements,
  loadGoldenJourneyPack,
  scoreSearchRelevanceCase,
} from "./cross-surface-quality-reporting.mjs";

const DEFAULT_SEARCH_REPLAY_LIMIT = 20;
const DEFAULT_WARM_READY_TIMEOUT_MS = 180_000;
const DEFAULT_WARM_READY_POLL_MS = 5_000;
const PREFERRED_WARM_READY_SCENARIO_IDS = [
  "search_barcode_sr_omega3",
  "search_alias_sensoril_ashwagandha",
  "search_alias_matcha_green_tea",
];

const trimTrailingSlash = (value) => String(value ?? "").replace(/\/+$/, "");
const sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

const buildSearchUrl = ({ apiBaseUrl, query, limit = DEFAULT_SEARCH_REPLAY_LIMIT }) => {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("page", "1");
  params.set("limit", String(limit));
  return `${trimTrailingSlash(apiBaseUrl)}/api/search?${params.toString()}`;
};

const readErrorBody = async (response) => {
  if (typeof response?.text !== "function") return "";
  return (await response.text().catch(() => "")).trim();
};

const sortFailureBuckets = (rows) => {
  const counts = new Map();
  for (const row of rows) {
    if (row.status !== "fail") continue;
    counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
};

const buildSearchReplayRow = ({
  scenario,
  scored,
  httpStatus,
  responseJson = null,
  errorMessage = null,
}) => {
  const supplements = extractSearchSupplements(responseJson);
  const top = supplements[0] ?? null;
  return {
    id: scenario.id,
    category: scenario.category,
    queryType: scenario.input?.queryType ?? null,
    query: scenario.input?.query ?? null,
    expectedProductId: scenario.expected?.search?.expectedProductId ?? null,
    metric: scenario.expected?.search?.metric ?? null,
    status: scored.status,
    reason: scored.reason,
    severity: scored.severity ?? null,
    httpStatus,
    rank: scored.details?.rank ?? null,
    resultCount: scored.details?.resultCount ?? supplements.length,
    topProductId: top?.productId ?? top?.id ?? null,
    topName: top?.name ?? null,
    errorMessage,
  };
};

const scoreRouteFailure = (scenario, { httpStatus = null, errorMessage = null } = {}) => ({
  gate: "search_relevance",
  status: "fail",
  reason: "search_route_failure",
  severity: scenario?.severityOnFail ?? "P1",
  details: {
    rank: null,
    resultCount: 0,
    httpStatus,
    errorMessage,
  },
});

export const createSearchReplayReport = async ({
  pack,
  apiBaseUrl,
  fetchImpl = globalThis.fetch,
  limit = DEFAULT_SEARCH_REPLAY_LIMIT,
  scenarioLimit = null,
  timestamp = String(Date.now()),
}) => {
  if (typeof fetchImpl !== "function") {
    throw new Error("createSearchReplayReport requires a fetch implementation");
  }
  if (!apiBaseUrl) {
    throw new Error("createSearchReplayReport requires apiBaseUrl");
  }

  const searchScenarios = (pack?.scenarios ?? [])
    .filter((scenario) => scenario.surface === "search")
    .slice(0, Number.isFinite(Number(scenarioLimit)) && Number(scenarioLimit) > 0 ? Number(scenarioLimit) : undefined);
  const rows = [];

  for (const scenario of searchScenarios) {
    const query = scenario.input?.query;
    const url = buildSearchUrl({ apiBaseUrl, query, limit });
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response?.ok) {
        const errorMessage = await readErrorBody(response);
        const scored = scoreRouteFailure(scenario, {
          httpStatus: response?.status ?? null,
          errorMessage,
        });
        rows.push(buildSearchReplayRow({
          scenario,
          scored,
          httpStatus: response?.status ?? null,
          errorMessage,
        }));
        continue;
      }

      const responseJson = await response.json();
      const scored = scoreSearchRelevanceCase({ scenario, response: responseJson });
      rows.push(buildSearchReplayRow({
        scenario,
        scored,
        httpStatus: response.status ?? 200,
        responseJson,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const scored = scoreRouteFailure(scenario, { errorMessage });
      rows.push(buildSearchReplayRow({
        scenario,
        scored,
        httpStatus: null,
        errorMessage,
      }));
    }
  }

  const pass = rows.filter((row) => row.status === "pass").length;
  const warn = rows.filter((row) => row.status === "warn").length;
  const fail = rows.filter((row) => row.status === "fail").length;

  return {
    reportType: "search_golden_replay",
    timestamp,
    apiBaseUrl: trimTrailingSlash(apiBaseUrl),
    packVersion: pack?.version ?? null,
    summary: {
      total: rows.length,
      pass,
      warn,
      fail,
      failureBuckets: sortFailureBuckets(rows),
    },
    rows,
  };
};

export const selectWarmReadyProbeScenarios = (pack) => {
  const searchScenarios = (pack?.scenarios ?? []).filter((scenario) => scenario.surface === "search");
  const selected = [];
  for (const id of PREFERRED_WARM_READY_SCENARIO_IDS) {
    const scenario = searchScenarios.find((item) => item.id === id);
    if (scenario) selected.push(scenario);
  }
  if (selected.length > 0) return selected;
  return searchScenarios.slice(0, 3);
};

const formatWarmReadyFailures = (report) =>
  (report?.rows ?? [])
    .filter((row) => row.status === "fail")
    .slice(0, 5)
    .map((row) => `${row.id}:${row.reason}`)
    .join(", ");

export const waitForSearchReplayWarmReady = async ({
  pack,
  apiBaseUrl,
  fetchImpl = globalThis.fetch,
  limit = DEFAULT_SEARCH_REPLAY_LIMIT,
  timeoutMs = DEFAULT_WARM_READY_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_WARM_READY_POLL_MS,
  nowImpl = () => Date.now(),
  sleepImpl = sleep,
}) => {
  const probeScenarios = selectWarmReadyProbeScenarios(pack);
  if (probeScenarios.length === 0) {
    return {
      status: "skipped",
      attempts: 0,
      elapsedMs: 0,
      probeScenarioIds: [],
      lastSummary: {
        total: 0,
        pass: 0,
        warn: 0,
        fail: 0,
        failureBuckets: [],
      },
    };
  }

  const startedAt = nowImpl();
  let attempts = 0;
  let lastReport = null;

  while (true) {
    attempts += 1;
    lastReport = await createSearchReplayReport({
      pack: {
        ...pack,
        scenarios: probeScenarios,
      },
      apiBaseUrl,
      fetchImpl,
      limit,
      timestamp: String(nowImpl()),
    });

    if ((lastReport.summary?.fail ?? 0) === 0) {
      return {
        status: "warm_ready",
        attempts,
        elapsedMs: nowImpl() - startedAt,
        probeScenarioIds: probeScenarios.map((scenario) => scenario.id),
        lastSummary: lastReport.summary,
      };
    }

    const elapsedMs = nowImpl() - startedAt;
    if (elapsedMs >= timeoutMs) {
      const failureText = formatWarmReadyFailures(lastReport) || "unknown failures";
      throw new Error(
        `search replay warm-ready timeout after ${elapsedMs}ms; probes=${probeScenarios.map((scenario) => scenario.id).join(", ")}; lastFailures=${failureText}`,
      );
    }

    await sleepImpl(pollIntervalMs);
  }
};

export const renderSearchReplayMarkdown = (report) => {
  const summary = report.summary ?? {};
  const total = summary.total ?? 0;
  const lines = [
    "# Search Golden Replay",
    "",
    `- apiBaseUrl: ${report.apiBaseUrl ?? "unknown"}`,
    `- packVersion: ${report.packVersion ?? "unknown"}`,
    `- pass: ${summary.pass ?? 0}/${total}`,
    `- warn: ${summary.warn ?? 0}/${total}`,
    `- fail: ${summary.fail ?? 0}/${total}`,
  ];

  if (report.warmup) {
    lines.push(
      `- warmupStatus: ${report.warmup.status ?? "unknown"}`,
      `- warmupAttempts: ${report.warmup.attempts ?? 0}`,
      `- warmupElapsedMs: ${report.warmup.elapsedMs ?? 0}`,
    );
  }

  lines.push(
    "",
    "## Failure Buckets",
    "",
  );

  if (summary.failureBuckets?.length) {
    for (const bucket of summary.failureBuckets) {
      lines.push(`- ${bucket.reason}: ${bucket.count}`);
    }
  } else {
    lines.push("- none");
  }

  const failures = (report.rows ?? []).filter((row) => row.status === "fail");
  lines.push("", "## Top Failures", "");
  if (failures.length === 0) {
    lines.push("- none");
  } else {
    for (const row of failures.slice(0, 12)) {
      lines.push(
        `- ${row.id}: ${row.reason}; query "${row.query}"; expected ${row.expectedProductId}; rank ${row.rank ?? "missing"}; top ${row.topProductId ?? "none"}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
};

export const writeSearchReplayReport = async ({
  report,
  outDir = "output/search-validation",
  outputBase = "search-golden-replay",
}) => {
  const resolvedOutDir = path.resolve(ROOT_DIR, outDir);
  await fs.mkdir(resolvedOutDir, { recursive: true });
  const timestamp = report.timestamp ?? String(Date.now());
  const jsonPath = path.join(outDir, `${outputBase}-${timestamp}.json`);
  const mdPath = path.join(outDir, `${outputBase}-${timestamp}.md`);
  await writeJson(jsonPath, report);
  await writeText(mdPath, renderSearchReplayMarkdown(report));
  return { jsonPath, mdPath };
};

export const runSearchReplayFromPackFile = async ({
  packPath = "data/validation/golden-journey-pack.v0.json",
  apiBaseUrl,
  fetchImpl = globalThis.fetch,
  limit,
  scenarioLimit,
  timestamp,
}) => {
  const pack = await loadGoldenJourneyPack(packPath);
  return createSearchReplayReport({
    pack,
    apiBaseUrl,
    fetchImpl,
    limit,
    scenarioLimit,
    timestamp,
  });
};
