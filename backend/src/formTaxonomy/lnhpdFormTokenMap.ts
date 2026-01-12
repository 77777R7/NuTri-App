const normalizeToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9_]+/g, " ").trim();

const isValidToken = (value: string): boolean => {
  if (!value) return false;
  if (value.length <= 1) return false;
  if (/^\d+$/.test(value)) return false;
  return true;
};

type TokenRewrite = string | string[];

type TokenRewriteMap = Record<string, TokenRewrite>;

export const LNHPD_FORM_TOKEN_REWRITE: TokenRewriteMap = {
  rhizome: "root",
  tuber: "root",
  bulb: "root",
  seed: "seed",
  seeds: "seed",
  aerial_parts: ["whole", "plant"],
  aerial: ["whole", "plant"],
  herb: ["whole", "plant"],
  standardized: "std",
  standardised: "std",
  tincture: "extract",
  fluidextract: "extract",
  powdered: "powder",
  hydrochloride: "hcl",
  coq10: "ubiquinone",
  q10: "ubiquinone",
  ubidecarenone: "ubiquinone",
  ubiquinone: "ubiquinone",
};

const appendToken = (token: string, seen: Set<string>, output: string[]) => {
  const normalized = normalizeToken(token);
  if (!isValidToken(normalized)) return;
  if (seen.has(normalized)) return;
  seen.add(normalized);
  output.push(normalized);
};

export const canonicalizeLnhpdFormTokens = (tokens: string[]): string[] => {
  const output: string[] = [];
  const seen = new Set<string>();
  const coq10Aliases = new Set([
    "coenzyme q10",
    "coenzymeq10",
    "coq10",
    "ubidecarenone",
    "ubiquinone",
    "q10",
  ]);

  tokens.forEach((token) => {
    const normalized = normalizeToken(token);
    if (!normalized) return;
    if (coq10Aliases.has(normalized) || normalized.includes("coenzyme q10")) {
      appendToken("ubiquinone", seen, output);
      return;
    }
    normalized.split(/\s+/).forEach((part) => {
      if (!part) return;
      const rewrite = LNHPD_FORM_TOKEN_REWRITE[part] ?? part;
      const rewriteTokens = Array.isArray(rewrite) ? rewrite : [rewrite];
      rewriteTokens.forEach((rewriteToken) => appendToken(rewriteToken, seen, output));
    });
  });

  const cleaned: string[] = [];
  const cleanedSeen = new Set<string>();
  const dosagePattern = /^\d+(?:mg|mcg|g|iu|ml|cfu)$/;
  output.forEach((token) => {
    if (!token) return;
    if (token === "and" || token === "dhe") return;
    if (dosagePattern.test(token)) return;
    const normalized = normalizeToken(token);
    if (!isValidToken(normalized)) return;
    if (cleanedSeen.has(normalized)) return;
    cleanedSeen.add(normalized);
    cleaned.push(normalized);
  });

  return cleaned;
};

type ExplicitTokenRule = { pattern: RegExp; tokens: string[] };

const EXPLICIT_FORM_RULES: ExplicitTokenRule[] = [
  { pattern: /\bsodium ascorbate\b/, tokens: ["sodium_ascorbate"] },
  { pattern: /\bcalcium ascorbate\b/, tokens: ["calcium_ascorbate"] },
  { pattern: /\bascorbic acid\b/, tokens: ["ascorbic_acid"] },
  { pattern: /\bfolic acid\b/, tokens: ["folic_acid"] },
  { pattern: /\bmethylfolate\b/, tokens: ["5_mthf"] },
  { pattern: /\b5\s*mthf\b|\b5\s*-?\s*mthf\b/, tokens: ["5_mthf"] },
  { pattern: /\bmethylcobalamin\b/, tokens: ["methylcobalamin"] },
  { pattern: /\bcyanocobalamin\b/, tokens: ["cyanocobalamin"] },
  { pattern: /\bhydroxocobalamin\b/, tokens: ["hydroxocobalamin"] },
  { pattern: /\badenosylcobalamin\b/, tokens: ["adenosylcobalamin"] },
  { pattern: /\bcholecalciferol\b|\bvitamin d3\b|\bd3\b/, tokens: ["d3_cholecalciferol"] },
  { pattern: /\bergocalciferol\b|\bvitamin d2\b|\bd2\b/, tokens: ["d2_ergocalciferol"] },
  { pattern: /\bubiquinol\b/, tokens: ["ubiquinol"] },
  { pattern: /\bubiquinone\b|\bubidecarenone\b|\bcoq10\b|\bcoenzyme q10\b/, tokens: ["ubiquinone"] },
  {
    pattern: /\bpyridoxine\b.*\b(hydrochloride|hcl)\b/,
    tokens: ["pyridoxine_hcl"],
  },
  {
    pattern: /\bpyridoxal\b.*\bphosphate\b|\bp\s*-?\s*5\s*-?\s*p\b|\bp5p\b/,
    tokens: ["p5p"],
  },
  { pattern: /\bbisglycinate\b/, tokens: ["bisglycinate"] },
  { pattern: /\bglycinate\b/, tokens: ["glycinate"] },
  { pattern: /\bpicolinate\b/, tokens: ["picolinate"] },
  { pattern: /\bthreonate\b/, tokens: ["threonate"] },
  { pattern: /\bmalate\b/, tokens: ["malate"] },
  { pattern: /\bcitrate\b/, tokens: ["citrate"] },
  { pattern: /\bgluconate\b/, tokens: ["gluconate"] },
  { pattern: /\bsulphate\b|\bsulfate\b/, tokens: ["sulfate"] },
  { pattern: /\bcarbonate\b/, tokens: ["carbonate"] },
  { pattern: /\bchloride\b|\bhydrochloride\b|\bhcl\b/, tokens: ["chloride"] },
  { pattern: /\boxide\b/, tokens: ["oxide"] },
  { pattern: /\bphosphate\b/, tokens: ["phosphate"] },
  { pattern: /\btaurate\b/, tokens: ["taurate"] },
  { pattern: /\bchelate\b|\bchelated\b/, tokens: ["chelate"] },
  { pattern: /\bacetate\b/, tokens: ["acetate"] },
  { pattern: /\bsuccinate\b/, tokens: ["succinate"] },
];

export const extractExplicitFormTokens = (value: string): string[] => {
  const normalized = normalizeToken(value);
  if (!normalized) return [];
  const tokens: string[] = [];
  EXPLICIT_FORM_RULES.forEach((rule) => {
    if (!rule.pattern.test(normalized)) return;
    rule.tokens.forEach((token) => {
      if (!token) return;
      tokens.push(token);
    });
  });
  return tokens;
};

export const collectExplicitFormTokens = (sources: Array<string | null | undefined>): string[] => {
  const tokens: string[] = [];
  sources.forEach((source) => {
    if (!source || !source.trim()) return;
    tokens.push(...extractExplicitFormTokens(source));
  });
  if (!tokens.length) return [];
  return canonicalizeLnhpdFormTokens(tokens);
};
