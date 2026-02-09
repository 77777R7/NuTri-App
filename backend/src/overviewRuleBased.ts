export type RuleBasedOverview = {
  overviewSummary: string;
  coreBenefits: string[];
  timing: string;
  withFood: boolean;
  usageSummary: string;
};

const ensureSentence = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const normalizeBenefitPhrase = (value: string): string => {
  let phrase = value.trim();
  phrase = phrase.replace(/[.!?]+$/g, "");
  phrase = phrase.replace(/^supports?\s+/i, "");
  phrase = phrase.replace(/^helps?\s+(with\s+)?/i, "");
  return phrase.trim();
};

const buildTwoSentenceOverview = (params: {
  productName: string;
  dosageText: string | null;
  coreBenefits: string[];
}): string => {
  const name = params.productName.trim() || "This supplement";
  const dose = params.dosageText ? ` (${params.dosageText})` : "";
  const benefitPhrase = normalizeBenefitPhrase(params.coreBenefits[0] ?? "") || "general wellness";
  const s1 = ensureSentence(`${name}${dose} is commonly used to support ${benefitPhrase}`);
  const s2 = "Follow the product label for dosing and timing.";
  // Guarantee exactly two sentences.
  return `${s1} ${s2}`;
};

export const buildRuleBasedOverview = (params: {
  productName: string;
  dosageText: string | null;
}): RuleBasedOverview => {
  const name = params.productName.toLowerCase();
  const has = (tokens: string[]) => tokens.some((token) => name.includes(token));

  // Safe-by-default baseline. When unsure, taking with food is generally more tolerable.
  let timing = "Morning (with breakfast)";
  let withFood = true;
  let usageSummary = "Take with food.";
  let coreBenefits: string[] = [];

  if (has(["melatonin"])) {
    timing = "Bedtime (30–60 min before sleep)";
    withFood = false;
    usageSummary = "Take on an empty stomach.";
    coreBenefits = ["Supports healthy sleep onset"];
  } else if (has(["probiotic"])) {
    timing = "Morning (before breakfast)";
    withFood = false;
    usageSummary = "Take on an empty stomach.";
    coreBenefits = ["Supports gut microbiome balance"];
  } else if (has(["magnesium"])) {
    timing = "Evening (after dinner)";
    withFood = true;
    usageSummary = "Take with food.";
    coreBenefits = ["Supports muscle relaxation"];
  } else if (has(["omega-3", "fish oil", "krill"])) {
    timing = "With meals (morning or dinner)";
    withFood = true;
    usageSummary = "Take with food.";
    coreBenefits = ["Supports heart health"];
  } else if (has(["vitamin d", "d3"])) {
    timing = "Morning (with breakfast)";
    withFood = true;
    usageSummary = "Take with food.";
    coreBenefits = ["Supports bone and immune health"];
  } else if (has(["iron"])) {
    timing = "Morning (empty stomach)";
    withFood = false;
    usageSummary = "Take on an empty stomach.";
    coreBenefits = ["Supports healthy red blood cells"];
  } else if (has(["calcium"])) {
    timing = "With meals";
    withFood = true;
    usageSummary = "Take with food.";
    coreBenefits = ["Supports bone health"];
  } else if (has(["zinc"])) {
    timing = "With meals";
    withFood = true;
    usageSummary = "Take with food.";
    coreBenefits = ["Supports immune function"];
  } else if (has(["vitamin", "b1", "b2", "b3", "b6", "b12", "folate"])) {
    timing = "Morning (with breakfast)";
    withFood = true;
    usageSummary = "Take with food.";
    coreBenefits = ["Supports daily nutrition"];
  }

  if (coreBenefits.length === 0) {
    coreBenefits = ["Supports general wellness"];
  }

  const overviewSummary = buildTwoSentenceOverview({
    productName: params.productName,
    dosageText: params.dosageText,
    coreBenefits,
  });

  return {
    overviewSummary,
    coreBenefits,
    timing,
    withFood,
    usageSummary,
  };
};

