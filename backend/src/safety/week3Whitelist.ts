import { normalizeOdsCanonicalKey } from "../ods/ulDataset.js";
import type { Week3LaunchTier, Week3UlLaunchMode } from "./types.js";

export type Week3SafetyWhitelistEntry = {
  canonicalKey: string;
  displayName: string;
  launchTier: Week3LaunchTier;
  launchEnabledForUlCompare: Week3UlLaunchMode;
  aliases: string[];
};

export const WEEK3_SAFETY_WHITELIST: Week3SafetyWhitelistEntry[] = [
  {
    canonicalKey: "magnesium",
    displayName: "Magnesium",
    launchTier: "tier1",
    launchEnabledForUlCompare: true,
    aliases: ["magnesium", "magnesium citrate", "magnesium glycinate", "magnesium oxide", "magnesium malate"],
  },
  {
    canonicalKey: "vitamin_c",
    displayName: "Vitamin C",
    launchTier: "tier1",
    launchEnabledForUlCompare: true,
    aliases: ["vitamin c", "ascorbic acid", "ester c", "sodium ascorbate", "calcium ascorbate"],
  },
  {
    canonicalKey: "zinc",
    displayName: "Zinc",
    launchTier: "tier1",
    launchEnabledForUlCompare: true,
    aliases: ["zinc", "zinc picolinate", "zinc citrate", "zinc gluconate"],
  },
  {
    canonicalKey: "iron",
    displayName: "Iron",
    launchTier: "tier1",
    launchEnabledForUlCompare: true,
    aliases: ["iron", "ferrous", "ferric", "ferrous bisglycinate", "ferrous sulfate"],
  },
  {
    canonicalKey: "folate",
    displayName: "Folate",
    launchTier: "tier1",
    launchEnabledForUlCompare: true,
    aliases: ["folate", "folic acid", "methylfolate", "l-5-methyltetrahydrofolate", "quatrefolic"],
  },
  {
    canonicalKey: "vitamin_b12",
    displayName: "Vitamin B12",
    launchTier: "tier2",
    launchEnabledForUlCompare: "fallback_only",
    aliases: ["vitamin b12", "b12", "methylcobalamin", "cyanocobalamin", "adenosylcobalamin", "hydroxocobalamin"],
  },
  {
    canonicalKey: "omega_3",
    displayName: "Omega-3",
    launchTier: "tier2",
    launchEnabledForUlCompare: "fallback_only",
    aliases: ["omega 3", "omega-3", "epa", "dha", "fish oil", "krill oil", "algal oil"],
  },
  {
    canonicalKey: "n_acetylcysteine",
    displayName: "NAC",
    launchTier: "tier2",
    launchEnabledForUlCompare: "fallback_only",
    aliases: ["nac", "n-acetylcysteine", "n acetylcysteine", "acetyl cysteine"],
  },
];

export const getWeek3WhitelistEntry = (canonicalKey: string | null | undefined): Week3SafetyWhitelistEntry | null => {
  const normalized = normalizeOdsCanonicalKey(canonicalKey);
  if (!normalized) return null;
  return WEEK3_SAFETY_WHITELIST.find((entry) => normalizeOdsCanonicalKey(entry.canonicalKey) === normalized) ?? null;
};
