import type { AnalysisBundle, BasisTag, IngredientsDetail, UsageField } from "./analysisBundle.js";
import type { FactsDigest } from "./factsDigest.js";

export type WebEvidenceGateResult<T> = {
  value: T;
  reasons: string[];
};

const NOT_PROVIDED_TAGS: BasisTag[] = ["not_provided"];

const buildNotProvidedField = (text: string): UsageField => ({
  text,
  basisTags: NOT_PROVIDED_TAGS,
});

const hasText = (value: string | null | undefined): boolean => typeof value === "string" && value.trim().length > 0;

const normalizeReasonCode = (value: string | null | undefined): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const toForcedWebLimitReason = (value: string | null | undefined): "needs_js" | "ownership_unverified" | "web_text_unusable" | null => {
  const code = normalizeReasonCode(value);
  if (!code) return null;
  if (code.includes("needs_js")) return "needs_js";
  if (code.includes("ownership_unverified")) return "ownership_unverified";
  if (code.includes("web_text_unusable") || code.includes("web_sanitize_failed")) return "web_text_unusable";
  return null;
};

const resolveForcedWebLimitReason = (
  bundle: AnalysisBundle,
): "needs_js" | "ownership_unverified" | "web_text_unusable" | null => {
  const direct = [
    bundle.meta.fallbackReason,
    bundle.meta.fallback?.code,
    bundle.meta.webVerifyMeta?.fallbackCode,
  ];
  for (const candidate of direct) {
    const resolved = toForcedWebLimitReason(candidate);
    if (resolved) return resolved;
  }

  for (const step of bundle.meta.webPipeline ?? []) {
    const resolved = toForcedWebLimitReason(step.code);
    if (resolved) return resolved;
  }
  return null;
};

const buildLimitedOverviewCopy = (
  reason: "needs_js" | "ownership_unverified" | "web_text_unusable",
): string => {
  if (reason === "needs_js") {
    return "Source page requires JavaScript; details are not reliably extractable.";
  }
  if (reason === "ownership_unverified") {
    return "Product ownership is not verified from web evidence; details are limited.";
  }
  return "Not provided by source. Information is limited to available source text.";
};

export const hasWebEvidenceText = (digest: FactsDigest): boolean => {
  if (digest.sourceType !== "web") return true;
  if (digest.actives.some((active) => hasText(active.evidenceText))) return true;
  if (digest.labelDosing.some((dose) => hasText(dose.rawText))) return true;
  if (digest.warnings.warnings.some((warning) => hasText(warning))) return true;
  if (digest.serving.servingSize && hasText(digest.serving.servingSize)) return true;
  return false;
};

export const applyWebBundleEvidenceGate = (
  bundle: AnalysisBundle,
  digest: FactsDigest,
): WebEvidenceGateResult<AnalysisBundle> => {
  if (digest.sourceType !== "web") {
    return { value: bundle, reasons: [] };
  }

  const reasons: string[] = [];
  const hasEvidence = hasWebEvidenceText(digest);
  const forcedLimitReason = resolveForcedWebLimitReason(bundle);
  const gateReason = !hasEvidence ? "web_text_unusable" : forcedLimitReason;
  let next = bundle;

  const safeUsageCover = {
    bullets: bundle.sections.usage.cover?.bullets ?? [],
    bestTimeToTake:
      bundle.sections.usage.cover?.bestTimeToTake ??
      buildNotProvidedField("Anytime (with meals)."),
    withFood:
      bundle.sections.usage.cover?.withFood ?? {
        value: true,
        text: "Prefer with meals for tolerability.",
        basisTags: ["general_advice" as BasisTag],
      },
    dosage: bundle.sections.usage.cover?.dosage ?? null,
  };

  if (gateReason) {
    const overviewSummary = buildLimitedOverviewCopy(gateReason);
    const overviewStatus = gateReason === "ownership_unverified" ? "limited" : "not_provided";
    const limitedIngredientsCoverItems = (next.sections.ingredients.cover?.items ?? []).slice(0, 1);
    const limitedIngredientsTotalCount =
      next.sections.ingredients.cover?.totalCount ?? next.sections.ingredients.cover?.items?.length ?? 0;
    reasons.push(gateReason);
    next = {
      ...next,
      meta: {
        ...next.meta,
        scoreAvailable: false,
        fallback: { code: gateReason },
        fallbackReason: gateReason,
      },
      sections: {
        ...next.sections,
        overview: {
          ...next.sections.overview,
          cover: {
            summary: overviewSummary,
            bullets: [{ text: "Not provided by source.", basisTags: NOT_PROVIDED_TAGS }],
          },
          detail: {
            summary: overviewSummary,
            bullets: [{ text: "Not provided by source.", basisTags: NOT_PROVIDED_TAGS }],
          },
          dataStatus: overviewStatus,
        },
        ingredients: {
          ...next.sections.ingredients,
          cover: {
            items: limitedIngredientsCoverItems.map((item) => ({
              ...item,
              basisTags: Array.from(new Set<BasisTag>([...item.basisTags, "not_provided"])),
            })),
            totalCount: limitedIngredientsTotalCount,
          },
          detail: null,
          dataStatus: "limited",
        },
        usage: {
          ...next.sections.usage,
          cover: safeUsageCover,
          detail: {
            timingRationale: null,
            withFoodRationale: null,
            scheduleFromLabel: [],
          },
          dataStatus: "limited",
        },
        safety: {
          ...next.sections.safety,
          cover: {
            verdict: "Not provided by source.",
            bullets: [{ text: "Not provided by source.", basisTags: NOT_PROVIDED_TAGS }],
          },
          detail: { warnings: [], consultDoctorIf: [], redFlags: [] },
          dataStatus: "limited",
        },
      },
    };
  } else {
    next = {
      ...next,
      sections: {
        ...next.sections,
        usage: {
          ...next.sections.usage,
          cover: safeUsageCover,
        },
      },
    };
  }

  return { value: next, reasons: [...new Set(reasons)] };
};

export const applyWebIngredientsDetailEvidenceGate = (
  detail: IngredientsDetail,
  digest: FactsDigest,
): WebEvidenceGateResult<IngredientsDetail> => {
  if (digest.sourceType !== "web") {
    return { value: detail, reasons: [] };
  }

  const reasons: string[] = [];
  const hasEvidence = hasWebEvidenceText(digest);

  const items = detail.items.map((item) => {
    const nameNorm = item.name.toLowerCase().trim();
    const active = digest.actives.find((candidate) => candidate.name.toLowerCase().trim() === nameNorm);
    const activeHasEvidence = hasText(active?.evidenceText);

    const whatItDoes = activeHasEvidence
      ? item.whatItDoes
      : buildNotProvidedField("Not provided by source.");
    const doseContext = activeHasEvidence
      ? item.doseContext
      : buildNotProvidedField("Not provided by source.");

    if (!activeHasEvidence) {
      reasons.push("web_claim_without_evidence");
    }

    return {
      ...item,
      whatItDoes,
      doseContext,
      chemicalFormExplain: buildNotProvidedField("Chemical form not provided by source."),
      deliveryFormExplain: null,
    };
  });

  const normalizedReasons = [...new Set(reasons)];

  return {
    value: {
      ...detail,
      items,
      overallSummary: hasEvidence ? detail.overallSummary : buildNotProvidedField("Not provided by source."),
      overlapNotes: hasEvidence ? detail.overlapNotes : buildNotProvidedField("Not provided by source."),
    },
    reasons: normalizedReasons,
  };
};
