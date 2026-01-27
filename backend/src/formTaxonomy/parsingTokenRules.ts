import { supabase } from "../supabase.js";
import { extractErrorMeta, withRetry } from "../supabaseRetry.js";
import {
  canonicalizeLnhpdFormTokens,
  extractExplicitFormTokens,
} from "./lnhpdFormTokenMap.js";

type NormalizationRuleRow = {
  pattern: string | null;
  replacement: string | null;
};

type TokenAliasRow = {
  token_raw: string | null;
  token_normalized: string | null;
  ingredient_id: string | null;
};

type GenericFormTokenRow = {
  token_raw: string | null;
  token_normalized: string | null;
};

type CompiledNormalizationRule = {
  pattern: RegExp;
  replacement: string;
};

type TokenMatcher = {
  pattern: RegExp;
  token: string;
};

export type ParsingTokenRules = {
  normalizationRules: CompiledNormalizationRule[];
  tokenMatchers: TokenMatcher[];
  formRawTokens: string[];
};

const EMPTY_RULES: ParsingTokenRules = {
  normalizationRules: [],
  tokenMatchers: [],
  formRawTokens: [],
};

let cachedRules: ParsingTokenRules | null = null;
let rulesPromise: Promise<ParsingTokenRules> | null = null;

const normalizeTokenText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9_]+/g, " ").trim();

