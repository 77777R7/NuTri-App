const IHERB_IMAGE_HOST_PATTERN = /(^|\.)images-iherb\.com$/i;
const IHERB_CMS_BANNER_PATTERN = /\/images\/cms\//i;
const INTERNAL_RENDER_IMAGE_PATTERN =
  /\/overlay-label-assets\/(?:generated-fallback-cards|dsld-label-renders|manual-fallback-renders)\//i;
const INTERNAL_RENDER_FILENAME_PATTERN = /(?:^|[_-])render(?:s|ed)?(?:[_-]|\b)/i;

export const isInternalRenderImageUrl = (value: string): boolean =>
  INTERNAL_RENDER_IMAGE_PATTERN.test(value)
  || (/supabase\.co/i.test(value) && INTERNAL_RENDER_FILENAME_PATTERN.test(value))
  || /HAIR_GROWTH_RENDER/i.test(value);

export const isIherbImageUrl = (value: string | null | undefined): boolean => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return IHERB_IMAGE_HOST_PATTERN.test(parsed.hostname) && !IHERB_CMS_BANNER_PATTERN.test(parsed.pathname);
  } catch {
    return false;
  }
};

export const scorePreferredProductImageUrl = (value: string | null | undefined): number => {
  if (!value) return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return 0;
  }

  if (IHERB_IMAGE_HOST_PATTERN.test(parsed.hostname)) {
    if (IHERB_CMS_BANNER_PATTERN.test(parsed.pathname)) return 20;
    return 100;
  }

  if (isInternalRenderImageUrl(trimmed)) {
    return 0;
  }

  if (/^https?:$/i.test(parsed.protocol)) {
    return 70;
  }

  return 30;
};

export const choosePreferredProductImageUrl = (
  ...candidates: Array<string | null | undefined>
): string | null => {
  const ranked = candidates
    .map((candidate) => (typeof candidate === 'string' ? candidate.trim() : ''))
    .filter(Boolean)
    .map((candidate) => ({ candidate, score: scorePreferredProductImageUrl(candidate) }))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0];
  return best && best.score >= 50 ? best.candidate : null;
};
