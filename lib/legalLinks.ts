import { Alert, Linking } from 'react-native';

export const PRIVACY_POLICY_URL = 'https://www.nutri.app/privacy';
export const TERMS_OF_SERVICE_URL = 'https://www.nutri.app/terms';
export const SUPPORT_EMAIL = 'support@nutri.app';

export const openExternalLegalLink = async (
  url: string,
  label: string,
): Promise<void> => {
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      throw new Error(`unsupported_url:${url}`);
    }
    await Linking.openURL(url);
  } catch (error) {
    console.warn(`[legal] failed to open ${label}`, error);
    Alert.alert(
      'Could not open link',
      `We could not open ${label}. Please try again in a moment.`,
    );
  }
};

export const openPrivacyPolicy = (): Promise<void> =>
  openExternalLegalLink(PRIVACY_POLICY_URL, 'Privacy Policy');

export const openTermsOfService = (): Promise<void> =>
  openExternalLegalLink(TERMS_OF_SERVICE_URL, 'Terms of Service');

export const buildAccountDeletionRequestUrl = (params: {
  email?: string | null;
  userId?: string | null;
}): string => {
  const subject = encodeURIComponent('NuTri account deletion request');
  const body = encodeURIComponent(
    [
      'Please delete my NuTri account and associated account data.',
      '',
      params.email ? `Account email: ${params.email}` : 'Account email: ',
      params.userId ? `User ID: ${params.userId}` : 'User ID: ',
      '',
      'I understand this request may remove saved scans, profile answers, and subscription-linked app data where applicable.',
    ].join('\n'),
  );

  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
};

export const openAccountDeletionRequest = (params: {
  email?: string | null;
  userId?: string | null;
}): Promise<void> =>
  openExternalLegalLink(
    buildAccountDeletionRequestUrl(params),
    'account deletion request',
  );

export const openSupportEmail = (): Promise<void> =>
  openExternalLegalLink(`mailto:${SUPPORT_EMAIL}`, 'support email');
