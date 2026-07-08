import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getScientificBackgroundEvidence } from "../src/insights/scientificBackgroundEvidencePackage.js";

type SearchDetailReplayTarget = {
  family: string;
  displayName: string | null;
  productId: string;
  barcode: string | null;
  title: string;
  primaryLane: string;
  expectedLiveGroundingStatus: "approved_reviewed_row" | "blocked_no_reviewed_row";
};

type ReplayArgs = {
  apiBaseUrl: string;
  outDir: string;
  timeoutMs: number;
  maxRevalidates: number;
  retryBufferMs: number;
  writeArtifacts: boolean;
  includeAll: boolean;
  routeEligibleOnly: boolean;
};

type RouteAttempt = {
  ok: boolean;
  status: number;
  elapsedMs: number;
  url: string;
  json: Record<string, unknown> | null;
  error: string | null;
};

type ReplayRow = {
  family: string;
  productId: string;
  barcode: string | null;
  title: string;
  route: {
    pass: boolean;
    status: number | null;
    attempts: number;
    finalSource: string | null;
    finalBackgroundRefreshPending: boolean | null;
    elapsedMsTotal: number;
    error: string | null;
  };
  routeProduct: {
    productId: string | null;
    barcode: string | null;
    name: string | null;
    brand: string | null;
    factsStatus: string | null;
  };
  familyInference: {
    pass: boolean;
    defaultAnchorName: string | null;
    scienceRowNames: string[];
    selectedLabel: string | null;
    matchedFields: string[];
  };
  scientificBackground: {
    pass: boolean;
    source: string | null;
    mode: string | null;
    genericHits: string[];
    containsFamilySignal: boolean;
    headings: string[];
    selectedLabel: string | null;
    sampleSummary: string | null;
    sampleEvidenceRead: string | null;
    sampleShopperMeaning: string | null;
  };
  evidenceGrounding: {
    pass: boolean;
    expectedLiveGroundingStatus: SearchDetailReplayTarget["expectedLiveGroundingStatus"];
    reviewedEvidenceFound: boolean;
    primaryLane: string;
    reviewedReferenceIds: string[];
    routeEvidenceSignalFound: boolean;
    routeEvidenceSignals: string[];
    sourceAcceptedAsApiGrounded: boolean;
  };
  safetyClaimGate: {
    pass: boolean;
    unsafeSentences: string[];
  };
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(ROOT, "..");
const STAGING_DIR = path.join(ROOT, "data", "staging", "nutri-minimal-v4");
const COMPILER_REPLAY_PACK_PATH = path.join(
  STAGING_DIR,
  "real-product-family-replay-pack.json",
);
const ROUTE_REPLAY_JSON_PATH = path.join(
  STAGING_DIR,
  "search-detail-route-replay-pack.json",
);
const ROUTE_REPLAY_MD_PATH = path.join(
  STAGING_DIR,
  "search-detail-route-replay-pack.md",
);

const DEFAULT_API_BASE_URL =
  process.env.SEARCH_DETAIL_REPLAY_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.SCIENCE_VALIDATION_API_BASE_URL ??
  "http://127.0.0.1:3001";

const FAMILY_PATTERNS: Record<string, RegExp> = {
  same: /\b(?:same|sam-e|s[\s-]*adenosyl[\s-]*(?:l[\s-]*)?methionine)\b/i,
  tocotrienols: /\btocotrienols?\b/i,
  devil_s_claw: /\bdevil'?s\s+claw\b|\bharpagophytum\b/i,
  schisandra_chinensis: /\bschisandra\b/i,
  red_yeast_rice: /\bred\s+yeast\s+rice\b|\bmonascus\b|\bmonacolin\b/i,
  pygeum: /\bpygeum\b|\bprunus\s+africana\b/i,
  milk_thistle: /\bmilk\s+thistle\b|\bsilybum\b|\bsilymarin\b/i,
  tribulus_terrestris: /\btribulus(?:\s+terrestris)?\b|\bprotodioscin\b/i,
  lion_s_mane_mushroom: /\blion'?s?\s+mane\b|\bhericium\s+erinaceus/i,
  chaga_mushroom: /\bchaga\b|\binonotus\s+obliquus\b/i,
  nadh: /\bnadh\b|\bnicotinamide\s+adenine\s+dinucleotide\b/i,
};

const PRIMARY_LANE_BY_FAMILY: Record<string, string> = {
  same: "primary_use_context",
  tocotrienols: "primary_use_context",
  devil_s_claw: "primary_use_context",
  schisandra_chinensis: "primary_use_context",
  red_yeast_rice: "primary_use_context",
  pygeum: "primary_use_context",
  milk_thistle: "primary_use_context",
  tribulus_terrestris: "primary_use_context",
  chaga_mushroom: "primary_use_context",
  nadh: "primary_use_context",
};

const GENERIC_BACKGROUND_PATTERNS = [
  /clearest comparison lane here/i,
  /this is the strongest reading/i,
  /has approved pubmed-backed context/i,
  /broad orientation section/i,
  /appears in several research directions/i,
  /research emphasis changes with the exact ingredient/i,
  /not every broad claim is equally central/i,
  /useful orientation section/i,
];

const UNSAFE_SENTENCE_PATTERNS = [
  /\b(treats?|treated|treating|cures?|curing|prevents?|preventing|replaces?|replacing|guarantees?|guaranteeing)\b/i,
  /\b(?:drug|medication|statin)[-\s]*(?:replacement|substitute)\b/i,
  /\b(?:best|better|superior|safer)\s+(?:than|form|choice|option)\b/i,
  /\bwill\s+(?:lower|reduce|improve|boost|detoxify)\b/i,
  /\b(?:lowers?|reduces?)\s+(?:ldl|cholesterol|blood sugar|glucose)\b/i,
  /\bboosts?\s+testosterone\b/i,
  /\bdetoxif(?:y|ies|ication)\b/i,
];

const BOUNDARY_PATTERN =
  /\b(do not|don't|does not|should not|avoid|not as|not proof|not a|without|rather than|keep|bounded|caution|separate from|not be read as|not be treated as|not automatically|should stay|must stay)\b/i;

const parseArgs = (argv = process.argv.slice(2)): ReplayArgs => {
  const values: ReplayArgs = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    outDir: "backend/data/staging/nutri-minimal-v4",
    timeoutMs: 20_000,
    maxRevalidates: 8,
    retryBufferMs: 300,
    writeArtifacts: true,
    includeAll: false,
    routeEligibleOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--api-base-url" && next) {
      values.apiBaseUrl = next;
      index += 1;
    } else if (arg === "--out-dir" && next) {
      values.outDir = next;
      index += 1;
    } else if (arg === "--timeout-ms" && next) {
      values.timeoutMs = Number(next);
      index += 1;
    } else if (arg === "--max-revalidates" && next) {
      values.maxRevalidates = Number(next);
      index += 1;
    } else if (arg === "--retry-buffer-ms" && next) {
      values.retryBufferMs = Number(next);
      index += 1;
    } else if (arg === "--no-write") {
      values.writeArtifacts = false;
    } else if (arg === "--include-all") {
      values.includeAll = true;
    } else if (arg === "--route-eligible-only") {
      values.routeEligibleOnly = true;
    }
  }
  values.apiBaseUrl = values.apiBaseUrl.replace(/\/+$/, "");
  return values;
};

const readJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await fs.readFile(filePath, "utf8")) as T;

const normalizeText = (value: unknown): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readString = (value: unknown): string | null => {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

const fetchRouteJson = async (
  url: string,
  timeoutMs: number,
): Promise<RouteAttempt> => {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-auth-disabled": "1",
        "Cache-Control": "no-cache, no-store",
        Pragma: "no-cache",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      url,
      json,
      error: response.ok ? null : text.slice(0, 400),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      url,
      json: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

const buildDetailUrl = (
  apiBaseUrl: string,
  productId: string,
  revalidateFallback: boolean,
): string => {
  const params = new URLSearchParams({ productId });
  if (revalidateFallback) params.set("revalidateFallback", "1");
  return `${apiBaseUrl}/api/search/product-detail?${params.toString()}`;
};

const loadTargetsFromCompilerReplay = async (
  includeAll = false,
  routeEligibleOnly = false,
): Promise<SearchDetailReplayTarget[]> => {
  const artifact = await readJson<{
    replay_rows: Array<{
      required?: boolean;
      family: string;
      display_name?: string | null;
      title?: string;
      replay_product?: {
        product_id?: string | null;
        barcode?: string | null;
        title?: string | null;
      };
      evidence_grounding?: {
        live_grounding_status?: SearchDetailReplayTarget["expectedLiveGroundingStatus"];
        primary_lane?: string | null;
      };
      inference?: {
        anchor_family?: string | null;
      };
    }>;
  }>(COMPILER_REPLAY_PACK_PATH);
  return artifact.replay_rows
    .filter((row) => includeAll || row.required === true)
    .filter(
      (row) =>
        !routeEligibleOnly ||
        row.required === true ||
        readString(row.inference?.anchor_family) === row.family,
    )
    .map((row) => ({
      family: row.family,
      displayName: readString(row.display_name),
      productId: normalizeText(row.replay_product?.product_id),
      barcode: readString(row.replay_product?.barcode),
      title: normalizeText(row.replay_product?.title ?? row.title),
      primaryLane:
        readString(row.evidence_grounding?.primary_lane) ??
        PRIMARY_LANE_BY_FAMILY[row.family] ??
        "primary_use_context",
      expectedLiveGroundingStatus:
        row.evidence_grounding?.live_grounding_status ??
        "blocked_no_reviewed_row",
    }))
    .filter((target) => target.productId.length > 0);
};

const getPayloadData = (attempt: RouteAttempt): Record<string, unknown> | null => {
  const json = attempt.json;
  if (!isRecord(json)) return null;
  const data = json.data;
  return isRecord(data) ? data : null;
};

const flattenScientificText = (block: unknown): string[] => {
  if (!isRecord(block)) return [];
  const sections = Array.isArray(block.sections) ? block.sections : [];
  return [
    block.introLine,
    ...sections.flatMap((section) => {
      if (!isRecord(section)) return [];
      return [
        section.heading,
        section.summary,
        ...(Array.isArray(section.bullets) ? section.bullets : []),
        section.evidenceRead,
        section.shopperMeaning,
      ];
    }),
    block.closingNote,
  ]
    .map(readString)
    .filter((value): value is string => Boolean(value));
};

const flattenOverviewText = (block: unknown): string[] => {
  if (!isRecord(block)) return [];
  return [block.titleLine, block.paragraph1, block.paragraph2, block.compareHint]
    .map(readString)
    .filter((value): value is string => Boolean(value));
};

const getScienceRowNames = (data: Record<string, unknown> | null): string[] => {
  const scienceBlock = isRecord(data?.scienceBlock) ? data?.scienceBlock : null;
  const rows = Array.isArray(scienceBlock?.ingredientRows)
    ? scienceBlock.ingredientRows
    : [];
  return rows
    .map((row) => (isRecord(row) ? readString(row.name) : null))
    .filter((value): value is string => Boolean(value));
};

const getScientificSections = (block: unknown): Record<string, unknown>[] =>
  isRecord(block) && Array.isArray(block.sections)
    ? block.sections.filter(isRecord)
    : [];

const normalizeProbeText = (value: unknown): string =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const familySignalMatches = (
  target: Pick<SearchDetailReplayTarget, "family" | "displayName">,
  value: unknown,
): boolean => {
  const text = normalizeText(value);
  if (!text) return false;
  const hardPattern = FAMILY_PATTERNS[target.family];
  if (hardPattern?.test(text)) return true;
  const normalizedText = normalizeProbeText(text);
  const probes = [
    target.displayName,
    target.family,
    target.family.replace(/_/g, " "),
  ]
    .map(normalizeProbeText)
    .filter((probe) => probe.length >= 3);
  return probes.some((probe) => normalizedText.includes(probe));
};

const evidenceSignalTexts = (family: string, primaryLane: string): string[] => {
  const evidence = getScientificBackgroundEvidence(family, primaryLane, "en");
  if (!evidence) return [];
  const values = [
    evidence.displayText,
    evidence.segments.summarySupport?.[0]?.text,
    evidence.segments.evidenceReadSupport?.[0]?.text,
    evidence.segments.shopperMeaningSupport?.[0]?.text,
    evidence.segments.caveats?.[0]?.text,
  ];
  return values
    .map(readString)
    .filter((value): value is string => Boolean(value))
    .map((value) => value.slice(0, 90));
};

const reviewedReferenceIds = (family: string, primaryLane: string): string[] => {
  const evidence = getScientificBackgroundEvidence(family, primaryLane, "en");
  return evidence?.supportingReferences.map((reference) => reference.id) ?? [];
};

const findGenericHits = (text: string): string[] =>
  GENERIC_BACKGROUND_PATTERNS.filter((pattern) => pattern.test(text)).map(
    (pattern) => String(pattern),
  );

const splitSentences = (text: string): string[] =>
  normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeText(sentence))
    .filter(Boolean);

const findUnsafeSentences = (text: string): string[] =>
  splitSentences(text).filter((sentence) => {
    if (/\btreating\s+(?:two\s+)?(?:labels?|products?)\s+as\s+equivalent\b/i.test(sentence)) {
      return false;
    }
    if (
      /^treat\s+.+\s+as\s+(?:a\s+)?(?:confidence|context|comparison|label|formula|disclosure)\b/i.test(
        sentence,
      )
    ) {
      return false;
    }
    if (BOUNDARY_PATTERN.test(sentence)) return false;
    return UNSAFE_SENTENCE_PATTERNS.some((pattern) => pattern.test(sentence));
  });

const clampRetryDelay = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1_500;
  return Math.max(500, Math.min(5_000, Math.round(numeric)));
};

