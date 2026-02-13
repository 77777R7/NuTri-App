import { performance } from "node:perf_hooks";

import type { AnalysisBundle, BasisTag, UsageField } from "./analysisBundle.js";
import type { FactsDigest } from "./factsDigest.js";

export type VerifyReviseStatus = "ok" | "degraded" | "failed";

export type WebVerifyMeta = {
  verifyStatus: VerifyReviseStatus;
  reviseStatus: VerifyReviseStatus;
  revisedClaimsCount: number;
  droppedClaimsCount: number;
  injectionClaimDroppedCount?: number;
  // Optional by design: avoid shipping non-deterministic timing into public bundles.
  // Populated only for regression-token requests.
  budgetUsedMs?: number;
  // Preferred deterministic counters for metrics and audits.
  checkedClaimsCount?: number;
  supportedClaimsCount?: number;
  unsupportedClaimsCount?: number;
  abstainedClaimsCount?: number;
  fallbackCode?: string;
};

export type WebVerifyReviseResult = {
  bundle: AnalysisBundle;
  verify: { status: VerifyReviseStatus; code?: string };
  revise: { status: VerifyReviseStatus; code?: string };
  meta: WebVerifyMeta;
};

export type WebVerifyReviseOptions = {
  timeBudgetMs?: number;
  includeBudgetMs?: boolean;
};

const NOT_PROVIDED_TAGS: BasisTag[] = ["not_provided"];
const NOT_PROVIDED_TEXT = "Not provided by source.";
const CHEMICAL_FORM_NOT_PROVIDED_TEXT = "Chemical form not provided by source.";

const buildNotProvidedField = (text: string): UsageField => ({
  text,
  basisTags: NOT_PROVIDED_TAGS,
});

const normalizeForTokens = (value: string): string =>
  value
    .toLowerCase()
    // Join common "number + unit" pairs so dosage evidence isn't lost due to token length thresholds.
    .replace(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|iu|g|ml)\b/gi, "$1$2")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasText = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

const tokenize = (value: string): string[] => {
  const normalized = normalizeForTokens(value);
  if (!normalized) return [];
  return normalized.split(" ").map((token) => token.trim()).filter(Boolean);
};

const buildEvidenceCorpus = (digest: FactsDigest): string => {
  const segments: string[] = [];
  for (const active of digest.actives) {
    if (hasText(active.evidenceText)) segments.push(String(active.evidenceText));
  }
  for (const dose of digest.labelDosing) {
    if (hasText(dose.rawText)) segments.push(String(dose.rawText));
  }
  for (const warning of digest.warnings.warnings) {
    if (hasText(warning)) segments.push(String(warning));
  }
  if (hasText(digest.serving.servingSize)) {
    segments.push(String(digest.serving.servingSize));
  }
  return normalizeForTokens(segments.join(" "));
};

const buildActiveTokenSet = (digest: FactsDigest): Set<string> => {
  const out = new Set<string>();
  for (const active of digest.actives) {
    for (const token of tokenize(String(active.name ?? ""))) {
      if (token.length >= 4) out.add(token);
    }
  }
  return out;
};

const buildEvidenceTokenSet = (evidenceCorpus: string, activeTokens: Set<string>): Set<string> => {
  const out = new Set<string>();
  for (const token of tokenize(evidenceCorpus)) {
    if (token.length < 4) continue;
    if (activeTokens.has(token)) continue;
    out.add(token);
  }
  return out;
};

const MARKETING_PATTERNS: RegExp[] = [
  /\boverall wellness\b/i,
  /\bultimate\b/i,
  /\bmiracle\b/i,
  /\bdetox\b/i,
  /\bboost(?:s)?\s+metabolism\b/i,
  /\bno\s+side\s+effects\b/i,
  /\bclinically\s+proven\b/i,
];

