import { z } from 'zod';

import type { LlmVerifierReasonCode } from './reasonCodes.js';

const nonEmptyString = z.string().trim().min(1);
const viewModeSchema = z.literal('details').optional();

const sourceTagSchema = z.enum(['Facts', 'Dataset', 'KB', 'ODS', 'ReviewedKB']);
const safeScienceSignalSourceSchema = z.enum(['subset', 'fallback', 'none']);
const safeScienceFallbackTypeSchema = z.enum(['best_for', 'comparison']).nullable();

const legacyPacketSchema = z
  .object({
    viewMode: viewModeSchema,
    ingredient: z
      .object({
        name: nonEmptyString,
        amount: z.number().finite().nullable().optional(),
        unit: z.string().trim().min(1).nullable().optional(),
        form: z.string().trim().min(1).nullable().optional(),
      })
      .strict(),
    productSpecificInsights: z
      .array(
        z
          .object({
            type: nonEmptyString,
            text: nonEmptyString,
            source: sourceTagSchema,
          })
          .strict(),
      )
      .default([]),
    safety: z
      .array(
        z
          .object({
            text: nonEmptyString,
            source: sourceTagSchema,
            assumptionBased: z.boolean().optional(),
          })
          .strict(),
      )
      .default([]),
    generalBackground: z
      .array(
        z
          .object({
            text: nonEmptyString,
            source: sourceTagSchema,
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

const v11PacketSchema = z
  .object({
    locale: z.string().trim().min(2).max(8).optional(),
    viewMode: viewModeSchema,
    ingredientName: nonEmptyString,
    facts: z
      .object({
        amount: z.number().finite().nullable().optional(),
        unit: z.string().trim().min(1).nullable().optional(),
        formText: z.string().trim().min(1).nullable().optional(),
      })
      .strict()
      .optional(),
    insight: z
      .object({
        rbfBand: z.enum(['high', 'normal', 'low', 'unknown']).optional(),
        rbfFactor: z.number().finite().nullable().optional(),
        confidenceTier: z.enum(['high', 'medium', 'low', 'none']).optional(),
        whyBullets: z.array(nonEmptyString).max(8).optional(),
        doseStatus: z.enum(['below_typical', 'within_typical', 'above_typical', 'unknown']).optional(),
        dailyAmount: z.number().finite().nullable().optional(),
        dailyUnit: z.string().trim().min(1).nullable().optional(),
      })
      .strict()
      .optional(),
    reviewedKbBullets: z.array(nonEmptyString).max(8).optional(),
    odsBullets: z.array(nonEmptyString).max(8).optional(),
    safeScienceBullets: z.array(nonEmptyString).max(8).optional(),
    safeScienceBeforeYouBuy: z.string().trim().min(1).nullable().optional(),
    safeScienceFormImpact: z.string().trim().min(1).nullable().optional(),
    safeScienceSignalSource: safeScienceSignalSourceSchema.optional(),
    safeScienceFallbackType: safeScienceFallbackTypeSchema.optional(),
    directionsText: z.string().trim().min(1).nullable().optional(),
    supportBullets: z.array(nonEmptyString).max(6).optional(),
    missingHighImpact: z.array(nonEmptyString).max(6).optional(),
  })
  .strict();

const dashboardCompatPacketSchema = z
  .object({
    locale: z.string().trim().min(2).max(8).optional(),
    viewMode: viewModeSchema,
    ingredientName: nonEmptyString,
    labelFacts: z
      .object({
        dose: z.string().trim().min(1).nullable().optional(),
      })
      .strict()
      .optional(),
    productSignals: z
      .object({
        formLabel: z.string().trim().min(1).nullable().optional(),
        effectiveFactor: z.number().finite().nullable().optional(),
        rbfBand: z.enum(['high', 'normal', 'low', 'unknown']).optional(),
        confidenceTier: z.enum(['high', 'medium', 'low', 'none']).optional(),
        why: z.string().trim().min(1).nullable().optional(),
        doseSignal: z
          .object({
            status: z.string().trim().min(1),
            dailyAmount: z.number().finite().nullable().optional(),
            unit: z.string().trim().min(1).nullable().optional(),
          })
          .strict()
          .nullable()
          .optional(),
      })
      .strict()
      .nullable()
      .optional(),
    runtimeNotes: z.record(z.string(), z.array(nonEmptyString)).nullable().optional(),
    safeScienceBullets: z.array(nonEmptyString).max(8).optional(),
    safeScienceBeforeYouBuy: z.string().trim().min(1).nullable().optional(),
    safeScienceFormImpact: z.string().trim().min(1).nullable().optional(),
    safeScienceSignalSource: safeScienceSignalSourceSchema.optional(),
    safeScienceFallbackType: safeScienceFallbackTypeSchema.optional(),
    directionsText: z.string().trim().min(1).nullable().optional(),
    supportBullets: z.array(nonEmptyString).max(6).optional(),
    missingHighImpact: z.array(nonEmptyString).max(6).optional(),
  })
  .strict();

const packetSchema = z.union([legacyPacketSchema, v11PacketSchema, dashboardCompatPacketSchema]);
type Packet = z.infer<typeof packetSchema>;
type LegacyPacket = z.infer<typeof legacyPacketSchema>;
type V11Packet = z.infer<typeof v11PacketSchema>;
type DashboardCompatPacket = z.infer<typeof dashboardCompatPacketSchema>;

export type IngredientSummaryResponse = {
  tldr: string;
  highlights: string[];
  caveats: string[];
  confidence_note: string;
  confidenceNote: string;
  sources_used: {
    facts: boolean;
    dataset: boolean;
    reviewedKB: boolean;
    ods: boolean;
  };
  sourcesUsed: Array<'Facts' | 'Dataset' | 'KB' | 'ODS' | 'ReviewedKB'>;
  fallbackUsed: boolean;
  guardApplied: boolean;
  summaryVersion: string;
  reasonCode: LlmVerifierReasonCode;
};

const asSentence = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const dedupe = (items: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = item.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(item.trim());
  }
  return out;
};

const disallowedMedicalClaimPatterns: RegExp[] = [
  /\bcure(?:s|d|ing)?\b/i,
  /\btreat(?:s|ed|ing|ment)?\b/i,
  /\bheal(?:s|ed|ing)?\b/i,
  /\bguarantee(?:s|d)?\b/i,
  /\bclinical proof\b/i,
  /\bproven to\b/i,
];
const technicalLeakPattern = /\brbf\b|match score|dataset signal|confidence tier|reason code|within_typical|below_typical|above_typical|reviewed[_\s]?kb|verified dataset|kb:|needs_capture|needs_edit|review_status/i;
const fluffPattern = /\bnormal function\b|\bday-to-day wellness\b|\bwellness outcomes?\b/i;
const SUMMARY_VERSION_DETAILS = 'v1.6.16-details-1';

const containsDisallowed = (text: string): boolean => {
  return disallowedMedicalClaimPatterns.some((pattern) => pattern.test(text));
};

const splitSentences = (value: string): string[] =>
  value
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const normalizeThreeSentenceSummary = (value: string): string | null => {
  const sentences = splitSentences(value);
  if (sentences.length < 3) return null;
  return sentences.slice(0, 3).map((line) => asSentence(line)).join(' ');
};

const isLegacyPacket = (input: Packet): input is LegacyPacket =>
  'ingredient' in input;

const isV11Packet = (input: Packet): input is V11Packet =>
  'facts' in input || 'insight' in input || 'reviewedKbBullets' in input || 'odsBullets' in input;

const normalizeCompatPacket = (input: Packet) => {
  if (isLegacyPacket(input)) {
    return {
      viewMode: input.viewMode ?? 'details',
      ingredientName: input.ingredient.name,
      amount: input.ingredient.amount ?? null,
      unit: input.ingredient.unit ?? null,
      formText: input.ingredient.form ?? null,
      rbfBand: 'unknown' as const,
      rbfFactor: null as number | null,
      confidenceTier: 'none' as const,
      whyBullets: input.productSpecificInsights.map((row) => row.text),
      doseStatus: 'unknown' as const,
      dailyAmount: null as number | null,
      dailyUnit: null as string | null,
      reviewedKbBullets: input.generalBackground.map((row) => row.text),
      odsBullets: [],
      safeScienceBullets: [],
      safeScienceBeforeYouBuy: null as string | null,
      safeScienceFormImpact: null as string | null,
      safeScienceSignalSource: 'none' as const,
      safeScienceFallbackType: null as 'best_for' | 'comparison' | null,
      directionsText: null as string | null,
      supportBullets: [] as string[],
      missingHighImpact: [] as string[],
      used: {
        facts: true,
        dataset: input.productSpecificInsights.length > 0,
        reviewedKB: input.generalBackground.length > 0,
        ods: input.generalBackground.some((row) => row.source === 'ODS'),
      },
    };
  }

  if (isV11Packet(input)) {
    return {
      viewMode: input.viewMode ?? 'details',
      ingredientName: input.ingredientName,
      amount: input.facts?.amount ?? null,
      unit: input.facts?.unit ?? null,
      formText: input.facts?.formText ?? null,
      rbfBand: input.insight?.rbfBand ?? 'unknown',
      rbfFactor: input.insight?.rbfFactor ?? null,
      confidenceTier: input.insight?.confidenceTier ?? 'none',
      whyBullets: input.insight?.whyBullets ?? [],
      doseStatus: input.insight?.doseStatus ?? 'unknown',
      dailyAmount: input.insight?.dailyAmount ?? null,
      dailyUnit: input.insight?.dailyUnit ?? null,
      reviewedKbBullets: input.reviewedKbBullets ?? [],
      odsBullets: input.odsBullets ?? [],
      safeScienceBullets: input.safeScienceBullets ?? [],
      safeScienceBeforeYouBuy: input.safeScienceBeforeYouBuy ?? null,
      safeScienceFormImpact: input.safeScienceFormImpact ?? null,
      safeScienceSignalSource: input.safeScienceSignalSource ?? 'none',
      safeScienceFallbackType: input.safeScienceFallbackType ?? null,
      directionsText: input.directionsText ?? null,
      supportBullets: input.supportBullets ?? [],
      missingHighImpact: input.missingHighImpact ?? [],
      used: {
        facts: Boolean(input.facts),
        dataset: Boolean(input.insight),
        reviewedKB: (input.reviewedKbBullets?.length ?? 0) > 0,
        ods: (input.odsBullets?.length ?? 0) > 0,
      },
    };
  }

  const compatInput = input as DashboardCompatPacket;
  const runtimeBullets = Object.values(compatInput.runtimeNotes ?? {}).flat();
  return {
    viewMode: compatInput.viewMode ?? 'details',
    ingredientName: compatInput.ingredientName,
    amount: null,
    unit: null,
    formText: compatInput.productSignals?.formLabel ?? null,
    rbfBand: compatInput.productSignals?.rbfBand ?? 'unknown',
    rbfFactor: compatInput.productSignals?.effectiveFactor ?? null,
    confidenceTier: compatInput.productSignals?.confidenceTier ?? 'none',
    whyBullets: [compatInput.productSignals?.why].filter((v): v is string => Boolean(v && v.trim())),
    doseStatus: (compatInput.productSignals?.doseSignal?.status as any) ?? 'unknown',
    dailyAmount: compatInput.productSignals?.doseSignal?.dailyAmount ?? null,
    dailyUnit: compatInput.productSignals?.doseSignal?.unit ?? null,
    reviewedKbBullets: runtimeBullets,
    odsBullets: [],
    safeScienceBullets: compatInput.safeScienceBullets ?? [],
    safeScienceBeforeYouBuy: compatInput.safeScienceBeforeYouBuy ?? null,
    safeScienceFormImpact: compatInput.safeScienceFormImpact ?? null,
    safeScienceSignalSource: compatInput.safeScienceSignalSource ?? 'none',
    safeScienceFallbackType: compatInput.safeScienceFallbackType ?? null,
    directionsText: compatInput.directionsText ?? null,
    supportBullets: compatInput.supportBullets ?? [],
    missingHighImpact: compatInput.missingHighImpact ?? [],
    used: {
      facts: Boolean(compatInput.labelFacts?.dose),
      dataset: Boolean(compatInput.productSignals),
      reviewedKB: runtimeBullets.length > 0,
      ods: false,
    },
  };
};

const buildDeterministicSummary = (input: ReturnType<typeof normalizeCompatPacket>): IngredientSummaryResponse => {
  const supportLineCandidate = input.safeScienceBullets[0]
    ?? input.supportBullets[0]
    ?? input.odsBullets[0]
    ?? `${input.ingredientName} is commonly selected for ingredient-level support goals.`;
  const supportLineRaw = fluffPattern.test(supportLineCandidate)
    ? `${input.ingredientName} is commonly selected for ingredient-level support goals.`
    : supportLineCandidate;
  const doseText =
    typeof input.amount === 'number' && input.unit
      ? `${input.amount} ${input.unit}`
      : input.unit
        ? `an amount in ${input.unit}`
        : 'an amount that is not clearly listed in this record';
  const directionsText = input.directionsText
    ? input.directionsText
    : 'directions are not included in the official record';
  const productLineRaw = `This product provides ${doseText}, and ${directionsText}.`;
  const missingWarning = input.missingHighImpact.some((reason) => /warning/i.test(reason));
  const missingDirections = input.missingHighImpact.some((reason) => /direction/i.test(reason));
  const limitationLineRaw = input.safeScienceBeforeYouBuy
    ? input.safeScienceBeforeYouBuy
    : missingWarning
    ? 'Product-specific warnings were not available in the official record, so check the package for label-specific cautions.'
    : missingDirections
      ? 'Directions were not provided in this record, so check the package label before use.'
      : 'Use the product label first and consult a clinician for personal risk factors.';
  const tldr = [
    asSentence(supportLineRaw),
    asSentence(productLineRaw),
    asSentence(limitationLineRaw),
  ].join(' ');

  const highlights = dedupe(
    [
      asSentence(supportLineRaw),
      input.safeScienceFormImpact ? asSentence(input.safeScienceFormImpact) : '',
      typeof input.amount === 'number' && input.unit
        ? asSentence(`This product provides ${input.amount} ${input.unit}.`)
        : asSentence('Use the product label for exact ingredient amounts.'),
      input.directionsText
        ? asSentence(`Directions from record: ${input.directionsText}`)
        : asSentence('Directions are not provided in this record.'),
    ],
  ).slice(0, 3);

  const caveats = dedupe(
    [
      asSentence('This summary is informational and not medical advice.'),
      missingWarning
        ? asSentence('Label-specific warnings were not available in this record.')
        : missingDirections
          ? asSentence('Direction details were incomplete in this record.')
          : asSentence('Always review the package label for complete instructions.'),
    ],
  ).slice(0, 2);

  const confidence_note = asSentence('Built from verified record fields and general science references.');

  const sourcesUsed = dedupe(
    [
      input.used.facts ? 'Facts' : '',
      input.used.dataset ? 'Dataset' : '',
      input.used.reviewedKB ? 'ReviewedKB' : '',
      input.used.ods ? 'ODS' : '',
    ].filter(Boolean),
  ) as Array<'Facts' | 'Dataset' | 'KB' | 'ODS' | 'ReviewedKB'>;

  return {
    tldr,
    highlights,
    caveats,
    confidence_note,
    confidenceNote: confidence_note,
    sources_used: {
      facts: input.used.facts,
      dataset: input.used.dataset,
      reviewedKB: input.used.reviewedKB,
      ods: input.used.ods,
    },
    sourcesUsed,
    fallbackUsed: true,
    guardApplied: true,
    summaryVersion: SUMMARY_VERSION_DETAILS,
    reasonCode: 'LLM_FALLBACK_USED',
  };
};

export type JsonExtractResult =
  | { ok: true; parsed: unknown; parsePath: "direct" | "fence_strip" | "brace_extract" | "safe_repair" }
  | { ok: false; reason: "non_json" | "parse_error" };

/**
 * P0-1: Resilient JSON extraction sequence.
 * Tries: direct parse → fence strip → brace extract → safe repair → fail.
 */
export const extractJsonObjectLoose = (raw: string): JsonExtractResult => {
  const trimmed = raw.trim();

  // 1. Direct parse
  try {
    return { ok: true, parsed: JSON.parse(trimmed), parsePath: "direct" };
  } catch { /* continue */ }

  // 2. Fence strip (```json ... ```)
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      return { ok: true, parsed: JSON.parse(fenceMatch[1].trim()), parsePath: "fence_strip" };
    } catch { /* continue */ }
  }

  // 3. Brace extract (first { ... } block)
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    const extracted = trimmed.slice(braceStart, braceEnd + 1);
    try {
      return { ok: true, parsed: JSON.parse(extracted), parsePath: "brace_extract" };
    } catch { /* continue */ }
  }

  // 4. Safe repair (trailing commas, control chars)
  if (braceStart >= 0 && braceEnd > braceStart) {
    const extracted = trimmed.slice(braceStart, braceEnd + 1);
    const repaired = extracted
      .replace(/,(\s*[}\]])/g, '$1')        // trailing commas
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ''); // control chars
    try {
      return { ok: true, parsed: JSON.parse(repaired), parsePath: "safe_repair" };
    } catch { /* continue */ }
  }

  if (braceStart < 0 || braceEnd <= braceStart) {
    return { ok: false, reason: "non_json" };
  }
  return { ok: false, reason: "parse_error" };
};

