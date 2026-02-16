import type { WebScoringReasonCode } from "./reasonCodes.js";

type OwnershipInput = {
  barcode: string;
  regId?: string | null;
  evidenceText?: string | null;
  candidateBrand?: string | null;
  expectedBrand?: string | null;
  candidateName?: string | null;
  expectedName?: string | null;
  variantCueMatch?: number | null;
};

export type OwnershipResult = {
  pass: boolean;
  reasonCode: WebScoringReasonCode;
  confidence: "strong" | "medium" | "failed";
  detail: {
    barcodeMatched: boolean;
    regIdMatched: boolean;
    brandSimilarity: number;
    productNameSimilarity: number;
    variantCueMatch: number;
  };
};

const normalize = (value?: string | null): string =>
  (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const trigram = (value: string): Set<string> => {
  const clean = `  ${normalize(value)}  `;
  const set = new Set<string>();
  for (let i = 0; i < clean.length - 2; i += 1) {
    set.add(clean.slice(i, i + 3));
  }
  return set;
};

const similarity = (a?: string | null, b?: string | null): number => {
  const aa = normalize(a);
  const bb = normalize(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  const ta = trigram(aa);
  const tb = trigram(bb);
  if (!ta.size || !tb.size) return 0;
  let intersection = 0;
  ta.forEach((token) => {
    if (tb.has(token)) intersection += 1;
  });
  return intersection / (ta.size + tb.size - intersection);
};

const containsToken = (haystack?: string | null, needle?: string | null): boolean => {
  const h = normalize(haystack);
  const n = normalize(needle);
  if (!h || !n) return false;
  return h.includes(n);
};

export const verifyWebOwnership = (input: OwnershipInput): OwnershipResult => {
  const barcodeDigits = (input.barcode ?? "").replace(/\D/g, "");
  const evidence = input.evidenceText ?? "";

  const barcodeMatched = barcodeDigits.length >= 8 && containsToken(evidence, barcodeDigits);
  const regIdMatched = Boolean(input.regId && containsToken(evidence, input.regId));

  if (barcodeMatched) {
    return {
      pass: true,
      reasonCode: "WEB_OWNERSHIP_STRONG_PASS_BARCODE",
      confidence: "strong",
      detail: {
        barcodeMatched,
        regIdMatched,
        brandSimilarity: 0,
        productNameSimilarity: 0,
        variantCueMatch: Number(input.variantCueMatch ?? 0),
      },
    };
  }

  if (regIdMatched) {
    return {
      pass: true,
      reasonCode: "WEB_OWNERSHIP_STRONG_PASS_REG_ID",
      confidence: "strong",
      detail: {
        barcodeMatched,
        regIdMatched,
        brandSimilarity: 0,
        productNameSimilarity: 0,
        variantCueMatch: Number(input.variantCueMatch ?? 0),
      },
    };
  }

  const brandSimilarity = similarity(input.candidateBrand, input.expectedBrand);
  const productNameSimilarity = similarity(input.candidateName, input.expectedName);
  const variantCueMatch = Math.max(0, Number(input.variantCueMatch ?? 0));

  const mediumPass =
    brandSimilarity >= 0.88 &&
    productNameSimilarity >= 0.82 &&
    variantCueMatch >= 1;

  if (mediumPass) {
    return {
      pass: true,
      reasonCode: "WEB_OWNERSHIP_MEDIUM_PASS",
      confidence: "medium",
      detail: {
        barcodeMatched,
        regIdMatched,
        brandSimilarity,
        productNameSimilarity,
        variantCueMatch,
      },
    };
  }

  return {
    pass: false,
    reasonCode: "WEB_OWNERSHIP_FAILED",
    confidence: "failed",
    detail: {
      barcodeMatched,
      regIdMatched,
      brandSimilarity,
      productNameSimilarity,
      variantCueMatch,
    },
  };
};
