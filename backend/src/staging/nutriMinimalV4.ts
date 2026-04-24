import {
  getNutriMinimalDefinitionForFamily,
  getNutriMinimalDefinitionForSourceIngredient,
  NUTRI_MINIMAL_FULL_FAMILY_DEFINITIONS,
  NUTRI_MINIMAL_FULL_RUNTIME_FAMILIES,
  type NutriMinimalFullFamilyDefinition,
} from "../nutriMinimalFullFamilyProductization.js";

export type FamilyMappingStatus =
  | "mapped_existing_family"
  | "new_family_candidate"
  | "unresolved_mapping";

export type ReviewStatus = "approved" | "needs_edit" | "rejected";

export type ReviewReason =
  | "approved_with_verified_pmids"
  | "backlog_only_runtime_family"
  | "family_mapping_unresolved"
  | "lane_mapping_needs_edit"
  | "no_plugin_verified_pmids"
  | "only_search_url_without_resolved_source"
  | "no_seed_citations"
  | "captured_excerpt_missing_linkage"
  | "capture_not_complete"
  | "unsafe_prose_claim"
  | "missing_citation_id"
  | "missing_excerpt_text"
  | "canonical_form_mapping_missing"
  | "variant_specificity_insufficient"
  | "needs_boundary_support";

export type RawSheetRow = Record<string, unknown>;

export type RawWorkbookSheetMap = Record<string, RawSheetRow[]>;

export type RawWorkbookMetadata = {
  package_version?: string | null;
  generated_at?: string | null;
  source_workbook?: string | null;
};

export type RawWorkbookPackage = {
  metadata: RawWorkbookMetadata;
  sheets: RawWorkbookSheetMap;
};

export type NormalizedDatasetPackage = {
  version: string;
  generated_at: string | null;
  meta: {
    version: string;
    source_workbook: string | null;
    generated_at: string | null;
  };
  sheets: Record<string, RawSheetRow[]>;
};

export type FamilyExpansionBacklogEntry = {
  source_ingredient_id: string;
  display_name: string;
  mapped_family: string | null;
  mapping_status: FamilyMappingStatus;
  category: string | null;
  forms_count: number;
  evidence_count: number;
  refs_count: number;
  coverage_gap_flags: string[];
  proposed_priority: "P0" | "P1" | "P2" | "P3";
  notes: string[];
};

export type FormTaxonomyStaging = {
  version: string;
  generated_at: string | null;
  meta: NormalizedDatasetPackage["meta"];
  sheets: {
    ingredients: RawSheetRow[];
    form_aliases: RawSheetRow[];
    normalization_rules: RawSheetRow[];
    token_aliases: RawSheetRow[];
    generic_form_tokens: RawSheetRow[];
  };
  summary: {
    ingredient_count: number;
    form_alias_count: number;
    normalization_rule_count: number;
    token_alias_count: number;
    generic_form_token_count: number;
    rejected_alias_count: number;
  };
  rejected_aliases: Array<{
    token_raw: string;
    reason: string;
    applies_to_ingredient_id: string | null;
    maps_to_form_key: string | null;
  }>;
};

export type SeedCitation = {
  id: string;
  type: string;
  identifier: string | null;
  source: string | null;
  url: string | null;
  audit_status: string | null;
  resolution_priority: number | null;
  link_status: string | null;
  seed_kind: "pmid" | "doi" | "resolved_url" | "search_url" | "other";
  search_query: string | null;
};

export type VerifiedPmid = {
  pmid: string;
  title: string | null;
  pubdate: string | null;
  pubtype: string[];
  url: string | null;
};

export type ScientificEvidenceCandidateRegistryRow = {
  family: string;
  lane: string;
  variant_key?: string;
  source: "life-science-research:ncbi-entrez-skill";
  retrieved_at: string;
  query: string | null;
  seed_citations: SeedCitation[];
  plugin_verified_pmids: VerifiedPmid[];
  priority: "P0" | "P1" | "P2" | "P3";
  selection_notes: string[];
  review_status: ReviewStatus;
  review_reasons: ReviewReason[];
  source_ingredient_ids: string[];
  source_goals: string[];
  mapping_status: FamilyMappingStatus;
};

export type ScientificEvidenceBacklogLaneStub = {
  source_ingredient_id: string;
  display_name: string;
  mapped_family: string | null;
  mapping_status: FamilyMappingStatus;
  proposed_lane_stub: string;
  review_status: ReviewStatus;
  review_reasons: ReviewReason[];
  notes: string[];
};

export type ScientificEvidenceCandidateRegistryArtifact = {
  version: string;
  generated_at: string | null;
  meta: NormalizedDatasetPackage["meta"] & {
    source: "life-science-research:ncbi-entrez-skill";
  };
  scientific_evidence_candidate_registry: ScientificEvidenceCandidateRegistryRow[];
  backlog_lane_stubs: ScientificEvidenceBacklogLaneStub[];
};

export type PromptGroundingReviewRow = {
  source_type: "evidence_excerpt" | "curated_override";
  source_id: string;
  review_status: ReviewStatus;
  review_reasons: ReviewReason[];
  notes: string[];
  mapped_family: string | null;
  section_key: string | null;
  ingredient_id: string | null;
  form_key: string | null;
  citation_id: string | null;
  excerpt_text: string | null;
};

export type PromptGroundingReviewQueueArtifact = {
  version: string;
  generated_at: string | null;
  meta: NormalizedDatasetPackage["meta"];
  prompt_grounding_review_queue: PromptGroundingReviewRow[];
};

export type ExistingCandidateQuery = {
  family: string;
  lane: string;
  variant_key?: string | null;
  query: string | null;
  priority: "P0" | "P1" | "P2" | "P3";
  selection_notes: string[];
};

export type ScientificLaneConfig = {
  priority: "P0" | "P1" | "P2" | "P3";
  preferred_goals: string[];
  fallback_query: string | null;
  selection_notes: string[];
  manual_seed_pmids?: string[];
  query_preference?: "prefer_existing" | "prefer_config";
};

export type ScientificLaneConfigMap = Record<
  string,
  Record<string, ScientificLaneConfig>
>;

export type P0ExpansionWaveLane = {
  lane_key: string;
  heading: string;
  intent: string;
  evidence_goal: string;
  shopper_meaning_goal: string;
};

export type P0ExpansionWaveRow = {
  source_ingredient_id: string;
  display_name: string;
  category: string | null;
  mapping_status: "new_family_candidate";
  implementation_priority: "P0";
  wave_rank: number;
  wave_score: number;
  pattern_keywords: string[];
  scientific_background_lanes: P0ExpansionWaveLane[];
  forms_count: number;
  evidence_count: number;
  refs_count: number;
  coverage_gap_flags: string[];
  notes: string[];
};

export type P0ExpansionWaveArtifact = {
  version: string;
  generated_at: string | null;
  meta: NormalizedDatasetPackage["meta"] & {
    wave_name: "nutri_minimal_v4_p0_expansion";
    selection_rules: string[];
    target_count: number;
  };
  p0_expansion_wave: P0ExpansionWaveRow[];
};

export type P0ExpansionSectionPlanDraft = {
  headingId: string;
  heading: string;
  intent: string;
  bulletThemes: string[];
  evidenceGoal: string;
  shopperMeaningGoal: string | null;
};

export type P0ExpansionSectionPlanDraftRow = {
  family: string;
  source_ingredient_id: string;
  display_name: string;
  category: string | null;
  implementation_priority: "P0";
  wave_rank: number;
  wave_score: number;
  pattern_keywords: string[];
  section_plan_args: P0ExpansionSectionPlanDraft[];
  notes: string[];
};

export type P0ExpansionSectionPlanDraftArtifact = {
  version: string;
  generated_at: string | null;
  meta: NormalizedDatasetPackage["meta"] & {
    source_wave: "nutri_minimal_v4_p0_expansion";
    draft_name: "nutri_minimal_v4_p0_section_plan_drafts";
    target_count: number;
  };
  p0_expansion_section_plan_drafts: P0ExpansionSectionPlanDraftRow[];
};

export type FullFamilyProductizationManifestRow = {
  source_ingredient_id: string;
  display_name: string;
  canonical_family: string | null;
  original_mapping_status: FamilyMappingStatus;
  closure_decision:
    | "productize_runtime_family"
    | "rescue_to_canonical_runtime_family"
    | "reject_from_runtime_productization";
  productization_class:
    | "low_risk_structural"
    | "high_risk_safety"
    | "crosswalk_rescue";
  safety_boundary_tier: "standard" | "high";
  category: string | null;
  pattern_keywords: string[];
  runtime_lane_keys: string[];
  evidence_review_status: ReviewStatus;
  hard_boundary: string;
  notes: string[];
};

export type FullFamilyProductizationManifestArtifact = {
  version: string;
  generated_at: string | null;
  meta: NormalizedDatasetPackage["meta"] & {
    manifest_name: "nutri_minimal_v4_full_family_productization";
    scope: "remaining_new_family_candidates_plus_unresolved_rescue";
    source: "nutri-minimal-v4";
  };
  summary: {
    input_rows: number;
    productized_runtime_families: number;
    low_risk_structural: number;
    high_risk_safety: number;
    crosswalk_rescue: number;
    rejected_from_runtime_productization: number;
  };
  full_family_productization_manifest: FullFamilyProductizationManifestRow[];
};

export type ScientificCandidateReviewInput = {
  row: ScientificEvidenceCandidateRegistryRow;
};

export type ScientificCandidateReviewResult = {
  query_used: string | null;
  verified_pmids: VerifiedPmid[];
};

export type ScientificCandidateReviewer = (
  input: ScientificCandidateReviewInput,
) => Promise<ScientificCandidateReviewResult>;

export const WORKBOOK_SHEET_KEY_MAP = {
  Ingredients: "ingredients",
  Forms: "forms",
  Evidence: "evidence",
  Citations: "citations",
  FormAliases: "form_aliases",
  NormalizationRules: "normalization_rules",
  CoverageReport: "coverage_report",
  EvidenceExcerpts: "evidence_excerpts",
  CuratedOverrides_v4: "curated_overrides_v4",
} as const;

export const RUNTIME_FAMILIES = [
  "astaxanthin_carotenoid",
  "curcumin",
  "quercetin",
  "turmeric",
  "dgl_licorice",
  "kava",
  "slippery_elm",
  "coq10",
  "creatine",
  "berberine",
  "nac",
  "glutathione",
  "alpha_lipoic_acid",
  "l_ornithine",
  "l_arginine",
  "arginine_alpha_ketoglutarate",
  "citrulline_malate",
  "d_ribose",
  "l_methionine",
  "l_valine",
  "beta_alanine",
  "carnosine",
  "choline",
  "citicoline",
  "nicotinamide_mononucleotide",
  "nicotinamide_riboside",
  "colostrum",
  "spirulina",
  "resveratrol",
  "gaba",
  "msm",
  "zeaxanthin",
  "collagen",
  "protein",
  "fiber",
  "electrolyte_hydration",
  "ashwagandha",
  "ginseng",
  "green_tea_extract",
  "7keto_dhea_metabolite",
  "cla",
  "carnitine",
  "5htp",
  "b3_niacinamide",
  "biotin",
  "riboflavin",
  "thiamin",
  "pantothenic_acid",
  "vitamin_a",
  "vitamin_e",
  "vitamin_k2",
  "vitamin_k1",
  "glycine",
  "taurine",
  "inositol",
  "vitamin_c",
  "vitamin_d",
  "b12",
  "folate",
  "b6",
  "chromium",
  "selenium",
  "copper",
  "molybdenum",
  "manganese",
  "iodine",
  "potassium",
  "zinc",
  "magnesium",
  "calcium",
  "iron",
  "melatonin",
  "omega_3",
  "aloe_vera",
  "chamomile",
  "astragalus",
  "cinnamon_extract",
  "grape_seed_extract",
  "garlic_extract",
  "ginger_root",
  "olive_leaf_extract",
  "pygeum",
  "red_yeast_rice",
  "royal_jelly",
  "saffron_extract",
  "tribulus_terrestris",
  "turkey_tail_mushroom",
  "milk_thistle",
  "papain",
  "bromelain",
  "serrapeptase",
  "passionflower",
  "valerian",
  "st_john_s_wort",
  "lavender",
  "lemon_balm",
  ...NUTRI_MINIMAL_FULL_RUNTIME_FAMILIES,
  "probiotic_or_blend",
  "generic",
] as const;

export const BACKLOG_ONLY_RUNTIME_FAMILIES = new Set<string>([
  "protein",
  "collagen",
  "probiotic_or_blend",
  "turmeric",
  "inositol",
  "7keto_dhea_metabolite",
]);

const DIRECT_RUNTIME_FAMILY_SET = new Set<string>(RUNTIME_FAMILIES);

const EXPLICIT_FAMILY_CROSSWALK: Record<string, string> = {
  vitamin_b12: "b12",
  vitamin_b6: "b6",
  vitamin_b3: "b3_niacinamide",
  niacin: "b3_niacinamide",
  niacinamide: "b3_niacinamide",
  nicotinamide: "b3_niacinamide",
  n_acetylcysteine: "nac",
  reduced_glutathione: "glutathione",
  s_acetyl_glutathione: "glutathione",
  alpha_lipoic_acid: "alpha_lipoic_acid",
  r_alpha_lipoic_acid: "alpha_lipoic_acid",
  l_ornithine: "l_ornithine",
  ornithine: "l_ornithine",
  l_arginine: "l_arginine",
  arginine: "l_arginine",
  arginine_alpha_ketoglutarate: "arginine_alpha_ketoglutarate",
  aakg: "arginine_alpha_ketoglutarate",
  citrulline_malate: "citrulline_malate",
  l_citrulline_malate: "citrulline_malate",
  d_ribose: "d_ribose",
  ribose: "d_ribose",
  l_methionine: "l_methionine",
  methionine: "l_methionine",
  l_valine: "l_valine",
  valine: "l_valine",
  beta_alanine: "beta_alanine",
  carnosyn: "beta_alanine",
  carno_syn: "beta_alanine",
  carnosine: "carnosine",
  l_carnosine: "carnosine",
  citicoline: "citicoline",
  cdp_choline: "citicoline",
  cognizin: "citicoline",
  choline_bitartrate: "choline",
  alpha_gpc: "choline",
  phosphatidylcholine: "choline",
  nicotinamide_mononucleotide: "nicotinamide_mononucleotide",
  nmn: "nicotinamide_mononucleotide",
  nicotinamide_riboside: "nicotinamide_riboside",
  colostrum: "colostrum",
  bovine_colostrum: "colostrum",
  spirulina: "spirulina",
  arthrospira: "spirulina",
  resveratrol: "resveratrol",
  trans_resveratrol: "resveratrol",
  gaba: "gaba",
  gamma_aminobutyric_acid: "gaba",
  pharmagaba: "gaba",
  msm: "msm",
  methylsulfonylmethane: "msm",
  optimsm: "msm",
  zeaxanthin: "zeaxanthin",
  conjugated_linoleic_acid: "cla",
  american_ginseng: "ginseng",
  panax_ginseng: "ginseng",
  dgl_licorice: "dgl_licorice",
  deglycyrrhizinated_licorice: "dgl_licorice",
  piper_methysticum: "kava",
  vitamin_b7: "biotin",
  d_biotin: "biotin",
  vitamin_b2: "riboflavin",
  vitamin_b1: "thiamin",
  thiamine: "thiamin",
  thiamine_hcl: "thiamin",
  thiamin_mononitrate: "thiamin",
  benfotiamine: "thiamin",
  vitamin_b5: "pantothenic_acid",
  pantothenic_acid: "pantothenic_acid",
  calcium_pantothenate: "pantothenic_acid",
  vitamin_k1: "vitamin_k1",
  phylloquinone: "vitamin_k1",
  phytonadione: "vitamin_k1",
  copper_bisglycinate: "copper",
  sodium_molybdate: "molybdenum",
  ammonium_molybdate: "molybdenum",
  manganese_bisglycinate: "manganese",
  manganese_gluconate: "manganese",
  manganese_sulfate: "manganese",
  potassium_iodide: "iodine",
  sodium_iodide: "iodine",
  potassium_gluconate: "potassium",
  potassium_citrate: "potassium",
  potassium_chloride: "potassium",
  potassium_bicarbonate: "potassium",
  aloe: "aloe_vera",
  aloe_vera: "aloe_vera",
  chamomile: "chamomile",
  matricaria_chamomilla: "chamomile",
  apigenin: "chamomile",
  astragalus: "astragalus",
  astragalus_membranaceus: "astragalus",
  cinnamon_extract: "cinnamon_extract",
  cinnamomum: "cinnamon_extract",
  grape_seed_extract: "grape_seed_extract",
  grape_seed: "grape_seed_extract",
  proanthocyanidins: "grape_seed_extract",
  garlic_extract: "garlic_extract",
  garlic: "garlic_extract",
  allium_sativum: "garlic_extract",
  ginger_root: "ginger_root",
  ginger: "ginger_root",
  zingiber_officinale: "ginger_root",
  olive_leaf_extract: "olive_leaf_extract",
  olive_leaf: "olive_leaf_extract",
  olea_europaea: "olive_leaf_extract",
  pygeum: "pygeum",
  prunus_africana: "pygeum",
  red_yeast_rice: "red_yeast_rice",
  monascus_purpureus: "red_yeast_rice",
  royal_jelly: "royal_jelly",
  saffron_extract: "saffron_extract",
  saffron: "saffron_extract",
  crocus_sativus: "saffron_extract",
  tribulus_terrestris: "tribulus_terrestris",
  tribulus: "tribulus_terrestris",
  turkey_tail_mushroom: "turkey_tail_mushroom",
  turkey_tail: "turkey_tail_mushroom",
  trametes_versicolor: "turkey_tail_mushroom",
  coriolus_versicolor: "turkey_tail_mushroom",
  milk_thistle: "milk_thistle",
  silybum_marianum: "milk_thistle",
  silymarin: "milk_thistle",
  carica_papaya: "papain",
  papaya_enzyme: "papain",
  ananas_comosus: "bromelain",
  pineapple_enzyme: "bromelain",
  serrapeptase: "serrapeptase",
  serratiopeptidase: "serrapeptase",
  serrapeptidase: "serrapeptase",
  passion_flower: "passionflower",
  passiflora_incarnata: "passionflower",
  valeriana_officinalis: "valerian",
  valerian_root: "valerian",
  hypericum_perforatum: "st_john_s_wort",
  st_johns_wort: "st_john_s_wort",
  st_john_s_wort: "st_john_s_wort",
  lavandula_angustifolia: "lavender",
  melissa_officinalis: "lemon_balm",
  omega_3: "omega_3",
  astaxanthin: "astaxanthin_carotenoid",
  collagen_peptides: "collagen",
  "5_htp": "5htp",
  acetyl_l_carnitine: "carnitine",
  lactobacillus: "probiotic_or_blend",
  bifidobacterium_lactis: "probiotic_or_blend",
  bacillus_coagulans: "probiotic_or_blend",
  bacillus_subtilis: "probiotic_or_blend",
  saccharomyces_boulardii: "probiotic_or_blend",
  fructooligosaccharides: "fiber",
  galactooligosaccharides: "fiber",
  inulin: "fiber",
  oat_beta_glucan: "fiber",
  partially_hydrolyzed_guar_gum: "fiber",
  psyllium_husk: "fiber",
  resistant_dextrin: "fiber",
  resistant_starch: "fiber",
  yeast_beta_glucan: "fiber",
};

