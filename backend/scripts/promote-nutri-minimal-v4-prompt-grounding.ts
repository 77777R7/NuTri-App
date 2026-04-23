import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type PromptGroundingReviewRow = {
  source_type: "evidence_excerpt" | "curated_override";
  source_id: string;
  review_status: "approved" | "needs_edit" | "rejected";
  review_reasons: string[];
  mapped_family: string | null;
  section_key: string | null;
  ingredient_id: string | null;
  form_key: string | null;
  citation_id: string | null;
  excerpt_text: string | null;
};

type ReviewedFormExplainOverride = Record<string, unknown> & {
  ingredient_id?: string;
  form_key?: string;
  override_id?: string;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUEUE_PATH = path.join(
  ROOT,
  "data",
  "staging",
  "nutri-minimal-v4",
  "prompt-grounding-review-queue.json",
);
const OVERRIDES_PATH = path.join(
  ROOT,
  "data",
  "reviewed",
  "reviewed-form-explains-overrides.v1.json",
);

const PROMOTION_SOURCE = "nutri_minimal_v4_prompt_grounding";

const titleCase = (value: string): string =>
  value
    .split("_")
    .filter(Boolean)
    .map((part) =>
      part.length <= 3
        ? part.toUpperCase()
        : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`,
    )
    .join(" ");

const stableKey = (
  ingredientId: string | null,
  formKey: string | null,
): string =>
  `${String(ingredientId ?? "").trim()}|${String(formKey ?? "").trim()}`;

const sentence = (
  text: string,
  sentenceId: string,
  referenceId: string | null,
): Record<string, unknown> => ({
  text,
  sentence_id: sentenceId,
  evidence_snippet_id: sentenceId.replace("_sentence_", "_excerpt_"),
  ...(referenceId ? { evidence_reference_id: referenceId } : {}),
  evidence_grade: "C",
  source: "nutri_minimal_v4_prompt_grounding",
});

export const selectPromotablePromptGroundingRows = (
  rows: PromptGroundingReviewRow[],
): PromptGroundingReviewRow[] =>
  rows.filter(
    (row) =>
      row.review_status === "approved" &&
      row.source_type === "evidence_excerpt" &&
      Boolean(row.ingredient_id) &&
      Boolean(row.form_key) &&
      Boolean(row.citation_id) &&
      Boolean(row.excerpt_text),
  );

export const buildReviewedFormExplainOverridesFromPromptGroundingRows = (
  rows: PromptGroundingReviewRow[],
): ReviewedFormExplainOverride[] => {
  const grouped = new Map<string, PromptGroundingReviewRow[]>();
  for (const row of selectPromotablePromptGroundingRows(rows)) {
    const key = stableKey(row.ingredient_id, row.form_key);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return Array.from(grouped.entries()).map(([key, group]) => {
    const [ingredientId, formKey] = key.split("|");
    const first = group[0];
    const ingredientLabel = titleCase(ingredientId);
    const formLabel = titleCase(formKey);
    const referenceIds = Array.from(
      new Set(group.map((row) => row.citation_id).filter(Boolean)),
    );
    const sourceIds = Array.from(new Set(group.map((row) => row.source_id)));
    const excerptText = group
      .map((row) => String(row.excerpt_text ?? "").trim())
      .filter(Boolean)
      .join(" ");
    const sourceId = sourceIds[0] ?? `${ingredientId}_${formKey}`;

    return {
      ingredient_id: ingredientId,
      ingredient: ingredientLabel,
      form_key: formKey,
      form_display: formLabel,
      evidence_grade: "C",
      overall_confidence: 0.56,
      relative_factor: 1,
      override_id: `${PROMOTION_SOURCE}_${sourceId}`,
      reference_ids: referenceIds,
      promotion: {
        source: PROMOTION_SOURCE,
        source_ids: sourceIds,
        mapped_family: first?.mapped_family ?? null,
        promoted_at: new Date().toISOString(),
        review_status: "approved",
      },
      segments: {
        absorption: {
          en: [
            sentence(
              excerptText,
              `${ingredientId}_${formKey}_sentence_absorption_001`,
              referenceIds[0] ?? null,
            ),
          ],
        },
        caveats: {
          en: [
            sentence(
              "Use this as form-level label context only; it should not become a disease-treatment, guaranteed-outcome, or universal best-form claim.",
              `${ingredientId}_${formKey}_sentence_caveat_001`,
              referenceIds[0] ?? null,
            ),
          ],
        },
      },
    };
  });
};

const main = async () => {
  const queueRaw = await fs.readFile(QUEUE_PATH, "utf8");
  const overridesRaw = await fs.readFile(OVERRIDES_PATH, "utf8");
  const queue = JSON.parse(queueRaw) as {
    prompt_grounding_review_queue?: PromptGroundingReviewRow[];
  };
  const overrides = JSON.parse(overridesRaw) as {
    metadata?: Record<string, unknown>;
    form_explain_overrides?: ReviewedFormExplainOverride[];
    indexes?: Record<string, unknown>;
  };

  const existingRows = Array.isArray(overrides.form_explain_overrides)
    ? overrides.form_explain_overrides
    : [];
  const promotedRows = buildReviewedFormExplainOverridesFromPromptGroundingRows(
    Array.isArray(queue.prompt_grounding_review_queue)
      ? queue.prompt_grounding_review_queue
      : [],
  );
  const promotedKeys = new Set(
    promotedRows.map((row) =>
      stableKey(row.ingredient_id ?? null, row.form_key ?? null),
    ),
  );
  const nextRows = existingRows.filter(
    (row) =>
      !promotedKeys.has(
        stableKey(row.ingredient_id ?? null, row.form_key ?? null),
      ),
  );
  nextRows.push(...promotedRows);

  const nextPayload = {
    ...overrides,
    metadata: {
      ...(overrides.metadata ?? {}),
      nutri_minimal_v4_prompt_grounding_promoted_at: new Date().toISOString(),
      nutri_minimal_v4_prompt_grounding_source:
        "backend/data/staging/nutri-minimal-v4/prompt-grounding-review-queue.json",
    },
    form_explain_overrides: nextRows,
  };

  await fs.writeFile(
    OVERRIDES_PATH,
    `${JSON.stringify(nextPayload, null, 2)}\n`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        approved_prompt_grounding_rows:
          queue.prompt_grounding_review_queue?.filter(
            (row) => row.review_status === "approved",
          ).length ?? 0,
        promoted_form_override_rows: promotedRows.length,
        output_rows: nextRows.length,
      },
      null,
      2,
    ),
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `[promote-nutri-minimal-v4-prompt-grounding] ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  });
}
