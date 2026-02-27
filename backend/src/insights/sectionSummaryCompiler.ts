import { z } from "zod";

import type { LlmVerifierReasonCode } from "./reasonCodes.js";
import { extractJsonObjectLoose } from "./summaryCompiler.js";

const nonEmptyString = z.string().trim().min(1);

export const usageSummaryPacketSchema = z
  .object({
    locale: z.string().trim().min(2).max(8).optional(),
    sourceType: z.string().trim().min(1).optional(),
    productName: z.string().trim().min(1).optional(),
    directionsLine: z.string().trim().min(1).optional(),
    perServingLine: z.string().trim().min(1).optional(),
    supportingLines: z.array(nonEmptyString).max(8).optional(),
    missingLines: z.array(nonEmptyString).max(8).optional(),
    guidanceLines: z.array(nonEmptyString).max(8).optional(),
  })
  .strict();

type UsageSummaryPacket = z.infer<typeof usageSummaryPacketSchema>;

export const safetySummaryPacketSchema = z
  .object({
    locale: z.string().trim().min(2).max(8).optional(),
    sourceType: z.string().trim().min(1).optional(),
    productName: z.string().trim().min(1).optional(),
    selectedIngredient: z.string().trim().min(1).optional(),
    labelLines: z.array(nonEmptyString).max(8).optional(),
    ulLines: z.array(nonEmptyString).max(8).optional(),
    interactionLines: z.array(nonEmptyString).max(8).optional(),
    missingLines: z.array(nonEmptyString).max(8).optional(),
  })
  .strict();

type SafetySummaryPacket = z.infer<typeof safetySummaryPacketSchema>;

export type UsageSummaryResponse = {
  tldr: string;
  source: "api" | "fallback";
  fallbackUsed: boolean;
  reasonCode: LlmVerifierReasonCode;
};

export type CompileUsageSummaryOpts = {
  llmFn?: (prompt: string) => Promise<string>;
  timeoutMs?: number;
  maxRetries?: number;
};

export type SafetySummaryResponse = {
  tldr: string;
  riskLine: string;
  contextLine: string;
  actionLine: string;
  source: "api" | "fallback";
  fallbackUsed: boolean;
  reasonCode: LlmVerifierReasonCode;
};

export type CompileSafetySummaryOpts = {
  llmFn?: (prompt: string) => Promise<string>;
  timeoutMs?: number;
  maxRetries?: number;
};

const LLM_USAGE_SUMMARY_TIMEOUT_MS = 8_000;
const LLM_USAGE_SUMMARY_MAX_RETRIES = 1;

const asSentence = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};

const dedupe = (items: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const sentence = asSentence(item);
    if (!sentence) continue;
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sentence);
  }
  return out;
};

const toSentenceArray = (value: string): string[] =>
  value
    .split(/(?<=[.!?])\s+/)
    .map((item) => asSentence(item))
    .filter((item) => item.length > 0);

const normalizeSummaryText = (value: string): string | null => {
  const sentences = dedupe(toSentenceArray(value)).slice(0, 3);
  if (sentences.length < 2) return null;
  return sentences.join(" ");
};

const buildUsageSummaryPrompt = (packet: UsageSummaryPacket): string => {
  const parts: string[] = [
    "Create a concise Usage Summary for a supplement record.",
    "Output ONLY JSON: {\"summary\":\"...\"}",
    "Rules: 2-3 short sentences, no markdown, no lists, no medical claims.",
    "The summary must focus on practical usage and missing-field impact.",
    "Do not repeat ingredient-form or bioavailability narrative.",
  ];

  if (packet.productName) {
    parts.push(`Product: ${packet.productName}.`);
  }
  if (packet.sourceType) {
    parts.push(`Source type: ${packet.sourceType}.`);
  }
  if (packet.directionsLine) {
    parts.push(`Directions line: ${packet.directionsLine}`);
  }
  if (packet.perServingLine) {
    parts.push(`Per-serving line: ${packet.perServingLine}`);
  }
  if (packet.supportingLines?.length) {
    parts.push(`Supporting context: ${packet.supportingLines.join(" | ")}`);
  }
  if (packet.missingLines?.length) {
    parts.push(`Missing/accuracy context: ${packet.missingLines.join(" | ")}`);
  }
  if (packet.guidanceLines?.length) {
    parts.push(`Safety guidance context: ${packet.guidanceLines.join(" | ")}`);
  }

  return parts.join("\n");
};

