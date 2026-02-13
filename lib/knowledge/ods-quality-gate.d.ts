export type SanitizedOdsOverview = {
  text: string;
  source: "ods" | "curated";
  rejected: boolean;
};

export declare const normalizeOdsText: (input: unknown) => string;
export declare const isLowQualityOdsOverview: (input: unknown) => boolean;
export declare const isLowQualityOdsBullet: (input: unknown) => boolean;
export declare const sanitizeOdsOverview: (input: unknown, fallback: unknown) => SanitizedOdsOverview;
export declare const sanitizeOdsBullets: (inputList: unknown, maxCount?: number) => string[];