export const normalizeFormText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const isValidToken = (value: string): boolean => {
  if (!value) return false;
  if (value.length <= 1) return false;
  if (/^\d+$/.test(value)) return false;
  return true;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildTokenPattern = (token: string): RegExp => {
  const escaped = escapeRegExp(token);
  const spaced = escaped.replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${spaced}\\b`, "i");
};

const compileNormalizationRules = (
  rows: NormalizationRuleRow[],
): CompiledNormalizationRule[] => {
  const rules: CompiledNormalizationRule[] = [];
  rows.forEach((row) => {
    const pattern = row.pattern?.trim() ?? "";
    const replacement = row.replacement?.trim() ?? "";
    if (!pattern || !replacement) return;
    try {
      rules.push({ pattern: new RegExp(pattern, "gi"), replacement });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[ParsingRules] Invalid normalization regex:", pattern, message);
    }
  });
  return rules;
};

const applyNormalizationRules = (
  value: string,
  rules: CompiledNormalizationRule[],
): string => {
  if (!rules.length) return value;
  let normalized = value;
  rules.forEach((rule) => {
    normalized = normalized.replace(rule.pattern, rule.replacement);
  });
  return normalized;
};

const addTokenMatcher = (
  matchToken: string,
  outputToken: string,
  tokenMatchers: TokenMatcher[],
  matcherKeys: Set<string>,
) => {
  const matchKey = normalizeTokenText(matchToken);
  const outputKey = normalizeTokenText(outputToken);
  if (!isValidToken(matchKey) || !isValidToken(outputKey)) return;
  const pattern = buildTokenPattern(matchKey);
  const matcherKey = `${outputKey}:${pattern.source}`;
  if (matcherKeys.has(matcherKey)) return;
  matcherKeys.add(matcherKey);
  tokenMatchers.push({ pattern, token: outputKey });
};

const addFormRawToken = (value: string, tokens: Set<string>) => {
  const normalized = normalizeFormText(value);
  if (!normalized || normalized.length <= 1) return;
  tokens.add(normalized);
};

const buildParsingTokenRules = (
  normalizationRows: NormalizationRuleRow[],
  tokenAliasRows: TokenAliasRow[],
  genericFormTokenRows: GenericFormTokenRow[],
): ParsingTokenRules => {
  const normalizationRules = compileNormalizationRules(normalizationRows);
  const tokenMatchers: TokenMatcher[] = [];
  const matcherKeys = new Set<string>();
  const formRawTokens = new Set<string>();

  const addTokenRow = (tokenRaw: string | null, tokenNormalized: string | null) => {
    if (!tokenRaw && !tokenNormalized) return;
    const normalizedToken = tokenNormalized ?? tokenRaw ?? "";
    if (!normalizedToken.trim()) return;
    if (tokenRaw) addFormRawToken(tokenRaw, formRawTokens);
    if (tokenNormalized) addFormRawToken(tokenNormalized, formRawTokens);
    if (tokenRaw) addTokenMatcher(tokenRaw, normalizedToken, tokenMatchers, matcherKeys);
    if (tokenNormalized) addTokenMatcher(tokenNormalized, normalizedToken, tokenMatchers, matcherKeys);
  };

  tokenAliasRows.forEach((row) => {
    if (row.ingredient_id) return;
    addTokenRow(row.token_raw, row.token_normalized);
  });

  genericFormTokenRows.forEach((row) => {
    addTokenRow(row.token_raw, row.token_normalized);
  });

  normalizationRows.forEach((row) => {
    const replacement = row.replacement ?? "";
    if (!replacement.trim()) return;
    addFormRawToken(replacement, formRawTokens);
    addTokenMatcher(replacement, replacement, tokenMatchers, matcherKeys);
  });

  return {
    normalizationRules,
    tokenMatchers,
    formRawTokens: Array.from(formRawTokens),
  };
};

export const loadParsingTokenRules = async (): Promise<ParsingTokenRules> => {
  if (cachedRules) return cachedRules;
  if (rulesPromise) return rulesPromise;

  rulesPromise = (async () => {
    try {
      const [normalizationRes, tokenAliasRes, genericRes] = await Promise.all([
        withRetry(() =>
          supabase.from("normalization_rules").select("pattern,replacement"),
        ),
        withRetry(() =>
          supabase
            .from("token_aliases")
            .select("token_raw,token_normalized,ingredient_id")
            .is("ingredient_id", null),
        ),
        withRetry(() =>
          supabase.from("generic_form_tokens").select("token_raw,token_normalized"),
        ),
      ]);

      if (normalizationRes.error) {
        const meta = extractErrorMeta(
          normalizationRes.error,
          normalizationRes.status,
          normalizationRes.rayId,
        );
        throw new Error(
          `[ParsingRules] normalization_rules fetch failed: ${meta.message ?? "unknown"}`,
        );
      }
      if (tokenAliasRes.error) {
        const meta = extractErrorMeta(
          tokenAliasRes.error,
          tokenAliasRes.status,
          tokenAliasRes.rayId,
        );
        throw new Error(
          `[ParsingRules] token_aliases fetch failed: ${meta.message ?? "unknown"}`,
        );
      }
      if (genericRes.error) {
        const meta = extractErrorMeta(
          genericRes.error,
          genericRes.status,
          genericRes.rayId,
        );
        throw new Error(
          `[ParsingRules] generic_form_tokens fetch failed: ${meta.message ?? "unknown"}`,
        );
      }

      const rules = buildParsingTokenRules(
        (normalizationRes.data ?? []) as NormalizationRuleRow[],
        (tokenAliasRes.data ?? []) as TokenAliasRow[],
        (genericRes.data ?? []) as GenericFormTokenRow[],
      );
      cachedRules = rules;
      return rules;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[ParsingRules] Falling back to static rules:", message);
      cachedRules = EMPTY_RULES;
      return EMPTY_RULES;
    }
  })();

  return rulesPromise;
};

export const extractExplicitFormTokensWithRules = (
  value: string,
  rules: ParsingTokenRules,
): string[] => {
  const tokens = new Set<string>();
  extractExplicitFormTokens(value).forEach((token) => tokens.add(token));
  if (!rules.tokenMatchers.length && !rules.normalizationRules.length) {
    return Array.from(tokens);
  }
  const normalized = normalizeTokenText(applyNormalizationRules(value, rules.normalizationRules));
  rules.tokenMatchers.forEach((matcher) => {
    if (matcher.pattern.test(normalized)) {
      tokens.add(matcher.token);
    }
  });
  return Array.from(tokens);
};

export const collectExplicitFormTokensWithRules = (
  sources: (string | null | undefined)[],
  rules: ParsingTokenRules,
): string[] => {
  const tokens: string[] = [];
  sources.forEach((source) => {
    if (!source || !source.trim()) return;
    tokens.push(...extractExplicitFormTokensWithRules(source, rules));
  });
  if (!tokens.length) return [];
  return canonicalizeLnhpdFormTokens(tokens);
};