const runRouteReplayTarget = async (
  target: SearchDetailReplayTarget,
  args: ReplayArgs,
): Promise<ReplayRow> => {
  const attempts: RouteAttempt[] = [];
  const startedAt = Date.now();
  let current = await fetchRouteJson(
    buildDetailUrl(args.apiBaseUrl, target.productId, false),
    args.timeoutMs,
  );
  attempts.push(current);

  for (let index = 0; index < args.maxRevalidates; index += 1) {
    const data = getPayloadData(current);
    const pending = isRecord(data?.deepDiveAsync)
      ? isRecord(data.deepDiveAsync.scientificBackground)
        ? data.deepDiveAsync.scientificBackground
        : null
      : null;
    if (
      !current.ok ||
      readString(data?.scientificBackgroundSource) === "api" ||
      pending?.backgroundRefreshPending !== true
    ) {
      break;
    }
    await sleep(clampRetryDelay(pending.recommendedRetryAfterMs) + args.retryBufferMs);
    current = await fetchRouteJson(
      buildDetailUrl(args.apiBaseUrl, target.productId, true),
      args.timeoutMs,
    );
    attempts.push(current);
  }

  const data = getPayloadData(current);
  const product = isRecord(data?.product) ? data.product : null;
  const defaultAnchor = isRecord(data?.defaultAnchor) ? data.defaultAnchor : null;
  const scientificBlock = data?.scientificBackground;
  const scientificSections = getScientificSections(scientificBlock);
  const scientificLines = flattenScientificText(scientificBlock);
  const overviewLines = flattenOverviewText(data?.ingredientOverview);
  const scientificText = scientificLines.join(" ");
  const aiText = [...scientificLines, ...overviewLines].join(" ");
  const scienceRowNames = getScienceRowNames(data);
  const selectedLabel = isRecord(scientificBlock)
    ? readString(scientificBlock.selectedLabel)
    : null;
  const defaultAnchorName = readString(defaultAnchor?.name);
  const familyProbeFields = [
    ["defaultAnchor.name", defaultAnchorName],
    ["scientificBackground.selectedLabel", selectedLabel],
    ["scienceBlock.ingredientRows.0.name", scienceRowNames[0] ?? null],
    ["product.name", readString(product?.name)],
    ...scienceRowNames.slice(1).map((name, index) => [
      `scienceBlock.ingredientRows.${index + 1}.name`,
      name,
    ]),
  ] as Array<[string, string | null]>;
  const matchedFields = familyProbeFields
    .filter(([, value]) => familySignalMatches(target, value))
    .map(([key]) => key);
  const primaryMatchedFields = matchedFields.filter((key) =>
    key === "defaultAnchor.name" ||
    key === "scientificBackground.selectedLabel" ||
    key === "scienceBlock.ingredientRows.0.name",
  );
  const containsFamilySignal = familySignalMatches(target, scientificText);
  const genericHits = findGenericHits(scientificText);
  const primaryLane = target.primaryLane;
  const referenceIds = reviewedReferenceIds(target.family, primaryLane);
  const evidenceSignals = evidenceSignalTexts(target.family, primaryLane);
  const routeEvidenceSignals = evidenceSignals.filter((signal) =>
    scientificText.toLowerCase().includes(signal.toLowerCase()),
  );
  const scientificSource = readString(data?.scientificBackgroundSource);
  const diagnostics = isRecord(data?.scientificBackgroundDiagnostics)
    ? data.scientificBackgroundDiagnostics
    : null;
  const sourceAcceptedAsApiGrounded =
    target.expectedLiveGroundingStatus === "approved_reviewed_row" &&
    scientificSource === "api" &&
    diagnostics?.liveWriterHit === true &&
    referenceIds.length > 0;
  const routeEvidenceSignalFound =
    routeEvidenceSignals.length > 0 || sourceAcceptedAsApiGrounded;
  const blockedExpected =
    target.expectedLiveGroundingStatus === "blocked_no_reviewed_row";
  const evidenceGroundingPass = blockedExpected
    ? referenceIds.length === 0 && routeEvidenceSignals.length === 0
    : referenceIds.length > 0 && routeEvidenceSignalFound;
  const unsafeSentences = findUnsafeSentences(aiText);
  const scientificPass =
    current.ok &&
    scientificSections.length >= 2 &&
    containsFamilySignal &&
    genericHits.length === 0;
  const familyInferencePass = current.ok && primaryMatchedFields.length > 0;
  const safetyPass = unsafeSentences.length === 0;

  return {
    family: target.family,
    productId: target.productId,
    barcode: target.barcode,
    title: target.title,
    route: {
      pass: current.ok,
      status: current.status || null,
      attempts: attempts.length,
      finalSource: scientificSource,
      finalBackgroundRefreshPending: isRecord(data?.deepDiveAsync) &&
        isRecord(data.deepDiveAsync.scientificBackground)
        ? Boolean(data.deepDiveAsync.scientificBackground.backgroundRefreshPending)
        : null,
      elapsedMsTotal: Date.now() - startedAt,
      error: current.error,
    },
    routeProduct: {
      productId: readString(product?.productId),
      barcode: readString(product?.barcode),
      name: readString(product?.name),
      brand: readString(product?.brand),
      factsStatus: readString(product?.factsStatus),
    },
    familyInference: {
      pass: familyInferencePass,
      defaultAnchorName,
      scienceRowNames,
      selectedLabel,
      matchedFields,
    },
    scientificBackground: {
      pass: scientificPass,
      source: scientificSource,
      mode: isRecord(scientificBlock) ? readString(scientificBlock.mode) : null,
      genericHits,
      containsFamilySignal,
      headings: scientificSections
        .map((section) => readString(section.heading))
        .filter((value): value is string => Boolean(value)),
      selectedLabel,
      sampleSummary: readString(scientificSections[0]?.summary),
      sampleEvidenceRead: readString(scientificSections[0]?.evidenceRead),
      sampleShopperMeaning: readString(scientificSections[0]?.shopperMeaning),
    },
    evidenceGrounding: {
      pass: evidenceGroundingPass,
      expectedLiveGroundingStatus: target.expectedLiveGroundingStatus,
      reviewedEvidenceFound: referenceIds.length > 0,
      primaryLane,
      reviewedReferenceIds: referenceIds,
      routeEvidenceSignalFound,
      routeEvidenceSignals,
      sourceAcceptedAsApiGrounded,
    },
    safetyClaimGate: {
      pass: safetyPass,
      unsafeSentences,
    },
  };
};

