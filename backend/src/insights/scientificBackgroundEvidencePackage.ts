import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ReviewedPackageMeta } from "./reviewedPackage.js";

export type ScientificBackgroundEvidenceSentence = {
  text: string;
  sentenceId: string | null;
  excerptId: string | null;
  referenceId: string | null;
  evidenceGrade: string | null;
};

export type ScientificBackgroundEvidenceReference = {
  id: string;
  source: string | null;
  title: string | null;
  url: string | null;
};

export type ScientificBackgroundEvidenceSegments = {
  summarySupport?: ScientificBackgroundEvidenceSentence[];
  evidenceReadSupport?: ScientificBackgroundEvidenceSentence[];
  shopperMeaningSupport?: ScientificBackgroundEvidenceSentence[];
  caveats?: ScientificBackgroundEvidenceSentence[];
};

export type ScientificBackgroundEvidenceRow = {
  ingredientFamily: string;
  sectionKey: string;
  variantKey?: string;
  variantLabel?: string;
  evidenceGrade?: "A" | "B" | "C" | "D" | "E";
  overallConfidence?: number;
  displayText?: string;
  supportingReferences: ScientificBackgroundEvidenceReference[];
  segments: ScientificBackgroundEvidenceSegments;
  meta: ReviewedPackageMeta;
};

type ParsedScientificBackgroundEvidencePackage = Record<string, unknown>;

const readString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const normalizeLookupPart = (value: string | null | undefined): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

const readSentenceBucket = (
  bucket: unknown,
): ScientificBackgroundEvidenceSentence[] => {
  if (!bucket || typeof bucket !== "object") return [];
  const en = (bucket as { en?: unknown }).en;
  if (!Array.isArray(en)) return [];

  const rows: ScientificBackgroundEvidenceSentence[] = [];
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

const readSupportingReferences = (
  bucket: unknown,
): ScientificBackgroundEvidenceReference[] => {
  if (!Array.isArray(bucket)) return [];

  const refs: ScientificBackgroundEvidenceReference[] = [];
  for (const item of bucket) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const id = readString(source.id);
    if (!id) continue;
    refs.push({
      id,
      source: readString(source.source),
      title: readString(source.title),
      url: readString(source.url),
    });
  }

  return refs;
};

const buildPackageMeta = (
  metadata: Record<string, unknown> | null,
  packageSha256: string,
  fallbackDatasetVersion?: string,
): ReviewedPackageMeta => ({
  datasetVersion:
    readString(metadata?.source_version) ??
    readString(metadata?.package_version) ??
    fallbackDatasetVersion ??
    "scientific-background-evidence-v1",
  reviewedAt: readString(metadata?.generated_at) ?? "unknown",
  packageSha256,
});

const pickRows = (
  parsed: ParsedScientificBackgroundEvidencePackage | null,
  keys: string[],
): Array<Record<string, unknown>> => {
  if (!parsed) return [];
  for (const key of keys) {
    const value = parsed[key];
    if (Array.isArray(value)) {
      return value as Array<Record<string, unknown>>;
    }
  }
  return [];
};

const buildRowKey = (
  ingredientFamily: string,
  sectionKey: string,
  variantKey?: string,
): string =>
  `${normalizeLookupPart(ingredientFamily)}|${normalizeLookupPart(sectionKey)}|${normalizeLookupPart(variantKey)}`;

const parseEvidenceRow = (
  row: Record<string, unknown>,
  meta: ReviewedPackageMeta,
): ScientificBackgroundEvidenceRow | null => {
  const ingredientFamily = readString(row.ingredient_family);
  const sectionKey = readString(row.section_key);
  if (!ingredientFamily || !sectionKey) return null;

  const variantKey = readString(row.variant_key) ?? undefined;
  const segmentsSource =
    row.segments && typeof row.segments === "object"
      ? (row.segments as Record<string, unknown>)
      : {};

  const summarySupport = readSentenceBucket(segmentsSource.summary_support);
  const evidenceReadSupport = readSentenceBucket(
    segmentsSource.evidence_read_support,
  );
  const shopperMeaningSupport = readSentenceBucket(
    segmentsSource.shopper_meaning_support,
  );
  const caveats = readSentenceBucket(segmentsSource.caveats);

  return {
    ingredientFamily,
    sectionKey,
    ...(variantKey ? { variantKey } : {}),
    ...(readString(row.variant_label)
      ? { variantLabel: readString(row.variant_label) ?? undefined }
      : {}),
    evidenceGrade:
      (readString(
        row.evidence_grade,
      ) as ScientificBackgroundEvidenceRow["evidenceGrade"]) ?? undefined,
    overallConfidence: readNumber(row.overall_confidence) ?? undefined,
    displayText: readString(row.display_text) ?? undefined,
    supportingReferences: readSupportingReferences(row.supporting_references),
    segments: {
      ...(summarySupport.length > 0 ? { summarySupport } : {}),
      ...(evidenceReadSupport.length > 0 ? { evidenceReadSupport } : {}),
      ...(shopperMeaningSupport.length > 0 ? { shopperMeaningSupport } : {}),
      ...(caveats.length > 0 ? { caveats } : {}),
    },
    meta,
  };
};

