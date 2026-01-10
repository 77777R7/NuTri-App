const normalizeToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

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

  tokens.forEach((token) => {
    const normalized = normalizeToken(token);
    if (!normalized) return;
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
