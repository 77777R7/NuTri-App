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

type ParsedReviewedPackage = Record<string, unknown>;

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

const getDefaultOverridesPath = () =>
  process.env.REVIEWED_FORM_EXPLAINS_OVERRIDES_PATH ??
  path.join(process.cwd(), "data", "reviewed", "reviewed-form-explains-overrides.v1.json");

const buildPackageMeta = (
  metadata: Record<string, unknown> | null,
  packageSha256: string,
  fallbackDatasetVersion?: string,
): ReviewedPackageMeta => ({
  datasetVersion:
    readString(metadata?.source_version) ??
    readString(metadata?.package_version) ??
    fallbackDatasetVersion ??
    "v4.0-en-only",
  reviewedAt: readString(metadata?.generated_at) ?? "unknown",
  packageSha256,
});

const pickRows = (parsed: ParsedReviewedPackage | null, keys: string[]): Array<Record<string, unknown>> => {
  if (!parsed) return [];
  for (const key of keys) {
    const value = parsed[key];
    if (Array.isArray(value)) {
      return value as Array<Record<string, unknown>>;
    }
  }
  return [];
};

const parseReviewedRow = (
  row: Record<string, unknown>,
  meta: ReviewedPackageMeta,
): ReviewedFormExplain | null => {
  const ingredientId = readString(row.ingredient_id);
  const formKey = readString(row.form_key);
  if (!ingredientId || !formKey) return null;

  const segmentsSource =
    row.segments && typeof row.segments === "object"
      ? (row.segments as Record<string, unknown>)
      : {};

  const absorption = readSentenceBucket(segmentsSource.absorption);
  const solubility = readSentenceBucket(segmentsSource.solubility);
  const tolerability = readSentenceBucket(segmentsSource.tolerability);
  const caveats = readSentenceBucket(segmentsSource.caveats);

  return {
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
    meta,
  };
};

export function loadReviewedPackageOnce(): void {
  if (loadAttempted) return;
  loadAttempted = true;

  const filePath = getDefaultPath();
  let baseBuffer: Buffer | null = null;
  try {
    baseBuffer = fs.readFileSync(filePath);
  } catch {
    baseBuffer = null;
  }

  const baseSha256 = baseBuffer ? createHash("sha256").update(baseBuffer).digest("hex") : "";
  let parsedBase: ParsedReviewedPackage | null = null;
  if (baseBuffer) {
    try {
      parsedBase = JSON.parse(baseBuffer.toString("utf-8")) as ParsedReviewedPackage;
    } catch {
      parsedBase = null;
    }
  }

  const baseMetadata =
    parsedBase?.metadata && typeof parsedBase.metadata === "object"
      ? (parsedBase.metadata as Record<string, unknown>)
      : null;
  packageMeta = buildPackageMeta(baseMetadata, baseSha256);

  const nextIndex = new Map<string, ReviewedFormExplain>();
  const baseRows = pickRows(parsedBase, ["form_explain_library_top100"]);
  for (const row of baseRows) {
    const entry = parseReviewedRow(row, packageMeta);
    if (!entry) continue;
    nextIndex.set(`${entry.ingredientId}|${entry.formKey}`, entry);
  }

  const overridesPath = getDefaultOverridesPath();
  try {
    const overrideBuffer = fs.readFileSync(overridesPath);
    const overrideSha256 = createHash("sha256").update(overrideBuffer).digest("hex");
    let parsedOverrides: ParsedReviewedPackage | null = null;
    try {
      parsedOverrides = JSON.parse(overrideBuffer.toString("utf-8")) as ParsedReviewedPackage;
    } catch {
      parsedOverrides = null;
    }

    if (parsedOverrides) {
      const overrideMetadata =
        parsedOverrides.metadata && typeof parsedOverrides.metadata === "object"
          ? (parsedOverrides.metadata as Record<string, unknown>)
          : null;
      const overrideMeta = buildPackageMeta(
        overrideMetadata,
        overrideSha256,
        packageMeta.datasetVersion,
      );
      const overrideRows = pickRows(parsedOverrides, [
        "form_explain_overrides",
        "form_explain_library_overrides",
        "form_explain_library_top100",
      ]);
      for (const row of overrideRows) {
        const entry = parseReviewedRow(row, overrideMeta);
        if (!entry) continue;
        nextIndex.set(`${entry.ingredientId}|${entry.formKey}`, entry);
      }
    }
  } catch {
    // Optional overlay file.
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