const renderMarkdown = (artifact: {
  generatedAt: string;
  apiBaseUrl: string;
  summary: Record<string, unknown>;
  rows: ReplayRow[];
  failures: ReplayRow[];
}): string => {
  const lines = [
    "# Nutri Minimal v4 Search Detail Route Replay",
    "",
    `Generated at: ${artifact.generatedAt}`,
    `API base: ${artifact.apiBaseUrl}`,
    "",
    "## Summary",
    "",
    `- route ok: ${artifact.summary.route_ok}/${artifact.summary.total}`,
    `- family inference: ${artifact.summary.family_inference_pass}/${artifact.summary.total}`,
    `- Scientific Background specific: ${artifact.summary.scientific_background_specific_pass}/${artifact.summary.total}`,
    `- evidence grounding gate: ${artifact.summary.evidence_grounding_gate_pass}/${artifact.summary.total}`,
    `- safety claim gate: ${artifact.summary.safety_claim_gate_pass}/${artifact.summary.total}`,
    `- approved grounding rows: ${artifact.summary.approved_grounding_rows}`,
    `- blocked grounding rows: ${artifact.summary.blocked_grounding_rows}`,
    `- failures: ${artifact.summary.failures}`,
    "",
    "## Rows",
    "",
    "| Family | Product ID | Route | Inference | Scientific | Grounding | Safety | Source | Selected |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of artifact.rows) {
    lines.push(
      [
        row.family,
        row.productId,
        row.route.pass ? "pass" : `fail ${row.route.status ?? ""}`.trim(),
        row.familyInference.pass ? "pass" : "fail",
        row.scientificBackground.pass ? "pass" : "fail",
        row.evidenceGrounding.pass ? "pass" : "fail",
        row.safetyClaimGate.pass ? "pass" : "fail",
        row.route.finalSource ?? "n/a",
        (row.familyInference.selectedLabel ?? row.familyInference.defaultAnchorName ?? "").replace(/\|/g, "\\|"),
      ].join(" | "),
    );
  }
  if (artifact.failures.length > 0) {
    lines.push("", "## Failures", "");
    for (const row of artifact.failures) {
      lines.push(
        `- ${row.family} (${row.productId}): route=${row.route.pass}, inference=${row.familyInference.pass}, scientific=${row.scientificBackground.pass}, grounding=${row.evidenceGrounding.pass}, safety=${row.safetyClaimGate.pass}, error=${row.route.error ?? "none"}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
};

export const runNutriMinimalV4SearchDetailRouteReplay = async (
  inputArgs: Partial<ReplayArgs> = {},
) => {
  const args = { ...parseArgs([]), ...inputArgs };
  args.apiBaseUrl = args.apiBaseUrl.replace(/\/+$/, "");
  const targets = await loadTargetsFromCompilerReplay(
    args.includeAll,
    args.routeEligibleOnly,
  );
  const rows: ReplayRow[] = [];
  for (const target of targets) {
    rows.push(await runRouteReplayTarget(target, args));
  }
  const failures = rows.filter(
    (row) =>
      !row.route.pass ||
      !row.familyInference.pass ||
      !row.scientificBackground.pass ||
      !row.evidenceGrounding.pass ||
      !row.safetyClaimGate.pass,
  );
  const artifact = {
    version: "nutri_minimal_v4_search_detail_route_replay.v1",
    generatedAt: new Date().toISOString(),
    apiBaseUrl: args.apiBaseUrl,
    summary: {
      total: rows.length,
      route_ok: rows.filter((row) => row.route.pass).length,
      family_inference_pass: rows.filter((row) => row.familyInference.pass).length,
      scientific_background_specific_pass: rows.filter(
        (row) => row.scientificBackground.pass,
      ).length,
      evidence_grounding_gate_pass: rows.filter((row) => row.evidenceGrounding.pass)
        .length,
      safety_claim_gate_pass: rows.filter((row) => row.safetyClaimGate.pass)
        .length,
      approved_grounding_rows: rows.filter(
        (row) =>
          row.evidenceGrounding.expectedLiveGroundingStatus ===
          "approved_reviewed_row",
      ).length,
      blocked_grounding_rows: rows.filter(
        (row) =>
          row.evidenceGrounding.expectedLiveGroundingStatus ===
          "blocked_no_reviewed_row",
      ).length,
      failures: failures.length,
    },
    failures,
    rows,
  };

  if (args.writeArtifacts) {
    const outDir = path.resolve(REPO_ROOT, args.outDir);
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(
      path.join(outDir, path.basename(ROUTE_REPLAY_JSON_PATH)),
      `${JSON.stringify(artifact, null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(outDir, path.basename(ROUTE_REPLAY_MD_PATH)),
      renderMarkdown(artifact),
    );
  }

  return artifact;
};

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  const args = parseArgs();
  runNutriMinimalV4SearchDetailRouteReplay(args)
    .then((artifact) => {
      console.log(
        JSON.stringify(
          {
            ok: artifact.failures.length === 0,
            route_replay_path: path.resolve(
              REPO_ROOT,
              args.outDir,
              path.basename(ROUTE_REPLAY_JSON_PATH),
            ),
            route_replay_markdown_path: path.resolve(
              REPO_ROOT,
              args.outDir,
              path.basename(ROUTE_REPLAY_MD_PATH),
            ),
            summary: artifact.summary,
          },
          null,
          2,
        ),
      );
      if (artifact.failures.length > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exit(1);
    });
}
