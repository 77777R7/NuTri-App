import type { ProfileDraft } from '../../types/onboarding';

export type ProfileStatusState =
  | 'connected'
  | 'preview'
  | 'enabled'
  | 'off'
  | 'allowed'
  | 'denied'
  | 'accepted'
  | 'pending'
  | 'not_set'
  | 'local_only'
  | 'soon';

export type ProfileSnapshotId = 'goals' | 'experience' | 'diet' | 'region';
export type ProfileStatusId =
  | 'biometric'
  | 'notifications'
  | 'photos'
  | 'consent'
  | 'sync'
  | 'help'
  | 'tools';

export type ProfileHeroModel = {
  displayName: string;
  secondaryText: string;
  initials: string;
  overviewState: Extract<ProfileStatusState, 'connected' | 'preview'>;
};

export type ProfileSnapshotItem = {
  id: ProfileSnapshotId;
  value: string | null;
};

export type ProfileStatusItem = {
  id: ProfileStatusId;
  state: ProfileStatusState;
};

export type ProfileChip = {
  id: string;
  label: string;
  preview: boolean;
};

export type ProfileScreenModel = {
  hero: ProfileHeroModel;
  snapshot: ProfileSnapshotItem[];
  personalization: {
    chips: ProfileChip[];
  };
  preferences: ProfileStatusItem[];
  accountData: ProfileStatusItem[];
};

type ProfileUserLike = {
  email?: string | null;
} | null;

type BuildProfileScreenModelInput = {
  user: ProfileUserLike;
  draft: ProfileDraft | null;
  isBiometricEnabled: boolean;
};

const PREVIEW_CHIPS = ['Daily routine', 'Immune support', 'Label clarity'];

const normalizeText = (value?: string | null): string | null => {
  if (typeof value !== 'string') return null;
  const next = value.trim();
  return next.length > 0 ? next : null;
};

const uniqueStrings = (values: (string | null | undefined)[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach(value => {
    const normalized = normalizeText(value);
    if (!normalized) return;
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    result.push(normalized);
  });

  return result;
};

const formatSummary = (
  values?: string[] | null,
  maxItems = 2,
  options?: { showOverflowCount?: boolean },
) => {
  const items = uniqueStrings(values ?? []);
  if (!items.length) return null;
  if (items.length <= maxItems) return items.join(', ');

  const visible = items.slice(0, maxItems).join(', ');
  if (!options?.showOverflowCount) return visible;
  return `${visible} +${items.length - maxItems} more`;
};

const formatRegion = (draft: ProfileDraft | null) => {
  const city = normalizeText(draft?.location?.city);
  const country = normalizeText(draft?.location?.country);

  if (city && country) return `${city}, ${country}`;
  if (country) return country;
  if (city) return city;
  return null;
};

const formatDisplayName = (email?: string | null) => {
  const localPart = normalizeText(email?.split('@')[0] ?? null);
  if (!localPart) return 'NuTri Member';

  const words = localPart
    .replace(/[._-]+/g, ' ')
    .split(/\s+/)
    .map(token => token.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean)
    .map(token => token[0].toUpperCase() + token.slice(1).toLowerCase());

  if (!words.length) return 'NuTri Member';
  return words.join(' ');
};

const formatInitials = (displayName: string, email?: string | null) => {
  if (displayName === 'NuTri Member') {
    return 'N';
  }

  const nameLetters = displayName
    .split(/\s+/)
    .map(token => token.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map(token => token[0]?.toUpperCase() ?? '')
    .join('');

  if (nameLetters) return nameLetters;

  const localPart = normalizeText(email?.split('@')[0] ?? null);
  if (localPart) {
    const compact = localPart.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase();
    if (compact) return compact;
  }

  return 'N';
};

const buildPersonalizationChips = (draft: ProfileDraft | null): ProfileChip[] => {
  const realValues = uniqueStrings([...(draft?.goals ?? []), ...(draft?.preferredTypes ?? [])]).slice(0, 5);

  if (realValues.length) {
    return realValues.map(label => ({
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      label,
      preview: false,
    }));
  }

  return PREVIEW_CHIPS.map(label => ({
    id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label,
    preview: true,
  }));
};

export function buildProfileScreenModel({
  user,
  draft,
  isBiometricEnabled,
}: BuildProfileScreenModelInput): ProfileScreenModel {
  const displayName = formatDisplayName(user?.email ?? null);
  const email = normalizeText(user?.email ?? null);
  const hasPrivacyConfig = typeof draft?.privacy?.agreed === 'boolean';

  return {
    hero: {
      displayName,
      secondaryText: email ?? 'Local profile preview',
      initials: formatInitials(displayName, email),
      overviewState: user ? 'connected' : 'preview',
    },
    snapshot: [
      { id: 'goals', value: formatSummary(draft?.goals, 3, { showOverflowCount: true }) },
      { id: 'experience', value: normalizeText(draft?.supplementExperience) },
      { id: 'diet', value: formatSummary(draft?.diets, 2) },
      { id: 'region', value: formatRegion(draft) },
    ],
    personalization: {
      chips: buildPersonalizationChips(draft),
    },
    preferences: [
      { id: 'biometric', state: isBiometricEnabled ? 'enabled' : 'off' },
      {
        id: 'notifications',
        state:
          draft?.permissionPreferences?.notifications === true
            ? 'allowed'
            : draft?.permissionPreferences?.notifications === false
              ? 'denied'
              : 'not_set',
      },
      {
        id: 'photos',
        state:
          draft?.permissionPreferences?.photos === true
            ? 'allowed'
            : draft?.permissionPreferences?.photos === false
              ? 'denied'
              : 'not_set',
      },
      {
        id: 'consent',
        state: draft?.privacy?.agreed === true ? 'accepted' : hasPrivacyConfig ? 'pending' : 'not_set',
      },
    ],
    accountData: [
      { id: 'sync', state: user ? 'connected' : 'local_only' },
      { id: 'help', state: 'soon' },
      { id: 'tools', state: 'soon' },
    ],
  };
}
