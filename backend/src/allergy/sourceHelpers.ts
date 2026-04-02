const normalizeWhitespace = (value: string): string =>
  value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

export const normalizeMatchText = (value: string | null | undefined): string =>
  normalizeWhitespace(String(value ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const toObjectRecord = (
  value: unknown,
): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

export const pickFirstValue = (
  record: Record<string, unknown>,
  keys: string[],
): unknown => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }

  const lowered = new Map<string, unknown>();
  Object.entries(record).forEach(([key, value]) => {
    lowered.set(key.toLowerCase(), value);
  });

  for (const key of keys) {
    const value = lowered.get(key.toLowerCase());
    if (value !== undefined) return value;
  }

  return undefined;
};

export const pickStringField = (
  record: Record<string, unknown>,
  keys: string[],
): string | null => {
  const raw = pickFirstValue(record, keys);
  if (typeof raw !== "string") return null;
  const normalized = normalizeWhitespace(raw);
  return normalized.length > 0 ? normalized : null;
};

export const splitLooseTextList = (value: string | null | undefined): string[] =>
  String(value ?? "")
    .split(/\r?\n|;|•|\u2022|\|/g)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);

export const coerceJsonListPayload = (
  payload: unknown,
  hintKeys: string[],
): unknown[] => {
  if (payload == null) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload === "string") {
    const items = splitLooseTextList(payload);
    return items.length > 0 ? items : [];
  }

  const record = toObjectRecord(payload);
  if (!record) return [];

  const values = Object.values(record);
  if (values.every((value) => value && typeof value === "object")) {
    const items = values.filter((value): value is Record<string, unknown> => {
      const nested = toObjectRecord(value);
      if (!nested) return false;
      const keys = new Set(Object.keys(nested).map((key) => key.toLowerCase()));
      return hintKeys.some((key) => keys.has(key.toLowerCase()));
    });
    if (items.length > 0) return items;
  }

  const ownKeys = new Set(Object.keys(record).map((key) => key.toLowerCase()));
  if (hintKeys.some((key) => ownKeys.has(key.toLowerCase()))) {
    return [record];
  }

  return [];
};

export const extractTextList = (
  payload: unknown,
  nameKeys: string[],
): string[] => {
  const items = coerceJsonListPayload(payload, nameKeys);
  const seen = new Set<string>();
  const extracted: string[] = [];

  items.forEach((item) => {
    if (typeof item === "string") {
      splitLooseTextList(item).forEach((entry) => {
        const normalized = normalizeMatchText(entry);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        extracted.push(entry);
      });
      return;
    }

    const record = toObjectRecord(item);
    if (!record) return;
    const name = pickStringField(record, nameKeys);
    if (!name) return;
    const normalized = normalizeMatchText(name);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    extracted.push(name);
  });

  return extracted;
};

export const extractTextSections = (
  payload: unknown,
): Array<{ heading: string; text: string }> => {
  const record = toObjectRecord(payload);
  if (!record) return [];

  return Object.entries(record)
    .map(([heading, text]) => {
      if (typeof text !== "string") return null;
      const normalizedText = normalizeWhitespace(text);
      if (!normalizedText) return null;
      return {
        heading: normalizeWhitespace(heading),
        text: normalizedText,
      };
    })
    .filter((item): item is { heading: string; text: string } => Boolean(item));
};
