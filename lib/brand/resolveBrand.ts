type BrandConfidence = "high" | "medium" | "low" | (string & {});
type BrandSource = "rule" | "ai" | (string & {});

export type BrandExtractionLike = {
  brand: string | null;
  confidence?: BrandConfidence;
  source?: BrandSource;
} | null | undefined;

function collapseSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function sanitizeBrandCandidate(value?: string | null): string | null {
  if (!value) return null;
  let cleaned = collapseSpaces(value);
  if (!cleaned) return null;

  // Normalize common separators used in backend logging / scraped titles.
  cleaned = cleaned.replace(/｜/g, "|");

  // If we have a pipe-delimited list, prefer the first segment (usually the brand).
  if (cleaned.includes("|")) {
    const [left] = cleaned.split("|");
    cleaned = collapseSpaces(left ?? "");
  }

  // If we have "Foo - Bar" (with spaces around), prefer the head segment for brand.
  const dashSplit = cleaned.split(/\s[\-\u2013\u2014]\s/);
  if (dashSplit.length > 1) {
    cleaned = collapseSpaces(dashSplit[0] ?? cleaned);
  }

  // Keep it conservative: do not attempt to "fix" legal entities here (formatter handles UI length).
  cleaned = cleaned.replace(/[^\p{L}\p{N}\s\-’'®]/gu, " ");
  cleaned = collapseSpaces(cleaned);

  if (!cleaned) return null;
  if (/^\d+$/.test(cleaned)) return null;
  return cleaned;
}

function isConfidencePreferred(confidence?: BrandConfidence) {
  return confidence === "high" || confidence === "medium";
}

function passesRuleBrandSanity(brand: string) {
  const raw = collapseSpaces(brand.replace(/｜/g, "|"));
  const tokenCount = raw.split(" ").filter(Boolean).length;
  const hasDba = /\b(?:dba|doing\s+business\s+as)\b/i.test(raw);
  const hasListSeparators = /[|/;]/.test(raw);
  return tokenCount <= 5 && !hasDba && !hasListSeparators;
}

export function resolveBrand(
  brandExtraction: BrandExtractionLike,
  ...candidates: Array<string | null | undefined>
): string | null {
  const extractionBrand =
    brandExtraction && typeof brandExtraction.brand === "string"
      ? sanitizeBrandCandidate(brandExtraction.brand)
      : null;

  let preferred: string | null = null;
  if (extractionBrand && isConfidencePreferred(brandExtraction?.confidence)) {
    const source = brandExtraction?.source;
    if (source === "ai") {
      preferred = extractionBrand;
    } else if (source === "rule") {
      preferred = passesRuleBrandSanity(extractionBrand) ? extractionBrand : null;
    }
  }

  const ordered = [preferred, ...candidates.map((c) => sanitizeBrandCandidate(c ?? null))];
  for (const value of ordered) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