/** Default LLM function type for dependency injection */
type LlmFn = (prompt: string) => Promise<string>;

/** Options for compileIngredientSummary */
export type CompileOpts = {
  llmFn?: LlmFn;
  timeoutMs?: number;
  maxRetries?: number;
  regression?: boolean;
};

const LLM_SUMMARY_TIMEOUT_MS = 8000;
const LLM_SUMMARY_MAX_RETRIES = 1;

/**
 * P0-1: Build the LLM prompt for ingredient summary generation.
 */
const buildSummaryPrompt = (normalized: ReturnType<typeof normalizeCompatPacket>): string => {
  const supportBullets = (
    normalized.safeScienceBullets.length > 0
      ? normalized.safeScienceBullets
      : normalized.supportBullets.length > 0
        ? normalized.supportBullets
        : normalized.odsBullets
  ).slice(0, 3);
  const missingHighImpact = normalized.missingHighImpact.slice(0, 3);
  const parts = [
    `Write a consumer-friendly summary for supplement ingredient "${normalized.ingredientName}".`,
    `Mode: ${normalized.viewMode}.`,
  ];
  if (normalized.amount != null && normalized.unit) {
    parts.push(`Verified amount: ${normalized.amount} ${normalized.unit}.`);
  }
  if (normalized.directionsText) {
    parts.push(`Verified directions: ${normalized.directionsText}.`);
  }
  if (supportBullets.length > 0) {
    parts.push(`General support bullets: ${supportBullets.join(' | ')}`);
  }
  if (missingHighImpact.length > 0) {
    parts.push(`High-impact missing fields: ${missingHighImpact.join(', ')}`);
  }
  parts.push(
    `Respond with ONLY a JSON object: {"tldr":"...","highlights":["..."],"caveats":["..."]}`,
    `Rules:`,
    `- tldr MUST be exactly 3 sentences.`,
    `- Sentence 1: what it may help support (general).`,
    `- Sentence 2: what this product provides (amount and directions if available).`,
    `- Sentence 3: top limitation (for example missing warnings or missing directions).`,
    `- Use plain language. Avoid technical terms like RBF, match score, confidence tier, reason code, reviewed KB.`,
    `- Avoid vague phrases like "normal function" or "day-to-day wellness".`,
    `- No medical claims (cure/treat/heal/guarantee).`,
    `- Keep highlights and caveats optional and concise.`,
  );
  return parts.join('\n');
};