const buildSafetySummaryPrompt = (packet: SafetySummaryPacket): string => {
  const parts: string[] = [
    "Create a concise Safety Summary for a supplement record.",
    "Output ONLY JSON: {\"riskLine\":\"...\",\"contextLine\":\"...\",\"actionLine\":\"...\",\"tldr\":\"...\"}",
    "Rules: 2-3 short sentences, no markdown, no lists, no medical diagnosis.",
    "Keep wording conservative and label-first.",
    "Do not restate ingredient effectiveness or bioavailability claims.",
    "riskLine must describe the key risk or conservative limitation from label evidence.",
    "contextLine must reference UL or interaction context when available.",
    "actionLine must be an actionable next step (label first, clinician if needed).",
    "tldr should combine the three lines in plain text.",
  ];

  if (packet.productName) {
    parts.push(`Product: ${packet.productName}.`);
  }
  if (packet.sourceType) {
    parts.push(`Source type: ${packet.sourceType}.`);
  }
  if (packet.selectedIngredient) {
    parts.push(`Selected ingredient context: ${packet.selectedIngredient}.`);
  }
  if (packet.labelLines?.length) {
    parts.push(`Label warning context: ${packet.labelLines.join(" | ")}`);
  }
  if (packet.ulLines?.length) {
    parts.push(`UL context: ${packet.ulLines.join(" | ")}`);
  }
  if (packet.interactionLines?.length) {
    parts.push(`Interaction context: ${packet.interactionLines.join(" | ")}`);
  }
  if (packet.missingLines?.length) {
    parts.push(`Missing-field context: ${packet.missingLines.join(" | ")}`);
  }

  return parts.join("\n");
};

const buildUsageFallbackSummary = (packet: UsageSummaryPacket): UsageSummaryResponse => {
  const lead =
    packet.directionsLine ||
    packet.perServingLine ||
    "Record-based usage details are limited, so guidance stays conservative.";
  const missingLine =
    packet.missingLines?.[0] ||
    "Missing fields lower confidence for product-specific timing and amount guidance.";
  const guidanceLine =
    packet.guidanceLines?.[0] ||
    "Follow the product label first and verify Supplement Facts and Directions for higher precision.";

  const sentences = dedupe([lead, missingLine, guidanceLine]).slice(0, 3);
  return {
    tldr: sentences.join(" "),
    source: "fallback",
    fallbackUsed: true,
    reasonCode: "FALLBACK_DETERMINISTIC",
  };
};

const buildSafetyFallbackSummary = (packet: SafetySummaryPacket): SafetySummaryResponse => {
  const riskLine =
    packet.labelLines?.[0] ||
    "Label-specific warnings are limited in this source, so this summary stays conservative.";
  const contextLine =
    packet.ulLines?.[0] ||
    packet.interactionLines?.[0] ||
    "General watch-outs can add context but do not replace product-label warnings.";
  const actionLine =
    packet.missingLines?.[0] ||
    "Check the product warning section and consult a clinician for personal risk factors.";

  const sentences = dedupe([riskLine, contextLine, actionLine]).slice(0, 3);
  return {
    tldr: sentences.join(" "),
    riskLine: asSentence(riskLine),
    contextLine: asSentence(contextLine),
    actionLine: asSentence(actionLine),
    source: "fallback",
    fallbackUsed: true,
    reasonCode: "FALLBACK_DETERMINISTIC",
  };
};

const parseUsageSummaryFromLlm = (raw: string): string | null => {
  const result = extractJsonObjectLoose(raw);
  if (!result.ok) return null;
  if (!result.parsed || typeof result.parsed !== "object") return null;
  const parsed = result.parsed as Record<string, unknown>;

  if (typeof parsed.summary === "string") {
    return normalizeSummaryText(parsed.summary);
  }
  if (typeof parsed.tldr === "string") {
    return normalizeSummaryText(parsed.tldr);
  }
  if (Array.isArray(parsed.sentences)) {
    const joined = parsed.sentences
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .join(" ");
    return normalizeSummaryText(joined);
  }
  return null;
};

type ParsedSafetySummary = {
  riskLine: string;
  contextLine: string;
  actionLine: string;
  tldr: string;
};

const parseSafetySummaryFromLlm = (raw: string): ParsedSafetySummary | null => {
  const result = extractJsonObjectLoose(raw);
  if (!result.ok) return null;
  if (!result.parsed || typeof result.parsed !== "object") return null;
  const parsed = result.parsed as Record<string, unknown>;

  const riskLineRaw = typeof parsed.riskLine === "string" ? asSentence(parsed.riskLine) : "";
  const contextLineRaw = typeof parsed.contextLine === "string" ? asSentence(parsed.contextLine) : "";
  const actionLineRaw = typeof parsed.actionLine === "string" ? asSentence(parsed.actionLine) : "";

  if (riskLineRaw && contextLineRaw && actionLineRaw) {
    const tldrCandidate =
      (typeof parsed.tldr === "string" && normalizeSummaryText(parsed.tldr)) ||
      normalizeSummaryText([riskLineRaw, contextLineRaw, actionLineRaw].join(" "));
    if (!tldrCandidate) return null;
    return {
      riskLine: riskLineRaw,
      contextLine: contextLineRaw,
      actionLine: actionLineRaw,
      tldr: tldrCandidate,
    };
  }

  const fallbackSummary =
    (typeof parsed.summary === "string" && normalizeSummaryText(parsed.summary)) ||
    (typeof parsed.tldr === "string" && normalizeSummaryText(parsed.tldr)) ||
    (Array.isArray(parsed.sentences)
      ? normalizeSummaryText(
          parsed.sentences
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .join(" "),
        )
      : null);
  if (!fallbackSummary) return null;
  const lines = dedupe(toSentenceArray(fallbackSummary)).slice(0, 3);
  if (lines.length < 3) return null;
  return {
    riskLine: lines[0],
    contextLine: lines[1],
    actionLine: lines[2],
    tldr: lines.join(" "),
  };
};

