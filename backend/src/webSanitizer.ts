export type SanitizedWebTextResult = {
  text: string;
  redactions: string[];
  injectionDetected: boolean;
};

export type SanitizeWebTextOptions = {
  maxChars?: number;
};

const DEFAULT_MAX_CHARS = 1200;

const INJECTION_PATTERNS: Array<{ code: string; re: RegExp }> = [
  { code: "prompt_injection_ignore_previous", re: /\bignore\s+(all\s+)?(previous|prior)\b/i },
  { code: "prompt_injection_system_prompt", re: /\bsystem\s+prompt\b/i },
  { code: "prompt_injection_developer_message", re: /\bdeveloper\s+message\b/i },
  { code: "prompt_injection_instructions", re: /\bfollow\s+these\s+instructions\b/i },
  { code: "prompt_injection_roleplay", re: /\bpretend\s+to\s+be\b/i },
];

const stripTagBlocks = (value: string): string =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

const stripHtmlTags = (value: string): string => value.replace(/<[^>]+>/g, " ");

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const stripControlChars = (value: string): string => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");

const trimRepeatedPunctuation = (value: string): string => value.replace(/([!?.,;:\-])\1{3,}/g, "$1$1$1");

const removeInjectionLines = (value: string): { text: string; redactions: string[]; injectionDetected: boolean } => {
  const lines = value.split(/\r?\n+/);
  const kept: string[] = [];
  const redactions = new Set<string>();
  let injectionDetected = false;

  for (const line of lines) {
    const normalized = normalizeWhitespace(line);
    if (!normalized) continue;

    let shouldDrop = false;
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.re.test(normalized)) {
        redactions.add(pattern.code);
        shouldDrop = true;
        injectionDetected = true;
      }
    }

    if (!shouldDrop) {
      kept.push(normalized);
    }
  }

  return {
    text: kept.join("\n"),
    redactions: [...redactions],
    injectionDetected,
  };
};

export const sanitizeWebText = (raw: string, options: SanitizeWebTextOptions = {}): SanitizedWebTextResult => {
  const maxChars = Number.isFinite(options.maxChars) && (options.maxChars ?? 0) > 0
    ? Math.floor(options.maxChars as number)
    : DEFAULT_MAX_CHARS;

  const base = typeof raw === "string" ? raw : "";
  const noTagBlocks = stripTagBlocks(base);
  const noTags = stripHtmlTags(noTagBlocks);
  const noControls = stripControlChars(noTags);
  const dedupPunctuation = trimRepeatedPunctuation(noControls);
  const { text: noInjection, redactions, injectionDetected } = removeInjectionLines(dedupPunctuation);
  const normalized = normalizeWhitespace(noInjection);
  const text = normalized.length > maxChars ? normalized.slice(0, maxChars).trim() : normalized;

  return {
    text,
    redactions,
    injectionDetected,
  };
};