const UNRESOLVED_INGREDIENT_IDS = new Set<string>([
  "same",
  "tocotrienols",
  "betaine",
  "dim",
  "dim",
  "pqq",
  "nadh",
  "hmb",
  "mct_oil",
  "black_seed_oil",
  "phosphatidylserine",
]);

const GENERIC_TOKEN_STOPWORDS = new Set<string>([
  "complex",
  "formula",
  "blend",
  "support",
  "advanced",
  "plus",
  "ultra",
  "max",
  "extra",
  "pure",
  "natural",
  "standardized",
  "free",
  "capsule",
  "tablet",
  "softgel",
]);

const PROHIBITED_PROSE_PATTERNS = [
  /\bcures?\b/i,
  /\btreats?\b/i,
  /\bprevents?\b/i,
  /\bdisease\b/i,
  /\bbetter than\b/i,
  /\bsuperior\b/i,
  /\bguaranteed\b/i,
  /\bbest absorbed\b/i,
  /\bhighest absorption\b/i,
  /\bclinically proven to cure\b/i,
];

const SEARCH_URL_TYPES = new Set(["pubmed_search"]);
const PMID_TYPES = new Set(["pmid", "pubmed_pmid", "pubmed"]);
const DOI_TYPES = new Set(["doi", "doi_or_url"]);

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeKey = (value: string | null | undefined): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
};

const splitList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter((item): item is string => Boolean(item));
  }
  if (typeof value !== "string") return [];
  return value
    .split(/[;|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const uniqueStrings = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    rows.push(normalized);
  }
  return rows;
};

const isAdmissibleToken = (value: string | null): boolean => {
  const normalized = normalizeKey(value);
  if (!normalized) return false;
  if (normalized.length <= 1) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (GENERIC_TOKEN_STOPWORDS.has(normalized)) return false;
  return true;
};

const isUnsafeProse = (value: string | null): boolean =>
  Boolean(value) &&
  PROHIBITED_PROSE_PATTERNS.some((pattern) => pattern.test(value ?? ""));

const extractSearchQuery = (url: string | null): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const term =
      parsed.searchParams.get("term") ?? parsed.searchParams.get("query");
    return normalizeText(term);
  } catch {
    return null;
  }
};

const extractPmid = (citation: RawSheetRow): string | null => {
  const type = normalizeKey(normalizeText(citation.type));
  const identifier = normalizeText(citation.identifier);
  const url = normalizeText(citation.url);
  if (identifier && PMID_TYPES.has(type))
    return identifier.replace(/[^0-9]/g, "") || null;
  if (identifier && /^\d+$/.test(identifier)) return identifier;
  if (url) {
    const match = url.match(
      /(?:pubmed\.ncbi\.nlm\.nih\.gov|europepmc\.org\/article\/med)\/?([0-9]{4,})/i,
    );
    if (match?.[1]) return match[1];
  }
  return null;
};

const resolveCitationSeedKind = (
  citation: RawSheetRow,
): SeedCitation["seed_kind"] => {
  const type = normalizeKey(normalizeText(citation.type));
  if (PMID_TYPES.has(type) || extractPmid(citation)) return "pmid";
  if (DOI_TYPES.has(type)) return "doi";
  if (SEARCH_URL_TYPES.has(type)) return "search_url";
  const url = normalizeText(citation.url);
  if (url && extractSearchQuery(url)) return "search_url";
  if (url) return "resolved_url";
  return "other";
};

const compareSeedCitations = (
  left: SeedCitation,
  right: SeedCitation,
): number => {
  const order = {
    pmid: 0,
    doi: 1,
    resolved_url: 2,
    search_url: 3,
    other: 4,
  } as const;
  const kindDelta = order[left.seed_kind] - order[right.seed_kind];
  if (kindDelta !== 0) return kindDelta;
  const leftPriority = left.resolution_priority ?? 999;
  const rightPriority = right.resolution_priority ?? 999;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return String(left.id).localeCompare(String(right.id));
};

const dedupeSeedCitations = (rows: SeedCitation[]): SeedCitation[] => {
  const next = new Map<string, SeedCitation>();
  for (const row of rows) {
    if (!row.id) continue;
    const existing = next.get(row.id);
    if (!existing || compareSeedCitations(row, existing) < 0) {
      next.set(row.id, row);
    }
  }
  return Array.from(next.values()).sort(compareSeedCitations);
};

const collectGapFlags = (
  coverageRow: RawSheetRow | null,
  mappedFamily: string | null,
): string[] => {
  const flags: string[] = [];
  if (coverageRow) {
    if (toBoolean(coverageRow.gap_flag_low_identity))
      flags.push("low_identity_confidence");
    if (toBoolean(coverageRow.gap_flag_premium_low_factor_conf)) {
      flags.push("premium_form_low_factor_confidence");
    }
    if (toBoolean(coverageRow.gap_flag_high_search_refs))
      flags.push("search_ref_heavy");
    if ((toNumber(coverageRow.refs_verified) ?? 0) === 0)
      flags.push("no_verified_refs_in_workbook");
  }
  if (mappedFamily && BACKLOG_ONLY_RUNTIME_FAMILIES.has(mappedFamily)) {
    flags.push("backlog_only_runtime_family");
  }
  return flags;
};

const buildPriority = (
  mappingStatus: FamilyMappingStatus,
  coverageFlags: string[],
  evidenceCount: number,
  refsCount: number,
): FamilyExpansionBacklogEntry["proposed_priority"] => {
  if (mappingStatus === "mapped_existing_family") {
    if (
      !coverageFlags.includes("backlog_only_runtime_family") &&
      evidenceCount >= 3 &&
      refsCount >= 4
    ) {
      return "P0";
    }
    return "P1";
  }
  if (mappingStatus === "new_family_candidate") {
    if (evidenceCount >= 3 && refsCount >= 4) return "P1";
    return "P2";
  }
  return "P3";
};

const resolveMappedFamily = (
  ingredientId: string,
  ingredientName: string | null,
): string | null => {
  const normalizedId = normalizeKey(ingredientId);
  if (!normalizedId) return null;
  const productizedDefinition =
    getNutriMinimalDefinitionForSourceIngredient(normalizedId);
  if (productizedDefinition) return productizedDefinition.canonicalFamily;
  if (UNRESOLVED_INGREDIENT_IDS.has(normalizedId)) return null;
  const explicit = EXPLICIT_FAMILY_CROSSWALK[normalizedId];
  if (explicit) return explicit;
  if (DIRECT_RUNTIME_FAMILY_SET.has(normalizedId)) return normalizedId;
  const normalizedName = normalizeKey(ingredientName);
  if (normalizedName === "omega_3") return "omega_3";
  if (normalizedName === "vitamin_b12") return "b12";
  if (normalizedName === "vitamin_b6") return "b6";
  return null;
};

const resolveMappingStatus = (
  ingredientId: string,
  mappedFamily: string | null,
): FamilyMappingStatus => {
  if (mappedFamily) return "mapped_existing_family";
  if (UNRESOLVED_INGREDIENT_IDS.has(normalizeKey(ingredientId)))
    return "unresolved_mapping";
  return "new_family_candidate";
};

const buildBacklogNotes = (
  ingredientId: string,
  mappedFamily: string | null,
  coverageFlags: string[],
): string[] => {
  const notes: string[] = [];
  if (mappedFamily) {
    notes.push(`Mapped to runtime family ${mappedFamily}.`);
    if (BACKLOG_ONLY_RUNTIME_FAMILIES.has(mappedFamily)) {
      notes.push("Keep in backlog for this wave; do not productize directly.");
    }
  } else if (UNRESOLVED_INGREDIENT_IDS.has(normalizeKey(ingredientId))) {
    notes.push(
      "Ingredient id is too ambiguous to auto-promote into a canonical family.",
    );
  } else {
    notes.push(
      "Candidate for family expansion once a canonical runtime family is defined.",
    );
  }
  if (coverageFlags.includes("search_ref_heavy")) {
    notes.push(
      "Workbook evidence is search-link heavy; LSR verification is required before promotion.",
    );
  }
  if (coverageFlags.includes("low_identity_confidence")) {
    notes.push(
      "Identity confidence is low in workbook coverage; keep crosswalk conservative.",
    );
  }
  return notes;
};

const buildCitationIndex = (
  normalizedPackage: NormalizedDatasetPackage,
): Map<string, RawSheetRow> => {
  const rows = normalizedPackage.sheets.citations ?? [];
  return new Map(
    rows
      .map((row) => [normalizeText(row.id), row] as const)
      .filter((entry): entry is readonly [string, RawSheetRow] =>
        Boolean(entry[0]),
      ),
  );
};

const buildCoverageIndex = (
  normalizedPackage: NormalizedDatasetPackage,
): Map<string, RawSheetRow> => {
  const rows = normalizedPackage.sheets.coverage_report ?? [];
  return new Map(
    rows
      .map((row) => [normalizeText(row.ingredient_id), row] as const)
      .filter((entry): entry is readonly [string, RawSheetRow] =>
        Boolean(entry[0]),
      ),
  );
};

const buildEvidenceRowsByIngredient = (
  normalizedPackage: NormalizedDatasetPackage,
): Map<string, RawSheetRow[]> => {
  const rows = normalizedPackage.sheets.evidence ?? [];
  const next = new Map<string, RawSheetRow[]>();
  for (const row of rows) {
    const ingredientId = normalizeText(row.ingredient_id);
    if (!ingredientId) continue;
    const bucket = next.get(ingredientId) ?? [];
    bucket.push(row);
    next.set(ingredientId, bucket);
  }
  return next;
};

const buildFormRowsByIngredient = (
  normalizedPackage: NormalizedDatasetPackage,
): Map<string, RawSheetRow[]> => {
  const rows = normalizedPackage.sheets.forms ?? [];
  const next = new Map<string, RawSheetRow[]>();
  for (const row of rows) {
    const ingredientId = normalizeText(row.ingredient_id);
    if (!ingredientId) continue;
    const bucket = next.get(ingredientId) ?? [];
    bucket.push(row);
    next.set(ingredientId, bucket);
  }
  return next;
};

const buildIngredientRowsById = (
  normalizedPackage: NormalizedDatasetPackage,
): Map<string, RawSheetRow> =>
  new Map(
    (normalizedPackage.sheets.ingredients ?? [])
      .map((row) => [normalizeText(row.ingredient_id), row] as const)
      .filter((entry): entry is readonly [string, RawSheetRow] =>
        Boolean(entry[0]),
      ),
  );

const parseReferenceIds = (row: RawSheetRow): string[] =>
  uniqueStrings([
    ...splitList(row.reference_ids),
    ...splitList(row.reference_ids_list),
    ...splitList(row.identity_reference_ids),
    ...splitList(row.identity_reference_ids_list),
    ...splitList(row.factor_reference_ids),
    ...splitList(row.factor_reference_ids_list),
  ]);

const buildManualPmidSeedCitations = (
  family: string,
  lane: string,
  pmids: string[] | undefined,
): SeedCitation[] =>
  uniqueStrings(pmids ?? [])
    .map((pmid) => pmid.replace(/[^0-9]/g, ""))
    .filter(Boolean)
    .map((pmid, index) => ({
      id: `manual_seed_pmid:${normalizeKey(family)}:${normalizeKey(lane)}:${pmid}`,
      type: "pubmed_pmid",
      identifier: `PMID:${pmid}`,
      source: "PubMed",
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      audit_status: "verified",
      resolution_priority: index,
      link_status: "resolved",
      seed_kind: "pmid" as const,
      search_query: null,
    }));

const computeExpansionWaveScore = (
  entry: FamilyExpansionBacklogEntry,
): number => {
  const penaltyByGap: Record<string, number> = {
    low_identity_confidence: 3,
    premium_form_low_factor_confidence: 2,
    search_ref_heavy: 1,
    no_verified_refs_in_workbook: 5,
  };
  const categoryBonus: Record<string, number> = {
    vitamin: 2,
    mineral: 2,
    nutrient: 1,
    amino_acid: 1,
    botanical: 1,
  };
  const penalty = entry.coverage_gap_flags.reduce(
    (sum, flag) => sum + (penaltyByGap[flag] ?? 0),
    0,
  );
  const bonus = categoryBonus[normalizeKey(entry.category)] ?? 0;
  return (
    entry.forms_count * 2 +
    entry.evidence_count * 4 +
    entry.refs_count +
    bonus -
    penalty
  );
};

const buildPatternKeywords = (
  entry: FamilyExpansionBacklogEntry,
  ingredientRow: RawSheetRow | null,
  formRows: RawSheetRow[],
): string[] =>
  uniqueStrings([
    entry.display_name,
    entry.source_ingredient_id.replace(/_/g, " "),
    ...splitList(ingredientRow?.synonyms),
    ...formRows.flatMap((row) => [
      normalizeText(row.form_display),
      normalizeText(row.form_key)?.replace(/_/g, " "),
    ]),
  ]).slice(0, 8);

const buildLaneTemplateSet = (
  category: string | null,
): P0ExpansionWaveLane[] => {
  const normalizedCategory = normalizeKey(category);
  if (normalizedCategory === "vitamin") {
    return [
      {
        lane_key: "status_and_supplementation_context",
        heading: "Status and supplementation context",
        intent:
          "Anchor the family in intake, status, and common supplementation context before broader marketing language.",
        evidence_goal:
          "Prefer review-level intake/status papers plus at least one human supplementation comparison.",
        shopper_meaning_goal:
          "Help shoppers decide whether the label is mainly about baseline status, dose, or a narrower use case.",
      },
      {
        lane_key: "form_and_labeling_context",
        heading: "Form and labeling context",
        intent:
          "Explain how named forms or vitamers change comparison without creating a blanket best-form rule.",
        evidence_goal:
          "Prefer form-aware review papers or human comparisons that name the disclosed vitamers.",
        shopper_meaning_goal:
          "Tell shoppers which form details on the label are worth comparing first.",
      },
      {
        lane_key: "dose_and_pairing_context",
        heading: "Dose and pairing context",
        intent:
          "Clarify when dose, cofactors, or paired formulas change interpretation.",
        evidence_goal:
          "Prefer papers that show why dose or co-formulation changes how the lane should be read.",
        shopper_meaning_goal:
          "Keep comparison focused on amount, pairings, and formula context rather than generic wellness promises.",
      },
    ];
  }

  if (normalizedCategory === "mineral") {
    return [
      {
        lane_key: "intake_and_status_context",
        heading: "Intake and status context",
        intent:
          "Ground the family in intake, status, and supplementation context before benefit-heavy positioning.",
        evidence_goal:
          "Prefer review-level intake/status papers plus human supplementation studies.",
        shopper_meaning_goal:
          "Help shoppers compare whether the label is mostly about intake, deficiency context, or a narrower formula claim.",
      },
      {
        lane_key: "form_and_absorption_context",
        heading: "Form and absorption context",
        intent:
          "Use named forms to explain comparison differences without asserting universal superiority.",
        evidence_goal:
          "Prefer named-form reviews or human comparisons that keep absorption and tolerability language bounded.",
        shopper_meaning_goal:
          "Point shoppers to the exact mineral form and disclosed amount before front-label promise language.",
      },
      {
        lane_key: "comparison_and_cofactor_context",
        heading: "Comparison and cofactor context",
        intent:
          "Explain how co-ingredients or formula setting shift what should be compared first.",
        evidence_goal:
          "Prefer papers that clarify when pairings or formula design change interpretation.",
        shopper_meaning_goal:
          "Keep shoppers focused on form, amount, and paired ingredients rather than generic product headlines.",
      },
    ];
  }

  if (normalizedCategory === "botanical") {
    return [
      {
        lane_key: "primary_use_context",
        heading: "Primary use context",
        intent:
          "Define the clearest shopper-safe use lane instead of repeating broad traditional-marketing language.",
        evidence_goal:
          "Prefer review-level human evidence for the main use case plus at least one controlled supplementation study.",
        shopper_meaning_goal:
          "Tell shoppers what the family is most often compared for before secondary claims.",
      },
      {
        lane_key: "extract_standardization_context",
        heading: "Extract and standardization context",
        intent:
          "Explain how extract type, marker compounds, or standardization change comparison.",
        evidence_goal:
          "Prefer papers that name extract forms or standardization markers in a comparison-safe way.",
        shopper_meaning_goal:
          "Help shoppers compare raw powder, extract, and standardized labels without assuming one universal best version.",
      },
      {
        lane_key: "formula_and_label_context",
        heading: "Formula and label context",
        intent:
          "Show how blends, paired ingredients, or delivery format change label reading.",
        evidence_goal:
          "Prefer practical label-reading evidence and human blend studies where available.",
        shopper_meaning_goal:
          "Keep comparison centered on disclosed extract details and formula context instead of vague herbal positioning.",
      },
    ];
  }

  if (normalizedCategory === "enzyme") {
    return [
      {
        lane_key: "functional_context",
        heading: "Functional context",
        intent:
          "Anchor the family in the clearest functional use case before broader digestive or wellness claims.",
        evidence_goal:
          "Prefer review-level human evidence tied to the named enzyme or activity range.",
        shopper_meaning_goal:
          "Help shoppers understand what the enzyme is mainly being compared for.",
      },
      {
        lane_key: "activity_and_delivery_context",
        heading: "Activity and delivery context",
        intent:
          "Explain how activity units, delivery, and capsule format change comparison.",
        evidence_goal:
          "Prefer papers or monographs that clarify meaningful activity and delivery differences.",
        shopper_meaning_goal:
          "Point shoppers to units, delivery, and combination formulas before generic digestive language.",
      },
      {
        lane_key: "formula_context",
        heading: "Formula context",
        intent:
          "Clarify when single-enzyme versus blend formulas should be compared differently.",
        evidence_goal:
          "Prefer evidence that helps separate single-ingredient reading from broad enzyme-blend marketing.",
        shopper_meaning_goal:
          "Keep label reading practical when several enzymes appear together.",
      },
    ];
  }

  return [
    {
      lane_key: "primary_context",
      heading: "Primary context",
      intent:
        "Define the clearest shopper-safe comparison lane for this family.",
      evidence_goal:
        "Prefer review-level evidence and at least one relevant human supplementation paper.",
      shopper_meaning_goal:
        "Give shoppers a practical first lens for comparing products in this family.",
    },
    {
      lane_key: "form_and_disclosure_context",
      heading: "Form and disclosure context",
      intent:
        "Explain how named form or delivery details change label reading.",
      evidence_goal:
        "Prefer form-aware or delivery-aware evidence that stays comparison-safe.",
      shopper_meaning_goal:
        "Show shoppers which disclosed details on the label are actually comparison-relevant.",
    },
    {
      lane_key: "formula_context",
      heading: "Formula context",
      intent: "Clarify how paired ingredients or blends change interpretation.",
      evidence_goal:
        "Prefer evidence that helps compare single-ingredient and mixed-formula products without hype.",
      shopper_meaning_goal:
        "Keep comparison focused on formula structure and label meaning.",
    },
  ];
};

