import { performance } from "node:perf_hooks";

import type { AnalysisBundle, BasisTag, UsageField } from "./analysisBundle.js";
import type { FactsDigest } from "./factsDigest.js";

export type VerifyReviseStatus = "ok" | "degraded" | "failed";

export type WebVerifyMeta = {
  verifyStatus: VerifyReviseStatus;
  reviseStatus: VerifyReviseStatus;
  revisedClaimsCount: number;
  droppedClaimsCount: number;
  budgetUsedMs: number;
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
};

const NOT_PROVIDED_TAGS: BasisTag[] = ["not_provided"];

const buildNotProvidedField = (text: string): UsageField => ({
  text,
  basisTags: NOT_PROVIDED_TAGS,
});

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasText = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

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
  return normalize(segments.join(" "));
};

const buildActiveTokens = (digest: FactsDigest): string[] =>
  digest.actives
    .map((active) => normalize(active.name))
    .filter((name) => name.length >= 3);

const estimateClaimSupport = (
  claim: string | null | undefined,
  context: { evidenceCorpus: string; activeTokens: string[] },
): boolean => {
  if (!hasText(claim)) return false;
  const normalizedClaim = normalize(String(claim));
  if (!normalizedClaim) return false;
  if (context.activeTokens.some((token) => normalizedClaim.includes(token))) {
    return true;
  }
  const claimTokens = normalizedClaim
    .split(" ")
    .filter((token) => token.length >= 4)
    .slice(0, 8);
  if (!claimTokens.length) return false;
  const hitCount = claimTokens.filter((token) => context.evidenceCorpus.includes(token)).length;
  return hitCount >= Math.min(2, claimTokens.length);
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
      budgetUsedMs: 0,
    };
    return {
      bundle,
      verify: { status: "ok" },
      revise: { status: "ok" },
      meta: passthroughMeta,
    };
  }

  const startedAt = performance.now();
  const timeBudgetMs = Number.isFinite(options.timeBudgetMs) && (options.timeBudgetMs ?? 0) > 0
    ? Number(options.timeBudgetMs)
    : 1200;
  const evidenceCorpus = buildEvidenceCorpus(digest);
  const activeTokens = buildActiveTokens(digest);

  if (!evidenceCorpus) {
    const degradedMeta: WebVerifyMeta = {
      verifyStatus: "degraded",
      reviseStatus: "degraded",
      revisedClaimsCount: 0,
      droppedClaimsCount: 0,
      budgetUsedMs: Math.round(performance.now() - startedAt),
      fallbackCode: "web_text_unusable",
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

  if (performance.now() - startedAt > timeBudgetMs) {
    const timeoutMeta: WebVerifyMeta = {
      verifyStatus: "degraded",
      reviseStatus: "degraded",
      revisedClaimsCount: 0,
      droppedClaimsCount: 0,
      budgetUsedMs: Math.round(performance.now() - startedAt),
      fallbackCode: "verify_budget_exhausted",
    };
    return {
      bundle: {
        ...bundle,
        meta: {
          ...bundle.meta,
          webVerifyMeta: timeoutMeta,
        },
      },
      verify: { status: "degraded", code: "verify_budget_exhausted" },
      revise: { status: "degraded", code: "verify_budget_exhausted" },
      meta: timeoutMeta,
    };
  }

  const supportContext = { evidenceCorpus, activeTokens };
  let revisedClaimsCount = 0;
  let droppedClaimsCount = 0;

  const reviseSummary = (summary: string | null | undefined): string => {
    if (!hasText(summary)) return "Not provided by source.";
    if (estimateClaimSupport(summary, supportContext)) return String(summary);
    droppedClaimsCount += 1;
    revisedClaimsCount += 1;
    return "Not provided by source.";
  };

  const reviseBullet = (text: string): { text: string; basisTags: BasisTag[] } => {
    if (estimateClaimSupport(text, supportContext)) {
      return { text, basisTags: ["web_evidence"] };
    }
    droppedClaimsCount += 1;
    revisedClaimsCount += 1;
    return { text: "Not provided by source.", basisTags: NOT_PROVIDED_TAGS };
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
      normalize(active.name),
      hasText(active.evidenceText),
    ]),
  );

  const revisedIngredients = bundle.sections.ingredients?.detail?.items
    ? {
        ...bundle.sections.ingredients,
        detail: {
          ...bundle.sections.ingredients.detail,
          items: bundle.sections.ingredients.detail.items.map((item) => {
            const activeKey = normalize(item.name);
            const activeHasEvidence = Boolean(evidenceByActive.get(activeKey));
            const whatItDoesSupported =
              activeHasEvidence && estimateClaimSupport(item.whatItDoes.text, supportContext);
            const doseContextSupported =
              activeHasEvidence && estimateClaimSupport(item.doseContext.text, supportContext);

            if (!whatItDoesSupported) {
              droppedClaimsCount += 1;
              revisedClaimsCount += 1;
            }
            if (!doseContextSupported) {
              revisedClaimsCount += 1;
            }

            return {
              ...item,
              whatItDoes: whatItDoesSupported
                ? item.whatItDoes
                : buildNotProvidedField("Not provided by source."),
              doseContext: doseContextSupported
                ? item.doseContext
                : buildNotProvidedField("Not provided by source."),
              chemicalFormExplain: buildNotProvidedField("Chemical form not provided by source."),
              deliveryFormExplain: null,
            };
          }),
        },
      }
    : bundle.sections.ingredients;

  const verifyStatus: VerifyReviseStatus = droppedClaimsCount > 0 ? "degraded" : "ok";
  const reviseStatus: VerifyReviseStatus = revisedClaimsCount > 0 ? "degraded" : "ok";
  const fallbackCode = droppedClaimsCount > 0 ? "verify_claim_without_support" : undefined;

  const meta: WebVerifyMeta = {
    verifyStatus,
    reviseStatus,
    revisedClaimsCount,
    droppedClaimsCount,
    budgetUsedMs: Math.round(performance.now() - startedAt),
    fallbackCode,
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
