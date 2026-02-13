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

  if (!hasEvidence) {
    reasons.push("web_text_unusable");
    next = {
      ...next,
      meta: {
        ...next.meta,
        fallback: { code: "web_text_unusable" },
        fallbackReason: "web_text_unusable",
      },
      sections: {
        ...next.sections,
        overview: {
          ...next.sections.overview,
          cover: {
            summary: "Not provided by source. Information is limited to available source text.",
            bullets: [{ text: "Not provided by source.", basisTags: NOT_PROVIDED_TAGS }],
          },
          detail: {
            summary: "Not provided by source. Information is limited to available source text.",
            bullets: [{ text: "Not provided by source.", basisTags: NOT_PROVIDED_TAGS }],
          },
          dataStatus: "not_provided",
        },
        usage: {
          ...next.sections.usage,
          cover: safeUsageCover,
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

  return { value: next, reasons };
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