const getFamilySpecificKeywords = (row: P0ExpansionWaveRow): string[] =>
  uniqueStrings(
    row.pattern_keywords.filter((keyword) => {
      const normalizedKeyword = normalizeKey(keyword);
      if (!normalizedKeyword) return false;
      return (
        normalizedKeyword !== normalizeKey(row.display_name) &&
        normalizedKeyword !== normalizeKey(row.source_ingredient_id)
      );
    }),
  ).slice(0, 3);

const buildFamilySpecificKeywordTheme = (
  row: P0ExpansionWaveRow,
  fallback: string,
  prefix: string,
): string => {
  const keywords = getFamilySpecificKeywords(row);
  if (keywords.length === 0) return fallback;
  return `${prefix} ${keywords.join(", ")}`;
};

const buildSectionPlanBulletThemes = (
  row: P0ExpansionWaveRow,
  lane: P0ExpansionWaveLane,
): string[] => {
  switch (lane.lane_key) {
    case "status_and_supplementation_context":
      return [
        `${row.display_name} intake or status context often drives the clearest interpretation`,
        "Human supplementation context matters more than broad front-label positioning",
        "Dose and baseline status can change how far the lane should be read",
      ];
    case "form_and_labeling_context":
      return [
        buildFamilySpecificKeywordTheme(
          row,
          "Named forms or vitamers change comparison",
          "Named forms such as",
        ),
        "Form disclosure is more useful than generic best-form language",
        "Compare the exact disclosed form before broader wellness claims",
      ];
    case "dose_and_pairing_context":
      return [
        `Disclosed amount can change how ${row.display_name} is interpreted`,
        "Cofactors or paired formulas can narrow the lane",
        "Comparison should stay on dose and pairings rather than generic wellness copy",
      ];
    case "intake_and_status_context":
      return [
        `${row.display_name} intake or status context often matters more than broad deficiency-style marketing`,
        "Human supplementation context should stay separate from front-label promise language",
        "Use status, disclosed amount, and formula context together before broader claims",
      ];
    case "form_and_absorption_context":
      return [
        buildFamilySpecificKeywordTheme(
          row,
          "Named mineral forms change comparison",
          "Named forms such as",
        ),
        "Absorption or tolerability language should stay bounded and comparison-safe",
        "Form and elemental amount usually matter more than front-label benefit copy",
      ];
    case "comparison_and_cofactor_context":
      return [
        "Paired nutrients or ratio-based formulas can change what shoppers compare first",
        "Co-ingredients can narrow interpretation without creating a universal stack rule",
        "Keep comparison centered on form, amount, and pairings",
      ];
    case "primary_use_context":
      return [
        `${row.display_name} should be anchored to the clearest shopper-safe use lane first`,
        "Human evidence should outrank broad traditional or front-label language",
        "Dose, extract, and formula setting can narrow the lane quickly",
      ];
    case "extract_standardization_context":
      return [
        buildFamilySpecificKeywordTheme(
          row,
          "Extract type or standardization can change comparison",
          "Named extract details such as",
        ),
        "Raw powder, extract, and standardized labels should not be treated as interchangeable",
        "Standardization detail helps comparison without proving one universal best version",
      ];
    case "formula_and_label_context":
      return [
        "Blend structure and paired ingredients can change label reading",
        "Delivery format matters only when the disclosed ingredient line supports it",
        "Keep comparison on extract details and formula context rather than vague herbal positioning",
      ];
    case "functional_context":
      return [
        `${row.display_name} should stay anchored to the clearest functional use context`,
        "Named activity or enzyme detail matters more than generic digestive marketing",
        "Human use context should lead before broader wellness copy",
      ];
    case "activity_and_delivery_context":
      return [
        "Activity units and delivery format can change comparison",
        "Capsule style or release format matters only when the label discloses it clearly",
        "Use units and delivery details before generic digestive language",
      ];
    case "formula_context":
      return [
        "Single-ingredient and blended formulas should not be compared the same way",
        "Paired ingredients can narrow the role this family is playing on the label",
        "Keep comparison focused on formula structure and disclosed lines",
      ];
    case "primary_context":
      return [
        `${row.display_name} needs one practical first comparison lens before broader claims`,
        "Human supplementation context should lead over generic wellness positioning",
        "The primary lane should stay narrower than marketing copy",
      ];
    case "form_and_disclosure_context":
      return [
        buildFamilySpecificKeywordTheme(
          row,
          "Named form or delivery details change label reading",
          "Disclosed details such as",
        ),
        "Form and delivery detail should guide comparison before benefit-heavy copy",
        "Use disclosed form detail without turning it into a blanket superiority claim",
      ];
    default:
      return [
        `${row.display_name} needs a practical first comparison lens`,
        "Form, dose, or paired-ingredient detail can narrow interpretation",
        "Keep comparison centered on label meaning rather than generic promises",
      ];
  }
};

const buildPrimaryContextLaneConfig = (
  queryTerm: string,
  label: string,
  preferredGoals: string[] = ["energy_performance", "general_wellness"],
): Record<string, ScientificLaneConfig> => ({
  primary_context: {
    priority: "P0",
    preferred_goals: preferredGoals,
    fallback_query: `((${queryTerm}) AND (supplementation[Title/Abstract] OR human[Title/Abstract] OR oral[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])`,
    selection_notes: [
      `Keep ${label} anchored to human supplementation context instead of broad wellness or performance marketing.`,
    ],
  },
  form_and_disclosure_context: {
    priority: "P1",
    preferred_goals: preferredGoals,
    fallback_query: `((${queryTerm}) AND (form[Title/Abstract] OR dose[Title/Abstract] OR formulation[Title/Abstract] OR bioavailability[Title/Abstract] OR comparison[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])`,
    selection_notes: [
      `Use ${label} form, dose, or delivery wording for label comparison without universal best-form claims.`,
    ],
  },
  formula_context: {
    priority: "P1",
    preferred_goals: preferredGoals,
    fallback_query: `${label} supplement formula blend comparison review humans`,
    selection_notes: [
      `Keep this lane on formula role, exact disclosure, and whether ${label} is central or supporting.`,
    ],
  },
});

const buildBotanicalLaneConfig = (
  queryTerm: string,
  label: string,
  preferredGoals: string[] = ["general_wellness"],
): Record<string, ScientificLaneConfig> => ({
  primary_use_context: {
    priority: "P0",
    preferred_goals: preferredGoals,
    fallback_query: `((${queryTerm}) AND (human[Title/Abstract] OR supplementation[Title/Abstract] OR oral[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])`,
    selection_notes: [
      `Keep ${label} anchored to human-use context rather than broad botanical or traditional-use marketing.`,
    ],
  },
  extract_standardization_context: {
    priority: "P1",
    preferred_goals: preferredGoals,
    fallback_query: `((${queryTerm}) AND (extract[Title/Abstract] OR standardization[Title/Abstract] OR marker[Title/Abstract] OR polyphenol[Title/Abstract] OR formulation[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])`,
    selection_notes: [
      `Use ${label} extract or marker wording for comparison without turning standardization into universal superiority.`,
    ],
  },
  formula_and_label_context: {
    priority: "P1",
    preferred_goals: preferredGoals,
    fallback_query: `${label} supplement formula extract label comparison review humans`,
    selection_notes: [
      `Keep this lane on exact botanical disclosure, formula role, and amount rather than broad herbal positioning.`,
    ],
  },
});

const buildVitaminLaneConfig = (
  queryTerm: string,
  label: string,
  preferredGoals: string[] = ["general_wellness"],
): Record<string, ScientificLaneConfig> => ({
  status_and_supplementation_context: {
    priority: "P0",
    preferred_goals: preferredGoals,
    fallback_query: `((${queryTerm}) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR status[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])`,
    selection_notes: [
      `Keep ${label} grounded in intake, status, and supplementation context rather than broad vitamin marketing.`,
    ],
  },
  form_and_labeling_context: {
    priority: "P1",
    preferred_goals: preferredGoals,
    fallback_query: `((${queryTerm}) AND (form[Title/Abstract] OR labeling[Title/Abstract] OR phylloquinone[Title/Abstract] OR dose[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])`,
    selection_notes: [
      `Use ${label} form or vitamer wording for comparison without a universal best-form claim.`,
    ],
  },
  dose_and_pairing_context: {
    priority: "P1",
    preferred_goals: preferredGoals,
    fallback_query: `${label} supplement dose cofactor formula comparison review humans`,
    selection_notes: [
      `Keep this lane on amount, form, and co-formulation rather than generic wellness promises.`,
    ],
  },
});

const buildMineralLaneConfig = (
  queryTerm: string,
  label: string,
  preferredGoals: string[] = ["general_wellness"],
): Record<string, ScientificLaneConfig> => ({
  intake_and_status_context: {
    priority: "P0",
    preferred_goals: preferredGoals,
    fallback_query: `((${queryTerm}) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR status[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])`,
    selection_notes: [
      `Keep ${label} grounded in intake, status, and supplementation context before broad mineral positioning.`,
    ],
  },
  form_and_absorption_context: {
    priority: "P1",
    preferred_goals: preferredGoals,
    fallback_query: `((${queryTerm}) AND (form[Title/Abstract] OR absorption[Title/Abstract] OR bioavailability[Title/Abstract] OR gluconate[Title/Abstract] OR sulfate[Title/Abstract] OR bisglycinate[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])`,
    selection_notes: [
      `Use named ${label} forms for label comparison without blanket absorption or superiority claims.`,
    ],
  },
  comparison_and_cofactor_context: {
    priority: "P1",
    preferred_goals: preferredGoals,
    fallback_query: `${label} supplement formula cofactor comparison review humans`,
    selection_notes: [
      `Keep this lane on exact form, amount, and paired-nutrient context.`,
    ],
  },
});

const buildEnzymeLaneConfig = (
  queryTerm: string,
  label: string,
): Record<string, ScientificLaneConfig> => ({
  functional_context: {
    priority: "P0",
    preferred_goals: ["digestive", "general_wellness"],
    fallback_query: `((${queryTerm}) AND (human[Title/Abstract] OR supplementation[Title/Abstract] OR oral[Title/Abstract] OR enzyme[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])`,
    selection_notes: [
      `Keep ${label} anchored to named-enzyme context rather than broad digestive or wellness marketing.`,
    ],
  },
  activity_and_delivery_context: {
    priority: "P1",
    preferred_goals: ["digestive", "general_wellness"],
    fallback_query: `((${queryTerm}) AND (activity[Title/Abstract] OR units[Title/Abstract] OR enteric[Title/Abstract] OR delivery[Title/Abstract] OR formulation[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])`,
    selection_notes: [
      `Use activity and delivery wording for comparison only when the label discloses it clearly.`,
    ],
  },
  formula_context: {
    priority: "P1",
    preferred_goals: ["digestive", "general_wellness"],
    fallback_query: `${label} enzyme supplement formula blend review humans`,
    selection_notes: [
      `Keep this lane on single-enzyme versus blend interpretation.`,
    ],
  },
});

const buildNutriMinimalQueryTerm = (
  definition: NutriMinimalFullFamilyDefinition,
): string =>
  definition.patternKeywords
    .slice(0, 4)
    .map((keyword) => `${keyword}[Title/Abstract]`)
    .join(" OR ");

const buildFullFamilyLaneConfig = (
  definition: NutriMinimalFullFamilyDefinition,
): Record<string, ScientificLaneConfig> => {
  const queryTerm = buildNutriMinimalQueryTerm(definition);
  const label = definition.displayName;
  if (definition.safetyBoundaryTier === "high") {
    return {
      primary_use_context: {
        priority: "P0",
        preferred_goals: definition.preferredGoals,
        fallback_query: `((${queryTerm}) AND (human[Title/Abstract] OR supplementation[Title/Abstract] OR oral[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])`,
        selection_notes: [
          `Keep ${label} anchored to human supplement context and preserve hard safety boundaries.`,
          definition.hardBoundary,
        ],
      },
      safety_and_boundary_context: {
        priority: "P1",
        preferred_goals: definition.preferredGoals,
        fallback_query: `((${queryTerm}) AND (safety[Title/Abstract] OR adverse[Title/Abstract] OR interaction[Title/Abstract] OR contraindication[Title/Abstract] OR caution[Title/Abstract])) AND (review[Publication Type] OR systematic review[Title/Abstract] OR trial[Title/Abstract])`,
        selection_notes: [
          `Use ${label} safety evidence to block disease-treatment, drug-replacement, and guaranteed-outcome wording.`,
        ],
      },
      form_source_and_label_context: {
        priority: "P1",
        preferred_goals: definition.preferredGoals,
        fallback_query: `((${queryTerm}) AND (extract[Title/Abstract] OR form[Title/Abstract] OR standardization[Title/Abstract] OR dose[Title/Abstract] OR formulation[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])`,
        selection_notes: [
          `Keep ${label} comparison on exact identity, source, dose, and disclosed label details.`,
        ],
      },
    };
  }

  if (definition.category === "enzyme") {
    return buildEnzymeLaneConfig(queryTerm, label);
  }
  if (definition.category === "mineral") {
    return buildMineralLaneConfig(queryTerm, label, definition.preferredGoals);
  }
  if (definition.category === "botanical") {
    return buildBotanicalLaneConfig(queryTerm, label, definition.preferredGoals);
  }
  return buildPrimaryContextLaneConfig(queryTerm, label, definition.preferredGoals);
};

const FULL_FAMILY_SCIENTIFIC_LANE_CONFIG: ScientificLaneConfigMap =
  Object.fromEntries(
    NUTRI_MINIMAL_FULL_FAMILY_DEFINITIONS.map((definition) => [
      definition.canonicalFamily,
      buildFullFamilyLaneConfig(definition),
    ]),
  );

