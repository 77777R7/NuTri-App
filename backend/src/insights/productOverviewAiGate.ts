import type { ProductOverviewWhatIsIt } from "../deepseek.js";

export type ProductOverviewAiGateParams = {
  lead: string;
  whatItIs: string;
  whyPeopleTakeIt: string;
  primaryIngredient: string | null;
  productTypeHint: string | null;
  keyIngredients: Array<{ name: string; dose?: string | null }>;
  allIngredientRows?: Array<{ name: string; dose?: string | null }>;
  servingStrength: string | null;
  form: string | null;
  count: string | null;
};

type ProductOverviewAiGateContext = Omit<
  ProductOverviewAiGateParams,
  "lead" | "whatItIs" | "whyPeopleTakeIt"
>;

const safeTrim = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toSentence = (value: string): string =>
  /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;

const normalizeOverviewAiToken = (value?: string | null): string =>
  safeTrim(value)?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";

export const hasProductOverviewAiForbiddenContent = (value: string): boolean => {
  const normalized = normalizeOverviewAiToken(value);
  if (!normalized) return true;
  return /\b(treat|treats|treating|cure|cures|curing|prevent|prevents|prevention|diagnos|therapy|heal|heals|healing|doctor|clinician|physician|pharmacist|with food|empty stomach|best form|superior bioavailability|high absorption|clinically proven)\b/i.test(
    normalized,
  );
};

const countSentenceLikeClauses = (value: string): number =>
  String(value)
    .split(/(?<=[.!?])\s+/)
    .map((part) => safeTrim(part) ?? "")
    .filter(Boolean).length;

const splitSentences = (value: string): string[] =>
  String(value)
    .split(/(?<=[.!?])\s+/)
    .map((part) => safeTrim(part) ?? "")
    .filter(Boolean);

export const passesProductOverviewWhatIsItGate = (
  params: ProductOverviewAiGateParams,
): boolean => {
  const combined = [params.lead, params.whatItIs, params.whyPeopleTakeIt].join(" ");
  if ((safeTrim(combined) ?? "").length < 90) return false;
  if (
    [params.lead, params.whatItIs, params.whyPeopleTakeIt].some((part) =>
      hasProductOverviewAiForbiddenContent(part),
    )
  ) {
    return false;
  }

  const normalizedCombined = normalizeOverviewAiToken(combined);
  const anchorCandidates = [
    params.primaryIngredient,
    params.productTypeHint,
    ...params.keyIngredients.map((item) => item.name),
    ...(params.allIngredientRows ?? []).map((item) => item.name),
  ]
    .map((value) => normalizeOverviewAiToken(value))
    .filter((value) => value.length >= 4);

  if (
    anchorCandidates.length > 0 &&
    !anchorCandidates.some((anchor) => normalizedCombined.includes(anchor))
  ) {
    return false;
  }

  const forbiddenFactEchoes = [params.servingStrength, params.count, params.form]
    .map((value) => normalizeOverviewAiToken(value))
    .filter((value) => value.length >= 4);
  if (forbiddenFactEchoes.some((fact) => normalizedCombined.includes(fact))) {
    return false;
  }

  if (countSentenceLikeClauses(params.whyPeopleTakeIt) > 2) {
    return false;
  }

  return true;
};

const normalizeDisplayToken = (value?: string | null): string | null => {
  const text = safeTrim(value);
  if (!text) return null;
  return text
    .replace(/\s+/g, " ")
    .replace(/\b(?:treats?|treating|cures?|curing|prevents?|prevention|reduces?|reduction)\b.*$/i, "")
    .replace(/\b(?:anti-aging|rejuvenator|detox|cleanse)\b.*$/i, "")
    .trim()
    .replace(/[,\-:;]+$/g, "")
    .trim() || null;
};

const resolveAnchor = (params: ProductOverviewAiGateContext): string => {
  const candidates = [
    params.primaryIngredient,
    params.productTypeHint,
    ...params.keyIngredients.map((item) => item.name),
    ...(params.allIngredientRows ?? []).map((item) => item.name),
  ];
  for (const candidate of candidates) {
    const normalized = normalizeDisplayToken(candidate);
    if (normalized && normalizeOverviewAiToken(normalized).length >= 4) {
      return normalized;
    }
  }
  return "the main disclosed ingredient";
};

const sanitizeApiText = (value: string): string => {
  const text = safeTrim(value) ?? "";
  return text
    .replace(/\bclinically proven\b/gi, "label-positioned")
    .replace(/\bsuperior bioavailability\b/gi, "form wording")
    .replace(/\bhigh absorption\b/gi, "absorption-related wording")
    .replace(/\bbest form\b/gi, "form choice")
    .replace(/\bwith food\b/gi, "label-use context")
    .replace(/\bempty stomach\b/gi, "label-use context")
    .replace(/\b(?:doctor|clinician|physician|pharmacist)\b/gi, "qualified professional")
    .replace(/\s+/g, " ")
    .trim();
};

const firstSentences = (value: string, max: number): string => {
  const sentences = splitSentences(value).slice(0, max);
  return sentences.length > 0 ? sentences.join(" ") : value;
};

const buildSafeLead = (anchor: string): string =>
  toSentence(`This is a supplement product organized around ${anchor}`);

const buildSafeWhatItIs = (anchor: string): string =>
  toSentence(
    `The useful read starts with ${anchor} and then checks whether the surrounding formula lines make that role clear`,
  );

const buildSafeWhy = (anchor: string): string =>
  toSentence(
    `People usually compare products like this by checking the named ${anchor} line, the formula structure, and how specific the label is`,
  );

export const repairProductOverviewWhatIsItForGate = (
  ai: ProductOverviewWhatIsIt,
  params: ProductOverviewAiGateContext,
): ProductOverviewWhatIsIt | null => {
  const gateParams = {
    ...params,
    lead: ai.lead,
    whatItIs: ai.whatItIs,
    whyPeopleTakeIt: ai.whyPeopleTakeIt,
  };
  if (passesProductOverviewWhatIsItGate(gateParams)) return ai;

  const anchor = resolveAnchor(params);
  const repairField = (value: string, fallback: string): string => {
    if (hasProductOverviewAiForbiddenContent(value)) return fallback;
    const sanitized = sanitizeApiText(value);
    if (!sanitized || hasProductOverviewAiForbiddenContent(sanitized)) return fallback;
    return sanitized;
  };

  const repaired: ProductOverviewWhatIsIt = {
    ...ai,
    lead: repairField(ai.lead, buildSafeLead(anchor)),
    whatItIs: repairField(ai.whatItIs, buildSafeWhatItIs(anchor)),
    whyPeopleTakeIt: firstSentences(
      repairField(ai.whyPeopleTakeIt, buildSafeWhy(anchor)),
      2,
    ),
  };

  const repairedCombined = [repaired.lead, repaired.whatItIs, repaired.whyPeopleTakeIt].join(" ");
  if (!normalizeOverviewAiToken(repairedCombined).includes(normalizeOverviewAiToken(anchor))) {
    repaired.whatItIs = buildSafeWhatItIs(anchor);
  }
  if ((safeTrim(repairedCombined) ?? "").length < 90) {
    repaired.whyPeopleTakeIt = buildSafeWhy(anchor);
  }

  return passesProductOverviewWhatIsItGate({
    ...params,
    lead: repaired.lead,
    whatItIs: repaired.whatItIs,
    whyPeopleTakeIt: repaired.whyPeopleTakeIt,
  })
    ? repaired
    : null;
};
