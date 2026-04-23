import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getNutriMinimalDefinitionForFamily } from "../src/nutriMinimalFullFamilyProductization.js";

type ReviewedEvidenceRow = Record<string, unknown> & {
  ingredient_family?: string;
  section_key?: string;
  variant_key?: string | null;
  variant_label?: string | null;
};

type ReviewedCandidateSearch = Record<string, unknown> & {
  family?: string;
  lane?: string;
  variant_key?: string | null;
};

type StagedCandidateRow = {
  family: string;
  lane: string;
  variant_key?: string | null;
  source: "life-science-research:ncbi-entrez-skill";
  retrieved_at: string;
  query: string | null;
  plugin_verified_pmids: Array<{
    pmid: string;
    title: string | null;
    pubdate: string | null;
    pubtype: string[];
    url: string | null;
  }>;
  priority: "P0" | "P1" | "P2" | "P3";
  selection_notes: string[];
  review_status: "approved" | "needs_edit" | "rejected";
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REVIEWED_PATH = path.join(
  ROOT,
  "data",
  "reviewed",
  "scientific-background-evidence.v1.json",
);
const STAGED_PATH = path.join(
  ROOT,
  "data",
  "staging",
  "nutri-minimal-v4",
  "scientific-evidence-candidate-registry.json",
);

const EXTRA_PROMOTION_KEYS = new Set([
  "vitamin_c|collagen_and_tissue_support|",
  "zinc|skin_and_barrier_research|",
  "iron|what_product_comparison_depends_on|",
  "magnesium|what_product_comparison_depends_on|",
]);

const SECOND_WAVE_APPROVED_P1_KEYS = new Set([
  "b12|nerve_and_blood_cell_context|",
  "b12|what_form_disclosure_changes|",
  "b6|nerve_related_interpretation|",
  "b6|why_dose_context_matters|",
  "calcium|form_and_absorption_context|",
  "calcium|how_coformulation_changes_comparison|",
  "fiber|satiety_and_gut_context|",
  "folate|pregnancy_and_developmental_context|",
  "folate|what_form_labeling_changes|",
  "melatonin|what_dose_and_use_context_can_change|",
  "vitamin_c|iron_absorption_context|",
  "vitamin_d|immune_and_broader_health_research|",
  "vitamin_d|what_interpretation_depends_on|",
]);

const SECOND_WAVE_MIN_VERIFIED_PMIDS = 3;

const rowKey = (
  family: string | null | undefined,
  lane: string | null | undefined,
  variantKey?: string | null,
) =>
  `${String(family ?? "").trim()}|${String(lane ?? "").trim()}|${String(variantKey ?? "").trim()}`;

const isSecondWaveHighValueP1 = (row: StagedCandidateRow): boolean =>
  row.priority === "P1" &&
  SECOND_WAVE_APPROVED_P1_KEYS.has(
    rowKey(row.family, row.lane, row.variant_key),
  ) &&
  row.plugin_verified_pmids.length >= SECOND_WAVE_MIN_VERIFIED_PMIDS;

const shouldSyncCandidateSearch = (row: StagedCandidateRow): boolean =>
  row.review_status === "approved";

const shouldPromoteCandidateEvidence = (row: StagedCandidateRow): boolean =>
  row.review_status === "approved" &&
  !String(row.variant_key ?? "").trim() &&
  row.plugin_verified_pmids.length > 0;

const shouldPromoteCandidate = (row: StagedCandidateRow): boolean =>
  shouldPromoteCandidateEvidence(row) &&
  (row.priority === "P0" ||
    EXTRA_PROMOTION_KEYS.has(rowKey(row.family, row.lane, row.variant_key)) ||
    isSecondWaveHighValueP1(row));

const pubmedReference = (
  pmid: string,
  title: string,
): Record<string, unknown> => ({
  id: `pmid:${pmid}`,
  source: "pubmed",
  title,
  url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
});

const reviewedSentence = (params: {
  text: string;
  sentenceId: string;
  evidenceReferenceId: string;
  evidenceGrade?: "B" | "C";
}): Record<string, unknown> => ({
  text: params.text,
  sentence_id: params.sentenceId,
  evidence_snippet_id: `${params.sentenceId.replace(/_summary_|_evidence_|_shopper_|_caveat_/, "_excerpt_")}`,
  evidence_reference_id: params.evidenceReferenceId,
  evidence_grade: params.evidenceGrade ?? "B",
  source: "reviewed_curated_v1",
});

const buildSimpleReviewedEvidenceRow = (params: {
  family: string;
  sectionKey: string;
  evidenceGrade?: "B" | "C";
  overallConfidence: number;
  displayText: string;
  sentencePrefix: string;
  summary: string;
  evidenceRead: string;
  shopperMeaning: string;
  caveat: string;
  summaryReferenceId: string;
  evidenceReferenceId: string;
  shopperReferenceId: string;
  caveatReferenceId: string;
  references: Array<{ pmid: string; title: string }>;
}): ReviewedEvidenceRow => ({
  ingredient_family: params.family,
  section_key: params.sectionKey,
  evidence_grade: params.evidenceGrade ?? "B",
  overall_confidence: params.overallConfidence,
  display_text: params.displayText,
  segments: {
    summary_support: {
      en: [
        reviewedSentence({
          text: params.summary,
          sentenceId: `${params.sentencePrefix}_summary_001`,
          evidenceReferenceId: params.summaryReferenceId,
          evidenceGrade: params.evidenceGrade,
        }),
      ],
    },
    evidence_read_support: {
      en: [
        reviewedSentence({
          text: params.evidenceRead,
          sentenceId: `${params.sentencePrefix}_evidence_001`,
          evidenceReferenceId: params.evidenceReferenceId,
          evidenceGrade: params.evidenceGrade,
        }),
      ],
    },
    shopper_meaning_support: {
      en: [
        reviewedSentence({
          text: params.shopperMeaning,
          sentenceId: `${params.sentencePrefix}_shopper_001`,
          evidenceReferenceId: params.shopperReferenceId,
          evidenceGrade: params.evidenceGrade,
        }),
      ],
    },
    caveats: {
      en: [
        reviewedSentence({
          text: params.caveat,
          sentenceId: `${params.sentencePrefix}_caveat_001`,
          evidenceReferenceId: params.caveatReferenceId,
          evidenceGrade: "C",
        }),
      ],
    },
  },
  supporting_references: params.references.map((reference) =>
    pubmedReference(reference.pmid, reference.title),
  ),
});

const toDisplayLabel = (value: string): string =>
  value
    .split("_")
    .filter(Boolean)
    .map((part) => {
      const normalized = part.toLowerCase();
      const knownLabels: Record<string, string> = {
        gaba: "GABA",
        msm: "MSM",
        red: "Red",
        nac: "NAC",
        coq10: "CoQ10",
      };
      if (knownLabels[normalized]) return knownLabels[normalized];
      return part.length <= 3
        ? part.toUpperCase()
        : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");

const toSentenceSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

const buildReviewedEvidenceRowFromCandidate = (
  row: StagedCandidateRow,
): ReviewedEvidenceRow | null => {
  const references = row.plugin_verified_pmids
    .filter((candidate) => candidate.pmid && candidate.title)
    .slice(0, 5)
    .map((candidate) => ({
      pmid: candidate.pmid,
      title: candidate.title ?? `PubMed ${candidate.pmid}`,
    }));
  if (!references.length) return null;

  const primaryReferenceId = `pmid:${references[0]?.pmid}`;
  const familyLabel = toDisplayLabel(row.family);
  const laneLabel = toDisplayLabel(row.lane).toLowerCase();
  const firstTitle = references[0]?.title ?? "the primary PubMed record";
  const sentencePrefix = `${toSentenceSlug(row.family)}_${toSentenceSlug(row.lane)}_candidate`;
  const evidenceGrade: "B" | "C" =
    row.priority === "P0" || row.priority === "P1" ? "B" : "C";
  const definition = getNutriMinimalDefinitionForFamily(row.family);
  const decisionLabel = definition?.displayName ?? familyLabel;
  const boundary =
    definition?.hardBoundary ??
    `Do not convert ${decisionLabel} evidence into disease-treatment, guaranteed-outcome, or universal best-form language.`;
  const comparisonFocus =
    definition?.safetyBoundaryTier === "high"
      ? "identity, amount, source/form disclosure, and safety cautions"
      : "dose, form/source disclosure, and formula role";
  const categoryContext =
    definition?.category === "enzyme"
      ? "enzyme identity, activity detail, and blend role"
      : definition?.category === "mineral"
        ? "intake context, amount, and named form"
        : definition?.category === "botanical"
          ? "extract/source identity, marker wording, and formula role"
          : "the disclosed ingredient line and formula context";

  return buildSimpleReviewedEvidenceRow({
    family: row.family,
    sectionKey: row.lane,
    evidenceGrade,
    overallConfidence: evidenceGrade === "B" ? 0.7 : 0.62,
    displayText: `${decisionLabel} evidence supports the ${laneLabel} lane only when the label gives enough detail to compare ${comparisonFocus}.`,
    sentencePrefix,
    summary: `${decisionLabel} is most useful here as a comparison lens around ${categoryContext}, not as a broad front-label promise.`,
    evidenceRead: `The reviewed PubMed set includes "${firstTitle}", so this lane should be read as bounded human or review-level context rather than a universal product claim.`,
    shopperMeaning: `When comparing ${decisionLabel} products, check ${comparisonFocus} before treating two labels as equivalent.`,
    caveat: boundary,
    summaryReferenceId: primaryReferenceId,
    evidenceReferenceId: primaryReferenceId,
    shopperReferenceId: primaryReferenceId,
    caveatReferenceId: primaryReferenceId,
    references,
  });
};

const REGISTRY_TEMPLATE_COPY_PATTERN =
  /has approved PubMed-backed context|can be grounded through primary|candidate set|primary reviewed candidate/i;

const getPrimaryReferenceTitle = (row: ReviewedEvidenceRow): string => {
  const references = Array.isArray(row.supporting_references)
    ? (row.supporting_references as Array<Record<string, unknown>>)
    : [];
  const firstTitle = references.find(
    (reference) => typeof reference.title === "string" && reference.title,
  )?.title;
  return typeof firstTitle === "string" && firstTitle.trim()
    ? firstTitle.trim()
    : "the reviewed PubMed support";
};

const replaceReviewedSentenceText = (
  row: ReviewedEvidenceRow,
  segmentKey: string,
  nextText: string,
): boolean => {
  const segments = row.segments as
    | Record<string, { en?: Array<Record<string, unknown>> }>
    | undefined;
  const sentences = segments?.[segmentKey]?.en;
  if (!Array.isArray(sentences) || !sentences.length) return false;
  const hadTemplate = sentences.some(
    (sentence) =>
      typeof sentence.text === "string" &&
      REGISTRY_TEMPLATE_COPY_PATTERN.test(sentence.text),
  );
  if (!hadTemplate) return false;
  const [firstSentence] = sentences;
  firstSentence.text = nextText;
  return true;
};

const polishRegistryTemplateEvidenceRows = (
  evidenceRows: ReviewedEvidenceRow[],
): number => {
  let polishedRows = 0;

  for (const row of evidenceRows) {
    if (!REGISTRY_TEMPLATE_COPY_PATTERN.test(JSON.stringify(row))) continue;

    const family = String(row.ingredient_family ?? "");
    const sectionKey = String(row.section_key ?? "");
    const definition = getNutriMinimalDefinitionForFamily(family);
    const decisionLabel = definition?.displayName ?? toDisplayLabel(family);
    const laneLabel = toDisplayLabel(sectionKey).toLowerCase();
    const primaryTitle = getPrimaryReferenceTitle(row);
    const comparisonFocus =
      definition?.safetyBoundaryTier === "high"
        ? "identity, amount, source/form disclosure, and safety cautions"
        : definition?.category === "enzyme"
          ? "enzyme identity, activity detail, and blend role"
          : definition?.category === "mineral"
            ? "amount, named form, and cofactor context"
            : definition?.category === "botanical"
              ? "extract/source identity, marker wording, and formula role"
              : "dose, form/source disclosure, and formula role";
    const boundary =
      definition?.hardBoundary ??
      `Do not convert ${decisionLabel} evidence into disease-treatment, guaranteed-outcome, superiority, or universal best-form language.`;

    if (
      typeof row.display_text === "string" &&
      REGISTRY_TEMPLATE_COPY_PATTERN.test(row.display_text)
    ) {
      row.display_text = `${decisionLabel} evidence should be used as bounded comparison context for ${laneLabel}, not as a broad front-label promise.`;
    }

    const changedSummary = replaceReviewedSentenceText(
      row,
      "summary_support",
      `${decisionLabel} is useful for this lane only when the label gives enough detail to compare ${comparisonFocus}.`,
    );
    const changedEvidence = replaceReviewedSentenceText(
      row,
      "evidence_read_support",
      `The reviewed PubMed support includes "${primaryTitle}", so this lane should stay tied to its study context and evidence limits.`,
    );
    const changedShopper = replaceReviewedSentenceText(
      row,
      "shopper_meaning_support",
      `When comparing ${decisionLabel} products, check ${comparisonFocus} before treating two labels as equivalent.`,
    );
    const changedCaveat = replaceReviewedSentenceText(
      row,
      "caveats",
      boundary,
    );

    if (
      changedSummary ||
      changedEvidence ||
      changedShopper ||
      changedCaveat
    ) {
      polishedRows += 1;
    }
  }

  return polishedRows;
};

const buildReviewedEvidenceSeedRows = (): ReviewedEvidenceRow[] => [
  {
    ingredient_family: "quercetin",
    section_key: "primary_use_context",
    evidence_grade: "B",
    overall_confidence: 0.74,
    display_text:
      "Quercetin has a recognizable human supplementation lane, but the cleanest comparison stays tied to study context, dose, and whether the label is using broad antioxidant or recovery wording.",
    segments: {
      summary_support: {
        en: [
          reviewedSentence({
            text: "Quercetin has human supplementation evidence, with review-level support most useful when the label stays tied to a specific use context rather than broad antioxidant positioning.",
            sentenceId: "quercetin_primary_summary_001",
            evidenceReferenceId: "pmid:21606866",
          }),
        ],
      },
      evidence_read_support: {
        en: [
          reviewedSentence({
            text: "The reviewed human evidence is clearest when read by outcome and study setting, including exercise-related meta-analyses and controlled supplementation trials.",
            sentenceId: "quercetin_primary_evidence_001",
            evidenceReferenceId: "pmid:22805526",
          }),
        ],
      },
      shopper_meaning_support: {
        en: [
          reviewedSentence({
            text: "When comparing quercetin labels, the most useful first checks are disclosed dose, extract or delivery wording, and whether quercetin is the main active or a supporting line.",
            sentenceId: "quercetin_primary_shopper_001",
            evidenceReferenceId: "pmid:20478383",
          }),
        ],
      },
      caveats: {
        en: [
          reviewedSentence({
            text: "Do not treat every immune, antioxidant, recovery, or respiratory-adjacent quercetin claim as equally supported across products.",
            sentenceId: "quercetin_primary_caveat_001",
            evidenceReferenceId: "pmid:21606866",
            evidenceGrade: "C",
          }),
        ],
      },
    },
    supporting_references: [
      pubmedReference(
        "21606866",
        "Quercetin and endurance exercise capacity: a systematic review and meta-analysis.",
      ),
      pubmedReference(
        "22805526",
        "Effects of quercetin supplementation on endurance performance and maximal oxygen consumption: a meta-analysis.",
      ),
      pubmedReference(
        "20478383",
        "Quercetin supplementation and upper respiratory tract infection: A randomized community clinical trial.",
      ),
    ],
  },
  {
    ingredient_family: "vitamin_e",
    section_key: "status_and_supplementation_context",
    evidence_grade: "B",
    overall_confidence: 0.76,
    display_text:
      "Vitamin E is best read through intake/status plus dose-aware supplementation context, with high-dose and outcome-specific evidence keeping broad antioxidant claims bounded.",
    segments: {
      summary_support: {
        en: [
          reviewedSentence({
            text: "Vitamin E supplementation has broad review-level evidence, but shopper-facing interpretation is strongest when tied to intake, status, dose, and outcome context.",
            sentenceId: "vitamin_e_status_summary_001",
            evidenceReferenceId: "pmid:37571239",
          }),
        ],
      },
      evidence_read_support: {
        en: [
          reviewedSentence({
            text: "Umbrella-review evidence shows that vitamin E findings vary by outcome, so broad antioxidant positioning should not be flattened into one universal benefit story.",
            sentenceId: "vitamin_e_status_evidence_001",
            evidenceReferenceId: "pmid:37571239",
          }),
        ],
      },
      shopper_meaning_support: {
        en: [
          reviewedSentence({
            text: "When comparing vitamin E products, dose and exact tocopherol or tocotrienol disclosure matter more than a generic antioxidant headline.",
            sentenceId: "vitamin_e_status_shopper_001",
            evidenceReferenceId: "pmid:37571239",
          }),
        ],
      },
      caveats: {
        en: [
          reviewedSentence({
            text: "High-dose vitamin E evidence includes safety-sensitive signals, so comparison should avoid implying that more vitamin E is automatically better.",
            sentenceId: "vitamin_e_status_caveat_001",
            evidenceReferenceId: "pmid:15537682",
            evidenceGrade: "C",
          }),
        ],
      },
    },
    supporting_references: [
      pubmedReference(
        "37571239",
        "Vitamin E and Multiple Health Outcomes: An Umbrella Review of Meta-Analyses.",
      ),
      pubmedReference(
        "15537682",
        "Meta-analysis: high-dosage vitamin E supplementation may increase all-cause mortality.",
      ),
      pubmedReference(
        "15531675",
        "Effects of oral vitamin E and beta-carotene supplementation on ultraviolet radiation-induced oxidative stress in human skin.",
      ),
    ],
  },
  {
    ingredient_family: "vitamin_k2",
    section_key: "status_and_supplementation_context",
    evidence_grade: "B",
    overall_confidence: 0.75,
    display_text:
      "Vitamin K2 labels are easiest to compare through supplementation context, exact menaquinone form, and whether the formula is paired with calcium or vitamin D.",
    segments: {
      summary_support: {
        en: [
          reviewedSentence({
            text: "Vitamin K2 is most practical to interpret through supplementation and calcium-metabolism context before broader bone or heart packaging language.",
            sentenceId: "vitamin_k2_status_summary_001",
            evidenceReferenceId: "pmid:32972636",
          }),
        ],
      },
      evidence_read_support: {
        en: [
          reviewedSentence({
            text: "Review-level evidence often discusses vitamin K alongside vitamin D and calcium, which makes pairing context important when reading K2 labels.",
            sentenceId: "vitamin_k2_status_evidence_001",
            evidenceReferenceId: "pmid:39125301",
          }),
        ],
      },
      shopper_meaning_support: {
        en: [
          reviewedSentence({
            text: "When comparing K2 products, check whether the line discloses MK-4, MK-7, or another menaquinone form before treating two labels as interchangeable.",
            sentenceId: "vitamin_k2_status_shopper_001",
            evidenceReferenceId: "pmid:38890875",
          }),
        ],
      },
      caveats: {
        en: [
          reviewedSentence({
            text: "Do not turn K2, vitamin D, or calcium pairings into a blanket promise that every bone-positioned formula carries the same evidence strength.",
            sentenceId: "vitamin_k2_status_caveat_001",
            evidenceReferenceId: "pmid:32972636",
            evidenceGrade: "C",
          }),
        ],
      },
    },
    supporting_references: [
      pubmedReference(
        "32972636",
        "Calcium, vitamin D, vitamin K2, and magnesium supplementation and skeletal health.",
      ),
      pubmedReference(
        "39125301",
        "The Importance of Vitamin K and the Combination of Vitamins K and D for Calcium Metabolism and Bone Health: A Review.",
      ),
      pubmedReference(
        "38890875",
        "Vitamin K2 in Health and Disease: A Clinical Perspective.",
      ),
    ],
  },
  {
    ingredient_family: "chromium",
    section_key: "intake_and_status_context",
    evidence_grade: "B",
    overall_confidence: 0.72,
    display_text:
      "Chromium has supplementation research, but comparison should stay tied to amount, form disclosure, and population context rather than broad metabolism or sugar-balance language.",
    segments: {
      summary_support: {
        en: [
          reviewedSentence({
            text: "Chromium supplementation evidence is most useful for shoppers when it is bounded by intake, status, form, dose, and population context.",
            sentenceId: "chromium_intake_summary_001",
            evidenceReferenceId: "pmid:39541030",
          }),
        ],
      },
      evidence_read_support: {
        en: [
          reviewedSentence({
            text: "Recent systematic-review evidence supports keeping chromium claims outcome-specific rather than translating them into broad metabolism or sugar-balance promises.",
            sentenceId: "chromium_intake_evidence_001",
            evidenceReferenceId: "pmid:39541030",
          }),
        ],
      },
      shopper_meaning_support: {
        en: [
          reviewedSentence({
            text: "When comparing chromium labels, exact form disclosure such as picolinate plus the stated microgram amount is more useful than a broad metabolic-support headline.",
            sentenceId: "chromium_intake_shopper_001",
            evidenceReferenceId: "pmid:35365361",
          }),
        ],
      },
      caveats: {
        en: [
          reviewedSentence({
            text: "Chromium should stay comparison-safe around medication-adjacent or metabolic claims, with interactions and population context kept visible.",
            sentenceId: "chromium_intake_caveat_001",
            evidenceReferenceId: "pmid:33801406",
            evidenceGrade: "C",
          }),
        ],
      },
    },
    supporting_references: [
      pubmedReference(
        "39541030",
        "Chromium supplementation and type 2 diabetes mellitus: an extensive systematic review.",
      ),
      pubmedReference("35365361", "ESPEN micronutrient guideline."),
      pubmedReference(
        "33801406",
        "Levothyroxine Interactions with Food and Dietary Supplements-A Systematic Review.",
      ),
    ],
  },
  {
    ingredient_family: "selenium",
    section_key: "intake_and_status_context",
    evidence_grade: "B",
    overall_confidence: 0.76,
    display_text:
      "Selenium is best read through intake/status and form disclosure, with broader antioxidant or thyroid-adjacent positioning kept narrower and context-dependent.",
    segments: {
      summary_support: {
        en: [
          reviewedSentence({
            text: "Selenium has a strong intake and human-health context, but supplement comparison should stay tied to baseline status, dose, and disclosed form.",
            sentenceId: "selenium_intake_summary_001",
            evidenceReferenceId: "pmid:22381456",
          }),
        ],
      },
      evidence_read_support: {
        en: [
          reviewedSentence({
            text: "Review-level selenium literature supports status-aware interpretation and does not justify turning antioxidant or thyroid-adjacent packaging into a universal claim.",
            sentenceId: "selenium_intake_evidence_001",
            evidenceReferenceId: "pmid:37238669",
          }),
        ],
      },
      shopper_meaning_support: {
        en: [
          reviewedSentence({
            text: "When comparing selenium products, check amount and form wording such as selenomethionine, selenium yeast, or selenite before relying on broad mineral branding.",
            sentenceId: "selenium_intake_shopper_001",
            evidenceReferenceId: "pmid:22381456",
          }),
        ],
      },
      caveats: {
        en: [
          reviewedSentence({
            text: "Thyroid-adjacent selenium evidence can be population- and condition-specific, so it should not be generalized to every selenium supplement label.",
            sentenceId: "selenium_intake_caveat_001",
            evidenceReferenceId: "pmid:38243784",
            evidenceGrade: "C",
          }),
        ],
      },
    },
    supporting_references: [
      pubmedReference("22381456", "Selenium and human health."),
      pubmedReference("37238669", "Selenium and Selenoproteins in Health."),
      pubmedReference(
        "38243784",
        "Selenium Supplementation in Patients with Hashimoto Thyroiditis: A Systematic Review and Meta-Analysis of Randomized Clinical Trials.",
      ),
    ],
  },
  {
    ingredient_family: "alpha_lipoic_acid",
    section_key: "primary_context",
    evidence_grade: "B",
    overall_confidence: 0.73,
    display_text:
      "Alpha-lipoic acid has a recognizable human supplementation lane, but comparison should stay tied to dose, form disclosure, and outcome context rather than broad antioxidant or metabolism promises.",
    segments: {
      summary_support: {
        en: [
          reviewedSentence({
            text: "Alpha-lipoic acid supplementation evidence is most useful for shoppers when it stays tied to human study context, dose, and the outcome being discussed.",
            sentenceId: "alpha_lipoic_acid_primary_summary_001",
            evidenceReferenceId: "pmid:33199187",
          }),
        ],
      },
      evidence_read_support: {
        en: [
          reviewedSentence({
            text: "Systematic-review evidence supports reading alpha-lipoic acid by specific outcome lane rather than as a universal antioxidant or metabolism claim.",
            sentenceId: "alpha_lipoic_acid_primary_evidence_001",
            evidenceReferenceId: "pmid:33199187",
          }),
        ],
      },
      shopper_meaning_support: {
        en: [
          reviewedSentence({
            text: "When comparing alpha-lipoic acid labels, check dose, R-ALA or stabilized-form wording, and whether ALA is the main active or a supporting formula line.",
            sentenceId: "alpha_lipoic_acid_primary_shopper_001",
            evidenceReferenceId: "pmid:33199187",
          }),
        ],
      },
      caveats: {
        en: [
          reviewedSentence({
            text: "Do not generalize glycemic or neuropathy-adjacent findings to every alpha-lipoic acid product or shopper goal.",
            sentenceId: "alpha_lipoic_acid_primary_caveat_001",
            evidenceReferenceId: "pmid:37630823",
            evidenceGrade: "C",
          }),
        ],
      },
    },
    supporting_references: [
      pubmedReference(
        "33199187",
        "An updated systematic review and dose-response meta-analysis of the effects of alpha-lipoic acid supplementation on glycemic markers in adults.",
      ),
      pubmedReference(
        "37630823",
        "Effects of Oral Alpha-Lipoic Acid Treatment on Diabetic Polyneuropathy: A Meta-Analysis and Systematic Review.",
      ),
      pubmedReference(
        "36480969",
        "Micronutrient Supplementation to Reduce Cardiovascular Risk.",
      ),
    ],
  },
  {
    ingredient_family: "biotin",
    section_key: "status_and_supplementation_context",
    evidence_grade: "B",
    overall_confidence: 0.72,
    display_text:
      "Biotin is best read through intake/status and dose-aware supplementation context, with hair, skin, and nail positioning kept narrower unless the label and evidence context support it.",
    segments: {
      summary_support: {
        en: [
          reviewedSentence({
            text: "Biotin labels are clearest when interpreted through intake, status, and supplementation context before beauty-oriented packaging is over-read.",
            sentenceId: "biotin_status_summary_001",
            evidenceReferenceId: "pmid:35365361",
          }),
        ],
      },
      evidence_read_support: {
        en: [
          reviewedSentence({
            text: "Review literature on biotin and hair loss is context-specific, so shopper-facing claims should stay narrower than generic hair, skin, and nail promises.",
            sentenceId: "biotin_status_evidence_001",
            evidenceReferenceId: "pmid:28879195",
          }),
        ],
      },
      shopper_meaning_support: {
        en: [
          reviewedSentence({
            text: "When comparing biotin products, the useful checks are dose, D-biotin or vitamin B7 wording, and whether biotin is central or part of a broader B-complex formula.",
            sentenceId: "biotin_status_shopper_001",
            evidenceReferenceId: "pmid:35365361",
          }),
        ],
      },
      caveats: {
        en: [
          reviewedSentence({
            text: "Hair-loss and beauty discussions should not become a blanket benefit claim for every shopper or every biotin dose.",
            sentenceId: "biotin_status_caveat_001",
            evidenceReferenceId: "pmid:30547302",
            evidenceGrade: "C",
          }),
        ],
      },
    },
    supporting_references: [
      pubmedReference("35365361", "ESPEN micronutrient guideline."),
      pubmedReference(
        "28879195",
        "A Review of the Use of Biotin for Hair Loss.",
      ),
      pubmedReference(
        "30547302",
        "The Role of Vitamins and Minerals in Hair Loss: A Review.",
      ),
      pubmedReference("28701385", "Biotin: From Nutrition to Therapeutics."),
    ],
  },
  {
    ingredient_family: "copper",
    section_key: "intake_and_status_context",
    evidence_grade: "B",
    overall_confidence: 0.72,
    display_text:
      "Copper labels are easiest to compare through intake/status, disclosed amount, and form or paired-mineral context rather than broad mineral-support language.",
    segments: {
      summary_support: {
        en: [
          reviewedSentence({
            text: "Copper supplement interpretation is strongest when it is grounded in intake, status, disclosed amount, and the broader mineral formula context.",
            sentenceId: "copper_intake_summary_001",
            evidenceReferenceId: "pmid:35365361",
          }),
        ],
      },
      evidence_read_support: {
        en: [
          reviewedSentence({
            text: "Diet-pattern and micronutrient reviews support reading copper as an intake/status line rather than as broad antioxidant or energy support copy.",
            sentenceId: "copper_intake_evidence_001",
            evidenceReferenceId: "pmid:33341313",
          }),
        ],
      },
      shopper_meaning_support: {
        en: [
          reviewedSentence({
            text: "When comparing copper products, check the amount, named form, and whether zinc or other minerals change the formula role.",
            sentenceId: "copper_intake_shopper_001",
            evidenceReferenceId: "pmid:35365361",
          }),
        ],
      },
      caveats: {
        en: [
          reviewedSentence({
            text: "Do not overread zinc-copper or deficiency-adjacent context as a broad need signal for every shopper.",
            sentenceId: "copper_intake_caveat_001",
            evidenceReferenceId: "pmid:36479498",
            evidenceGrade: "C",
          }),
        ],
      },
    },
    supporting_references: [
      pubmedReference("35365361", "ESPEN micronutrient guideline."),
      pubmedReference(
        "33341313",
        "Intake and adequacy of the vegan diet. A systematic review of the evidence.",
      ),
      pubmedReference("36479498", "Main nutritional deficiencies."),
    ],
  },
  {
    ingredient_family: "riboflavin",
    section_key: "status_and_supplementation_context",
    evidence_grade: "B",
    overall_confidence: 0.73,
    display_text:
      "Riboflavin is best read through intake/status and B-vitamin supplementation context, with narrower outcome lanes kept separate from broad energy copy.",
    segments: {
      summary_support: {
        en: [
          reviewedSentence({
            text: "Riboflavin labels are most useful when grounded in intake, status, and B-vitamin supplementation context before broad energy positioning is accepted.",
            sentenceId: "riboflavin_status_summary_001",
            evidenceReferenceId: "pmid:35365361",
          }),
        ],
      },
      evidence_read_support: {
        en: [
          reviewedSentence({
            text: "Riboflavin review literature supports keeping general B2 interpretation separate from narrower outcome-specific lanes.",
            sentenceId: "riboflavin_status_evidence_001",
            evidenceReferenceId: "pmid:32023913",
          }),
        ],
      },
      shopper_meaning_support: {
        en: [
          reviewedSentence({
            text: "When comparing riboflavin products, check dose, vitamin B2 or flavin-coenzyme wording, and whether the line is central or part of a broader B-complex.",
            sentenceId: "riboflavin_status_shopper_001",
            evidenceReferenceId: "pmid:35365361",
          }),
        ],
      },
      caveats: {
        en: [
          reviewedSentence({
            text: "Migraine-related riboflavin evidence is narrower and should not be used as generic shopper-facing positioning for every B2 label.",
            sentenceId: "riboflavin_status_caveat_001",
            evidenceReferenceId: "pmid:33779525",
            evidenceGrade: "C",
          }),
        ],
      },
    },
    supporting_references: [
      pubmedReference("35365361", "ESPEN micronutrient guideline."),
      pubmedReference(
        "32023913",
        "Riboflavin: The Health Benefits of a Forgotten Natural Vitamin.",
      ),
      pubmedReference(
        "33779525",
        "Effect of Vitamin B2 supplementation on migraine prophylaxis: a systematic review and meta-analysis.",
      ),
      pubmedReference(
        "37603429",
        "Causes and Clinical Sequelae of Riboflavin Deficiency.",
      ),
    ],
  },
  {
    ingredient_family: "aloe_vera",
    section_key: "primary_use_context",
    evidence_grade: "B",
    overall_confidence: 0.7,
    display_text:
      "Aloe vera supplement labels should be compared through oral-use context and exact aloe disclosure, while topical and broad soothing language stays separate from supplement evidence.",
    segments: {
      summary_support: {
        en: [
          reviewedSentence({
            text: "Aloe vera supplement interpretation should stay tied to oral-use context and exact aloe disclosure rather than borrowing broad topical aloe language.",
            sentenceId: "aloe_vera_primary_summary_001",
            evidenceReferenceId: "pmid:32183224",
          }),
        ],
      },
      evidence_read_support: {
        en: [
          reviewedSentence({
            text: "Aloe vera evidence includes both active-constituent reviews and safety-sensitive oral-use context, so supplement labels need form and use-route clarity.",
            sentenceId: "aloe_vera_primary_evidence_001",
            evidenceReferenceId: "pmid:26986231",
          }),
        ],
      },
      shopper_meaning_support: {
        en: [
          reviewedSentence({
            text: "When comparing aloe vera supplements, check whether the label discloses inner-leaf, whole-leaf, latex-free, or decolorized extract wording.",
            sentenceId: "aloe_vera_primary_shopper_001",
            evidenceReferenceId: "pmid:32183224",
          }),
        ],
      },
      caveats: {
        en: [
          reviewedSentence({
            text: "Do not generalize topical aloe evidence or broad soothing language to oral supplement products.",
            sentenceId: "aloe_vera_primary_caveat_001",
            evidenceReferenceId: "pmid:26986231",
            evidenceGrade: "C",
          }),
        ],
      },
    },
    supporting_references: [
      pubmedReference(
        "32183224",
        "Pharmacological Update Properties of Aloe Vera and its Major Active Constituents.",
      ),
      pubmedReference(
        "26986231",
        "Aloe vera: A review of toxicity and adverse clinical effects.",
      ),
      pubmedReference("36304597", "Dietary supplements and bleeding."),
    ],
  },
  buildSimpleReviewedEvidenceRow({
    family: "l_arginine",
    sectionKey: "primary_context",
    evidenceGrade: "B",
    overallConfidence: 0.73,
    displayText:
      "L-arginine has a recognizable human supplementation lane, but comparison should stay tied to dose, exact form, and outcome context rather than broad nitric-oxide or pump language.",
    sentencePrefix: "l_arginine_primary",
    summary:
      "L-arginine supplementation is best interpreted through a specific human study context before broad performance or circulation packaging language is accepted.",
    evidenceRead:
      "Systematic-review evidence supports keeping arginine interpretation outcome-specific rather than turning amino-acid or nitric-oxide wording into one universal benefit story.",
    shopperMeaning:
      "When comparing L-arginine labels, check amount, HCl or AAKG-style wording, and whether arginine is central or part of a broader pre-workout or amino-acid formula.",
    caveat:
      "Do not generalize wound-healing, pregnancy, cardiovascular, or sports-performance findings to every arginine product or shopper goal.",
    summaryReferenceId: "pmid:32370176",
    evidenceReferenceId: "pmid:32370176",
    shopperReferenceId: "pmid:32370176",
    caveatReferenceId: "pmid:34444657",
    references: [
      {
        pmid: "32370176",
        title:
          "Effects of Arginine Supplementation on Athletic Performance Based on Energy Metabolism: A Systematic Review and Meta-Analysis.",
      },
      {
        pmid: "34444657",
        title:
          "The Effect of Amino Acids on Wound Healing: A Systematic Review and Meta-Analysis on Arginine and Glutamine.",
      },
      {
        pmid: "36480969",
        title: "Micronutrient Supplementation to Reduce Cardiovascular Risk.",
      },
    ],
  }),
  buildSimpleReviewedEvidenceRow({
    family: "l_ornithine",
    sectionKey: "primary_context",
    evidenceGrade: "C",
    overallConfidence: 0.58,
    displayText:
      "L-ornithine has narrower human supplementation support, so comparison should stay close to disclosed dose, form, and formula role rather than broad amino-acid or recovery promises.",
    sentencePrefix: "l_ornithine_primary",
    summary:
      "L-ornithine labels are safest to read as a narrow amino-acid supplementation context rather than a broad performance or recovery claim.",
    evidenceRead:
      "The direct shopper-relevant evidence is thinner than for more common sports amino acids, with human supplementation support best treated as context-specific.",
    shopperMeaning:
      "When comparing L-ornithine products, check whether the label discloses free-form or HCl wording, amount, and whether ornithine is central or a supporting amino-acid line.",
    caveat:
      "Do not use sparse fatigue or hepatic-adjacent ornithine literature as a blanket benefit story for every ornithine formula.",
    summaryReferenceId: "pmid:19083482",
    evidenceReferenceId: "pmid:19083482",
    shopperReferenceId: "pmid:19083482",
    caveatReferenceId: "pmid:34822189",
    references: [
      {
        pmid: "19083482",
        title:
          "L-ornithine supplementation attenuates physical fatigue in healthy volunteers by modulating lipid and amino acid metabolism.",
      },
      {
        pmid: "34822189",
        title:
          "L-ornithine L-aspartate in acute treatment of severe hepatic encephalopathy: A double-blind randomized controlled trial.",
      },
    ],
  }),
  buildSimpleReviewedEvidenceRow({
    family: "molybdenum",
    sectionKey: "intake_and_status_context",
    evidenceGrade: "B",
    overallConfidence: 0.72,
    displayText:
      "Molybdenum labels are best compared through trace-mineral intake/status, disclosed amount, and molybdate or chelate wording rather than broad detox or enzyme-support language.",
    sentencePrefix: "molybdenum_intake",
    summary:
      "Molybdenum interpretation is strongest when grounded in trace-mineral intake and supplementation context before benefit-heavy positioning.",
    evidenceRead:
      "Guideline and scoping-review evidence supports using molybdenum as an intake/status lane, not as a broad detox or enzyme-support promise.",
    shopperMeaning:
      "When comparing molybdenum products, check microgram amount and exact form wording such as molybdate or chelate before relying on broad trace-mineral branding.",
    caveat:
      "Do not translate molybdenum's biochemical cofactor role into a blanket shopper need signal or detox claim.",
    summaryReferenceId: "pmid:35365361",
    evidenceReferenceId: "pmid:38187804",
    shopperReferenceId: "pmid:38187804",
    caveatReferenceId: "pmid:10382558",
    references: [
      { pmid: "35365361", title: "ESPEN micronutrient guideline." },
      {
        pmid: "38187804",
        title:
          "Molybdenum - a scoping review for Nordic Nutrition Recommendations 2023.",
      },
      { pmid: "10382558", title: "Molybdenum." },
    ],
  }),
  buildSimpleReviewedEvidenceRow({
    family: "iodine",
    sectionKey: "intake_and_status_context",
    evidenceGrade: "B",
    overallConfidence: 0.74,
    displayText:
      "Iodine labels are best read through intake/status, disclosed amount, and source wording such as iodide or kelp rather than broad thyroid or natural-source claims.",
    sentencePrefix: "iodine_intake",
    summary:
      "Iodine interpretation should start with intake and status context before thyroid-adjacent or kelp-based packaging language is over-read.",
    evidenceRead:
      "Review-level evidence supports iodine as an intake/status lane, with source and amount changing how supplement labels should be compared.",
    shopperMeaning:
      "When comparing iodine products, check microgram amount and whether the label uses potassium iodide, sodium iodide, kelp, or seaweed source wording.",
    caveat:
      "Do not turn thyroid-adjacent iodine literature or kelp source language into a broad benefit promise for every shopper.",
    summaryReferenceId: "pmid:35010904",
    evidenceReferenceId: "pmid:25591468",
    shopperReferenceId: "pmid:35010904",
    caveatReferenceId: "pmid:29569622",
    references: [
      {
        pmid: "35010904",
        title:
          "Nutrient Intake and Status in Adults Consuming Plant-Based Diets Compared to Meat-Eaters: A Systematic Review.",
      },
      { pmid: "25591468", title: "Iodine deficiency and thyroid disorders." },
      {
        pmid: "29569622",
        title: "Global epidemiology of hyperthyroidism and hypothyroidism.",
      },
    ],
  }),
  buildSimpleReviewedEvidenceRow({
    family: "papain",
    sectionKey: "functional_context",
    evidenceGrade: "C",
    overallConfidence: 0.52,
    displayText:
      "Papain should be treated as an enzyme label-reading lane first: compare activity, amount, and enzyme-blend context before accepting broad papaya or digestive promises.",
    sentencePrefix: "papain_functional",
    summary:
      "Papain labels are safest to interpret through enzyme identity and formula role rather than broad digestive or papaya wellness language.",
    evidenceRead:
      "The most reliable PubMed support is stronger for papain-like enzyme identity than for broad oral supplement outcomes, so shopper-facing claims should stay label-contextual.",
    shopperMeaning:
      "When comparing papain products, check whether the label discloses enzyme activity units, mass-only papain, papaya-enzyme wording, or a broader enzyme blend.",
    caveat:
      "Do not use general papaya, protease, or mechanism literature as proof that every papain supplement has the same digestive effect.",
    summaryReferenceId: "pmid:37164157",
    evidenceReferenceId: "pmid:12475197",
    shopperReferenceId: "pmid:37164157",
    caveatReferenceId: "pmid:32367410",
    references: [
      {
        pmid: "37164157",
        title:
          "Identification and classification of papain-like cysteine proteinases.",
      },
      {
        pmid: "12475197",
        title:
          "Human and parasitic papain-like cysteine proteases: their role in physiology and pathology and recent developments in inhibitor design.",
      },
      {
        pmid: "32367410",
        title:
          "Therapeutic application of Carica papaya leaf extract in the management of human diseases.",
      },
    ],
  }),
  buildSimpleReviewedEvidenceRow({
    family: "passionflower",
    sectionKey: "primary_use_context",
    evidenceGrade: "B",
    overallConfidence: 0.7,
    displayText:
      "Passionflower labels should be compared through human-use context plus species, extract, tea, or standardization wording rather than broad calming language.",
    sentencePrefix: "passionflower_primary",
    summary:
      "Passionflower has a recognizable human-use lane, but label interpretation should stay tied to preparation and study context.",
    evidenceRead:
      "Clinical and review literature supports keeping passionflower evidence preparation-specific instead of flattening tea, extract, and blend labels together.",
    shopperMeaning:
      "When comparing passionflower products, check Passiflora species wording, tea versus extract format, standardized flavonoid language, and whether it is central or supporting.",
    caveat:
      "Do not generalize sleep or anxiety-adjacent studies to every passionflower dose, extract, or blended calming formula.",
    summaryReferenceId: "pmid:21294203",
    evidenceReferenceId: "pmid:24140586",
    shopperReferenceId: "pmid:24140586",
    caveatReferenceId: "pmid:21294203",
    references: [
      {
        pmid: "21294203",
        title:
          "A double-blind, placebo-controlled investigation of the effects of Passiflora incarnata (passionflower) herbal tea on subjective sleep quality.",
      },
      {
        pmid: "24140586",
        title:
          "Passiflora incarnata L.: ethnopharmacology, clinical application, safety and evaluation of clinical trials.",
      },
      {
        pmid: "29168225",
        title:
          "GABA-modulating phytomedicines for anxiety: A systematic review of preclinical and clinical evidence.",
      },
    ],
  }),
  buildSimpleReviewedEvidenceRow({
    family: "st_john_s_wort",
    sectionKey: "primary_use_context",
    evidenceGrade: "B",
    overallConfidence: 0.76,
    displayText:
      "St. John's wort needs an interaction-aware evidence lane: compare Hypericum extract disclosure and safety context before treating it like ordinary mood-support branding.",
    sentencePrefix: "st_john_s_wort_primary",
    summary:
      "St. John's wort is a high-boundary botanical where shopper-facing interpretation should foreground exact Hypericum disclosure and interaction-aware context.",
    evidenceRead:
      "Review literature repeatedly flags St. John's wort interactions, so evidence reading should stay more cautious than broad mood-support packaging.",
    shopperMeaning:
      "When comparing St. John's wort products, check Hypericum, hypericin, hyperforin, standardized-extract wording, and whether the label gives enough context for safe comparison.",
    caveat:
      "Do not frame St. John's wort as a casual wellness botanical or make treatment-style mood claims in shopper-facing copy.",
    summaryReferenceId: "pmid:36246064",
    evidenceReferenceId: "pmid:19719333",
    shopperReferenceId: "pmid:28762712",
    caveatReferenceId: "pmid:28762712",
    references: [
      {
        pmid: "36246064",
        title:
          "Hypericum perforatum: Traditional uses, clinical trials, and drug interactions.",
      },
      {
        pmid: "19719333",
        title:
          "Interactions between herbal medicines and prescribed drugs: an updated systematic review.",
      },
      {
        pmid: "28762712",
        title: "Common Herbal Dietary Supplement-Drug Interactions.",
      },
    ],
  }),
  buildSimpleReviewedEvidenceRow({
    family: "lavender",
    sectionKey: "primary_use_context",
    evidenceGrade: "B",
    overallConfidence: 0.75,
    displayText:
      "Lavender supplement labels should separate oral/studied preparation context from broad aromatherapy language, with Silexan-style or extract wording carrying comparison value.",
    sentencePrefix: "lavender_primary",
    summary:
      "Lavender has review-level human evidence, but supplement comparison should stay tied to the studied route and preparation rather than broad calming copy.",
    evidenceRead:
      "Meta-analytic evidence is most useful when read by preparation, especially where oral lavender oil preparations are distinguished from general lavender exposure.",
    shopperMeaning:
      "When comparing lavender products, check whether the label discloses lavender oil, Silexan-style preparation, flower powder, extract, route, and amount.",
    caveat:
      "Do not assume aromatherapy, topical, tea, and oral capsule lavender labels share the same evidence lane.",
    summaryReferenceId: "pmid:31655395",
    evidenceReferenceId: "pmid:29150713",
    shopperReferenceId: "pmid:29150713",
    caveatReferenceId: "pmid:31655395",
    references: [
      {
        pmid: "31655395",
        title:
          "Effects of lavender on anxiety: A systematic review and meta-analysis.",
      },
      {
        pmid: "29150713",
        title:
          "Efficacy of Silexan in subthreshold anxiety: meta-analysis of randomised, placebo-controlled trials.",
      },
      {
        pmid: "21170695",
        title:
          "Efficacy and safety of silexan, a new, orally administered lavender oil preparation, in subthreshold anxiety disorder - evidence from clinical trials.",
      },
    ],
  }),
  buildSimpleReviewedEvidenceRow({
    family: "lemon_balm",
    sectionKey: "primary_use_context",
    evidenceGrade: "C",
    overallConfidence: 0.64,
    displayText:
      "Lemon balm has a narrower oral-use lane, so compare Melissa disclosure, extract or tea format, and formula role before accepting broad calming language.",
    sentencePrefix: "lemon_balm_primary",
    summary:
      "Lemon balm labels are best interpreted through oral human-use context and exact Melissa officinalis disclosure rather than broad herbal calming copy.",
    evidenceRead:
      "The human evidence is more preparation- and population-specific than the broad marketing language often suggests.",
    shopperMeaning:
      "When comparing lemon balm products, check Melissa species wording, leaf, tea, extract, standardization detail, amount, and whether it is central or supporting.",
    caveat:
      "Do not generalize distress, sleep, antiviral, or formula-specific lemon balm findings to every calming blend.",
    summaryReferenceId: "pmid:37927585",
    evidenceReferenceId: "pmid:29908682",
    shopperReferenceId: "pmid:35730441",
    caveatReferenceId: "pmid:36655201",
    references: [
      {
        pmid: "37927585",
        title:
          "The possible calming effect of subchronic supplementation of a standardised phospholipid carrier-based Melissa officinalis L. extract in healthy adults with emotional distress and poor sleep conditions: results from a prospective, randomised, double-blind, placebo-controlled study.",
      },
      {
        pmid: "29908682",
        title:
          "The effects of Melissa officinalis supplementation on depression, anxiety, stress, and sleep disorder in patients with chronic stable angina.",
      },
      {
        pmid: "35730441",
        title:
          "An Updated Review on The Properties of Melissa officinalis L.: Not Exclusively Anti-anxiety.",
      },
      {
        pmid: "36655201",
        title:
          "Antiviral Potential of Melissa officinalis L.: A Literature Review.",
      },
    ],
  }),
  buildSimpleReviewedEvidenceRow({
    family: "pantothenic_acid",
    sectionKey: "status_and_supplementation_context",
    evidenceGrade: "B",
    overallConfidence: 0.71,
    displayText:
      "Pantothenic acid is best read through B-vitamin intake/status and dose-aware supplementation context, with pantethine or B5 form language kept narrower.",
    sentencePrefix: "pantothenic_acid_status",
    summary:
      "Pantothenic acid labels are clearest when interpreted through B-vitamin intake, status, and supplementation context before broad energy language is over-read.",
    evidenceRead:
      "Guideline and B-complex review evidence supports keeping B5 interpretation practical and dose-aware rather than promotional.",
    shopperMeaning:
      "When comparing pantothenic acid products, check dose, vitamin B5, calcium pantothenate, or pantethine wording, and whether B5 is central or part of a broader B-complex.",
    caveat:
      "Do not treat pantethine, calcium pantothenate, and generic B5 labels as interchangeable evidence stories.",
    summaryReferenceId: "pmid:35365361",
    evidenceReferenceId: "pmid:36235591",
    shopperReferenceId: "pmid:35365361",
    caveatReferenceId: "pmid:35276844",
    references: [
      { pmid: "35365361", title: "ESPEN micronutrient guideline." },
      {
        pmid: "36235591",
        title:
          "Dietary Vitamin B Complex: Orchestration in Human Nutrition throughout Life with Sex Differences.",
      },
      {
        pmid: "35276844",
        title:
          "Biological Properties of Vitamins of the B-Complex, Part 1: Vitamins B(1), B(2), B(3), and B(5).",
      },
    ],
  }),
];

const main = async () => {
  const reviewedRaw = await fs.readFile(REVIEWED_PATH, "utf8");
  const stagedRaw = await fs.readFile(STAGED_PATH, "utf8");

  const reviewed = JSON.parse(reviewedRaw) as {
    metadata?: Record<string, unknown>;
    scientific_background_evidence?: ReviewedEvidenceRow[];
    candidate_pubmed_searches?: ReviewedCandidateSearch[];
  };
  const staged = JSON.parse(stagedRaw) as {
    scientific_evidence_candidate_registry?: StagedCandidateRow[];
  };

  const evidenceRows = Array.isArray(reviewed.scientific_background_evidence)
    ? [...reviewed.scientific_background_evidence]
    : [];
  const candidateRows = Array.isArray(reviewed.candidate_pubmed_searches)
    ? [...reviewed.candidate_pubmed_searches]
    : [];
  const stagedRows = Array.isArray(
    staged.scientific_evidence_candidate_registry,
  )
    ? staged.scientific_evidence_candidate_registry.filter(
        shouldSyncCandidateSearch,
      )
    : [];
  const evidencePromotionRows = stagedRows.filter(
    shouldPromoteCandidateEvidence,
  );

  const candidateIndex = new Map<string, number>();
  candidateRows.forEach((row, index) => {
    candidateIndex.set(rowKey(row.family, row.lane, row.variant_key), index);
  });

  let candidateUpserts = 0;
  for (const row of stagedRows) {
    const nextCandidate: ReviewedCandidateSearch = {
      family: row.family,
      lane: row.lane,
      ...(row.variant_key ? { variant_key: row.variant_key } : {}),
      source: row.source,
      retrieved_at: row.retrieved_at,
      query: row.query,
      candidates: row.plugin_verified_pmids,
      priority: row.priority,
      selection_notes: row.selection_notes,
    };
    const key = rowKey(row.family, row.lane, row.variant_key);
    const existingIndex = candidateIndex.get(key);
    if (typeof existingIndex === "number") {
      candidateRows[existingIndex] = nextCandidate;
    } else {
      candidateIndex.set(key, candidateRows.length);
      candidateRows.push(nextCandidate);
    }
    candidateUpserts += 1;
  }

  const evidenceIndex = new Set(
    evidenceRows.map((row) =>
      rowKey(row.ingredient_family, row.section_key, row.variant_key),
    ),
  );
  let evidencePromotions = 0;
  for (const row of evidencePromotionRows) {
    const genericKey = rowKey(row.family, row.lane, null);
    if (evidenceIndex.has(genericKey)) continue;
    const promotedRow = buildReviewedEvidenceRowFromCandidate(row);
    if (!promotedRow) continue;
    evidenceRows.push(promotedRow);
    evidenceIndex.add(genericKey);
    evidencePromotions += 1;
  }

  const evidenceRowIndex = new Map(
    evidenceRows.map((row, index) => [
      rowKey(row.ingredient_family, row.section_key, row.variant_key),
      index,
    ]),
  );

  let explicitSeedUpserts = 0;
  for (const seedRow of buildReviewedEvidenceSeedRows()) {
    const key = rowKey(
      seedRow.ingredient_family,
      seedRow.section_key,
      seedRow.variant_key,
    );
    const existingIndex = evidenceRowIndex.get(key);
    if (typeof existingIndex === "number") {
      evidenceRows[existingIndex] = seedRow;
    } else {
      evidenceRowIndex.set(key, evidenceRows.length);
      evidenceRows.push(seedRow);
    }
    evidenceIndex.add(key);
    explicitSeedUpserts += 1;
  }

  const templateRowsPolished =
    polishRegistryTemplateEvidenceRows(evidenceRows);

  const nextPayload = {
    ...reviewed,
    scientific_background_evidence: evidenceRows,
    candidate_pubmed_searches: candidateRows,
  };

  await fs.writeFile(
    REVIEWED_PATH,
    `${JSON.stringify(nextPayload, null, 2)}\n`,
    "utf8",
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        candidate_upserts: candidateUpserts,
        evidence_promotions: evidencePromotions,
        explicit_seed_upserts: explicitSeedUpserts,
        template_rows_polished: templateRowsPolished,
        approved_candidate_rows: stagedRows.length,
        approved_evidence_rows: evidencePromotionRows.length,
        selected_rows: stagedRows.map((row) => ({
          family: row.family,
          lane: row.lane,
          priority: row.priority,
        })),
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(
    `[promote-nutri-minimal-v4-reviewed-evidence] ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