export const DEFAULT_SCIENTIFIC_LANE_CONFIG: ScientificLaneConfigMap = {
  ...FULL_FAMILY_SCIENTIFIC_LANE_CONFIG,
  l_valine: buildPrimaryContextLaneConfig(
    "L-valine[Title/Abstract] OR valine[Title/Abstract] OR branched-chain amino acid[Title/Abstract] OR BCAA[Title/Abstract]",
    "L-valine",
    ["energy_performance", "recovery"],
  ),
  beta_alanine: buildPrimaryContextLaneConfig(
    "beta-alanine[Title/Abstract] OR beta alanine[Title/Abstract] OR carnosyn[Title/Abstract]",
    "beta-alanine",
    ["energy_performance", "recovery"],
  ),
  carnosine: buildPrimaryContextLaneConfig(
    "carnosine[Title/Abstract] OR L-carnosine[Title/Abstract]",
    "carnosine",
    ["energy_performance", "general_wellness"],
  ),
  citicoline: buildPrimaryContextLaneConfig(
    "citicoline[Title/Abstract] OR CDP-choline[Title/Abstract] OR Cognizin[Title/Abstract]",
    "citicoline",
    ["cognitive", "general_wellness"],
  ),
  nicotinamide_riboside: buildPrimaryContextLaneConfig(
    "nicotinamide riboside[Title/Abstract]",
    "nicotinamide riboside",
    ["energy_performance", "general_wellness"],
  ),
  colostrum: buildPrimaryContextLaneConfig(
    "colostrum[Title/Abstract] OR bovine colostrum[Title/Abstract]",
    "colostrum",
    ["digestive", "immune", "general_wellness"],
  ),
  spirulina: buildPrimaryContextLaneConfig(
    "spirulina[Title/Abstract] OR Arthrospira[Title/Abstract] OR phycocyanin[Title/Abstract]",
    "spirulina",
    ["general_wellness", "energy_performance"],
  ),
  resveratrol: buildPrimaryContextLaneConfig(
    "resveratrol[Title/Abstract] OR trans-resveratrol[Title/Abstract]",
    "resveratrol",
    ["heart_lipids", "general_wellness"],
  ),
  gaba: buildPrimaryContextLaneConfig(
    "gamma-aminobutyric acid[Title/Abstract] OR GABA[Title/Abstract] OR PharmaGABA[Title/Abstract]",
    "GABA",
    ["sleep_stress", "mood"],
  ),
  msm: buildPrimaryContextLaneConfig(
    "methylsulfonylmethane[Title/Abstract] OR MSM[Title/Abstract] OR OptiMSM[Title/Abstract]",
    "MSM",
    ["joint", "recovery", "general_wellness"],
  ),
  zeaxanthin: buildPrimaryContextLaneConfig(
    "zeaxanthin[Title/Abstract]",
    "zeaxanthin",
    ["eye_health", "general_wellness"],
  ),
  chamomile: buildBotanicalLaneConfig(
    "chamomile[Title/Abstract] OR Matricaria chamomilla[Title/Abstract] OR apigenin[Title/Abstract]",
    "chamomile",
    ["sleep_stress", "general_wellness"],
  ),
  astragalus: buildBotanicalLaneConfig(
    "astragalus[Title/Abstract] OR Astragalus membranaceus[Title/Abstract] OR astragaloside[Title/Abstract]",
    "astragalus",
    ["immune", "general_wellness"],
  ),
  cinnamon_extract: buildBotanicalLaneConfig(
    "cinnamon extract[Title/Abstract] OR Cinnamomum[Title/Abstract] OR cinnamon[Title/Abstract]",
    "cinnamon extract",
    ["metabolic", "general_wellness"],
  ),
  grape_seed_extract: buildBotanicalLaneConfig(
    "grape seed extract[Title/Abstract] OR proanthocyanidin[Title/Abstract] OR Vitis vinifera[Title/Abstract]",
    "grape seed extract",
    ["heart_lipids", "general_wellness"],
  ),
  garlic_extract: buildBotanicalLaneConfig(
    "garlic[Title/Abstract] OR Allium sativum[Title/Abstract] OR allicin[Title/Abstract]",
    "garlic extract",
    ["heart_lipids", "immune", "general_wellness"],
  ),
  ginger_root: buildBotanicalLaneConfig(
    "ginger[Title/Abstract] OR Zingiber officinale[Title/Abstract] OR gingerol[Title/Abstract]",
    "ginger root",
    ["digestive", "recovery", "general_wellness"],
  ),
  olive_leaf_extract: buildBotanicalLaneConfig(
    "olive leaf[Title/Abstract] OR Olea europaea[Title/Abstract] OR oleuropein[Title/Abstract]",
    "olive leaf extract",
    ["heart_lipids", "immune", "general_wellness"],
  ),
  pygeum: buildBotanicalLaneConfig(
    "pygeum[Title/Abstract] OR Prunus africana[Title/Abstract]",
    "pygeum",
    ["men_health", "general_wellness"],
  ),
  red_yeast_rice: buildBotanicalLaneConfig(
    "red yeast rice[Title/Abstract] OR Monascus purpureus[Title/Abstract] OR monacolin[Title/Abstract]",
    "red yeast rice",
    ["heart_lipids", "general_wellness"],
  ),
  royal_jelly: buildBotanicalLaneConfig(
    "royal jelly[Title/Abstract]",
    "royal jelly",
    ["general_wellness", "immune"],
  ),
  saffron_extract: buildBotanicalLaneConfig(
    "saffron[Title/Abstract] OR Crocus sativus[Title/Abstract] OR crocin[Title/Abstract] OR safranal[Title/Abstract]",
    "saffron extract",
    ["mood", "sleep_stress", "general_wellness"],
  ),
  tribulus_terrestris: buildBotanicalLaneConfig(
    "tribulus[Title/Abstract] OR Tribulus terrestris[Title/Abstract] OR protodioscin[Title/Abstract]",
    "tribulus terrestris",
    ["men_health", "energy_performance", "general_wellness"],
  ),
  turkey_tail_mushroom: buildBotanicalLaneConfig(
    "turkey tail[Title/Abstract] OR Trametes versicolor[Title/Abstract] OR Coriolus versicolor[Title/Abstract] OR PSK[Title/Abstract] OR PSP[Title/Abstract]",
    "turkey tail mushroom",
    ["immune", "general_wellness"],
  ),
  milk_thistle: buildBotanicalLaneConfig(
    "milk thistle[Title/Abstract] OR Silybum marianum[Title/Abstract] OR silymarin[Title/Abstract]",
    "milk thistle",
    ["liver", "general_wellness"],
  ),
  vitamin_k1: buildVitaminLaneConfig(
    "vitamin K1[Title/Abstract] OR phylloquinone[Title/Abstract] OR phytonadione[Title/Abstract]",
    "vitamin K1",
    ["bone", "general_wellness"],
  ),
  manganese: buildMineralLaneConfig("manganese[Title/Abstract]", "manganese", [
    "general_wellness",
  ]),
  serrapeptase: buildEnzymeLaneConfig(
    "serrapeptase[Title/Abstract] OR serratiopeptidase[Title/Abstract] OR serrapeptidase[Title/Abstract]",
    "serrapeptase",
  ),
  quercetin: {
    primary_use_context: {
      priority: "P0",
      preferred_goals: ["immune", "recovery", "energy_performance"],
      fallback_query:
        "((quercetin[Title/Abstract]) AND (supplementation[Title/Abstract] OR human[Title/Abstract] OR oral[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep quercetin anchored to human supplementation context rather than broad antioxidant marketing.",
      ],
    },
    extract_standardization_context: {
      priority: "P1",
      preferred_goals: ["immune", "recovery"],
      fallback_query:
        "((quercetin[Title/Abstract] OR isoquercetin[Title/Abstract] OR phytosome[Title/Abstract] OR EMIQ[Title/Abstract]) AND (bioavailability[Title/Abstract] OR formulation[Title/Abstract] OR absorption[Title/Abstract] OR comparison[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use extract wording to improve comparison without creating a universal best-form claim.",
      ],
    },
    formula_and_label_context: {
      priority: "P1",
      preferred_goals: ["immune", "recovery"],
      fallback_query:
        "quercetin supplement blend formulation comparison review humans",
      selection_notes: [
        "Keep this lane on label meaning, formula role, and disclosed extract detail.",
      ],
    },
  },
  dgl_licorice: {
    primary_use_context: {
      priority: "P0",
      preferred_goals: ["digestive", "general_wellness"],
      fallback_query:
        "((deglycyrrhizinated licorice[Title/Abstract] OR DGL[Title/Abstract] OR licorice[Title/Abstract]) AND (human[Title/Abstract] OR supplementation[Title/Abstract] OR oral[Title/Abstract])) AND (review[Publication Type] OR systematic review[Title/Abstract] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep DGL licorice distinct from ordinary licorice and glycyrrhizin-heavy safety context.",
      ],
    },
    extract_standardization_context: {
      priority: "P1",
      preferred_goals: ["digestive", "general_wellness"],
      fallback_query:
        "((deglycyrrhizinated licorice[Title/Abstract] OR DGL[Title/Abstract] OR licorice[Title/Abstract]) AND (extract[Title/Abstract] OR glycyrrhizin[Title/Abstract] OR standardization[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use deglycyrrhizinated and extract wording for comparison without creating a universal best-extract claim.",
      ],
    },
    formula_and_label_context: {
      priority: "P1",
      preferred_goals: ["digestive", "general_wellness"],
      fallback_query:
        "DGL licorice supplement formula chewable extract review humans",
      selection_notes: [
        "Keep this lane on formula role, chewable/extract disclosure, and glycyrrhizin-related label meaning.",
      ],
    },
  },
  kava: {
    primary_use_context: {
      priority: "P0",
      preferred_goals: ["sleep_stress", "mood"],
      fallback_query:
        "((kava[Title/Abstract] OR Piper methysticum[Title/Abstract]) AND (human[Title/Abstract] OR supplementation[Title/Abstract] OR oral[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep kava anchored to human use context while preserving liver/safety boundary language.",
      ],
    },
    extract_standardization_context: {
      priority: "P1",
      preferred_goals: ["sleep_stress", "mood"],
      fallback_query:
        "((kava[Title/Abstract] OR Piper methysticum[Title/Abstract] OR kavalactone[Title/Abstract]) AND (extract[Title/Abstract] OR standardization[Title/Abstract] OR aqueous[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use extract and kavalactone wording for label comparison without a universal best-extract claim.",
      ],
    },
    formula_and_label_context: {
      priority: "P1",
      preferred_goals: ["sleep_stress", "mood"],
      fallback_query: "kava supplement formula label kavalactone review humans",
      selection_notes: [
        "Keep this lane on exact extract disclosure, amount, and formula role rather than broad relaxation copy.",
      ],
    },
  },
  slippery_elm: {
    primary_use_context: {
      priority: "P0",
      preferred_goals: ["digestive", "general_wellness"],
      fallback_query:
        "((slippery elm[Title/Abstract] OR Ulmus rubra[Title/Abstract]) AND (human[Title/Abstract] OR supplementation[Title/Abstract] OR oral[Title/Abstract] OR mucilage[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract] OR monograph[Title/Abstract])",
      selection_notes: [
        "Keep slippery elm evidence bounded and practical because human supplement evidence may be sparse.",
      ],
    },
    extract_standardization_context: {
      priority: "P1",
      preferred_goals: ["digestive", "general_wellness"],
      fallback_query:
        "((slippery elm[Title/Abstract] OR Ulmus rubra[Title/Abstract]) AND (bark[Title/Abstract] OR mucilage[Title/Abstract] OR lozenge[Title/Abstract] OR extract[Title/Abstract])) AND (review[Publication Type] OR monograph[Title/Abstract] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use inner-bark, mucilage, lozenge, or extract wording for comparison without overclaiming outcomes.",
      ],
    },
    formula_and_label_context: {
      priority: "P1",
      preferred_goals: ["digestive", "general_wellness"],
      fallback_query:
        "slippery elm supplement formula mucilage lozenge review humans",
      selection_notes: [
        "Keep this lane on exact botanical disclosure and formula role rather than broad soothing language.",
      ],
    },
  },
  aloe_vera: {
    primary_use_context: {
      priority: "P0",
      preferred_goals: ["digestive", "general_wellness"],
      fallback_query:
        "((aloe vera[Title/Abstract] OR aloe[Title/Abstract]) AND (human[Title/Abstract] OR supplementation[Title/Abstract] OR oral[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep aloe vera anchored to oral supplement context and separate inner-leaf/extract wording from broad topical aloe associations.",
      ],
    },
    extract_standardization_context: {
      priority: "P1",
      preferred_goals: ["digestive", "general_wellness"],
      fallback_query:
        "((aloe vera[Title/Abstract] OR aloe[Title/Abstract]) AND (inner leaf[Title/Abstract] OR decolorized[Title/Abstract] OR latex[Title/Abstract] OR extract[Title/Abstract] OR standardization[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use inner-leaf, whole-leaf, latex-free, or decolorized extract wording for comparison without overclaiming outcomes.",
      ],
    },
    formula_and_label_context: {
      priority: "P1",
      preferred_goals: ["digestive", "general_wellness"],
      fallback_query:
        "aloe vera supplement formula inner leaf extract review humans",
      selection_notes: [
        "Keep this lane on exact botanical disclosure and formula role rather than broad soothing or topical language.",
      ],
    },
  },
  passionflower: {
    primary_use_context: {
      priority: "P0",
      preferred_goals: ["sleep_stress", "mood"],
      fallback_query:
        "((passionflower[Title/Abstract] OR passion flower[Title/Abstract] OR Passiflora incarnata[Title/Abstract]) AND (human[Title/Abstract] OR supplementation[Title/Abstract] OR oral[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep passionflower anchored to human use context and separate extract or tea wording from broad calming language.",
      ],
    },
    extract_standardization_context: {
      priority: "P1",
      preferred_goals: ["sleep_stress", "mood"],
      fallback_query:
        "((passionflower[Title/Abstract] OR Passiflora incarnata[Title/Abstract]) AND (extract[Title/Abstract] OR flavonoid[Title/Abstract] OR standardization[Title/Abstract] OR tea[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use species, extract, tea, or flavonoid wording for comparison without overclaiming outcomes.",
      ],
    },
    formula_and_label_context: {
      priority: "P1",
      preferred_goals: ["sleep_stress", "mood"],
      fallback_query:
        "passionflower supplement formula sleep stress extract review humans",
      selection_notes: [
        "Keep this lane on exact botanical disclosure and formula role rather than broad calming language.",
      ],
    },
  },
  st_john_s_wort: {
    primary_use_context: {
      priority: "P0",
      preferred_goals: ["mood"],
      fallback_query:
        "((St John's wort[Title/Abstract] OR St Johns wort[Title/Abstract] OR Hypericum perforatum[Title/Abstract]) AND (human[Title/Abstract] OR supplementation[Title/Abstract] OR oral[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep St. John's wort evidence bounded and interaction-aware rather than broad mood-support marketing.",
      ],
    },
    extract_standardization_context: {
      priority: "P1",
      preferred_goals: ["mood"],
      fallback_query:
        "((St John's wort[Title/Abstract] OR Hypericum perforatum[Title/Abstract] OR hypericin[Title/Abstract] OR hyperforin[Title/Abstract]) AND (extract[Title/Abstract] OR standardization[Title/Abstract] OR LI 160[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use Hypericum, hypericin, hyperforin, or standardized-extract wording for comparison without universal extract superiority.",
      ],
    },
    formula_and_label_context: {
      priority: "P1",
      preferred_goals: ["mood"],
      fallback_query:
        "St John's wort supplement formula interaction extract review humans",
      selection_notes: [
        "Keep this lane on exact botanical disclosure, formula role, and interaction-aware boundaries.",
      ],
    },
  },
  lavender: {
    primary_use_context: {
      priority: "P0",
      preferred_goals: ["sleep_stress", "mood"],
      fallback_query:
        "((lavender[Title/Abstract] OR Lavandula angustifolia[Title/Abstract] OR Silexan[Title/Abstract]) AND (human[Title/Abstract] OR supplementation[Title/Abstract] OR oral[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep lavender anchored to oral supplement or studied preparation context rather than broad aromatherapy or calming copy.",
      ],
    },
    extract_standardization_context: {
      priority: "P1",
      preferred_goals: ["sleep_stress", "mood"],
      fallback_query:
        "((lavender[Title/Abstract] OR Lavandula angustifolia[Title/Abstract] OR Silexan[Title/Abstract]) AND (oil[Title/Abstract] OR extract[Title/Abstract] OR preparation[Title/Abstract] OR standardization[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use lavender oil, Silexan-style, flower, or extract wording for comparison without assuming route equivalence.",
      ],
    },
    formula_and_label_context: {
      priority: "P1",
      preferred_goals: ["sleep_stress", "mood"],
      fallback_query:
        "lavender supplement formula oral extract oil review humans",
      selection_notes: [
        "Keep this lane on exact botanical disclosure and formula role rather than broad aromatherapy language.",
      ],
    },
  },
  lemon_balm: {
    primary_use_context: {
      priority: "P0",
      preferred_goals: ["sleep_stress", "mood"],
      fallback_query:
        "((lemon balm[Title/Abstract] OR Melissa officinalis[Title/Abstract]) AND (human[Title/Abstract] OR supplementation[Title/Abstract] OR oral[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep lemon balm anchored to oral human-use context rather than broad calming or herbal tradition copy.",
      ],
    },
    extract_standardization_context: {
      priority: "P1",
      preferred_goals: ["sleep_stress", "mood"],
      fallback_query:
        "((lemon balm[Title/Abstract] OR Melissa officinalis[Title/Abstract]) AND (extract[Title/Abstract] OR leaf[Title/Abstract] OR tea[Title/Abstract] OR standardization[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use Melissa, leaf, tea, or extract wording for comparison without overclaiming outcomes.",
      ],
    },
    formula_and_label_context: {
      priority: "P1",
      preferred_goals: ["sleep_stress", "mood"],
      fallback_query:
        "lemon balm supplement formula sleep stress extract review humans",
      selection_notes: [
        "Keep this lane on exact botanical disclosure and formula role rather than broad calming language.",
      ],
    },
  },
  valerian: {
    primary_use_context: {
      priority: "P0",
      preferred_goals: ["sleep_stress"],
      fallback_query:
        "((valerian[Title/Abstract] OR Valeriana officinalis[Title/Abstract]) AND (sleep[Title/Abstract] OR supplementation[Title/Abstract] OR extract[Title/Abstract] OR human[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep valerian anchored to oral sleep/stress-context evidence and avoid broad sedative or treatment language.",
      ],
    },
    extract_standardization_context: {
      priority: "P1",
      preferred_goals: ["sleep_stress"],
      fallback_query:
        "((valerian[Title/Abstract] OR Valeriana officinalis[Title/Abstract]) AND (extract[Title/Abstract] OR root[Title/Abstract] OR valerenic[Title/Abstract] OR standardization[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use root, extract, or marker wording for comparison without overclaiming outcomes.",
      ],
    },
    formula_and_label_context: {
      priority: "P1",
      preferred_goals: ["sleep_stress"],
      fallback_query:
        "valerian supplement formula sleep blend extract review humans",
      selection_notes: [
        "Keep this lane on exact botanical disclosure and formula role rather than broad sleep language.",
      ],
    },
  },
  papain: {
    functional_context: {
      priority: "P0",
      preferred_goals: ["digestive"],
      fallback_query:
        "((papain[Title/Abstract] OR papaya enzyme[Title/Abstract] OR Carica papaya[Title/Abstract]) AND (human[Title/Abstract] OR supplementation[Title/Abstract] OR oral[Title/Abstract] OR digestive[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep papain grounded in enzyme-function and digestive-formula context rather than broad papaya wellness claims.",
      ],
    },
    activity_and_delivery_context: {
      priority: "P1",
      preferred_goals: ["digestive"],
      fallback_query:
        "((papain[Title/Abstract] OR papaya enzyme[Title/Abstract]) AND (activity[Title/Abstract] OR enzyme[Title/Abstract] OR delivery[Title/Abstract] OR unit[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use enzyme activity, mass-based label, or delivery wording for comparison without universal superiority claims.",
      ],
    },
    formula_context: {
      priority: "P1",
      preferred_goals: ["digestive"],
      fallback_query:
        "papain supplement enzyme blend formula digestive review humans",
      selection_notes: [
        "Keep this lane on enzyme formula role and whether papain is central or part of a broader enzyme blend.",
      ],
    },
  },
  bromelain: {
    functional_context: {
      priority: "P0",
      preferred_goals: ["digestive", "joint"],
      fallback_query:
        "((bromelain[Title/Abstract]) AND (human[Title/Abstract] OR supplementation[Title/Abstract] OR oral[Title/Abstract] OR enzyme[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep bromelain grounded in enzyme-function and formula context rather than broad pineapple or digestive wellness claims.",
      ],
    },
    activity_and_delivery_context: {
      priority: "P1",
      preferred_goals: ["digestive", "joint"],
      fallback_query:
        "((bromelain[Title/Abstract]) AND (activity[Title/Abstract] OR GDU[Title/Abstract] OR MCU[Title/Abstract] OR enzyme[Title/Abstract] OR delivery[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use enzyme activity units, mass-based labels, and delivery wording for comparison without universal superiority claims.",
      ],
    },
    formula_context: {
      priority: "P1",
      preferred_goals: ["digestive", "joint"],
      fallback_query: "bromelain supplement enzyme blend formula review humans",
      selection_notes: [
        "Keep this lane on enzyme formula role and whether bromelain is central or part of a broader enzyme blend.",
      ],
    },
  },
  glutathione: {
    primary_context: {
      priority: "P0",
      preferred_goals: ["detox_antioxidant", "general_wellness"],
      fallback_query:
        "((glutathione[Title/Abstract]) AND (supplementation[Title/Abstract] OR oral[Title/Abstract] OR human[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep direct glutathione distinct from NAC precursor context and avoid broad detox marketing.",
      ],
    },
    form_and_disclosure_context: {
      priority: "P1",
      preferred_goals: ["detox_antioxidant", "general_wellness"],
      fallback_query:
        "((glutathione[Title/Abstract]) AND (liposomal[Title/Abstract] OR reduced[Title/Abstract] OR S-acetyl[Title/Abstract] OR bioavailability[Title/Abstract] OR absorption[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use disclosed delivery or form detail for comparison without a universal best-form claim.",
      ],
    },
    formula_context: {
      priority: "P1",
      preferred_goals: ["detox_antioxidant", "general_wellness"],
      fallback_query:
        "glutathione supplement formula antioxidant precursor review humans",
      selection_notes: [
        "Keep this lane on formula role, paired antioxidants, and whether glutathione is central or supporting.",
      ],
    },
  },
  alpha_lipoic_acid: {
    primary_context: {
      priority: "P0",
      preferred_goals: ["energy_performance", "weight"],
      fallback_query:
        "((alpha-lipoic acid[Title/Abstract] OR alpha lipoic acid[Title/Abstract] OR lipoic acid[Title/Abstract]) AND (supplementation[Title/Abstract] OR oral[Title/Abstract] OR human[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep alpha-lipoic acid grounded in human supplementation context rather than broad antioxidant or metabolism hype.",
      ],
    },
    form_and_disclosure_context: {
      priority: "P1",
      preferred_goals: ["energy_performance", "weight"],
      fallback_query:
        "((alpha-lipoic acid[Title/Abstract] OR alpha lipoic acid[Title/Abstract] OR R-alpha-lipoic acid[Title/Abstract]) AND (form[Title/Abstract] OR bioavailability[Title/Abstract] OR absorption[Title/Abstract] OR stabilized[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use R-ALA or stabilized-form wording for comparison without a universal best-form claim.",
      ],
    },
    formula_context: {
      priority: "P1",
      preferred_goals: ["energy_performance", "weight"],
      fallback_query:
        "alpha lipoic acid supplement formula antioxidant cofactor review humans",
      selection_notes: [
        "Keep this lane on formula role, paired antioxidants, and whether ALA is central or supporting.",
      ],
    },
  },
  l_ornithine: {
    primary_context: {
      priority: "P0",
      preferred_goals: ["energy_performance", "sleep_stress"],
      fallback_query:
        "((ornithine[Title/Abstract] OR L-ornithine[Title/Abstract]) AND (supplementation[Title/Abstract] OR oral[Title/Abstract] OR human[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep L-ornithine grounded in human supplementation context rather than broad amino-acid or performance hype.",
      ],
    },
    form_and_disclosure_context: {
      priority: "P1",
      preferred_goals: ["energy_performance", "sleep_stress"],
      fallback_query:
        "((ornithine[Title/Abstract] OR L-ornithine[Title/Abstract] OR ornithine hydrochloride[Title/Abstract]) AND (form[Title/Abstract] OR dose[Title/Abstract] OR supplement[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use free-form or HCl wording for comparison without a universal best-form claim.",
      ],
    },
    formula_context: {
      priority: "P1",
      preferred_goals: ["energy_performance", "sleep_stress"],
      fallback_query:
        "ornithine supplement formula amino acid blend review humans",
      selection_notes: [
        "Keep this lane on formula role, paired amino acids, and whether ornithine is central or supporting.",
      ],
    },
  },
  l_arginine: {
    primary_context: {
      priority: "P0",
      preferred_goals: ["energy_performance", "heart_lipids"],
      fallback_query:
        "((arginine[Title/Abstract] OR L-arginine[Title/Abstract]) AND (supplementation[Title/Abstract] OR oral[Title/Abstract] OR human[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep L-arginine grounded in human supplementation context rather than broad nitric-oxide or pump marketing.",
      ],
    },
    form_and_disclosure_context: {
      priority: "P1",
      preferred_goals: ["energy_performance", "heart_lipids"],
      fallback_query:
        "((arginine[Title/Abstract] OR L-arginine[Title/Abstract] OR AAKG[Title/Abstract] OR arginine alpha-ketoglutarate[Title/Abstract]) AND (form[Title/Abstract] OR dose[Title/Abstract] OR supplement[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use HCl, AAKG, malate, or free-form wording for comparison without universal best-form claims.",
      ],
    },
    formula_context: {
      priority: "P1",
      preferred_goals: ["energy_performance", "heart_lipids"],
      fallback_query:
        "arginine supplement formula pre workout amino acid blend review humans",
      selection_notes: [
        "Keep this lane on formula role, paired amino acids, and whether arginine is central or supporting.",
      ],
    },
  },
  arginine_alpha_ketoglutarate: {
    primary_context: {
      priority: "P0",
      preferred_goals: ["energy_performance"],
      fallback_query:
        "((arginine alpha-ketoglutarate[Title/Abstract] OR AAKG[Title/Abstract]) AND (supplementation[Title/Abstract] OR exercise[Title/Abstract] OR human[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep AAKG grounded in human supplementation and exercise-context label reading rather than broad pump or nitric-oxide hype.",
      ],
    },
    form_and_disclosure_context: {
      priority: "P1",
      preferred_goals: ["energy_performance"],
      fallback_query:
        "((arginine alpha-ketoglutarate[Title/Abstract] OR AAKG[Title/Abstract]) AND (form[Title/Abstract] OR dose[Title/Abstract] OR supplement[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use AAKG disclosure as a comparison cue without claiming it is universally superior to other arginine forms.",
      ],
    },
    formula_context: {
      priority: "P1",
      preferred_goals: ["energy_performance"],
      fallback_query:
        "AAKG supplement pre workout formula amino acid blend review humans",
      selection_notes: [
        "Keep this lane on formula role, paired amino acids, stimulants, and whether AAKG is central or supporting.",
      ],
    },
  },
  citrulline_malate: {
    primary_context: {
      priority: "P0",
      preferred_goals: ["energy_performance"],
      fallback_query:
        "((citrulline malate[Title/Abstract] OR L-citrulline[Title/Abstract]) AND (supplementation[Title/Abstract] OR exercise[Title/Abstract] OR human[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep citrulline malate grounded in human exercise-supplementation context rather than broad pump or endurance hype.",
      ],
    },
    form_and_disclosure_context: {
      priority: "P1",
      preferred_goals: ["energy_performance"],
      fallback_query:
        "((citrulline malate[Title/Abstract] OR L-citrulline[Title/Abstract]) AND (malate[Title/Abstract] OR form[Title/Abstract] OR dose[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use citrulline versus citrulline-malate wording for comparison without universal best-form claims.",
      ],
    },
    formula_context: {
      priority: "P1",
      preferred_goals: ["energy_performance"],
      fallback_query:
        "citrulline malate supplement formula pre workout amino acid blend review humans",
      selection_notes: [
        "Keep this lane on formula role, dose, and whether citrulline malate is central or supporting.",
      ],
    },
  },
  d_ribose: {
    primary_context: {
      priority: "P0",
      preferred_goals: ["energy_performance"],
      fallback_query:
        "((D-ribose[Title/Abstract] OR ribose[Title/Abstract]) AND (supplementation[Title/Abstract] OR oral[Title/Abstract] OR human[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep D-ribose grounded in bounded human supplementation context rather than broad cellular-energy promises.",
      ],
    },
    form_and_disclosure_context: {
      priority: "P1",
      preferred_goals: ["energy_performance"],
      fallback_query:
        "((D-ribose[Title/Abstract] OR ribose[Title/Abstract]) AND (form[Title/Abstract] OR dose[Title/Abstract] OR supplement[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use D-ribose naming and dose disclosure for comparison without broad energy guarantees.",
      ],
    },
    formula_context: {
      priority: "P1",
      preferred_goals: ["energy_performance"],
      fallback_query: "D-ribose supplement formula energy blend review humans",
      selection_notes: [
        "Keep this lane on formula role and whether D-ribose is central or part of a broader energy formula.",
      ],
    },
  },
  l_methionine: {
    primary_context: {
      priority: "P0",
      preferred_goals: ["general_wellness", "energy_performance"],
      fallback_query:
        "((methionine[Title/Abstract] OR L-methionine[Title/Abstract]) AND (supplementation[Title/Abstract] OR oral[Title/Abstract] OR human[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep L-methionine grounded in amino-acid and formula-context label reading rather than broad detox or metabolism hype.",
      ],
    },
    form_and_disclosure_context: {
      priority: "P1",
      preferred_goals: ["general_wellness", "energy_performance"],
      fallback_query:
        "((methionine[Title/Abstract] OR L-methionine[Title/Abstract]) AND (form[Title/Abstract] OR dose[Title/Abstract] OR supplement[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use L-methionine naming and dose disclosure for comparison without broad pathway promises.",
      ],
    },
    formula_context: {
      priority: "P1",
      preferred_goals: ["general_wellness", "energy_performance"],
      fallback_query:
        "methionine supplement formula amino acid blend review humans",
      selection_notes: [
        "Keep this lane on formula role, paired nutrients, and whether methionine is central or supporting.",
      ],
    },
  },
  choline: {
    primary_context: {
      priority: "P0",
      preferred_goals: ["brain_focus", "general_wellness"],
      fallback_query:
        "((choline[Title/Abstract]) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR human[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep choline grounded in intake and supplementation context rather than broad brain or liver marketing.",
      ],
    },
    form_and_disclosure_context: {
      priority: "P1",
      preferred_goals: ["brain_focus", "general_wellness"],
      fallback_query:
        "((choline[Title/Abstract]) AND (bitartrate[Title/Abstract] OR phosphatidylcholine[Title/Abstract] OR alpha-GPC[Title/Abstract] OR form[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use choline form disclosure to improve comparison without ranking all choline forms universally.",
      ],
    },
    formula_context: {
      priority: "P1",
      preferred_goals: ["brain_focus", "general_wellness"],
      fallback_query:
        "choline supplement formula nootropic prenatal paired nutrients review humans",
      selection_notes: [
        "Keep this lane on formula role and whether choline is central or part of a broader blend.",
      ],
    },
  },
  nicotinamide_mononucleotide: {
    primary_context: {
      priority: "P0",
      preferred_goals: ["healthy_aging", "energy_performance"],
      fallback_query:
        "((nicotinamide mononucleotide[Title/Abstract] OR NMN[Title/Abstract]) AND (supplementation[Title/Abstract] OR oral[Title/Abstract] OR human[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep NMN grounded in human supplementation context rather than broad longevity or anti-aging promises.",
      ],
    },
    form_and_disclosure_context: {
      priority: "P1",
      preferred_goals: ["healthy_aging", "energy_performance"],
      fallback_query:
        "((nicotinamide mononucleotide[Title/Abstract] OR NMN[Title/Abstract]) AND (form[Title/Abstract] OR dose[Title/Abstract] OR bioavailability[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use NMN naming, dose, and delivery disclosure for comparison without longevity superiority claims.",
      ],
    },
    formula_context: {
      priority: "P1",
      preferred_goals: ["healthy_aging", "energy_performance"],
      fallback_query:
        "NMN supplement formula NAD precursor blend review humans",
      selection_notes: [
        "Keep this lane on formula role, paired NAD-related ingredients, and whether NMN is central or supporting.",
      ],
    },
  },
  b3_niacinamide: {
    b3_coenzyme_context: {
      priority: "P1",
      preferred_goals: ["energy_performance"],
      fallback_query:
        '((niacin[Title/Abstract] OR niacinamide[Title/Abstract] OR nicotinamide[Title/Abstract] OR "vitamin B3"[Title/Abstract]) AND (supplementation[Title/Abstract] OR metabolism[Title/Abstract] OR coenzyme[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Keep B3 grounded in coenzyme and supplementation context instead of broad energy or skin hype.",
      ],
    },
    companion_role_on_the_label: {
      priority: "P1",
      preferred_goals: ["energy_performance", "beauty"],
      fallback_query:
        "niacinamide vitamin B3 multivitamin formula role review supplement",
      selection_notes: [
        "Use this lane to explain when B3 is central versus when it is a supporting row in a broader formula.",
      ],
    },
  },
  biotin: {
    status_and_supplementation_context: {
      priority: "P0",
      preferred_goals: ["beauty", "energy_performance"],
      fallback_query:
        '((biotin[Title/Abstract] OR "vitamin B7"[Title/Abstract]) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR status[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Anchor biotin in intake/status and supplementation context before hair, skin, or nail marketing is over-read.",
      ],
    },
    form_and_labeling_context: {
      priority: "P1",
      preferred_goals: ["beauty", "energy_performance"],
      fallback_query:
        '((biotin[Title/Abstract] OR "vitamin B7"[Title/Abstract] OR d-biotin[Title/Abstract]) AND (form[Title/Abstract] OR labeling[Title/Abstract] OR supplement[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Use D-biotin or B7 label wording to support comparison without form superiority claims.",
      ],
    },
    dose_and_pairing_context: {
      priority: "P1",
      preferred_goals: ["beauty", "energy_performance"],
      fallback_query: "biotin supplement dose B complex formula review humans",
      selection_notes: [
        "Keep this lane practical by tying comparison to amount and whether biotin is central or part of a broader B-complex formula.",
      ],
    },
  },
  riboflavin: {
    status_and_supplementation_context: {
      priority: "P0",
      preferred_goals: ["energy_performance", "brain_focus"],
      fallback_query:
        '((riboflavin[Title/Abstract] OR "vitamin B2"[Title/Abstract]) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR status[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Anchor riboflavin in intake/status and supplementation context before broad energy or B-vitamin copy.",
      ],
    },
    form_and_labeling_context: {
      priority: "P1",
      preferred_goals: ["energy_performance", "brain_focus"],
      fallback_query:
        '((riboflavin[Title/Abstract] OR "vitamin B2"[Title/Abstract] OR flavin[Title/Abstract]) AND (form[Title/Abstract] OR coenzyme[Title/Abstract] OR labeling[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Use riboflavin/B2 or flavin-coenzyme wording for label comparison without best-form claims.",
      ],
    },
    dose_and_pairing_context: {
      priority: "P1",
      preferred_goals: ["energy_performance", "brain_focus"],
      fallback_query:
        "riboflavin vitamin B2 supplement dose B complex formula review humans",
      selection_notes: [
        "Keep this lane practical by tying comparison to amount and whether riboflavin is central or part of a broader B-complex formula.",
      ],
    },
  },
  thiamin: {
    status_and_supplementation_context: {
      priority: "P0",
      preferred_goals: ["energy_performance", "brain_focus"],
      fallback_query:
        '((thiamin[Title/Abstract] OR thiamine[Title/Abstract] OR "vitamin B1"[Title/Abstract]) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR status[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Anchor thiamin in intake/status and supplementation context before broad energy or nervous-system copy.",
      ],
    },
    form_and_labeling_context: {
      priority: "P1",
      preferred_goals: ["energy_performance", "brain_focus"],
      fallback_query:
        '((thiamin[Title/Abstract] OR thiamine[Title/Abstract] OR "vitamin B1"[Title/Abstract] OR benfotiamine[Title/Abstract]) AND (form[Title/Abstract] OR labeling[Title/Abstract] OR supplement[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Use thiamine HCl, mononitrate, or benfotiamine wording for comparison without universal best-form claims.",
      ],
    },
    dose_and_pairing_context: {
      priority: "P1",
      preferred_goals: ["energy_performance", "brain_focus"],
      fallback_query:
        "thiamin vitamin B1 supplement dose B complex formula review humans",
      selection_notes: [
        "Keep this lane practical by tying comparison to amount and whether thiamin is central or part of a broader B-complex formula.",
      ],
    },
  },
  pantothenic_acid: {
    status_and_supplementation_context: {
      priority: "P0",
      preferred_goals: ["energy_performance", "general_wellness"],
      fallback_query:
        '((pantothenic acid[Title/Abstract] OR "vitamin B5"[Title/Abstract] OR pantethine[Title/Abstract]) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR status[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Anchor pantothenic acid in intake/status and B-vitamin supplementation context before broad energy or wellness copy.",
      ],
    },
    form_and_labeling_context: {
      priority: "P1",
      preferred_goals: ["energy_performance", "general_wellness"],
      fallback_query:
        '((pantothenic acid[Title/Abstract] OR "vitamin B5"[Title/Abstract] OR calcium pantothenate[Title/Abstract] OR pantethine[Title/Abstract]) AND (form[Title/Abstract] OR labeling[Title/Abstract] OR supplement[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Use vitamin B5, calcium pantothenate, or pantethine wording for label comparison without best-form claims.",
      ],
    },
    dose_and_pairing_context: {
      priority: "P1",
      preferred_goals: ["energy_performance", "general_wellness"],
      fallback_query:
        "pantothenic acid vitamin B5 supplement dose B complex formula review humans",
      selection_notes: [
        "Keep this lane practical by tying comparison to amount and whether B5 is central or part of a broader B-complex formula.",
      ],
    },
  },
  vitamin_a: {
    status_and_supplementation_context: {
      priority: "P0",
      preferred_goals: ["immune", "beauty"],
      fallback_query:
        '((\"vitamin A\"[Title/Abstract] OR retinol[Title/Abstract] OR retinyl[Title/Abstract] OR beta-carotene[Title/Abstract]) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR status[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Anchor vitamin A in intake, status, form, and dose-aware context before broad vision, immune, or skin claims.",
      ],
    },
    form_and_labeling_context: {
      priority: "P1",
      preferred_goals: ["immune", "beauty"],
      fallback_query:
        '((\"vitamin A\"[Title/Abstract] OR retinol[Title/Abstract] OR retinyl[Title/Abstract] OR beta-carotene[Title/Abstract]) AND (form[Title/Abstract] OR provitamin[Title/Abstract] OR labeling[Title/Abstract] OR comparison[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Use preformed versus provitamin A wording to improve comparison without universal superiority claims.",
      ],
    },
    dose_and_pairing_context: {
      priority: "P1",
      preferred_goals: ["immune", "beauty"],
      fallback_query:
        "vitamin A supplement dose pairing beta-carotene retinol review humans",
      selection_notes: [
        "Keep this lane practical by tying comparison to amount, form, and co-formulation.",
      ],
    },
  },
  vitamin_e: {
    status_and_supplementation_context: {
      priority: "P0",
      preferred_goals: ["heart_lipids", "beauty"],
      fallback_query:
        '((\"vitamin E\"[Title/Abstract] OR tocopherol[Title/Abstract] OR tocotrienol[Title/Abstract]) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR status[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Anchor vitamin E in intake and supplementation context before broader antioxidant packaging claims.",
      ],
    },
    form_and_labeling_context: {
      priority: "P1",
      preferred_goals: ["heart_lipids", "beauty"],
      fallback_query:
        '((\"vitamin E\"[Title/Abstract] OR tocopherol[Title/Abstract] OR tocotrienol[Title/Abstract]) AND (form[Title/Abstract] OR acetate[Title/Abstract] OR succinate[Title/Abstract] OR comparison[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Use vitamers and disclosed forms to support comparison-safe label reading.",
      ],
    },
    dose_and_pairing_context: {
      priority: "P1",
      preferred_goals: ["heart_lipids", "beauty"],
      fallback_query:
        "vitamin E supplement dose pairing antioxidant formula review",
      selection_notes: [
        "Keep the lane practical by tying comparison to amount, form, and paired nutrients.",
      ],
    },
  },
  vitamin_k2: {
    status_and_supplementation_context: {
      priority: "P0",
      preferred_goals: ["bone"],
      fallback_query:
        '((\"vitamin K2\"[Title/Abstract] OR menaquinone[Title/Abstract] OR \"MK-7\"[Title/Abstract] OR \"MK-4\"[Title/Abstract]) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR status[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Anchor vitamin K2 in intake and supplementation context before broad bone or heart marketing is flattened together.",
      ],
    },
    form_and_labeling_context: {
      priority: "P1",
      preferred_goals: ["bone"],
      fallback_query:
        '((\"vitamin K2\"[Title/Abstract] OR menaquinone[Title/Abstract] OR \"MK-7\"[Title/Abstract] OR \"MK-4\"[Title/Abstract]) AND (form[Title/Abstract] OR labeling[Title/Abstract] OR comparison[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Use MK-4 or MK-7 disclosure to improve comparison without turning it into a blanket best-form claim.",
      ],
    },
    dose_and_pairing_context: {
      priority: "P1",
      preferred_goals: ["bone"],
      fallback_query:
        "vitamin K2 calcium vitamin D pairing supplement review humans",
      selection_notes: [
        "Keep the lane focused on amount and pairing context rather than generic bone marketing.",
      ],
    },
  },
  chromium: {
    intake_and_status_context: {
      priority: "P0",
      preferred_goals: ["weight", "energy_performance"],
      fallback_query:
        "((chromium[Title/Abstract]) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR status[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep chromium anchored to intake and supplementation context rather than broad sugar-balance hype.",
      ],
    },
    form_and_absorption_context: {
      priority: "P1",
      preferred_goals: ["weight", "energy_performance"],
      fallback_query:
        "((chromium[Title/Abstract]) AND (picolinate[Title/Abstract] OR polynicotinate[Title/Abstract] OR nicotinate[Title/Abstract] OR form[Title/Abstract] OR comparison[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use named chromium forms for comparison-safe label reading without universal better-absorbed claims.",
      ],
    },
    comparison_and_cofactor_context: {
      priority: "P1",
      preferred_goals: ["weight", "energy_performance"],
      fallback_query:
        "chromium supplement formula comparison cofactor review humans",
      selection_notes: [
        "Help shoppers compare chromium through form, amount, and whether it is central or supporting in the formula.",
      ],
    },
  },
  selenium: {
    intake_and_status_context: {
      priority: "P0",
      preferred_goals: ["immune", "beauty"],
      fallback_query:
        "((selenium[Title/Abstract]) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR status[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep selenium grounded in intake and supplementation context instead of broad antioxidant or thyroid-adjacent filler.",
      ],
    },
    form_and_absorption_context: {
      priority: "P1",
      preferred_goals: ["immune", "beauty"],
      fallback_query:
        '((selenium[Title/Abstract]) AND (selenomethionine[Title/Abstract] OR selenite[Title/Abstract] OR selenate[Title/Abstract] OR \"selenium yeast\"[Title/Abstract] OR form[Title/Abstract] OR comparison[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Use named selenium forms to improve comparison without a universal best-form claim.",
      ],
    },
    comparison_and_cofactor_context: {
      priority: "P1",
      preferred_goals: ["immune", "beauty"],
      fallback_query:
        "selenium supplement formula comparison paired nutrients review humans",
      selection_notes: [
        "Keep the lane on exact disclosure, amount, and paired-nutrient context.",
      ],
    },
  },
  copper: {
    intake_and_status_context: {
      priority: "P0",
      preferred_goals: ["energy_performance", "immune"],
      fallback_query:
        "((copper[Title/Abstract]) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR status[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep copper grounded in intake and supplementation context rather than broad mineral or antioxidant filler.",
      ],
    },
    form_and_absorption_context: {
      priority: "P1",
      preferred_goals: ["energy_performance", "immune"],
      fallback_query:
        "((copper[Title/Abstract]) AND (bisglycinate[Title/Abstract] OR citrate[Title/Abstract] OR gluconate[Title/Abstract] OR chelate[Title/Abstract] OR form[Title/Abstract] OR absorption[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use named copper forms for comparison-safe label reading without universal better-absorbed claims.",
      ],
    },
    comparison_and_cofactor_context: {
      priority: "P1",
      preferred_goals: ["energy_performance", "immune"],
      fallback_query:
        "copper supplement zinc pairing formula comparison review humans",
      selection_notes: [
        "Keep this lane on exact disclosure, amount, and paired-mineral context.",
      ],
    },
  },
  molybdenum: {
    intake_and_status_context: {
      priority: "P0",
      preferred_goals: ["general_wellness", "energy_performance"],
      fallback_query:
        "((molybdenum[Title/Abstract] OR molybdate[Title/Abstract]) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR status[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep molybdenum grounded in trace-mineral intake and supplementation context rather than broad detox or enzyme-support filler.",
      ],
    },
    form_and_absorption_context: {
      priority: "P1",
      preferred_goals: ["general_wellness", "energy_performance"],
      fallback_query:
        "((molybdenum[Title/Abstract] OR molybdate[Title/Abstract]) AND (chelate[Title/Abstract] OR glycinate[Title/Abstract] OR form[Title/Abstract] OR absorption[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use molybdate or chelate wording for comparison-safe label reading without universal better-absorbed claims.",
      ],
    },
    comparison_and_cofactor_context: {
      priority: "P1",
      preferred_goals: ["general_wellness", "energy_performance"],
      fallback_query:
        "molybdenum supplement formula comparison cofactor trace mineral review humans",
      selection_notes: [
        "Keep this lane on exact disclosure, amount, and trace-mineral formula context.",
      ],
    },
  },
  iodine: {
    intake_and_status_context: {
      priority: "P0",
      preferred_goals: ["general_wellness", "energy_performance"],
      fallback_query:
        "((iodine[Title/Abstract] OR iodide[Title/Abstract]) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR status[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep iodine grounded in intake/status and supplementation context rather than broad thyroid or kelp marketing.",
      ],
    },
    form_and_absorption_context: {
      priority: "P1",
      preferred_goals: ["general_wellness", "energy_performance"],
      fallback_query:
        "((iodine[Title/Abstract] OR iodide[Title/Abstract] OR kelp[Title/Abstract] OR seaweed[Title/Abstract]) AND (form[Title/Abstract] OR source[Title/Abstract] OR supplement[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use iodide, kelp, or seaweed source wording for comparison without natural-source superiority claims.",
      ],
    },
    comparison_and_cofactor_context: {
      priority: "P1",
      preferred_goals: ["general_wellness", "energy_performance"],
      fallback_query:
        "iodine supplement formula comparison selenium thyroid context review humans",
      selection_notes: [
        "Keep this lane on exact disclosure, amount, and paired-nutrient formula context.",
      ],
    },
  },
  potassium: {
    intake_and_status_context: {
      priority: "P0",
      preferred_goals: ["heart_lipids", "general_wellness"],
      fallback_query:
        "((potassium[Title/Abstract]) AND (supplementation[Title/Abstract] OR intake[Title/Abstract] OR status[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Keep potassium as a supplement-form lane only; do not let ordinary Nutrition Facts potassium rows become productized science anchors.",
      ],
    },
    form_and_absorption_context: {
      priority: "P1",
      preferred_goals: ["heart_lipids", "general_wellness"],
      fallback_query:
        "((potassium[Title/Abstract]) AND (gluconate[Title/Abstract] OR citrate[Title/Abstract] OR chloride[Title/Abstract] OR bicarbonate[Title/Abstract] OR form[Title/Abstract])) AND (review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use named potassium salts for label comparison without universal best-form or more-natural claims.",
      ],
    },
    comparison_and_cofactor_context: {
      priority: "P1",
      preferred_goals: ["heart_lipids", "general_wellness"],
      fallback_query:
        "potassium supplement formula sodium magnesium electrolyte comparison review humans",
      selection_notes: [
        "Keep this lane on exact salt form, amount, sodium/electrolyte context, and whether potassium is central or supporting.",
      ],
    },
  },
  magnesium: {
    form_and_tolerability_context: {
      priority: "P0",
      preferred_goals: ["sleep_stress", "energy_performance"],
      fallback_query:
        "magnesium supplement bioavailability tolerability citrate oxide humans",
      selection_notes: [
        "Prefer human oral comparison papers or review-level summaries about disclosed magnesium forms.",
        "Keep the lane comparison-safe and avoid universal best-form claims.",
      ],
    },
    what_product_comparison_depends_on: {
      priority: "P1",
      preferred_goals: ["sleep_stress", "energy_performance"],
      fallback_query:
        "magnesium supplement form disclosure elemental amount review humans",
      selection_notes: [
        "Favor label-reading context about form disclosure, elemental amount, and formula setting.",
      ],
    },
  },
  iron: {
    form_and_tolerability_context: {
      priority: "P0",
      preferred_goals: ["energy_performance"],
      fallback_query:
        '((\"ferrous bisglycinate\"[Title/Abstract] OR \"iron bisglycinate\"[Title/Abstract]) AND \"ferrous sulfate\"[Title/Abstract]) AND (review[Publication Type] OR review[Title/Abstract] OR randomized[Title/Abstract] OR trial[Title/Abstract] OR tolerability[Title/Abstract] OR bioavailability[Title/Abstract])',
      selection_notes: [
        "Prefer oral supplementation reviews and named-form comparison studies that stay practical about tolerability and label interpretation.",
        "Use review-level form-comparison context to keep bisglycinate-versus-sulfate language bounded and shopper-safe.",
      ],
      manual_seed_pmids: ["15743016"],
      query_preference: "prefer_config",
    },
    what_product_comparison_depends_on: {
      priority: "P1",
      preferred_goals: ["energy_performance"],
      fallback_query:
        "iron supplement form elemental amount cofactor comparison review",
      selection_notes: [
        "Keep this lane focused on label comparison, not blanket superiority claims.",
      ],
    },
  },
  omega_3: {
    inflammation_and_recovery_context: {
      priority: "P1",
      preferred_goals: ["immune", "joint", "energy_performance"],
      fallback_query:
        "omega-3 supplementation recovery inflammation randomized review",
      selection_notes: [
        "Use recovery or inflammation language only as a narrower lane beside lipid-oriented interpretation.",
      ],
    },
    brain_and_eye_context: {
      priority: "P1",
      preferred_goals: ["brain_focus"],
      fallback_query: "omega-3 EPA DHA brain eye review supplementation",
      selection_notes: [
        "Prefer EPA/DHA-aware reviews rather than generic fish oil marketing copy.",
      ],
    },
    broader_cardiovascular_context: {
      priority: "P1",
      preferred_goals: ["heart_lipids"],
      fallback_query: "omega-3 cardiovascular supplement review EPA DHA",
      selection_notes: [
        "Keep cardiovascular language broader than the stricter triglyceride lane.",
      ],
    },
    lipid_and_triglyceride_research: {
      priority: "P0",
      preferred_goals: ["heart_lipids"],
      fallback_query: "omega-3 triglyceride EPA DHA meta-analysis supplement",
      selection_notes: [
        "This is the clearest comparison lane; prioritize triglyceride-relevant human evidence.",
      ],
    },
  },
  protein: {
    muscle_and_recovery_context: {
      priority: "P0",
      preferred_goals: ["energy_performance"],
      fallback_query:
        "protein supplementation muscle recovery randomized trial review",
      selection_notes: [
        "Prefer supplementation evidence relevant to muscle support and recovery context.",
      ],
    },
    protein_type_and_disclosure_context: {
      priority: "P1",
      preferred_goals: ["energy_performance"],
      fallback_query:
        "protein isolate concentrate blend comparison review supplement",
      selection_notes: [
        "This lane is more about label disclosure and protein type than broad benefit copy.",
      ],
    },
    satiety_and_meal_support_context: {
      priority: "P1",
      preferred_goals: ["weight"],
      fallback_query: "protein supplementation satiety meal replacement review",
      selection_notes: [
        "Keep satiety language narrower than generic weight-loss promises.",
      ],
    },
  },
  fiber: {
    digestive_regularity_context: {
      priority: "P0",
      preferred_goals: ["gut_probiotic"],
      fallback_query:
        "fiber supplementation digestive regularity randomized review",
      selection_notes: [
        "Prefer regularity-oriented human evidence and avoid overclaiming disease management.",
      ],
    },
    source_and_solubility_context: {
      priority: "P1",
      preferred_goals: ["gut_probiotic"],
      fallback_query: "fiber source solubility supplement comparison review",
      selection_notes: [
        "This lane should help compare fiber source and disclosed type, not crown one universal best fiber.",
      ],
    },
    satiety_and_gut_context: {
      priority: "P1",
      preferred_goals: ["weight", "gut_probiotic"],
      fallback_query: "fiber supplementation satiety gut review humans",
      selection_notes: [
        "Use satiety and gut-context evidence conservatively and keep it comparison-safe.",
      ],
    },
  },
  b12: {
    deficiency_and_supplementation_context: {
      priority: "P0",
      preferred_goals: ["energy_performance"],
      fallback_query: "vitamin B12 supplementation deficiency review humans",
      selection_notes: [
        "Favor deficiency and supplementation context over broad energy-marketing language.",
      ],
    },
    what_form_disclosure_changes: {
      priority: "P1",
      preferred_goals: ["energy_performance"],
      fallback_query:
        "methylcobalamin cyanocobalamin vitamin B12 supplementation review",
      selection_notes: [
        "Use form disclosure to explain comparison context, not universal superiority.",
      ],
    },
    nerve_and_blood_cell_context: {
      priority: "P1",
      preferred_goals: ["brain_focus", "energy_performance"],
      fallback_query: "vitamin B12 nerve blood cell supplementation review",
      selection_notes: [
        "Keep this lane anchored to supplementation context and avoid disease-treatment framing.",
      ],
    },
  },
  folate: {
    folate_status_and_supplementation_context: {
      priority: "P0",
      preferred_goals: ["womens_health"],
      fallback_query: "folate supplementation status review humans",
      selection_notes: [
        "Favor supplementation and status context over vague wellness phrasing.",
      ],
    },
    pregnancy_and_developmental_context: {
      priority: "P1",
      preferred_goals: ["womens_health"],
      fallback_query: "folate pregnancy supplementation review humans",
      selection_notes: [
        "Keep this lane specific to pregnancy/developmental context and shopper-safe.",
      ],
    },
    what_form_labeling_changes: {
      priority: "P1",
      preferred_goals: ["womens_health"],
      fallback_query:
        '((folic acid[Title/Abstract] OR methylfolate[Title/Abstract] OR "5-MTHF"[Title/Abstract]) AND (bioavailability[Title/Abstract] OR supplementation[Title/Abstract] OR comparison[Title/Abstract] OR oral[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Use form labeling to explain comparison differences, not a blanket best-form claim.",
      ],
      manual_seed_pmids: ["30010385", "39339754"],
      query_preference: "prefer_config",
    },
  },
  calcium: {
    bone_and_intake_context: {
      priority: "P0",
      preferred_goals: ["bone"],
      fallback_query: "calcium supplementation bone intake review humans",
      selection_notes: [
        "Prefer intake and supplementation context, not disease-treatment language.",
      ],
    },
    form_and_absorption_context: {
      priority: "P1",
      preferred_goals: ["bone"],
      fallback_query: "calcium carbonate citrate absorption supplement review",
      selection_notes: [
        "Use named calcium forms to support comparison-safe interpretation.",
      ],
    },
    how_coformulation_changes_comparison: {
      priority: "P1",
      preferred_goals: ["bone"],
      fallback_query:
        '((calcium[Title/Abstract] AND "vitamin D"[Title/Abstract]) AND (coformulation[Title/Abstract] OR supplementation[Title/Abstract] OR fracture[Title/Abstract] OR "bone mineral density"[Title/Abstract])) AND (systematic review[Title/Abstract] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Explain co-formulation context without turning it into a universal stack recommendation.",
      ],
      manual_seed_pmids: ["29279934", "37544189", "33237064"],
      query_preference: "prefer_config",
    },
  },
  zinc: {
    immune_function_context: {
      priority: "P0",
      preferred_goals: ["immune"],
      fallback_query: "zinc supplementation immune review humans",
      selection_notes: [
        "Keep immune wording within supplementation context and avoid cure/prevention language.",
      ],
    },
    skin_and_barrier_research: {
      priority: "P1",
      preferred_goals: ["beauty"],
      fallback_query:
        '((zinc[Title/Abstract]) AND (skin[Title/Abstract] OR dermatology[Title/Abstract] OR acne[Title/Abstract] OR \"wound healing\"[Title/Abstract] OR barrier[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract] OR meta-analysis[Publication Type]) NOT (testosterone[Title/Abstract] OR semen[Title/Abstract] OR contracept*[Title/Abstract])',
      selection_notes: [
        "Treat skin/barrier as a narrower lane than generic immune claims.",
      ],
      manual_seed_pmids: ["29439479", "32860489", "17244314"],
      query_preference: "prefer_config",
    },
  },
  vitamin_d: {
    bone_and_calcium_regulation_context: {
      priority: "P0",
      preferred_goals: ["bone"],
      fallback_query:
        "vitamin D supplementation bone calcium regulation review",
      selection_notes: [
        "Favor bone/calcium-regulation context as the clearest lane.",
      ],
    },
    immune_and_broader_health_research: {
      priority: "P1",
      preferred_goals: ["immune"],
      fallback_query: "vitamin D supplementation immune review humans",
      selection_notes: [
        "Keep broader-health language secondary and comparison-safe.",
      ],
    },
    what_interpretation_depends_on: {
      priority: "P1",
      preferred_goals: ["bone", "immune"],
      fallback_query:
        '((\"vitamin D\"[Title/Abstract] OR cholecalciferol[Title/Abstract]) AND (\"25(OH)D\"[Title/Abstract] OR \"baseline status\"[Title/Abstract] OR dose[Title/Abstract] OR supplementation[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Use this lane to explain why dose, baseline status, and use context change interpretation.",
      ],
      manual_seed_pmids: ["30313003", "30032221", "34520402"],
      query_preference: "prefer_config",
    },
  },
  melatonin: {
    sleep_timing_and_onset_context: {
      priority: "P0",
      preferred_goals: ["sleep_stress"],
      fallback_query: "melatonin supplementation sleep onset timing review",
      selection_notes: [
        "Prefer sleep timing/onset evidence over broader stress-marketing language.",
      ],
    },
    what_dose_and_use_context_can_change: {
      priority: "P1",
      preferred_goals: ["sleep_stress"],
      fallback_query:
        "((melatonin[Title/Abstract]) AND (dose[Title/Abstract] OR timing[Title/Abstract] OR onset[Title/Abstract] OR prolonged-release[Title/Abstract] OR extended-release[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR meta-analysis[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])",
      selection_notes: [
        "Use this lane for dose/use-context interpretation, not blanket sleep promises.",
      ],
      manual_seed_pmids: ["38888087", "36179487", "33962317"],
      query_preference: "prefer_config",
    },
  },
  vitamin_c: {
    antioxidant_and_immune_research: {
      priority: "P0",
      preferred_goals: ["immune"],
      fallback_query:
        "vitamin C supplementation immune antioxidant review humans",
      selection_notes: [
        "Prefer comparison-safe immune or antioxidant evidence; avoid treatment claims.",
      ],
    },
    collagen_and_tissue_support: {
      priority: "P1",
      preferred_goals: ["beauty"],
      fallback_query:
        '((\"vitamin C\"[Title/Abstract] OR ascorbic acid[Title/Abstract]) AND (collagen[Title/Abstract] OR \"skin health\"[Title/Abstract] OR \"tissue healing\"[Title/Abstract] OR \"wound healing\"[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract]) NOT (immune[Title/Abstract] OR \"common cold\"[Title/Abstract])',
      selection_notes: [
        "Prefer tissue-healing or collagen-context reviews and human supplementation studies rather than broad beauty copy.",
        "Avoid immune-led or topical-only evidence unless it clearly helps bound the lane rather than dominate it.",
      ],
      manual_seed_pmids: ["28805671", "30386805", "27852613"],
      query_preference: "prefer_config",
    },
    iron_absorption_context: {
      priority: "P1",
      preferred_goals: ["immune", "energy_performance"],
      fallback_query: "vitamin C iron absorption supplement review humans",
      selection_notes: [
        "Use this lane to explain pairings and context, not a universal absorption guarantee.",
      ],
    },
  },
  b6: {
    cofactor_and_metabolism_context: {
      priority: "P0",
      preferred_goals: ["energy_performance"],
      fallback_query: "vitamin B6 cofactor metabolism supplementation review",
      selection_notes: [
        "Favor cofactor/metabolism context over generic energy promises.",
      ],
    },
    why_dose_context_matters: {
      priority: "P1",
      preferred_goals: ["energy_performance"],
      fallback_query:
        '((\"vitamin B6\"[Title/Abstract] OR pyridoxine[Title/Abstract] OR \"pyridoxal-5-phosphate\"[Title/Abstract]) AND (dose[Title/Abstract] OR safety[Title/Abstract] OR neuropathy[Title/Abstract] OR supplementation[Title/Abstract])) AND (systematic review[Title/Abstract] OR review[Publication Type] OR randomized[Title/Abstract] OR trial[Title/Abstract])',
      selection_notes: [
        "Use this lane to explain dose-context interpretation rather than universal benefit claims.",
      ],
      manual_seed_pmids: ["31915511", "40218880", "33376337"],
      query_preference: "prefer_config",
    },
    nerve_related_interpretation: {
      priority: "P1",
      preferred_goals: ["brain_focus"],
      fallback_query: "vitamin B6 nerve supplementation review",
      selection_notes: [
        "Keep nerve-related language bounded and shopper-safe.",
      ],
    },
  },
};

