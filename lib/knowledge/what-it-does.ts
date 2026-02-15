import { normalizeHumanTextForMatch } from "@/lib/text/normalizeHumanText";
import { isLowQualityOdsOverview, normalizeOdsText } from "./ods-quality-gate.js";

const SAFE_PLACEHOLDER = "We don't have a vetted summary for this ingredient yet.";

const normalizeForCompare = (value: string) =>
  normalizeHumanTextForMatch(value)
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripTrailingEllipsis = (value: string) => value.replace(/\.\.\.$/, "").trim();

export const isMeaningfulOverviewText = (text: string | null | undefined, productName?: string | null): boolean => {
  const normalized = normalizeOdsText(text);
  if (!normalized) return false;
  if (normalized.length < 35) return false;
  if (isLowQualityOdsOverview(normalized)) return false;

  const product = normalizeForCompare(productName ?? "");
  const candidate = normalizeForCompare(stripTrailingEllipsis(normalized));
  if (product && candidate) {
    if (candidate === product) return false;
    if (candidate.startsWith(product) && candidate.length <= product.length + 20) return false;
  }

  return true;
};

export const pickMeaningfulOverviewText = (params: {
  productName?: string | null;
  candidates: Array<string | null | undefined>;
}): { text: string; usedPlaceholder: boolean } => {
  for (const candidate of params.candidates) {
    if (!isMeaningfulOverviewText(candidate, params.productName)) continue;
    return { text: normalizeOdsText(candidate), usedPlaceholder: false };
  }
  return { text: SAFE_PLACEHOLDER, usedPlaceholder: true };
};

export const SAFE_OVERVIEW_PLACEHOLDER = SAFE_PLACEHOLDER;
