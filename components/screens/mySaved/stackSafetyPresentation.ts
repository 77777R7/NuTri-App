import type { StackDuplicateGroup, StackLevelSafetySummary, StackSafetyMeta } from "./types";

export type StackSafetyCardTone = "locked" | "over" | "near" | "below" | "overlap" | "clear" | "limited";

export type StackSafetyProCardViewModel = {
  tone: StackSafetyCardTone;
  eyebrow: string;
  title: string;
  body: string;
  badge: string;
  ctaLabel: string;
  evidenceLine: string | null;
};

const statusToTone = (status: StackLevelSafetySummary["status"]): StackSafetyCardTone => {
  if (status === "over") return "over";
  if (status === "near") return "near";
  if (status === "below") return "below";
  return "limited";
};

const getPrimaryGroup = (groups: StackDuplicateGroup[]): StackDuplicateGroup | null => {
  const surfaced = groups.filter((group) => group.surfaced);
  return surfaced[0] ?? groups[0] ?? null;
};

const buildEvidenceLine = (group: StackDuplicateGroup | null, meta?: StackSafetyMeta | null): string | null => {
  if (group?.estimatedTotalDoseText && group.ulValueText) {
    return `${group.estimatedTotalDoseText}/day estimated • Adult UL ${group.ulValueText}/day`;
  }
  if (meta?.estimateBasisSummary) return meta.estimateBasisSummary;
  if (meta?.skippedSupplementNote) return meta.skippedSupplementNote;
  return null;
};

export const buildStackSafetyProCardViewModel = ({
  isPremium,
  savedCount,
  overlapCount,
  summary,
  duplicateGroups = [],
  meta,
}: {
  isPremium: boolean;
  savedCount: number;
  overlapCount: number;
  summary?: StackLevelSafetySummary | null;
  duplicateGroups?: StackDuplicateGroup[];
  meta?: StackSafetyMeta | null;
}): StackSafetyProCardViewModel => {
  if (!isPremium) {
    return {
      tone: "locked",
      eyebrow: "Pro safety",
      title: "Stack Safety Check",
      body: "Check repeated ingredients and dose overlaps across your saved stack.",
      badge: "Pro",
      ctaLabel: "Unlock",
      evidenceLine: savedCount > 1 ? `${savedCount} saved supplements ready` : "Add 2+ supplements to compare",
    };
  }

  const primaryGroup = getPrimaryGroup(duplicateGroups);
  if (summary?.headline && summary.status) {
    const tone = statusToTone(summary.status);
    return {
      tone,
      eyebrow: tone === "over" || tone === "near" ? "Stack safety signal" : "Stack overlap",
      title: summary.headline,
      body:
        tone === "over" || tone === "near"
          ? "Estimated from your saved products. Review the overlap before adding more of the same ingredient."
          : "NuTri found a repeated ingredient and will keep checking it as your saved stack changes.",
      badge: tone === "over" ? "Review" : tone === "near" ? "Near UL" : "Tracked",
      ctaLabel: "Review",
      evidenceLine: buildEvidenceLine(primaryGroup, meta),
    };
  }

  if (overlapCount > 0 || (meta?.hiddenGroupCount ?? 0) > 0) {
    return {
      tone: "overlap",
      eyebrow: "Stack overlap",
      title: "Ingredient overlaps found",
      body:
        "Some saved supplements repeat the same ingredient. Dose data is limited, so NuTri is keeping this as an overlap instead of an upper-limit warning.",
      badge: "Estimate",
      ctaLabel: "Review",
      evidenceLine: meta?.hiddenGroupNote ?? `${overlapCount} overlap${overlapCount === 1 ? "" : "s"} found`,
    };
  }

  if (savedCount < 2) {
    return {
      tone: "limited",
      eyebrow: "Stack safety",
      title: "Save another supplement to compare",
      body: "NuTri checks repeated ingredients once your stack has more than one product.",
      badge: "Ready",
      ctaLabel: "Add more",
      evidenceLine: null,
    };
  }

  return {
    tone: "clear",
    eyebrow: "Stack safety",
    title: "No duplicate ingredient warning detected",
    body: "NuTri will keep checking saved supplements as labels, directions, and dose data become available.",
    badge: "Clear",
    ctaLabel: "Review",
    evidenceLine: meta?.estimateBasisSummary ?? null,
  };
};
