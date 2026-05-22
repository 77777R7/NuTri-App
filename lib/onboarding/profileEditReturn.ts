export const PROFILE_EDIT_MODE = 'profile_edit';

const PROFILE_PATH = '/main/Home-Page';

const decodeMaybe = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const isProfileEditMode = (value: unknown) =>
  typeof value === 'string' && value === PROFILE_EDIT_MODE;

export const sanitizeProfileEditReturnTo = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = decodeMaybe(value).trim();

  if (!trimmed || trimmed.startsWith('//') || /[\r\n]/.test(trimmed)) {
    return null;
  }

  const queryStart = trimmed.indexOf('?');
  const pathname = queryStart >= 0 ? trimmed.slice(0, queryStart) : trimmed;
  if (pathname !== PROFILE_PATH) return null;

  return trimmed;
};