export const normalizeWorkbookPackage = (
  input: RawWorkbookPackage,
): NormalizedDatasetPackage => {
  const version = normalizeText(input.metadata.package_version) ?? "v4.0";
  const generatedAt = normalizeText(input.metadata.generated_at);
  const sourceWorkbook = normalizeText(input.metadata.source_workbook);

  const sheets: Record<string, RawSheetRow[]> = {};
  for (const [sheetName, normalizedKey] of Object.entries(
    WORKBOOK_SHEET_KEY_MAP,
  )) {
    sheets[normalizedKey] = Array.isArray(input.sheets[sheetName])
      ? input.sheets[sheetName]
      : [];
  }

  return {
    version,
    generated_at: generatedAt,
    meta: {
      version,
      source_workbook: sourceWorkbook,
      generated_at: generatedAt,
    },
    sheets,
  };
};

export const buildFamilyExpansionBacklog = (
  normalizedPackage: NormalizedDatasetPackage,
): FamilyExpansionBacklogEntry[] => {
  const coverageIndex = buildCoverageIndex(normalizedPackage);
  const ingredients = normalizedPackage.sheets.ingredients ?? [];

  return ingredients
    .map((row) => {
      const sourceIngredientId = normalizeText(row.ingredient_id) ?? "";
      const displayName = normalizeText(row.ingredient) ?? sourceIngredientId;
      const mappedFamily = resolveMappedFamily(sourceIngredientId, displayName);
      const mappingStatus = resolveMappingStatus(
        sourceIngredientId,
        mappedFamily,
      );
      const coverageRow = coverageIndex.get(sourceIngredientId) ?? null;
      const formsCount =
        toNumber(coverageRow?.forms_count ?? row.forms_count) ?? 0;
      const evidenceCount =
        toNumber(coverageRow?.evidence_rows ?? row.evidence_count) ?? 0;
      const refsCount =
        toNumber(coverageRow?.refs_total ?? row.refs_count) ?? 0;
      const coverageGapFlags = collectGapFlags(coverageRow, mappedFamily);
      return {
        source_ingredient_id: sourceIngredientId,
        display_name: displayName,
        mapped_family: mappedFamily,
        mapping_status: mappingStatus,
        category: normalizeText(row.category),
        forms_count: formsCount,
        evidence_count: evidenceCount,
        refs_count: refsCount,
        coverage_gap_flags: coverageGapFlags,
        proposed_priority: buildPriority(
          mappingStatus,
          coverageGapFlags,
          evidenceCount,
          refsCount,
        ),
        notes: buildBacklogNotes(
          sourceIngredientId,
          mappedFamily,
          coverageGapFlags,
        ),
      } satisfies FamilyExpansionBacklogEntry;
    })
    .filter((row) => row.source_ingredient_id)
    .sort((left, right) => {
      const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
      const priorityDelta =
        priorityOrder[left.proposed_priority] -
        priorityOrder[right.proposed_priority];
      if (priorityDelta !== 0) return priorityDelta;
      return left.source_ingredient_id.localeCompare(
        right.source_ingredient_id,
      );
    });
};