const ANCHOR_STOP_WORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "when",
  "where",
  "which",
  "label",
  "source",
  "general",
  "watch",
  "outs",
  "summary",
  "conservative",
  "risk",
  "limited",
  "missing",
  "fields",
  "context",
  "lines",
  "line",
]);

const collectAnchorTokens = (packet: SafetySummaryPacket): string[] => {
  const raw = [
    packet.selectedIngredient,
    ...(packet.labelLines ?? []),
    ...(packet.ulLines ?? []),
    ...(packet.interactionLines ?? []),
  ]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join(" ")
    .toLowerCase();
  if (!raw) return [];
  const tokens = raw
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !ANCHOR_STOP_WORDS.has(token));
  return Array.from(new Set(tokens)).slice(0, 10);
};

const hasAnchorHit = (summary: ParsedSafetySummary, anchorTokens: string[]): boolean => {
  if (anchorTokens.length === 0) return true;
  const haystack = `${summary.riskLine} ${summary.contextLine} ${summary.actionLine}`.toLowerCase();
  return anchorTokens.some((token) => haystack.includes(token));
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("llm_timeout")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export const compileUsageSummaryAsync = async (
  input: unknown,
  opts?: CompileUsageSummaryOpts,
): Promise<UsageSummaryResponse> => {
  const packet = usageSummaryPacketSchema.parse(input);
  const fallback = buildUsageFallbackSummary(packet);
  const llmFn = opts?.llmFn;

  if (!llmFn) {
    return fallback;
  }

  const timeoutMs = opts?.timeoutMs ?? LLM_USAGE_SUMMARY_TIMEOUT_MS;
  const maxRetries = opts?.maxRetries ?? LLM_USAGE_SUMMARY_MAX_RETRIES;
  const prompt = buildUsageSummaryPrompt(packet);
  let lastError: LlmVerifierReasonCode = "LLM_CALL_FAILED";

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const raw = await withTimeout(llmFn(prompt), timeoutMs);
      const summary = parseUsageSummaryFromLlm(raw);
      if (!summary) {
        lastError = "LLM_SCHEMA_INVALID";
        continue;
      }
      return {
        tldr: summary,
        source: "api",
        fallbackUsed: false,
        reasonCode: "LLM_OK",
      };
    } catch (error) {
      if (error instanceof Error && error.message === "llm_timeout") {
        lastError = "LLM_CALL_FAILED";
      } else {
        lastError = "LLM_CALL_FAILED";
      }
    }
  }

  return {
    ...fallback,
    reasonCode: lastError,
  };
};

export const compileSafetySummaryAsync = async (
  input: unknown,
  opts?: CompileSafetySummaryOpts,
): Promise<SafetySummaryResponse> => {
  const packet = safetySummaryPacketSchema.parse(input);
  const fallback = buildSafetyFallbackSummary(packet);
  const anchorTokens = collectAnchorTokens(packet);
  const llmFn = opts?.llmFn;

  if (!llmFn) {
    return fallback;
  }

  const timeoutMs = opts?.timeoutMs ?? LLM_USAGE_SUMMARY_TIMEOUT_MS;
  const maxRetries = opts?.maxRetries ?? LLM_USAGE_SUMMARY_MAX_RETRIES;
  const prompt = buildSafetySummaryPrompt(packet);
  let lastError: LlmVerifierReasonCode = "LLM_CALL_FAILED";

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const raw = await withTimeout(llmFn(prompt), timeoutMs);
      const summary = parseSafetySummaryFromLlm(raw);
      if (!summary) {
        lastError = "LLM_SCHEMA_INVALID";
        continue;
      }
      if (!hasAnchorHit(summary, anchorTokens)) {
        lastError = "LLM_VERIFIER_REJECTED";
        continue;
      }
      return {
        tldr: summary.tldr,
        riskLine: summary.riskLine,
        contextLine: summary.contextLine,
        actionLine: summary.actionLine,
        source: "api",
        fallbackUsed: false,
        reasonCode: "LLM_OK",
      };
    } catch (error) {
      if (error instanceof Error && error.message === "llm_timeout") {
        lastError = "LLM_CALL_FAILED";
      } else {
        lastError = "LLM_CALL_FAILED";
      }
    }
  }

  return {
    ...fallback,
    reasonCode: lastError,
  };
};
