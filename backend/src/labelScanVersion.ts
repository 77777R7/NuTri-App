/**
 * Label scan parser/OCR version contract.
 * Used for strict cache cutover and traceability in responses/logs.
 */

export const LABEL_PARSER_VERSION =
  process.env.LABEL_PARSER_VERSION?.trim() || "v2.3.0";

export const LABEL_OCR_ENGINE =
  process.env.LABEL_OCR_ENGINE?.trim() || "google_vision_document_text";

export const LABEL_OCR_PARAMS_VERSION =
  process.env.LABEL_OCR_PARAMS_VERSION?.trim() || "default";

export const LABEL_PREPROCESS_PROFILE_DEFAULT =
  process.env.LABEL_PREPROCESS_PROFILE_DEFAULT?.trim() || "jpeg_1800_q82";

export const LABEL_ANALYSIS_VERSION =
  process.env.LABEL_ANALYSIS_VERSION?.trim() || "v3.0.0";

export function normalizePreprocessProfile(value?: string | null): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0
    ? normalized
    : LABEL_PREPROCESS_PROFILE_DEFAULT;
}

export function buildVersionedOcrCacheKey(
  imageHash: string,
  preprocessProfile?: string | null,
): string {
  const profile = normalizePreprocessProfile(preprocessProfile);
  // OCR cache should remain parser-independent so parser iterations can reuse OCR output.
  return `${imageHash}::${LABEL_OCR_ENGINE}::${LABEL_OCR_PARAMS_VERSION}::${profile}`;
}

export function buildParseCacheKey(ocrCacheKey: string): string {
  return `${ocrCacheKey}::${LABEL_PARSER_VERSION}`;
}

export function buildAnalysisCacheKey(parseCacheKey: string): string {
  return `${parseCacheKey}::${LABEL_ANALYSIS_VERSION}`;
}