export const buildFormTaxonomyStaging = (
  normalizedPackage: NormalizedDatasetPackage,
): FormTaxonomyStaging => {
  const formAliasRows = normalizedPackage.sheets.form_aliases ?? [];
  const normalizationRules = normalizedPackage.sheets.normalization_rules ?? [];
  const ingredients = (normalizedPackage.sheets.ingredients ?? [])
    .map((row) => ({
      ingredient_id: normalizeText(row.ingredient_id),
      ingredient: normalizeText(row.ingredient),
      category: normalizeText(row.category),
      base_unit: normalizeText(row.base_unit),
      synonyms: splitList(row.synonyms),
      goals: splitList(row.goals),
    }))
    .filter((row) => row.ingredient_id && row.ingredient) as RawSheetRow[];

  const acceptedFormAliases: RawSheetRow[] = [];
  const tokenAliases: RawSheetRow[] = [];
  const genericFormTokens = new Map<string, RawSheetRow>();
  const rejectedAliases: FormTaxonomyStaging["rejected_aliases"] = [];

  for (const row of formAliasRows) {
    const tokenRaw = normalizeText(row.token_raw);
    const tokenNormalized = normalizeText(row.token_normalized) ?? tokenRaw;
    const appliesToIngredientId = normalizeText(row.applies_to_ingredient_id);
    const mapsToFormKey = normalizeText(row.maps_to_form_key);
    if (!tokenRaw || !tokenNormalized) continue;

    if (!isAdmissibleToken(tokenRaw) || !isAdmissibleToken(tokenNormalized)) {
      rejectedAliases.push({
        token_raw: tokenRaw,
        reason: "inadmissible_token",
        applies_to_ingredient_id: appliesToIngredientId,
        maps_to_form_key: mapsToFormKey,
      });
      continue;
    }

    if (mapsToFormKey) {
      acceptedFormAliases.push({
        applies_to_ingredient_id: appliesToIngredientId,
        maps_to_form_key: mapsToFormKey,
        token_raw: tokenRaw,
        token_normalized: normalizeKey(tokenNormalized),
        alias_confidence: toNumber(row.alias_confidence),
        notes: normalizeText(row.notes),
      });
    }

    tokenAliases.push({
      token_raw: tokenRaw,
      token_normalized: normalizeKey(tokenNormalized),
      alias_confidence: toNumber(row.alias_confidence),
      notes: normalizeText(row.notes),
      applies_to_ingredient_id: appliesToIngredientId,
    });

    if (!appliesToIngredientId) {
      const genericKey = normalizeKey(tokenNormalized);
      if (!genericKey) continue;
      const existing = genericFormTokens.get(genericKey);
      const nextRow = {
        token_raw: tokenRaw,
        token_normalized: genericKey,
        alias_confidence: toNumber(row.alias_confidence),
        notes:
          normalizeText(row.notes) ?? "Derived from FormAliases generic row",
      };
      if (
        !existing ||
        (toNumber(existing.alias_confidence) ?? -1) <
          (toNumber(nextRow.alias_confidence) ?? -1)
      ) {
        genericFormTokens.set(genericKey, nextRow);
      }
    }
  }

  for (const rule of normalizationRules) {
    const replacement = normalizeText(rule.replacement);
    if (!replacement || !isAdmissibleToken(replacement)) continue;
    const genericKey = normalizeKey(replacement);
    if (!genericKey) continue;
    if (!genericFormTokens.has(genericKey)) {
      genericFormTokens.set(genericKey, {
        token_raw: replacement,
        token_normalized: genericKey,
        alias_confidence: 0.5,
        notes: `Derived from normalization rule ${normalizeText(rule.rule_id) ?? "unknown"}`,
      });
    }
  }

  return {
    version: normalizedPackage.version,
    generated_at: normalizedPackage.generated_at,
    meta: normalizedPackage.meta,
    sheets: {
      ingredients,
      form_aliases: acceptedFormAliases,
      normalization_rules: (normalizedPackage.sheets.normalization_rules ?? [])
        .map((row) => ({
          rule_id: normalizeText(row.rule_id),
          pattern: normalizeText(row.pattern),
          replacement: normalizeText(row.replacement),
          description: normalizeText(row.description),
        }))
        .filter(
          (row) => row.rule_id && row.pattern && row.replacement,
        ) as RawSheetRow[],
      token_aliases: tokenAliases,
      generic_form_tokens: Array.from(genericFormTokens.values()).sort(
        (left, right) =>
          String(left.token_normalized ?? "").localeCompare(
            String(right.token_normalized ?? ""),
          ),
      ),
    },
    summary: {
      ingredient_count: ingredients.length,
      form_alias_count: acceptedFormAliases.length,
      normalization_rule_count:
        normalizedPackage.sheets.normalization_rules?.length ?? 0,
      token_alias_count: tokenAliases.length,
      generic_form_token_count: genericFormTokens.size,
      rejected_alias_count: rejectedAliases.length,
    },
    rejected_aliases: rejectedAliases,
  };
};