let loadAttempted = false;
let evidenceIndex = new Map<string, ScientificBackgroundEvidenceRow>();
let packageMeta: ReviewedPackageMeta = {
  datasetVersion: "unknown",
  reviewedAt: "unknown",
  packageSha256: "",
};

const BACKEND_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const getDefaultPath = () =>
  process.env.SCIENTIFIC_BACKGROUND_EVIDENCE_PATH ??
  path.join(
    BACKEND_ROOT,
    "data",
    "reviewed",
    "scientific-background-evidence.v1.json",
  );

const getDefaultOverridesPath = () =>
  process.env.SCIENTIFIC_BACKGROUND_EVIDENCE_OVERRIDES_PATH ??
  path.join(
    BACKEND_ROOT,
    "data",
    "reviewed",
    "scientific-background-evidence-overrides.v1.json",
  );

export function loadScientificBackgroundEvidencePackageOnce(): void {
  if (loadAttempted) return;
  loadAttempted = true;

  const filePath = getDefaultPath();
  let baseBuffer: Buffer | null = null;
  try {
    baseBuffer = fs.readFileSync(filePath);
  } catch {
    baseBuffer = null;
  }

  const baseSha256 = baseBuffer
    ? createHash("sha256").update(baseBuffer).digest("hex")
    : "";
  let parsedBase: ParsedScientificBackgroundEvidencePackage | null = null;
  if (baseBuffer) {
    try {
      parsedBase = JSON.parse(
        baseBuffer.toString("utf-8"),
      ) as ParsedScientificBackgroundEvidencePackage;
    } catch {
      parsedBase = null;
    }
  }

  const baseMetadata =
    parsedBase?.metadata && typeof parsedBase.metadata === "object"
      ? (parsedBase.metadata as Record<string, unknown>)
      : null;
  packageMeta = buildPackageMeta(baseMetadata, baseSha256);

  const nextIndex = new Map<string, ScientificBackgroundEvidenceRow>();
  const baseRows = pickRows(parsedBase, [
    "scientific_background_evidence",
    "scientific_background_evidence_library",
  ]);

  for (const row of baseRows) {
    const entry = parseEvidenceRow(row, packageMeta);
    if (!entry) continue;
    nextIndex.set(
      buildRowKey(entry.ingredientFamily, entry.sectionKey, entry.variantKey),
      entry,
    );
  }

  const overridesPath = getDefaultOverridesPath();
  try {
    const overrideBuffer = fs.readFileSync(overridesPath);
    const overrideSha256 = createHash("sha256")
      .update(overrideBuffer)
      .digest("hex");
    let parsedOverrides: ParsedScientificBackgroundEvidencePackage | null =
      null;
    try {
      parsedOverrides = JSON.parse(
        overrideBuffer.toString("utf-8"),
      ) as ParsedScientificBackgroundEvidencePackage;
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
        "scientific_background_evidence_overrides",
        "scientific_background_evidence",
      ]);
      for (const row of overrideRows) {
        const entry = parseEvidenceRow(row, overrideMeta);
        if (!entry) continue;
        nextIndex.set(
          buildRowKey(
            entry.ingredientFamily,
            entry.sectionKey,
            entry.variantKey,
          ),
          entry,
        );
      }
    }
  } catch {
    // Optional override file.
  }

  evidenceIndex = nextIndex;
}

export function getScientificBackgroundEvidence(
  ingredientFamily: string,
  sectionKey: string,
  locale: "en",
  variantKey?: string,
): ScientificBackgroundEvidenceRow | null {
  if (locale !== "en") return null;
  loadScientificBackgroundEvidencePackageOnce();
  if (variantKey) {
    const exact = evidenceIndex.get(
      buildRowKey(ingredientFamily, sectionKey, variantKey),
    );
    if (exact) return exact;
  }
  const generic = evidenceIndex.get(buildRowKey(ingredientFamily, sectionKey));
  if (generic) return generic;
  const genericVariant = evidenceIndex.get(
    buildRowKey(ingredientFamily, sectionKey, "generic_form_comparison"),
  );
  if (genericVariant) return genericVariant;
  return null;
}

export function batchGetScientificBackgroundEvidence(
  reqs: Array<{
    ingredientFamily: string;
    sectionKey: string;
    locale: "en";
    variantKey?: string;
  }>,
): Array<{
  status: "ok" | "not_found";
  item: ScientificBackgroundEvidenceRow | null;
  reason?: string;
}> {
  loadScientificBackgroundEvidencePackageOnce();
  return reqs.map((req) => {
    if (req.locale !== "en") {
      return {
        status: "not_found",
        item: null,
        reason: "no_entry_for_section_key",
      };
    }
    const item = getScientificBackgroundEvidence(
      req.ingredientFamily,
      req.sectionKey,
      req.locale,
      req.variantKey,
    );
    if (!item) {
      return {
        status: "not_found",
        item: null,
        reason: "no_entry_for_section_key",
      };
    }
    return { status: "ok", item };
  });
}
