export type RuleBasedOverview = {
  overviewSummary: string;
  coreBenefits: string[];
  timing: string;
  withFood: boolean;
  usageSummary: string;
};

const safeTrim = (value: string | null | undefined): string => (value ?? "").trim();

const normalizeName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const sentenceClampTwo = (value: string): string => {
  const text = safeTrim(value);
  if (!text) {
    return "This supplement is designed to support a common wellness goal. Follow the product label for dosing.";
  }

  // Split on sentence-ending punctuation; keep at most the first two sentences.
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1]}`;
  }

  const only = parts[0] ?? text;
  const normalized = /[.!?]$/.test(only) ? only : `${only}.`;
  return `${normalized} Follow the product label for dosing.`;
};

const computeDoseText = (productName: string, dosageText: string | null): string => {
  const dose = safeTrim(dosageText);
  if (!dose) return "";
  const nameLower = productName.toLowerCase();
  if (nameLower.includes(dose.toLowerCase())) return "";
  return ` (${dose})`;
};

const usageSummaryFromWithFood = (withFood: boolean): string =>
  withFood ? "Take with food." : "Take on an empty stomach.";

export const buildRuleBasedOverview = (params: {
  productName: string;
  dosageText: string | null;
}): RuleBasedOverview => {
  const nameNorm = normalizeName(params.productName);
  const hasAny = (tokens: string[]) => tokens.some((t) => nameNorm.includes(t));

  const doseText = computeDoseText(params.productName, params.dosageText);

  let timing = "Anytime (with meals)";
  let withFood = true;
  let coreBenefits: string[] = ["General wellness support"];
  let overviewSummary = `${params.productName}${doseText} is a dietary supplement designed to support a common wellness goal. Follow the product label for dosing.`;

  if (hasAny(["melatonin"])) {
    timing = "Bedtime (30-60 min before sleep)";
    withFood = false;
    coreBenefits = ["Supports sleep onset", "Supports a healthy sleep cycle"];
    overviewSummary = `${params.productName}${doseText} is commonly used to support sleep onset and a healthy sleep cycle. Follow the product label and use it as part of a consistent routine.`;
  } else if (hasAny(["probiotic"])) {
    timing = "Morning (before breakfast)";
    withFood = false;
    coreBenefits = ["Supports digestive health", "Supports gut microbiome balance"];
    overviewSummary = `${params.productName}${doseText} is a probiotic supplement intended to support digestive comfort and a balanced gut microbiome. Follow the product label and take it consistently for best results.`;
  } else if (hasAny(["magnesium"])) {
    timing = "Evening (after dinner)";
    withFood = true;
    coreBenefits = ["Supports muscle relaxation", "Supports stress response"];
    overviewSummary = `${params.productName}${doseText} is a magnesium supplement used to support muscle function and relaxation. Follow the product label and take it regularly as part of your routine.`;
  } else if (hasAny(["omega 3", "omega-3", "fish oil", "krill"])) {
    timing = "Breakfast or dinner (with a meal)";
    withFood = true;
    coreBenefits = ["Supports heart health", "Supports brain and eye health"];
    overviewSummary = `${params.productName}${doseText} provides omega-3 fatty acids to support heart, brain, and eye health. Follow the product label and take it with a meal for best tolerance.`;
  } else if (hasAny(["vitamin d", "vitamin d3", "d3"])) {
    timing = "Morning (with breakfast)";
    withFood = true;
    coreBenefits = ["Supports bone health", "Supports immune function"];
    overviewSummary = `${params.productName}${doseText} is a vitamin D supplement that supports bone health and immune function. Follow the product label and take it consistently, especially if intake or sunlight exposure is limited.`;
  } else if (hasAny(["iron"])) {
    timing = "Morning (empty stomach)";
    withFood = false;
    coreBenefits = ["Supports healthy red blood cells", "Supports energy metabolism"];
    overviewSummary = `${params.productName}${doseText} is an iron supplement used to support healthy red blood cells and oxygen transport. Follow the product label and consider taking it consistently when iron intake is low.`;
  } else if (hasAny(["calcium"])) {
    timing = "With meals";
    withFood = true;
    coreBenefits = ["Supports bone health"];
    overviewSummary = `${params.productName}${doseText} is a calcium supplement designed to support bone and dental health. Follow the product label and take it regularly as part of a balanced diet.`;
  } else if (hasAny(["zinc"])) {
    timing = "With meals";
    withFood = true;
    coreBenefits = ["Supports immune function", "Supports skin health"];
    overviewSummary = `${params.productName}${doseText} is a zinc supplement used to support immune function and skin health. Follow the product label and take it consistently as part of your routine.`;
  } else if (hasAny(["vitamin c", "ascorbic"])) {
    timing = "Anytime (with meals)";
    withFood = true;
    coreBenefits = ["Supports antioxidant defense", "Supports immune function"];
    overviewSummary = `${params.productName}${doseText} is a vitamin C supplement designed to support antioxidant defenses and immune function. Follow the product label and take it consistently as part of your daily routine.`;
  } else if (hasAny(["vitamin", "b1", "b2", "b3", "b6", "b12", "folate", "thiamine", "riboflavin", "niacin"])) {
    timing = "Morning (with breakfast)";
    withFood = true;
    coreBenefits = ["Supports energy metabolism", "Supports nervous system function"];
    overviewSummary = `${params.productName}${doseText} is a B-vitamin supplement intended to support energy metabolism and nervous system function. Follow the product label and take it daily as part of a consistent routine.`;
  }

  coreBenefits = coreBenefits.map((b) => b.trim()).filter(Boolean).slice(0, 3);
  if (coreBenefits.length === 0) {
    coreBenefits = ["General wellness support"];
  }

  overviewSummary = sentenceClampTwo(overviewSummary);

  return {
    overviewSummary,
    coreBenefits,
    timing: safeTrim(timing) || "Anytime (with meals)",
    withFood,
    usageSummary: usageSummaryFromWithFood(withFood),
  };
};
