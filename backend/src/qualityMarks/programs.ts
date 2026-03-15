import type {
  QualityMarkProgramId,
  QualityMarkRegistryFamily,
  QualityMarkTermClass,
} from "./types.js";

export type QualityMarkProgramDefinition = {
  id: QualityMarkProgramId;
  label: string;
  registryFamily: QualityMarkRegistryFamily;
  termClass: QualityMarkTermClass;
  mapsToGenericThirdPartyClaim: boolean;
  spacedPattern: RegExp;
  compactPattern: RegExp;
  searchTerms: string[];
};

export const QUALITY_MARK_PROGRAMS: QualityMarkProgramDefinition[] = [
  {
    id: "nsf_certified_for_sport",
    label: "NSF Certified for Sport",
    registryFamily: "nsf",
    termClass: "third_party_testing",
    mapsToGenericThirdPartyClaim: true,
    spacedPattern: /\bnsf\b(?:\s*certified(?:\s*for\s*sport)?)?/i,
    compactPattern: /nsfcertifiedforsport|nsfcertified|nsf/i,
    searchTerms: ["NSF", "NSF Certified for Sport"],
  },
  {
    id: "usp_verified",
    label: "USP Verified",
    registryFamily: "usp",
    termClass: "third_party_testing",
    mapsToGenericThirdPartyClaim: true,
    spacedPattern: /\busp\b(?:\s*verified)?/i,
    compactPattern: /uspverified|usp/i,
    searchTerms: ["USP", "USP Verified"],
  },
  {
    id: "informed_choice",
    label: "Informed Choice",
    registryFamily: "lgc_informed",
    termClass: "third_party_testing",
    mapsToGenericThirdPartyClaim: true,
    spacedPattern: /\binformed\s*choice\b/i,
    compactPattern: /informedchoice/i,
    searchTerms: ["Informed Choice"],
  },
  {
    id: "informed_sport",
    label: "Informed Sport",
    registryFamily: "lgc_informed",
    termClass: "third_party_testing",
    mapsToGenericThirdPartyClaim: true,
    spacedPattern: /\binformed\s*sport\b/i,
    compactPattern: /informedsport/i,
    searchTerms: ["Informed Sport"],
  },
  {
    id: "ifos",
    label: "IFOS",
    registryFamily: "nutrasource",
    termClass: "third_party_testing",
    mapsToGenericThirdPartyClaim: true,
    spacedPattern: /\bifos\b/i,
    compactPattern: /ifos/i,
    searchTerms: ["IFOS"],
  },
  {
    id: "bscg",
    label: "BSCG",
    registryFamily: "bscg",
    termClass: "third_party_testing",
    mapsToGenericThirdPartyClaim: true,
    spacedPattern: /\bbscg\b/i,
    compactPattern: /bscg/i,
    searchTerms: ["BSCG"],
  },
  {
    id: "consumerlab_review",
    label: "ConsumerLab",
    registryFamily: "secondary_reference",
    termClass: "secondary_reference",
    mapsToGenericThirdPartyClaim: false,
    spacedPattern: /\bconsumerlab\b/i,
    compactPattern: /consumerlab/i,
    searchTerms: ["ConsumerLab"],
  },
  {
    id: "igen",
    label: "iGEN",
    registryFamily: "secondary_reference",
    termClass: "secondary_reference",
    mapsToGenericThirdPartyClaim: false,
    spacedPattern: /\bigen\b/i,
    compactPattern: /igen/i,
    searchTerms: ["iGEN"],
  },
  {
    id: "itested",
    label: "iTested",
    registryFamily: "secondary_reference",
    termClass: "secondary_reference",
    mapsToGenericThirdPartyClaim: false,
    spacedPattern: /\bitested\b/i,
    compactPattern: /itested/i,
    searchTerms: ["iTested"],
  },
  {
    id: "labdoor",
    label: "Labdoor",
    registryFamily: "secondary_reference",
    termClass: "secondary_reference",
    mapsToGenericThirdPartyClaim: false,
    spacedPattern: /\blabdoor\b/i,
    compactPattern: /labdoor/i,
    searchTerms: ["Labdoor"],
  },
];

export const QUALITY_MARK_PROGRAMS_BY_ID = new Map(
  QUALITY_MARK_PROGRAMS.map((definition) => [definition.id, definition] as const),
);

export const PHASE1_THIRD_PARTY_PROGRAM_IDS: QualityMarkProgramId[] = [
  "nsf_certified_for_sport",
  "usp_verified",
  "informed_choice",
  "informed_sport",
  "ifos",
];

export const getQualityMarkProgramDefinition = (
  programId: QualityMarkProgramId,
): QualityMarkProgramDefinition | null => QUALITY_MARK_PROGRAMS_BY_ID.get(programId) ?? null;

export const getGenericThirdPartyProgramDefinitions = (): QualityMarkProgramDefinition[] =>
  QUALITY_MARK_PROGRAMS.filter((definition) => definition.mapsToGenericThirdPartyClaim);

export const getPhase1SearchTerms = (): string[] => {
  const terms = new Set<string>(["third-party tested"]);
  for (const definition of QUALITY_MARK_PROGRAMS) {
    for (const term of definition.searchTerms) {
      if (definition.mapsToGenericThirdPartyClaim || PHASE1_THIRD_PARTY_PROGRAM_IDS.includes(definition.id)) {
        terms.add(term);
      }
    }
  }
  return Array.from(terms);
};