const buildSeedCitation = (row: RawSheetRow): SeedCitation => ({
  id: normalizeText(row.id) ?? "",
  type: normalizeText(row.type) ?? "unknown",
  identifier: normalizeText(row.identifier),
  source: normalizeText(row.source),
  url: normalizeText(row.url),
  audit_status: normalizeText(row.audit_status),
  resolution_priority: toNumber(row.resolution_priority),
  link_status: normalizeText(row.link_status),
  seed_kind: resolveCitationSeedKind(row),
  search_query: extractSearchQuery(normalizeText(row.url)),
});

const selectSeedCitations = (
  referenceIds: string[],
  citationIndex: Map<string, RawSheetRow>,
): SeedCitation[] =>
  dedupeSeedCitations(
    referenceIds
      .map((id) => citationIndex.get(id))
      .filter((row): row is RawSheetRow => Boolean(row))
      .map(buildSeedCitation),
  );

const laneNeedsFormReferences = (lane: string): boolean =>
  /form|disclosure|solubility|tolerability|comparison/i.test(lane);

const selectGoalAwareEvidenceRows = (
  evidenceRows: RawSheetRow[],
  preferredGoals: string[],
): RawSheetRow[] => {
  if (!preferredGoals.length) return evidenceRows;
  const preferredSet = new Set(
    preferredGoals.map((goal) => normalizeKey(goal)),
  );
  const filtered = evidenceRows.filter((row) =>
    preferredSet.has(normalizeKey(normalizeText(row.goal))),
  );
  return filtered.length > 0 ? filtered : evidenceRows;
};

const buildFallbackLaneStub = (
  entry: FamilyExpansionBacklogEntry,
): ScientificEvidenceBacklogLaneStub => ({
  source_ingredient_id: entry.source_ingredient_id,
  display_name: entry.display_name,
  mapped_family: entry.mapped_family,
  mapping_status: entry.mapping_status,
  proposed_lane_stub: entry.mapped_family
    ? `${entry.mapped_family}__needs_section_plan`
    : `${entry.source_ingredient_id}__candidate_family_lane`,
  review_status:
    entry.mapping_status === "unresolved_mapping" ? "rejected" : "needs_edit",
  review_reasons:
    entry.mapping_status === "unresolved_mapping"
      ? ["family_mapping_unresolved"]
      : entry.mapped_family &&
          BACKLOG_ONLY_RUNTIME_FAMILIES.has(entry.mapped_family)
        ? ["backlog_only_runtime_family"]
        : ["lane_mapping_needs_edit"],
  notes: entry.notes,
});

export const buildScientificEvidenceCandidateRegistry = (
  normalizedPackage: NormalizedDatasetPackage,
  backlogEntries: FamilyExpansionBacklogEntry[],
  laneConfigMap: ScientificLaneConfigMap,
  existingQueries: ExistingCandidateQuery[] = [],
): ScientificEvidenceCandidateRegistryArtifact => {
  const today = new Date().toISOString().slice(0, 10);
  const citationIndex = buildCitationIndex(normalizedPackage);
  const evidenceByIngredient = buildEvidenceRowsByIngredient(normalizedPackage);
  const formsByIngredient = buildFormRowsByIngredient(normalizedPackage);
  const existingQueryMap = new Map<string, ExistingCandidateQuery>();
  for (const row of existingQueries) {
    const key = `${normalizeKey(row.family)}|${normalizeKey(row.lane)}|${normalizeKey(row.variant_key ?? null)}`;
    existingQueryMap.set(key, row);
  }

  const registry: ScientificEvidenceCandidateRegistryRow[] = [];
  const backlogLaneStubs: ScientificEvidenceBacklogLaneStub[] = [];

  const entriesByFamily = new Map<string, FamilyExpansionBacklogEntry[]>();
  for (const entry of backlogEntries) {
    if (!entry.mapped_family) {
      backlogLaneStubs.push(buildFallbackLaneStub(entry));
      continue;
    }
    const bucket = entriesByFamily.get(entry.mapped_family) ?? [];
    bucket.push(entry);
    entriesByFamily.set(entry.mapped_family, bucket);
  }

  for (const [family, familyEntries] of entriesByFamily.entries()) {
    const laneConfig = laneConfigMap[family];
    if (!laneConfig || BACKLOG_ONLY_RUNTIME_FAMILIES.has(family)) {
      familyEntries.forEach((entry) =>
        backlogLaneStubs.push(buildFallbackLaneStub(entry)),
      );
      continue;
    }

    const familyIngredientIds = familyEntries.map(
      (entry) => entry.source_ingredient_id,
    );
    const familyEvidenceRows = familyIngredientIds.flatMap(
      (ingredientId) => evidenceByIngredient.get(ingredientId) ?? [],
    );
    const familyFormRows = familyIngredientIds.flatMap(
      (ingredientId) => formsByIngredient.get(ingredientId) ?? [],
    );
    const familyGoals = uniqueStrings(
      familyEvidenceRows.map((row) => normalizeText(row.goal)),
    );

    for (const [lane, config] of Object.entries(laneConfig)) {
      const laneEvidenceRows = selectGoalAwareEvidenceRows(
        familyEvidenceRows,
        config.preferred_goals,
      );
      const laneReferenceIds = uniqueStrings([
        ...laneEvidenceRows.flatMap(parseReferenceIds),
        ...(laneNeedsFormReferences(lane)
          ? familyFormRows.flatMap(parseReferenceIds)
          : []),
      ]);
      const seedCitations = dedupeSeedCitations([
        ...selectSeedCitations(laneReferenceIds, citationIndex),
        ...buildManualPmidSeedCitations(family, lane, config.manual_seed_pmids),
      ]).slice(0, 8);
      const existingQuery = existingQueryMap.get(
        `${normalizeKey(family)}|${normalizeKey(lane)}|`,
      );
      const searchSeed =
        seedCitations.find((citation) => citation.search_query)?.search_query ??
        null;
      const resolvedQuery =
        config.query_preference === "prefer_config"
          ? (config.fallback_query ?? existingQuery?.query ?? searchSeed)
          : (existingQuery?.query ?? config.fallback_query ?? searchSeed);
      registry.push({
        family,
        lane,
        source: "life-science-research:ncbi-entrez-skill",
        retrieved_at: today,
        query: resolvedQuery,
        seed_citations: seedCitations,
        plugin_verified_pmids: [],
        priority: existingQuery?.priority ?? config.priority,
        selection_notes: uniqueStrings([
          ...(existingQuery?.selection_notes ?? []),
          ...config.selection_notes,
        ]),
        review_status: "needs_edit",
        review_reasons: laneReferenceIds.length
          ? ["no_plugin_verified_pmids"]
          : ["no_seed_citations"],
        source_ingredient_ids: familyIngredientIds,
        source_goals: familyGoals,
        mapping_status: "mapped_existing_family",
      });
    }
  }

  return {
    version: normalizedPackage.version,
    generated_at: normalizedPackage.generated_at,
    meta: {
      ...normalizedPackage.meta,
      source: "life-science-research:ncbi-entrez-skill",
    },
    scientific_evidence_candidate_registry: registry.sort((left, right) => {
      const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
      const priorityDelta =
        priorityOrder[left.priority] - priorityOrder[right.priority];
      if (priorityDelta !== 0) return priorityDelta;
      const familyDelta = left.family.localeCompare(right.family);
      if (familyDelta !== 0) return familyDelta;
      return left.lane.localeCompare(right.lane);
    }),
    backlog_lane_stubs: backlogLaneStubs.sort((left, right) =>
      left.source_ingredient_id.localeCompare(right.source_ingredient_id),
    ),
  };
};

