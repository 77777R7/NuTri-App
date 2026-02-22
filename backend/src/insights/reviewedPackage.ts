import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type ReviewedPackageMeta = {
  datasetVersion: string;
  reviewedAt: string;
  packageSha256: string;
};

type ReviewedSentence = {
  text: string;
  sentenceId: string | null;
  excerptId: string | null;
  referenceId: string | null;
  evidenceGrade: string | null;
};

export type ReviewedSegments = {
  absorption?: ReviewedSentence[];
  solubility?: ReviewedSentence[];
  tolerability?: ReviewedSentence[];
  caveats?: ReviewedSentence[];
};

export type ReviewedFormExplain = {
  ingredientId: string;
  formKey: string;
  formLabel?: string;
  evidenceGrade?: "A" | "B" | "C" | "D" | "E";
  overallConfidence?: number;
  relativeFactor?: number;
  displayText?: string;
  segments: ReviewedSegments;
  meta: ReviewedPackageMeta;
};

const readString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readSentenceBucket = (bucket: unknown): ReviewedSentence[] => {
  if (!bucket || typeof bucket !== "object") return [];
  const en = (bucket as { en?: unknown }).en;
  if (!Array.isArray(en)) return [];

  const rows: ReviewedSentence[] = [];
  for (const row of en) {
    if (!row || typeof row !== "object") continue;
    const source = row as Record<string, unknown>;
    const text = readString(source.text);
    if (!text) continue;
    rows.push({
      text,
      sentenceId: readString(source.sentence_id),
      excerptId: readString(source.evidence_snippet_id),
      referenceId: readString(source.evidence_reference_id),
      evidenceGrade: readString(source.evidence_grade),
    });
    if (rows.length >= 2) break;
  }

  return rows;
};

let loadAttempted = false;
let reviewedIndex = new Map<string, ReviewedFormExplain>();
let packageMeta: ReviewedPackageMeta = {
  datasetVersion: "unknown",
  reviewedAt: "unknown",
  packageSha256: "",
};

const getDefaultPath = () =>
  process.env.REVIEWED_FORM_EXPLAINS_PATH ??
  path.join(process.cwd(), "data", "reviewed", "reviewed-form-explains-v4.json");

export function loadReviewedPackageOnce(): void {
  if (loadAttempted) return;
  loadAttempted = true;

  const filePath = getDefaultPath();
  let rawBuffer: Buffer;
  try {
    rawBuffer = fs.readFileSync(filePath);
  } catch {
    reviewedIndex = new Map();
    return;
  }

  const packageSha256 = createHash("sha256").update(rawBuffer).digest("hex");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBuffer.toString("utf-8")) as Record<string, unknown>;
  } catch {
    reviewedIndex = new Map();
    packageMeta = {
      datasetVersion: "unknown",
      reviewedAt: "unknown",
      packageSha256,
    };
    return;
  }

  const metadata =
    parsed.metadata && typeof parsed.metadata === "object"
      ? (parsed.metadata as Record<string, unknown>)
      : null;

  packageMeta = {
    datasetVersion:
      readString(metadata?.source_version) ??
      readString(metadata?.package_version) ??
      "v4.0-en-only",
    reviewedAt: readString(metadata?.generated_at) ?? "unknown",
    packageSha256,
  };

  const rows = Array.isArray(parsed.form_explain_library_top100)
    ? (parsed.form_explain_library_top100 as Array<Record<string, unknown>>)
    : [];

  const nextIndex = new Map<string, ReviewedFormExplain>();
  for (const row of rows) {
    const ingredientId = readString(row.ingredient_id);
    const formKey = readString(row.form_key);
    if (!ingredientId || !formKey) continue;

    const segmentsSource =
      row.segments && typeof row.segments === "object"
        ? (row.segments as Record<string, unknown>)
        : {};

    const absorption = readSentenceBucket(segmentsSource.absorption);
    const solubility = readSentenceBucket(segmentsSource.solubility);
    const tolerability = readSentenceBucket(segmentsSource.tolerability);
    const caveats = readSentenceBucket(segmentsSource.caveats);

    const entry: ReviewedFormExplain = {
      ingredientId,
      formKey,
      formLabel: readString(row.form_display) ?? undefined,
      evidenceGrade: (readString(row.evidence_grade) as ReviewedFormExplain["evidenceGrade"]) ?? undefined,
      overallConfidence: readNumber(row.overall_confidence) ?? undefined,
      relativeFactor: readNumber(row.relative_factor) ?? undefined,
      displayText: readString(row.display_text) ?? undefined,
      segments: {
        ...(absorption.length > 0 ? { absorption } : {}),
        ...(solubility.length > 0 ? { solubility } : {}),
        ...(tolerability.length > 0 ? { tolerability } : {}),
        ...(caveats.length > 0 ? { caveats } : {}),
      },
      meta: packageMeta,
    };

    nextIndex.set(`${ingredientId}|${formKey}`, entry);
  }

  reviewedIndex = nextIndex;
}

export function getReviewedFormExplain(
  ingredientId: string,
  formKey: string,
  locale: "en",
): ReviewedFormExplain | null {
  if (locale !== "en") return null;
  loadReviewedPackageOnce();
  const key = `${ingredientId}|${formKey}`;
  return reviewedIndex.get(key) ?? null;
}

export function batchGetReviewedFormExplain(
  reqs: Array<{ ingredientId: string; formKey: string; locale: "en" }>,
): Array<{ status: "ok" | "not_found"; item: ReviewedFormExplain | null; reason?: string }> {
  loadReviewedPackageOnce();
  return reqs.map((req) => {
    if (req.locale !== "en") {
      return { status: "not_found", item: null, reason: "no_entry_for_form_key" };
    }
    const item = reviewedIndex.get(`${req.ingredientId}|${req.formKey}`) ?? null;
    if (!item) {
      return { status: "not_found", item: null, reason: "no_entry_for_form_key" };
    }
    return { status: "ok", item };
  });
}
