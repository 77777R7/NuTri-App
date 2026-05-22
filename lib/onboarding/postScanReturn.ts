export const POST_SCAN_MODE = 'post_scan';
export const PERSONALIZED_GUIDE_APPLIED = 'applied';

const SCAN_RESULT_PATH = '/scan/result';

const decodeMaybe = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const isPostScanMode = (value: unknown) =>
  typeof value === 'string' && value === POST_SCAN_MODE;

export const sanitizePostScanReturnTo = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = decodeMaybe(value).trim();

  if (!trimmed || trimmed.startsWith('//') || /[\r\n]/.test(trimmed)) {
    return null;
  }

  const queryStart = trimmed.indexOf('?');
  const pathname = queryStart >= 0 ? trimmed.slice(0, queryStart) : trimmed;
  if (pathname !== SCAN_RESULT_PATH) return null;

  return trimmed;
};

export const appendPersonalizedGuideApplied = (returnTo: string) => {
  const safeReturnTo = sanitizePostScanReturnTo(returnTo);
  if (!safeReturnTo) return null;

  const cleaned = safeReturnTo
    .replace(/([?&])personalizedGuide=[^&]*&?/g, '$1')
    .replace(/[?&]$/, '');
  const separator = cleaned.includes('?') ? '&' : '?';
  return `${cleaned}${separator}personalizedGuide=${PERSONALIZED_GUIDE_APPLIED}`;
};

export const buildScanResultReturnTo = ({
  sessionId,
  source,
  guestScanSessionId,
  devBarcode,
  resumeAction,
}: {
  sessionId: string;
  source?: string | null;
  guestScanSessionId?: string | null;
  devBarcode?: string | null;
  resumeAction?: string | null;
}) => {
  const params = [
    `sessionId=${encodeURIComponent(sessionId)}`,
    `source=${encodeURIComponent(source?.trim() || 'scan_result')}`,
    guestScanSessionId
      ? `guestScanSessionId=${encodeURIComponent(guestScanSessionId)}`
      : null,
    devBarcode ? `devBarcode=${encodeURIComponent(devBarcode)}` : null,
    resumeAction ? `resumeAction=${encodeURIComponent(resumeAction)}` : null,
  ].filter((item): item is string => Boolean(item));

  return `${SCAN_RESULT_PATH}?${params.join('&')}`;
};

export const getLegacyOnboardingRedirect = (returnTo: unknown) => {
  const safeReturnTo = sanitizePostScanReturnTo(returnTo);
  if (!safeReturnTo) return '/onboarding?step=goals';

  return appendPersonalizedGuideApplied(safeReturnTo) ?? '/onboarding?step=goals';
};