const hasReviewLikeEvidence = (rows: VerifiedPmid[]): boolean =>
  rows.some((row) =>
    row.pubtype.some((value) => /review|meta-analysis|systematic/i.test(value)),
  );

const hasHumanComparisonLikeEvidence = (rows: VerifiedPmid[]): boolean =>
  rows.some((row) =>
    row.pubtype.some((value) =>
      /randomized|clinical trial|comparative study|journal article/i.test(
        value,
      ),
    ),
  );

export const reviewScientificEvidenceCandidateRegistry = async (
  artifact: ScientificEvidenceCandidateRegistryArtifact,
  reviewer: ScientificCandidateReviewer,
): Promise<ScientificEvidenceCandidateRegistryArtifact> => {
  const reviewedRows: ScientificEvidenceCandidateRegistryRow[] = [];

  for (const row of artifact.scientific_evidence_candidate_registry) {
    if (row.mapping_status !== "mapped_existing_family") {
      reviewedRows.push({
        ...row,
        review_status: "rejected",
        review_reasons: ["family_mapping_unresolved"],
      });
      continue;
    }

    let reviewResult: ScientificCandidateReviewResult;
    try {
      reviewResult = await reviewer({ row });
    } catch {
      reviewedRows.push({
        ...row,
        review_status: row.seed_citations.every(
          (citation) => citation.seed_kind === "search_url",
        )
          ? "rejected"
          : "needs_edit",
        review_reasons: row.seed_citations.every(
          (citation) => citation.seed_kind === "search_url",
        )
          ? ["only_search_url_without_resolved_source"]
          : ["no_plugin_verified_pmids"],
      });
      continue;
    }

    const verifiedPmids = reviewResult.verified_pmids.slice(0, 5);
    const nextReasons: ReviewReason[] = [];
    let reviewStatus: ReviewStatus = "needs_edit";

    if (!row.seed_citations.length) {
      reviewStatus = "rejected";
      nextReasons.push("no_seed_citations");
    } else if (verifiedPmids.length === 0) {
      if (
        row.seed_citations.every(
          (citation) => citation.seed_kind === "search_url",
        )
      ) {
        reviewStatus = "rejected";
        nextReasons.push("only_search_url_without_resolved_source");
      } else {
        reviewStatus = "needs_edit";
        nextReasons.push("no_plugin_verified_pmids");
      }
    } else if (
      !hasReviewLikeEvidence(verifiedPmids) ||
      !hasHumanComparisonLikeEvidence(verifiedPmids)
    ) {
      reviewStatus = "needs_edit";
      nextReasons.push("needs_boundary_support");
    } else {
      reviewStatus = "approved";
      nextReasons.push("approved_with_verified_pmids");
    }

    if (!row.source_goals.length) {
      nextReasons.push("lane_mapping_needs_edit");
      if (reviewStatus === "approved") reviewStatus = "needs_edit";
    }

    reviewedRows.push({
      ...row,
      query: reviewResult.query_used ?? row.query,
      plugin_verified_pmids: verifiedPmids,
      review_status: reviewStatus,
      review_reasons: Array.from(new Set(nextReasons)),
    });
  }

  return {
    ...artifact,
    scientific_evidence_candidate_registry: reviewedRows,
  };
};

export const buildP0ExpansionWave = (
  normalizedPackage: NormalizedDatasetPackage,
  backlogEntries: FamilyExpansionBacklogEntry[],
  limit = 15,
): P0ExpansionWaveArtifact => {
  const ingredientIndex = buildIngredientRowsById(normalizedPackage);
  const formRowsByIngredient = buildFormRowsByIngredient(normalizedPackage);
  const selected: P0ExpansionWaveRow[] = [];
  const categoryCounts = new Map<string, number>();

  const candidates = backlogEntries
    .filter((entry) => entry.mapping_status === "new_family_candidate")
    .filter(
      (entry) =>
        !entry.coverage_gap_flags.includes("no_verified_refs_in_workbook"),
    )
    .sort((left, right) => {
      const scoreDelta =
        computeExpansionWaveScore(right) - computeExpansionWaveScore(left);
      if (scoreDelta !== 0) return scoreDelta;
      return left.source_ingredient_id.localeCompare(
        right.source_ingredient_id,
      );
    });

  for (const entry of candidates) {
    if (selected.length >= limit) break;
    const categoryKey = normalizeKey(entry.category) || "other";
    const currentCategoryCount = categoryCounts.get(categoryKey) ?? 0;
    if (currentCategoryCount >= 4) continue;
    categoryCounts.set(categoryKey, currentCategoryCount + 1);
    const ingredientRow =
      ingredientIndex.get(entry.source_ingredient_id) ?? null;
    const formRows = formRowsByIngredient.get(entry.source_ingredient_id) ?? [];
    selected.push({
      source_ingredient_id: entry.source_ingredient_id,
      display_name: entry.display_name,
      category: entry.category,
      mapping_status: "new_family_candidate",
      implementation_priority: "P0",
      wave_rank: selected.length + 1,
      wave_score: computeExpansionWaveScore(entry),
      pattern_keywords: buildPatternKeywords(entry, ingredientRow, formRows),
      scientific_background_lanes: buildLaneTemplateSet(entry.category),
      forms_count: entry.forms_count,
      evidence_count: entry.evidence_count,
      refs_count: entry.refs_count,
      coverage_gap_flags: entry.coverage_gap_flags,
      notes: uniqueStrings([
        ...entry.notes,
        "Selected for the first P0 expansion wave because coverage is already broad enough to draft family-specific parsing and scientific-background lanes.",
      ]),
    });
  }

  return {
    version: normalizedPackage.version,
    generated_at: normalizedPackage.generated_at,
    meta: {
      ...normalizedPackage.meta,
      wave_name: "nutri_minimal_v4_p0_expansion",
      selection_rules: [
        "Only include rows with mapping_status=new_family_candidate.",
        "Exclude rows with no_verified_refs_in_workbook from the first wave.",
        "Rank by forms_count, evidence_count, refs_count, and gap penalties.",
        "Cap any single category at 4 families to keep the wave balanced.",
      ],
      target_count: limit,
    },
    p0_expansion_wave: selected,
  };
};

const laneKeysForFullDefinition = (
  definition: NutriMinimalFullFamilyDefinition,
): string[] => Object.keys(buildFullFamilyLaneConfig(definition));

export const buildFullFamilyProductizationManifest = (
  normalizedPackage: NormalizedDatasetPackage,
  backlogEntries: FamilyExpansionBacklogEntry[],
): FullFamilyProductizationManifestArtifact => {
  const targetEntries = backlogEntries.filter(
    (entry) =>
      Boolean(
        getNutriMinimalDefinitionForSourceIngredient(
          entry.source_ingredient_id,
        ),
      ) ||
      entry.mapping_status === "new_family_candidate" ||
      entry.mapping_status === "unresolved_mapping",
  );
  const reviewStatusByFamily = new Map<string, ReviewStatus>();
  for (const definition of NUTRI_MINIMAL_FULL_FAMILY_DEFINITIONS) {
    reviewStatusByFamily.set(definition.canonicalFamily, "needs_edit");
  }

  const manifestRows = targetEntries.map((entry) => {
    const definition = getNutriMinimalDefinitionForSourceIngredient(
      entry.source_ingredient_id,
    );
    if (!definition) {
      return {
        source_ingredient_id: entry.source_ingredient_id,
        display_name: entry.display_name,
        canonical_family: null,
        original_mapping_status: entry.mapping_status,
        closure_decision: "reject_from_runtime_productization",
        productization_class: "high_risk_safety",
        safety_boundary_tier: "high",
        category: entry.category,
        pattern_keywords: [],
        runtime_lane_keys: [],
        evidence_review_status: "rejected",
        hard_boundary:
          "Hard boundary: no runtime productization without a canonical family definition.",
        notes: uniqueStrings([
          ...entry.notes,
          "Rejected from this closure because no deterministic full-family definition exists.",
        ]),
      } satisfies FullFamilyProductizationManifestRow;
    }

    return {
      source_ingredient_id: entry.source_ingredient_id,
      display_name: entry.display_name,
      canonical_family: definition.canonicalFamily,
      original_mapping_status: entry.mapping_status,
      closure_decision:
        definition.productizationClass === "crosswalk_rescue"
          ? "rescue_to_canonical_runtime_family"
          : "productize_runtime_family",
      productization_class: definition.productizationClass,
      safety_boundary_tier: definition.safetyBoundaryTier,
      category: entry.category,
      pattern_keywords: definition.patternKeywords,
      runtime_lane_keys: laneKeysForFullDefinition(definition),
      evidence_review_status:
        reviewStatusByFamily.get(definition.canonicalFamily) ?? "needs_edit",
      hard_boundary: definition.hardBoundary,
      notes: uniqueStrings([
        ...entry.notes,
        definition.productizationClass === "crosswalk_rescue"
          ? "Rescued into an explicit canonical runtime family with high-boundary evidence review."
          : "Productized for runtime inference; evidence promotion still requires approved LSR review.",
      ]),
    } satisfies FullFamilyProductizationManifestRow;
  });

  const summary = manifestRows.reduce(
    (acc, row) => {
      acc.input_rows += 1;
      if (row.closure_decision !== "reject_from_runtime_productization") {
        acc.productized_runtime_families += 1;
      } else {
        acc.rejected_from_runtime_productization += 1;
      }
      acc[row.productization_class] += 1;
      return acc;
    },
    {
      input_rows: 0,
      productized_runtime_families: 0,
      low_risk_structural: 0,
      high_risk_safety: 0,
      crosswalk_rescue: 0,
      rejected_from_runtime_productization: 0,
    },
  );

  return {
    version: normalizedPackage.version,
    generated_at: normalizedPackage.generated_at,
    meta: {
      ...normalizedPackage.meta,
      manifest_name: "nutri_minimal_v4_full_family_productization",
      scope: "remaining_new_family_candidates_plus_unresolved_rescue",
      source: "nutri-minimal-v4",
    },
    summary,
    full_family_productization_manifest: manifestRows.sort((left, right) =>
      left.source_ingredient_id.localeCompare(right.source_ingredient_id),
    ),
  };
};

export const buildP0ExpansionSectionPlanDrafts = (
  normalizedPackage: NormalizedDatasetPackage,
  backlogEntries: FamilyExpansionBacklogEntry[],
  limit = 15,
): P0ExpansionSectionPlanDraftArtifact => {
  const wave = buildP0ExpansionWave(normalizedPackage, backlogEntries, limit);
  const draftRows: P0ExpansionSectionPlanDraftRow[] =
    wave.p0_expansion_wave.map((row) => ({
      family: row.source_ingredient_id,
      source_ingredient_id: row.source_ingredient_id,
      display_name: row.display_name,
      category: row.category,
      implementation_priority: row.implementation_priority,
      wave_rank: row.wave_rank,
      wave_score: row.wave_score,
      pattern_keywords: row.pattern_keywords,
      section_plan_args: row.scientific_background_lanes.map((lane) => ({
        headingId: lane.lane_key,
        heading: lane.heading,
        intent: lane.intent,
        bulletThemes: buildSectionPlanBulletThemes(row, lane),
        evidenceGoal: lane.evidence_goal,
        shopperMeaningGoal: lane.shopper_meaning_goal,
      })),
      notes: row.notes,
    }));

  return {
    version: normalizedPackage.version,
    generated_at: normalizedPackage.generated_at,
    meta: {
      ...normalizedPackage.meta,
      source_wave: "nutri_minimal_v4_p0_expansion",
      draft_name: "nutri_minimal_v4_p0_section_plan_drafts",
      target_count: draftRows.length,
    },
    p0_expansion_section_plan_drafts: draftRows,
  };
};

export const buildPromptGroundingReviewQueue = (
  normalizedPackage: NormalizedDatasetPackage,
  backlogEntries: FamilyExpansionBacklogEntry[],
  laneConfigMap: ScientificLaneConfigMap,
): PromptGroundingReviewQueueArtifact => {
  const citationUsageById = new Map<
    string,
    Array<{
      mappedFamily: string | null;
      lane: string | null;
      ingredientId: string | null;
      formKey: string | null;
    }>
  >();
  const familyByIngredient = new Map(
    backlogEntries.map(
      (entry) => [entry.source_ingredient_id, entry.mapped_family] as const,
    ),
  );
  const forms = normalizedPackage.sheets.forms ?? [];
  const evidence = normalizedPackage.sheets.evidence ?? [];

  for (const row of forms) {
    const ingredientId = normalizeText(row.ingredient_id);
    const mappedFamily = ingredientId
      ? (familyByIngredient.get(ingredientId) ?? null)
      : null;
    const formKey = normalizeText(row.form_key);
    for (const referenceId of parseReferenceIds(row)) {
      const bucket = citationUsageById.get(referenceId) ?? [];
      bucket.push({ mappedFamily, lane: null, ingredientId, formKey });
      citationUsageById.set(referenceId, bucket);
    }
  }

  for (const row of evidence) {
    const ingredientId = normalizeText(row.ingredient_id);
    const mappedFamily = ingredientId
      ? (familyByIngredient.get(ingredientId) ?? null)
      : null;
    const lane = mappedFamily
      ? (Object.keys(laneConfigMap[mappedFamily] ?? {})[0] ?? null)
      : null;
    for (const referenceId of parseReferenceIds(row)) {
      const bucket = citationUsageById.get(referenceId) ?? [];
      bucket.push({ mappedFamily, lane, ingredientId, formKey: null });
      citationUsageById.set(referenceId, bucket);
    }
  }

  const reviewRows: PromptGroundingReviewRow[] = [];

  for (const row of normalizedPackage.sheets.evidence_excerpts ?? []) {
    const sourceId = normalizeText(row.excerpt_id);
    if (!sourceId) continue;
    const citationId = normalizeText(row.citation_id);
    const excerptText = normalizeText(row.excerpt_text);
    const captureStatus = normalizeKey(normalizeText(row.capture_status));
    const usages = citationId ? (citationUsageById.get(citationId) ?? []) : [];
    const firstUsage = usages[0] ?? null;
    const reasons: ReviewReason[] = [];
    let reviewStatus: ReviewStatus = "needs_edit";

    if (captureStatus !== "captured") {
      reviewStatus = "rejected";
      reasons.push("capture_not_complete");
    }
    if (!citationId) {
      reviewStatus = "rejected";
      reasons.push("missing_citation_id");
    }
    if (!excerptText) {
      reviewStatus = "rejected";
      reasons.push("missing_excerpt_text");
    }
    if (!usages.length) {
      if (reviewStatus !== "rejected") reviewStatus = "needs_edit";
      reasons.push("captured_excerpt_missing_linkage");
    }
    if (isUnsafeProse(excerptText)) {
      reviewStatus = "rejected";
      reasons.push("unsafe_prose_claim");
    }
    if (!reasons.length) {
      reviewStatus = "approved";
      reasons.push("approved_with_verified_pmids");
    }

    reviewRows.push({
      source_type: "evidence_excerpt",
      source_id: sourceId,
      review_status: reviewStatus,
      review_reasons: Array.from(new Set(reasons)),
      notes: excerptText
        ? [
            "Captured excerpt is eligible only if later promoted through reviewed evidence packaging.",
          ]
        : [],
      mapped_family: firstUsage?.mappedFamily ?? null,
      section_key: firstUsage?.lane ?? null,
      ingredient_id: firstUsage?.ingredientId ?? null,
      form_key: firstUsage?.formKey ?? null,
      citation_id: citationId,
      excerpt_text: excerptText,
    });
  }

  for (const row of normalizedPackage.sheets.curated_overrides_v4 ?? []) {
    const sourceId = normalizeText(row.override_id);
    if (!sourceId) continue;
    const ingredientId = normalizeText(row.ingredient_id);
    const mappedFamily = ingredientId
      ? (familyByIngredient.get(ingredientId) ?? null)
      : null;
    const formKey = normalizeText(row.form_key);
    const prose = uniqueStrings([
      normalizeText(row.absorption_en),
      normalizeText(row.tolerability_en),
      normalizeText(row.solubility_en),
      normalizeText(row.caveats_en),
    ]).join(" ");
    const reasons: ReviewReason[] = [];
    let reviewStatus: ReviewStatus = "needs_edit";

    if (!ingredientId || !formKey) {
      reviewStatus = "rejected";
      reasons.push("canonical_form_mapping_missing");
    }
    if (isUnsafeProse(prose)) {
      reviewStatus = "rejected";
      reasons.push("unsafe_prose_claim");
    }
    if (
      (normalizeKey(normalizeText(row.review_status)) || "") === "needs_edit"
    ) {
      reasons.push("variant_specificity_insufficient");
    }
    if (!reasons.length) {
      reviewStatus = "approved";
      reasons.push("approved_with_verified_pmids");
    }

    reviewRows.push({
      source_type: "curated_override",
      source_id: sourceId,
      review_status: reviewStatus,
      review_reasons: Array.from(new Set(reasons)),
      notes: prose
        ? [
            "Curated override remains staging-only until explicitly promoted into reviewed form explains.",
          ]
        : [],
      mapped_family: mappedFamily,
      section_key: null,
      ingredient_id: ingredientId,
      form_key: formKey,
      citation_id: null,
      excerpt_text: prose || null,
    });
  }

  return {
    version: normalizedPackage.version,
    generated_at: normalizedPackage.generated_at,
    meta: normalizedPackage.meta,
    prompt_grounding_review_queue: reviewRows.sort((left, right) => {
      const typeDelta = left.source_type.localeCompare(right.source_type);
      if (typeDelta !== 0) return typeDelta;
      return left.source_id.localeCompare(right.source_id);
    }),
  };
};

export const selectApprovedPromptGroundingRows = (
  artifact: PromptGroundingReviewQueueArtifact,
): PromptGroundingReviewRow[] =>
  artifact.prompt_grounding_review_queue.filter(
    (row) => row.review_status === "approved",
  );
