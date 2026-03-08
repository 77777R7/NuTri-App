import { normalizeHumanTextForMatch } from "@/lib/text/normalizeHumanText";
import { isNutritionLabelLikeIngredient } from "@/lib/scan/isNutritionLabelLikeIngredient";

export type FactsActiveDisplay = {
  name?: string | null;
  amount?: number | null;
  unit?: string | null;
  amountText?: string | null;
};

export type WhatsInsideDisplay = {
  source: "overlay" | "actives" | "inferred" | "dose" | "none";
  lines: string[];
  hiddenCount: number;
  badgeLabel: string | null;
  metaText: string | null;
};

const ACTIVE_INFERENCE_RULES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bastaxanthin\b/i, label: "Astaxanthin" },
  { pattern: /\bvitamin[-\s]*c\b|\bascorbic\s+acid\b|\bester[-\s]?c\b/i, label: "Vitamin C" },
  { pattern: /\bvitamin[-\s]*d(?:3)?\b/i, label: "Vitamin D" },
  { pattern: /\bomega\s*[-\s]?3\b|\bfish[-\s]+oil\b|\bkrill\b/i, label: "Omega-3" },
  { pattern: /\bmagnesium\b/i, label: "Magnesium" },
  { pattern: /\bzinc\b/i, label: "Zinc" },
  { pattern: /\biron\b/i, label: "Iron" },
  { pattern: /\bnac\b|\bn[-\s]?acetyl[-\s]?cysteine\b/i, label: "N-acetylcysteine (NAC)" },
  { pattern: /\bwhey\s+protein\b|\bprotein\b/i, label: "Whey Protein" },
  { pattern: /\bcreatine\b/i, label: "Creatine" },
];

const PRODUCT_INFERENCE_BLOCKLIST = /\b(daily\s+multi|multivitamin|formula|blend|complex|support|advanced|proprietary)\b/i;
const INFERRED_STRENGTH_REGEX =
  /\b\d+(?:\.\d+)?(?:\s*[kmbt])?\s*(mcg|μg|µg|ug|mg|g|iu|cfu)\b/i;

type ProcessedActive = {
  canonicalKey: string;
  displayName: string;
  amountText: string;
  hasAmount: boolean;
  line: string;
};

const toAmountText = (active: FactsActiveDisplay): string => {
  const amountText = typeof active.amountText === "string" ? active.amountText.trim() : "";
  if (amountText) return amountText;

  if (active.amount == null) return "";
  const unit = typeof active.unit === "string" ? active.unit.trim() : "";
  return unit ? `${active.amount} ${unit}` : `${active.amount}`;
};