/**
 * P0-1: Validate LLM response shape.
 */
const validateSummaryShape = (
  parsed: unknown,
): { tldr: string; highlights: string[]; caveats: string[] } | null => {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.tldr !== 'string' || !obj.tldr.trim()) return null;
  if (!Array.isArray(obj.highlights)) return null;
  if (!Array.isArray(obj.caveats)) return null;
  return {
    tldr: String(obj.tldr).trim(),
    highlights: obj.highlights.filter((h): h is string => typeof h === 'string' && h.trim().length > 0).slice(0, 3),
    caveats: obj.caveats.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).slice(0, 3),
  };
};

export const compileIngredientSummary = (input: unknown): IngredientSummaryResponse => {
  const parsed = packetSchema.parse(input);
  const normalized = normalizeCompatPacket(parsed);
  const fallback = buildDeterministicSummary(normalized);

  // Synchronous path: returns deterministic fallback (backward compatible).
  // Use compileIngredientSummaryAsync for the LLM-enhanced path.
  return {
    ...fallback,
    reasonCode: 'FALLBACK_DETERMINISTIC',
  };
};

/**
 * P0-1: Async version with real DeepSeek LLM call.
 * Falls back to deterministic summary on failure.
 */
export const compileIngredientSummaryAsync = async (
  input: unknown,
  opts?: CompileOpts,
): Promise<IngredientSummaryResponse & { debug?: { llmRawPreview?: string; parsePath?: string } }> => {
  const parsed = packetSchema.parse(input);
  const normalized = normalizeCompatPacket(parsed);
  const fallback = buildDeterministicSummary(normalized);

  const llmFn = opts?.llmFn;
  if (!llmFn) {
    return {
      ...fallback,
      reasonCode: 'FALLBACK_DETERMINISTIC',
    };
  }

  const timeoutMs = opts?.timeoutMs ?? LLM_SUMMARY_TIMEOUT_MS;
  const maxRetries = opts?.maxRetries ?? LLM_SUMMARY_MAX_RETRIES;
  const isRegression = opts?.regression === true;

  const prompt = buildSummaryPrompt(normalized);
  let lastError: string | null = null;
  let llmRawPreview: string | null = null;
  let parsePath: string | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let raw: string;
      try {
        raw = await llmFn(prompt);
      } finally {
        clearTimeout(timer);
      }

      llmRawPreview = raw.slice(0, 500);
      const jsonResult = extractJsonObjectLoose(raw);

      if (!jsonResult.ok) {
        lastError = 'LLM_PARSE_FAILED_NON_JSON';
        continue;
      }
      parsePath = jsonResult.parsePath;

      const validated = validateSummaryShape(jsonResult.parsed);
      if (!validated) {
        lastError = 'LLM_SCHEMA_INVALID';
        continue;
      }

      // Verify no disallowed medical claims or technical leakage.
      const joined = [validated.tldr, ...validated.highlights, ...validated.caveats].join(' ');
      if (containsDisallowed(joined)) {
        lastError = 'LLM_VERIFIER_REJECTED';
        continue;
      }
      if (technicalLeakPattern.test(joined)) {
        lastError = 'LLM_VERIFIER_REJECTED';
        continue;
      }
      if (fluffPattern.test(joined)) {
        lastError = 'LLM_VERIFIER_REJECTED';
        continue;
      }
      const normalizedTldr = normalizeThreeSentenceSummary(validated.tldr);
      if (!normalizedTldr) {
        lastError = 'LLM_VERIFIER_REJECTED';
        continue;
      }

      // Build sources
      const sourcesUsed = dedupe(
        [
          normalized.used.facts ? 'Facts' : '',
          normalized.used.dataset ? 'Dataset' : '',
          normalized.used.reviewedKB ? 'ReviewedKB' : '',
          normalized.used.ods ? 'ODS' : '',
        ].filter(Boolean),
      ) as Array<'Facts' | 'Dataset' | 'KB' | 'ODS' | 'ReviewedKB'>;

      const confidenceNote = asSentence(
        'Grounded to verified record fields and general science references.',
      );

      const result: IngredientSummaryResponse & { debug?: { llmRawPreview?: string; parsePath?: string } } = {
        tldr: normalizedTldr,
        highlights: validated.highlights.length ? validated.highlights : fallback.highlights,
        caveats: validated.caveats.length ? validated.caveats : fallback.caveats,
        confidence_note: confidenceNote,
        confidenceNote,
        sources_used: normalized.used,
        sourcesUsed,
        fallbackUsed: false,
        guardApplied: true,
        summaryVersion: SUMMARY_VERSION_DETAILS,
        reasonCode: 'LLM_OK',
      };

      if (isRegression) {
        result.debug = {
          llmRawPreview: llmRawPreview ?? undefined,
          parsePath: parsePath ?? undefined,
        };
      }

      return result;
    } catch (err) {
      lastError = 'LLM_CALL_FAILED';
    }
  }

  // All attempts failed, return deterministic fallback
  const result: IngredientSummaryResponse & { debug?: { llmRawPreview?: string; parsePath?: string } } = {
    ...fallback,
    guardApplied: true,
    summaryVersion: SUMMARY_VERSION_DETAILS,
    reasonCode: (lastError ?? 'LLM_CALL_FAILED') as LlmVerifierReasonCode,
  };

  if (isRegression) {
    result.debug = {
      llmRawPreview: llmRawPreview ?? undefined,
      parsePath: parsePath ?? undefined,
    };
  }

  return result;
};

export const ingredientSummaryPacketSchema = packetSchema;
