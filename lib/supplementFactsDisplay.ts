export type FactsActiveDisplay = {
  name?: string | null;
  amount?: number | null;
  unit?: string | null;
  amountText?: string | null;
};

export type WhatsInsideDisplay = {
  source: "actives" | "inferred" | "dose" | "none";
  lines: string[];
  hiddenCount: number;
  metaText: string | null;
};

const ACTIVE_INFERENCE_RULES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bastaxanthin\b/i, label: "Astaxanthin" },
  { pattern: /\bvitamin\s*c\b|\bascorbic\s+acid\b/i, label: "Vitamin C" },
  { pattern: /\bvitamin\s*d(?:3)?\b/i, label: "Vitamin D" },
  { pattern: /\bomega\s*[-\s]?3\b|\bfish\s+oil\b|\bkrill\b/i, label: "Omega-3" },
  { pattern: /\bmagnesium\b/i, label: "Magnesium" },
  { pattern: /\bzinc\b/i, label: "Zinc" },
  { pattern: /\biron\b/i, label: "Iron" },
  { pattern: /\bwhey\s+protein\b|\bprotein\b/i, label: "Whey Protein" },
  { pattern: /\bcreatine\b/i, label: "Creatine" },
];

const toAmountText = (active: FactsActiveDisplay): string => {
  const amountText = typeof active.amountText === "string" ? active.amountText.trim() : "";
  if (amountText) return amountText;

  if (active.amount == null) return "";
  const unit = typeof active.unit === "string" ? active.unit.trim() : "";
  return unit ? `${active.amount} ${unit}` : `${active.amount}`;
};

export const inferActiveFromProductName = (productName: string): string | null => {
  const normalized = productName.trim();
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
}): WhatsInsideDisplay => {
  const activeLines = params.actives
    .filter((active) => typeof active?.name === "string" && active.name.trim().length > 0)
    .map((active) => {
      const name = active.name!.trim();
      const amount = toAmountText(active);
      return amount ? `${name} - ${amount}` : name;
    });

  if (activeLines.length > 0) {
    const sorted = [...activeLines].sort((a, b) => (/\d/.test(b) ? 1 : 0) - (/\d/.test(a) ? 1 : 0));
    return {
      source: "actives",
      lines: sorted.slice(0, 6),
      hiddenCount: Math.max(0, sorted.length - 6),
      metaText: null,
    };
  }

  const dose = typeof params.dosageText === "string" ? params.dosageText.trim() : "";
  if (!dose) {
    return { source: "none", lines: [], hiddenCount: 0, metaText: null };
  }

  const inferredActive = inferActiveFromProductName(params.productName);
  if (inferredActive) {
    return {
      source: "inferred",
      lines: [`${inferredActive} - ${dose}`],
      hiddenCount: 0,
      metaText: "Inferred from product name.",
    };
  }

  return {
    source: "dose",
    lines: [`Dose: ${dose}`],
    hiddenCount: 0,
    metaText: null,
  };
};
