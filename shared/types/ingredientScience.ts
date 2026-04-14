export type IngredientOverviewBlock = {
  mode: "single_anchor" | "multi_anchor" | "blend_anchor";
  titleLine: string | null;
  paragraph1: string;
  paragraph2: string | null;
  compareHint: string | null;
};

export type ScientificBackgroundSection = {
  heading: string;
  summary: string;
  bullets: string[];
  evidenceRead: string;
  shopperMeaning: string | null;
};

export type ScientificBackgroundBlock = {
  mode: "research_mode" | "label_context_mode";
  selectedLabel: string;
  selectedDose: string | null;
  introLine: string | null;
  sections: ScientificBackgroundSection[];
  closingNote: string | null;
};

export type IngredientOverviewResponse = {
  status: "ok";
  digest: string;
  ingredientOverview: IngredientOverviewBlock;
  source: "api" | "fallback";
  fallbackUsed: boolean;
  promptVersion: string;
};

export type ScientificBackgroundResponse = {
  status: "ok";
  digest: string;
  scientificBackground: ScientificBackgroundBlock;
  source: "api" | "fallback";
  fallbackUsed: boolean;
  promptVersion: string;
  backgroundRefreshPending?: boolean;
  recommendedRetryAfterMs?: number;
};
