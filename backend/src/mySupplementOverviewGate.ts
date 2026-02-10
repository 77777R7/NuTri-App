export type MySupplementOverviewV2GateInput = {
  actives: Array<{ name?: string | null }>;
  oneLiner: string;
  whatItIs: string;
  tips?: string[] | null;
  whatYouMayNotice?: string[] | null;
  watchOuts?: string[] | null;
};

export function getMySupplementOverviewV2GateReason(input: MySupplementOverviewV2GateInput): string | null {
  const text = `${input.oneLiner} ${input.whatItIs} ${(input.tips ?? []).join(" ")} ${(input.whatYouMayNotice ?? []).join(" ")} ${(input.watchOuts ?? []).join(" ")}`
    .toLowerCase()
    .trim();

  if (/\b(treat|cure|diagnos|disease)\b/i.test(text)) return "medical_claim_language";

  const genericPhrases = /(overall wellness|healthy lifestyle|designed to support|general wellness|supports overall)/i;
  const hasGeneric = genericPhrases.test(text);

  const doseRe = /\b\d+(\.\d+)?\s*(mcg|ug|µg|μg|mg|g|iu|cfu|ml|oz)\b/i;
  const hasDose = doseRe.test(text);

  const actives = Array.isArray(input.actives) ? input.actives : [];
  const hasActives = actives.length > 0;
  const activeMentioned = hasActives
    ? actives.slice(0, 8).some((a) => {
        const name = String(a?.name ?? "").toLowerCase().trim();
        return name.length >= 3 && text.includes(name);
      })
    : false;

  if (hasActives && !activeMentioned && !hasDose) return "missing_active_or_dose";
  if (hasGeneric && hasActives && !activeMentioned && !hasDose) return "generic_without_facts";
  if (input.oneLiner.length < 10 || input.whatItIs.length < 20) return "too_short";

  return null;
}

