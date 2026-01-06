export type ScoreSource = "dsld" | "lnhpd" | "ocr" | "manual";

export type ScoreGoalFit = {
  goal: string;
  score: number;
  label?: string;
};

export type ScoreFlag = {
  code: string;
  message: string;
  severity?: "info" | "warning" | "risk";
};

export type ScoreHighlight = {
  code?: string;
  message: string;
};

export type ScoreBundleV4 = {
  overallScore: number | null;
  pillars: {
    effectiveness: number | null;
    safety: number | null;
    integrity: number | null;
  };
  confidence: number | null;
  bestFitGoals: ScoreGoalFit[];
  flags: ScoreFlag[];
  highlights: ScoreHighlight[];
  provenance: {
    source: ScoreSource;
    sourceId: string;
    canonicalSourceId: string | null;
    scoreVersion: string;
    computedAt: string;
    inputsHash: string | null;
    datasetVersion: string | null;
    extractedAt: string | null;
  };
  explain: Record<string, unknown> | null;
};

export type ScoreBundleResponse =
  | {
      status: "ok";
      source: ScoreSource;
      sourceId: string;
      bundle: ScoreBundleV4;
    }
  | {
      status: "pending";
      source: ScoreSource;
      sourceId: string;
    }
  | {
      status: "not_found";
      source: ScoreSource;
      sourceId: string;
    };