// Prompt-injection heuristic (defense-in-depth). Require BOTH:
// - an "intent" verb, AND
// - a sensitive target object
// This reduces false positives for benign mentions like "system prompt" in meta discussions.
const INJECTION_INTENT_RE =
  /\b(ignore|disregard|reveal|show|output|follow|pretend|jailbreak|instruct)\b/i;
const INJECTION_OBJECT_RE =
  /\b(system\s+prompt|developer\s+message|chain\s+of\s+thought|hidden\s+instructions|internal\s+instructions|policy)\b/i;

const looksLikeInjectionAttempt = (raw: string): boolean => {
  const normalized = normalizeForTokens(String(raw ?? ""));
  if (!normalized) return false;
  return INJECTION_INTENT_RE.test(normalized) && INJECTION_OBJECT_RE.test(normalized);
};

const hasSpecificToken = (raw: string): boolean => {
  const v = String(raw ?? "");
  if (/\d/.test(v)) return true;
  const normalized = normalizeForTokens(v);
  if (/\b\d+(?:\.\d+)?(?:mg|mcg|iu|g|ml)\b/i.test(normalized)) return true;
  if (
    /\b(daily|once|twice|morning|evening|bedtime|breakfast|lunch|dinner|with\s+meals?|before|after)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }
  return false;
};

const looksLikeMarketingFluff = (raw: string): boolean => {
  const normalized = normalizeForTokens(String(raw ?? ""));
  if (!normalized) return false;
  return MARKETING_PATTERNS.some((re) => re.test(normalized)) && !hasSpecificToken(raw);
};

const hasNegation = (value: string): boolean => /\b(no|not|without)\b/i.test(String(value ?? ""));

const shouldTreatAsAbstained = (claim: string | null | undefined): boolean => {
  if (!hasText(claim)) return true;
  const trimmed = String(claim).trim();
  if (!trimmed) return true;
  return trimmed === NOT_PROVIDED_TEXT || trimmed === CHEMICAL_FORM_NOT_PROVIDED_TEXT;
};

