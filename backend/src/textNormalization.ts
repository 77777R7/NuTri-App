const HYPHEN_LIKE_RE = /[\u2010-\u2015\u2212]/g;
const TRADEMARK_RE = /[™®]/g;
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

export const normalizeHumanText = (value: string): string =>
  value
    .replace(ZERO_WIDTH_RE, "")
    .replace(HYPHEN_LIKE_RE, "-")
    .replace(TRADEMARK_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeHumanTextForMatch = (value: string): string => normalizeHumanText(value).toLowerCase();