const normalizeName = (value: string): string =>
  normalizeHumanTextForMatch(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9+\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const canonicalizeActiveKey = (name: string): string => {
  const normalized = normalizeName(name);
  if (!normalized) return "";
  if (/\b(epa|eicosapentaenoic)\b/.test(normalized)) return "epa";
  if (/\b(dha|docosahexaenoic)\b/.test(normalized)) return "dha";
  if (/\b(cholecalciferol|vitamin[-\s]*d3?|ergocalciferol)\b/.test(normalized)) return "vitamin d";
  if (/\b(ascorbic acid|vitamin[-\s]*c)\b/.test(normalized)) return "vitamin c";
  if (/\bmagnesium\b/.test(normalized)) return "magnesium";
  if (/\bzinc\b/.test(normalized)) return "zinc";
  if (/\biron\b/.test(normalized)) return "iron";
  return normalized;
};

const prettifyActiveLabel = (canonicalKey: string, fallbackName: string): string => {
  switch (canonicalKey) {
    case "epa":
      return "EPA";
    case "dha":
      return "DHA";
    case "vitamin d":
      return "Vitamin D";
    case "vitamin c":
      return "Vitamin C";
    case "magnesium":
      return "Magnesium";
    case "zinc":
      return "Zinc";
    case "iron":
      return "Iron";
    default:
      return fallbackName.trim();
  }
};

const activePriority = (key: string): number => {
  if (key === "omega_3_combo") return 0;
  if (key === "vitamin d") return 1;
  if (key === "magnesium") return 2;
  if (key === "zinc") return 3;
  if (key === "iron") return 4;
  return 99;
};

const pickPreferredActive = (current: ProcessedActive, incoming: ProcessedActive): ProcessedActive => {
  if (incoming.hasAmount && !current.hasAmount) return incoming;
  if (!incoming.hasAmount && current.hasAmount) return current;

  const displayCmp = incoming.displayName.localeCompare(current.displayName, undefined, { sensitivity: "base" });
  if (displayCmp < 0) return incoming;
  if (displayCmp > 0) return current;

  return incoming.line.localeCompare(current.line, undefined, { sensitivity: "base" }) < 0 ? incoming : current;
};

const buildProcessedActives = (actives: FactsActiveDisplay[]): ProcessedActive[] => {
  const deduped = new Map<string, ProcessedActive>();

  for (const active of actives) {
    const name = typeof active?.name === "string" ? active.name.trim() : "";
    if (!name || isNutritionLabelLikeIngredient(name)) continue;
    const canonicalKey = canonicalizeActiveKey(name);
    if (!canonicalKey) continue;

    const amountText = toAmountText(active);
    const displayName = prettifyActiveLabel(canonicalKey, name);
    const next: ProcessedActive = {
      canonicalKey,
      displayName,
      amountText,
      hasAmount: amountText.length > 0,
      line: amountText ? `${displayName} - ${amountText}` : displayName,
    };
    const existing = deduped.get(canonicalKey);
    deduped.set(canonicalKey, existing ? pickPreferredActive(existing, next) : next);
  }

  const items = Array.from(deduped.values());
  const epa = items.find((item) => item.canonicalKey === "epa");
  const dha = items.find((item) => item.canonicalKey === "dha");
  const withoutPair = items.filter((item) => item.canonicalKey !== "epa" && item.canonicalKey !== "dha");

  if (epa && dha) {
    const epaPart = epa.amountText ? `EPA ${epa.amountText}` : "EPA";
    const dhaPart = dha.amountText ? `DHA ${dha.amountText}` : "DHA";
    withoutPair.push({
      canonicalKey: "omega_3_combo",
      displayName: "Omega-3",
      amountText: "",
      hasAmount: Boolean(epa.amountText || dha.amountText),
      line: `Omega-3 (${epaPart} + ${dhaPart})`,
    });
  } else {
    if (epa) withoutPair.push(epa);
    if (dha) withoutPair.push(dha);
  }

  withoutPair.sort((a, b) => {
    const byPriority = activePriority(a.canonicalKey) - activePriority(b.canonicalKey);
    if (byPriority !== 0) return byPriority;
    if (a.hasAmount !== b.hasAmount) return a.hasAmount ? -1 : 1;
    const byName = a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
    if (byName !== 0) return byName;
    return a.line.localeCompare(b.line, undefined, { sensitivity: "base" });
  });

  return withoutPair;
};

export const inferActiveFromProductName = (productName: string): string | null => {
  const normalized = normalizeHumanTextForMatch(productName);
  if (!normalized) return null;

  for (const rule of ACTIVE_INFERENCE_RULES) {
    if (rule.pattern.test(normalized)) return rule.label;
  }
  return null;
};

export const buildWhatsInsideDisplay = (params: {
  actives: FactsActiveDisplay[];
  dosageText?: string | null;
  productName: string;
  overlayIngredients?: Array<{ name: string; dose: string | null }>;
}): WhatsInsideDisplay => {
  const overlayLines = (params.overlayIngredients ?? [])
    .map((ingredient) => {
      const name = typeof ingredient?.name === "string" ? ingredient.name.trim() : "";
      if (!name || isNutritionLabelLikeIngredient(name)) return null;
      const dose = typeof ingredient?.dose === "string" ? ingredient.dose.trim() : "";
      return dose ? `${name} - ${dose}` : name;
    })
    .filter((line): line is string => Boolean(line));

  if (overlayLines.length > 0) {
    return {
      source: "overlay",
      lines: overlayLines.slice(0, 3),
      hiddenCount: Math.max(0, overlayLines.length - 3),
      badgeLabel: null,
      metaText: null,
    };
  }

  const processedActives = buildProcessedActives(params.actives ?? []);
  const activeLines = processedActives.map((item) => item.line);

  if (activeLines.length > 0) {
    return {
      source: "actives",
      lines: activeLines.slice(0, 2),
      hiddenCount: Math.max(0, activeLines.length - 2),
      badgeLabel: null,
      metaText: null,
    };
  }

  const dose = typeof params.dosageText === "string" ? params.dosageText.trim() : "";
  if (!dose) {
    return { source: "none", lines: [], hiddenCount: 0, badgeLabel: null, metaText: null };
  }

  const normalizedProductName = normalizeHumanTextForMatch(params.productName);
  const canInferFromName = Boolean(normalizedProductName) && !PRODUCT_INFERENCE_BLOCKLIST.test(normalizedProductName);
  const hasStrengthDose = INFERRED_STRENGTH_REGEX.test(dose);
  const inferredActive = canInferFromName && hasStrengthDose ? inferActiveFromProductName(normalizedProductName) : null;
  if (inferredActive && hasStrengthDose) {
    return {
      source: "inferred",
      lines: [`${inferredActive} - ${dose}`],
      hiddenCount: 0,
      badgeLabel: "Inferred",
      metaText: "Inferred from product name.",
    };
  }

  return {
    source: "dose",
    lines: [`Dose: ${dose}`],
    hiddenCount: 0,
    badgeLabel: null,
    metaText: null,
  };
};
