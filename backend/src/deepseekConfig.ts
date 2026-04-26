export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

export const DEEPSEEK_NON_THINKING_MODE = {
  type: "disabled",
} as const;

const DEPRECATED_DEEPSEEK_FLASH_ALIASES = new Set([
  "deepseek-chat",
  "deepseek-reasoner",
]);

export const resolveDeepSeekModel = (value?: string | null): string => {
  const candidate = value?.trim();
  if (!candidate) return DEFAULT_DEEPSEEK_MODEL;
  if (DEPRECATED_DEEPSEEK_FLASH_ALIASES.has(candidate)) {
    return DEFAULT_DEEPSEEK_MODEL;
  }
  return candidate;
};