export const applyWebVerifyRevise = (
  bundle: AnalysisBundle,
  digest: FactsDigest,
  options: WebVerifyReviseOptions = {},
): WebVerifyReviseResult => {
  if (digest.sourceType !== "web") {
    const passthroughMeta: WebVerifyMeta = {
      verifyStatus: "ok",
      reviseStatus: "ok",
      revisedClaimsCount: 0,
      droppedClaimsCount: 0,
    };
    return {
      bundle,
      verify: { status: "ok" },
      revise: { status: "ok" },
      meta: passthroughMeta,
    };
  }

  const startedAt = performance.now();
  const includeBudgetMs = options.includeBudgetMs === true;
  const timeBudgetMs =
    Number.isFinite(options.timeBudgetMs) && (options.timeBudgetMs ?? 0) > 0
      ? Number(options.timeBudgetMs)
      : 200;
  const evidenceCorpus = buildEvidenceCorpus(digest);
  const activeTokens = buildActiveTokenSet(digest);
  const evidenceTokens = buildEvidenceTokenSet(evidenceCorpus, activeTokens);
  const evidenceHasNegation = hasNegation(evidenceCorpus);

  let checkedClaimsCount = 0;
  let supportedClaimsCount = 0;
  let unsupportedClaimsCount = 0;
  let abstainedClaimsCount = 0;
  let revisedClaimsCount = 0;
  let droppedClaimsCount = 0;
  let injectionClaimDroppedCount = 0;
  let budgetExhausted = false;

  const isOverBudget = (): boolean => performance.now() - startedAt > timeBudgetMs;

  if (!evidenceCorpus) {
    abstainedClaimsCount += 1;
    const degradedMeta: WebVerifyMeta = {
      verifyStatus: "degraded",
      reviseStatus: "degraded",
      revisedClaimsCount: 0,
      droppedClaimsCount: 0,
      checkedClaimsCount: 0,
      supportedClaimsCount: 0,
      unsupportedClaimsCount: 0,
      abstainedClaimsCount,
      fallbackCode: "web_text_unusable",
      ...(includeBudgetMs ? { budgetUsedMs: Math.round(performance.now() - startedAt) } : {}),
    };
    return {
      bundle: {
        ...bundle,
        meta: {
          ...bundle.meta,
          webVerifyMeta: degradedMeta,
        },
      },
      verify: { status: "degraded", code: "web_text_unusable" },
      revise: { status: "degraded", code: "web_text_unusable" },
      meta: degradedMeta,
    };
  }

  const assessClaimSupport = (claim: string): boolean => {
    if (budgetExhausted || isOverBudget()) {
      budgetExhausted = true;
      return false;
    }

    if (looksLikeInjectionAttempt(claim)) {
      injectionClaimDroppedCount += 1;
      return false;
    }

    if (looksLikeMarketingFluff(claim)) {
      return false;
    }

    const normalizedClaim = normalizeForTokens(claim);
    if (!normalizedClaim) return false;

    if (hasNegation(claim) && !evidenceHasNegation) {
      return false;
    }

    const claimTokens = tokenize(normalizedClaim)
      .filter((token) => token.length >= 4)
      .slice(0, 10);
    if (claimTokens.length === 0) return false;

    const overlapCount = claimTokens.filter((token) => evidenceTokens.has(token)).length;
    const overlapRatio = overlapCount / Math.max(1, claimTokens.length);
    return overlapCount >= 2 && overlapRatio >= 0.25;
  };

  const reviseSummary = (summary: string | null | undefined): string => {
    if (shouldTreatAsAbstained(summary)) {
      abstainedClaimsCount += 1;
      return hasText(summary) ? String(summary) : NOT_PROVIDED_TEXT;
    }

    checkedClaimsCount += 1;
    const supported = assessClaimSupport(String(summary));
    if (supported) {
      supportedClaimsCount += 1;
      return String(summary);
    }

    unsupportedClaimsCount += 1;
    droppedClaimsCount += 1;
    revisedClaimsCount += 1;
    return NOT_PROVIDED_TEXT;
  };

  const reviseBullet = (text: string): { text: string; basisTags: BasisTag[] } => {
    if (shouldTreatAsAbstained(text)) {
      abstainedClaimsCount += 1;
      return { text: hasText(text) ? String(text) : NOT_PROVIDED_TEXT, basisTags: NOT_PROVIDED_TAGS };
    }

    checkedClaimsCount += 1;
    const supported = assessClaimSupport(text);
    if (supported) {
      supportedClaimsCount += 1;
      return { text, basisTags: ["web_evidence"] };
    }
    unsupportedClaimsCount += 1;
    droppedClaimsCount += 1;
    revisedClaimsCount += 1;
    return { text: NOT_PROVIDED_TEXT, basisTags: NOT_PROVIDED_TAGS };
  };

  const revisedOverview = bundle.sections.overview
    ? {
        ...bundle.sections.overview,
        cover: bundle.sections.overview.cover
          ? {
              ...bundle.sections.overview.cover,
              summary: reviseSummary(bundle.sections.overview.cover.summary),
              bullets: bundle.sections.overview.cover.bullets.map((bullet) => reviseBullet(bullet.text)),
            }
          : bundle.sections.overview.cover,
        detail: bundle.sections.overview.detail
          ? {
              ...bundle.sections.overview.detail,
              summary: reviseSummary(bundle.sections.overview.detail.summary),
              bullets: bundle.sections.overview.detail.bullets.map((bullet) => reviseBullet(bullet.text)),
            }
          : bundle.sections.overview.detail,
      }
    : bundle.sections.overview;

  const evidenceByActive = new Map<string, boolean>(
    digest.actives.map((active) => [
      normalizeForTokens(active.name),
      hasText(active.evidenceText),
    ]),
  );

  const revisedIngredients = bundle.sections.ingredients?.detail?.items
    ? {
        ...bundle.sections.ingredients,
        detail: {
          ...bundle.sections.ingredients.detail,
          items: bundle.sections.ingredients.detail.items.map((item) => {
            const activeKey = normalizeForTokens(item.name);
            const activeHasEvidence = Boolean(evidenceByActive.get(activeKey));
            const assessIngredientClaim = (
              claim: string | null | undefined,
            ): { supported: boolean; kind: "supported" | "unsupported" | "abstained" } => {
              if (shouldTreatAsAbstained(claim)) {
                abstainedClaimsCount += 1;
                return { supported: false, kind: "abstained" };
              }

              checkedClaimsCount += 1;

              // Ingredient-level claims must have evidence attached to that active.
              if (!activeHasEvidence) {
                unsupportedClaimsCount += 1;
                return { supported: false, kind: "unsupported" };
              }

              const supported = assessClaimSupport(String(claim));
              if (supported) {
                supportedClaimsCount += 1;
                return { supported: true, kind: "supported" };
              }
              unsupportedClaimsCount += 1;
              return { supported: false, kind: "unsupported" };
            };

            const whatItDoesAssessment = assessIngredientClaim(item.whatItDoes.text);
            const doseContextAssessment = assessIngredientClaim(item.doseContext.text);

            if (whatItDoesAssessment.kind === "unsupported") {
              droppedClaimsCount += 1;
              revisedClaimsCount += 1;
            }
            if (whatItDoesAssessment.kind === "abstained" && !hasText(item.whatItDoes.text)) {
              revisedClaimsCount += 1;
            }

            if (doseContextAssessment.kind === "unsupported") {
              revisedClaimsCount += 1;
            }
            if (doseContextAssessment.kind === "abstained" && !hasText(item.doseContext.text)) {
              revisedClaimsCount += 1;
            }

            return {
              ...item,
              whatItDoes: whatItDoesAssessment.kind === "supported"
                ? item.whatItDoes
                : buildNotProvidedField("Not provided by source."),
              doseContext: doseContextAssessment.kind === "supported"
                ? item.doseContext
                : buildNotProvidedField("Not provided by source."),
              chemicalFormExplain: buildNotProvidedField(CHEMICAL_FORM_NOT_PROVIDED_TEXT),
              deliveryFormExplain: null,
            };
          }),
        },
      }
    : bundle.sections.ingredients;

  const verifyStatus: VerifyReviseStatus =
    budgetExhausted || injectionClaimDroppedCount > 0 || unsupportedClaimsCount > 0 ? "degraded" : "ok";
  const reviseStatus: VerifyReviseStatus = revisedClaimsCount > 0 ? "degraded" : "ok";
  const fallbackCode = budgetExhausted
    ? "verify_budget_exhausted"
    : injectionClaimDroppedCount > 0
      ? "verify_injection_detected"
      : unsupportedClaimsCount > 0
        ? "verify_claim_without_support"
        : undefined;

  const meta: WebVerifyMeta = {
    verifyStatus,
    reviseStatus,
    revisedClaimsCount,
    droppedClaimsCount,
    injectionClaimDroppedCount,
    checkedClaimsCount,
    supportedClaimsCount,
    unsupportedClaimsCount,
    abstainedClaimsCount,
    fallbackCode,
    ...(includeBudgetMs ? { budgetUsedMs: Math.round(performance.now() - startedAt) } : {}),
  };

  return {
    bundle: {
      ...bundle,
      meta: {
        ...bundle.meta,
        webVerifyMeta: meta,
      },
      sections: {
        ...bundle.sections,
        overview: revisedOverview,
        ingredients: revisedIngredients,
      },
    },
    verify: {
      status: verifyStatus,
      code: fallbackCode,
    },
    revise: {
      status: reviseStatus,
      code: fallbackCode,
    },
    meta,
  };
};
