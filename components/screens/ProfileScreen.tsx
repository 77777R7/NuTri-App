import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {
  AlertCircle,
  ChevronRight,
  Clock3,
  FileText,
  Leaf,
  LifeBuoy,
  LogOut,
  Mail,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target,
  Trash2,
  type LucideIcon,
} from 'lucide-react-native';
import React, { useCallback, useMemo } from 'react';

import { ContentFrame } from '@/components/common/ContentFrame';
import { useAuth } from '@/contexts/AuthContext';
import { useDailyCheckIns } from '@/contexts/DailyCheckInContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useSavedSupplements } from '@/contexts/SavedSupplementsContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useFirstScanReveal } from '@/hooks/useFirstScanReveal';
import { useScreenTokens } from '@/hooks/useScreenTokens';
import { validateCheckInDateForItem } from '@/lib/check-in-eligibility';
import { buildCheckInKey, getLocalDateKey } from '@/lib/check-ins';
import { useTranslation } from '@/lib/i18n';
import {
  FREE_SAVED_SUPPLEMENT_LIMIT,
  FREE_SCAN_LIMIT,
  type OfficialPaywallSource,
} from '@/lib/pro/featureGates';
import {
  openAccountDeletionRequest,
  openPrivacyPolicy,
  openSupportEmail,
  openTermsOfService,
} from '@/lib/legalLinks';
import { buildProfileScreenModel } from '@/lib/profile/viewModel';
import type { ProfileDraft } from '@/types/onboarding';

const SCREEN_BG = '#fafafa';
const CARD_BG = '#ffffff';
const TEXT = '#101828';
const MUTED = '#6a7282';
const SOFT_BORDER = '#f3f4f6';
const PROFILE_AVATAR = require('@/assets/images/profile/sarah-jenkins.jpg');
const PRO_CARD_BG = require('@/assets/images/profile/pro-card-sky.png');
const SERIF_FONT = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
});

export type ProfileScreenProps = {
  navHeight: number;
};

type AnswerChip = {
  id: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
};

const allergyLabelMap: Record<string, string> = {
  milk: 'No Dairy',
  egg: 'No Egg',
  fish: 'No Fish',
  shellfish: 'No Shellfish',
  tree_nuts: 'No Tree Nuts',
  peanuts: 'No Peanuts',
  wheat: 'No Wheat',
  soy: 'No Soy',
  sesame: 'No Sesame',
  gluten: 'No Gluten',
  gelatin_animal_based: 'No Gelatin',
  'No known allergies': 'No known allergies',
};

const normalizeChipId = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const cleanText = (value?: string | null) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
};

const uniqueValues = (values: (string | null | undefined)[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach(value => {
    const normalized = cleanText(value);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });

  return result;
};

const labelForAvoidItem = (value: string) => allergyLabelMap[value] ?? allergyLabelMap[value.toLowerCase()] ?? `Avoid ${value}`;

const buildAnswerChips = (draft: ProfileDraft | null): AnswerChip[] => {
  const goal = cleanText(draft?.goals?.[0]);
  const avoid =
    draft?.noKnownAllergies
      ? 'No known allergies'
      : cleanText(draft?.avoidItems?.[0])
        ?? cleanText(draft?.allergyFlags?.[0])
        ?? cleanText(draft?.ingredientRestrictions?.[0]);
  const diet = cleanText(draft?.diets?.[0]);
  const timing =
    cleanText(draft?.smartFilterConfig?.preselectedTiming?.[0])
    ?? cleanText(draft?.setupPreferences?.[0]);

  return uniqueValues([
    goal,
    avoid ? labelForAvoidItem(avoid) : null,
    diet,
    timing,
  ]).slice(0, 5).map((label, index) => {
    const icon = index === 0 ? Target : index === 1 ? AlertCircle : index === 2 ? Leaf : Clock3;
    return {
      id: normalizeChipId(label) || `answer-${index}`,
      label,
      icon,
      active: index === 2,
    };
  });
};

const getAppVersionLabel = () => {
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const buildNumber = Platform.OS === 'ios'
    ? Constants.expoConfig?.ios?.buildNumber
    : Constants.expoConfig?.android?.versionCode;

  return buildNumber ? `${version} (Build ${buildNumber})` : version;
};

export default function ProfileScreen({ navHeight }: ProfileScreenProps) {
  const { user, isBiometricEnabled, signOut } = useAuth();
  const { draft } = useOnboarding();
  const { savedSupplements } = useSavedSupplements();
  const { checkInsByDate } = useDailyCheckIns();
  const subscription = useSubscription();
  const firstScanReveal = useFirstScanReveal();
  const router = useRouter();
  const { t } = useTranslation();
  const tokens = useScreenTokens(navHeight);

  const model = useMemo(
    () => buildProfileScreenModel({ user, draft, isBiometricEnabled }),
    [draft, isBiometricEnabled, user],
  );
  const displayName = useMemo(() => {
    const metadataName = cleanText(user?.user_metadata?.full_name as string | undefined);
    return metadataName ?? model.hero.displayName;
  }, [model.hero.displayName, user?.user_metadata?.full_name]);
  const email = cleanText(user?.email) ?? model.hero.secondaryText;
  const isPro = subscription.isPremium;
  const answerChips = useMemo(() => buildAnswerChips(draft), [draft]);

  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);
  const checkInTargets = useMemo(
    () =>
      savedSupplements.filter(item =>
        validateCheckInDateForItem(item, todayKey, todayKey).isValid,
      ),
    [savedSupplements, todayKey],
  );
  const completedToday = useMemo(() => {
    const checkedKeys = new Set(checkInsByDate[todayKey] ?? []);
    return checkInTargets.reduce((count, item) => {
      const key = buildCheckInKey({ supplementId: item.supplementId, localId: item.id });
      return checkedKeys.has(key) ? count + 1 : count;
    }, 0);
  }, [checkInTargets, checkInsByDate, todayKey]);

  const checkInStatus = useMemo(() => {
    if (savedSupplements.length === 0) return 'Save a supplement to start';
    if (checkInTargets.length === 0) return 'Nothing scheduled today';
    if (completedToday === checkInTargets.length) return 'Completed today';
    return `${completedToday}/${checkInTargets.length} completed today`;
  }, [checkInTargets.length, completedToday, savedSupplements.length]);

  const freePlanLine = firstScanReveal.firstCompletedScanId
    ? 'Free scan used'
    : `${FREE_SCAN_LIMIT} free scan included`;
  const savedLimitLine = isPro
    ? `${savedSupplements.length} saved`
    : `${savedSupplements.length}/${FREE_SAVED_SUPPLEMENT_LIMIT} saved on Free`;
  const stackSafetyLine = savedSupplements.length >= 2
    ? isPro
      ? 'Ready to check overlaps'
      : 'Pro safety check available'
    : 'Add 2 supplements to check';

  const openPaywall = useCallback(
    (source: OfficialPaywallSource) => {
      router.push({
        pathname: '/paywall/official',
        params: {
          source,
          returnTo: '/main/Home-Page?tab=profile',
        },
      });
    },
    [router],
  );

  const openSavedTab = useCallback(() => {
    router.push({
      pathname: '/main/Home-Page',
      params: { tab: 'saved' },
    });
  }, [router]);

  const openHomeTab = useCallback(() => {
    router.push({
      pathname: '/main/Home-Page',
      params: { tab: 'home' },
    });
  }, [router]);

  const handleEditAnswers = useCallback(() => {
    router.push({
      pathname: '/onboarding/goals',
      params: {
        mode: 'profile_edit',
        returnTo: '/main/Home-Page?tab=profile',
      },
    });
  }, [router]);

  const handleRestorePurchases = useCallback(async () => {
    const result = await subscription.restorePurchases();
    Alert.alert(
      result.ok ? 'Purchases restored' : 'No active purchase found',
      result.ok
        ? 'Your NuTri Pro access is up to date.'
        : result.message ?? 'We could not find an active NuTri Pro purchase for this account.',
    );
  }, [subscription]);

  const handleSignOut = useCallback(() => {
    Alert.alert('Sign out?', 'You can sign back in anytime.', [
      { text: t.profileCancelAction, style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  }, [signOut, t.profileCancelAction]);

  const handleDeleteAccountPress = useCallback(() => {
    Alert.alert(
      t.profileDeleteAccountTitle,
      t.profileDeleteAccountConfirm,
      [
        { text: t.profileCancelAction, style: 'cancel' },
        {
          text: t.profileDeleteAccountAction,
          style: 'destructive',
          onPress: () => {
            void openAccountDeletionRequest({
              email: user?.email ?? null,
              userId: user?.id ?? null,
            });
          },
        },
      ],
    );
  }, [t, user?.email, user?.id]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: tokens.contentTopPadding, bottom: tokens.contentBottomPadding }}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: tokens.contentTopPadding,
            paddingBottom: tokens.contentBottomPadding + 72,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ContentFrame navHeight={navHeight}>
          <View style={styles.headerBlock}>
            <Text
              style={[styles.headerTitle, { fontSize: tokens.h1Size, lineHeight: tokens.h1Line }]}
              maxFontSizeMultiplier={1.2}
            >
              Profile
            </Text>

            <View style={styles.identityRow}>
              <Image source={PROFILE_AVATAR} contentFit="cover" style={styles.avatar} />

              <View style={styles.identityCopy}>
                <Text style={styles.displayName} numberOfLines={1}>
                  {displayName}
                </Text>
                <Text style={styles.emailText} numberOfLines={1} selectable>
                  {email}
                </Text>
                <View style={[styles.planBadge, isPro ? styles.planBadgePro : styles.planBadgeFree]}>
                  <Text style={[styles.planBadgeText, isPro ? styles.planBadgeTextPro : styles.planBadgeTextFree]}>
                    {isPro ? 'NuTri Pro' : 'Free Plan'}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {isPro ? (
            <View style={[styles.proCard, styles.cardShadow]}>
              <Image source={PRO_CARD_BG} contentFit="cover" style={styles.proCardImage} />
              <View style={styles.proCardOverlay} />
              <View style={styles.proCardHeader}>
                <Text style={styles.proCardTitle}>NuTri Pro</Text>
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>ACTIVE</Text>
                </View>
              </View>
              <Text style={styles.proCardBody}>
                Unlimited scans, search, and stack safety are unlocked.
              </Text>
            </View>
          ) : (
            <View style={[styles.freePlanCard, styles.cardShadow]}>
              <View style={styles.freePlanCopy}>
                <Text style={styles.freePlanTitle}>Free plan</Text>
                <Text style={styles.freePlanText}>{freePlanLine}</Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.88}
                style={styles.upgradeButton}
                onPress={() => openPaywall('profile_upgrade')}
                accessibilityRole="button"
              >
                <Sparkles size={17} color="#ffffff" strokeWidth={2.4} />
                <Text style={styles.upgradeButtonText}>Upgrade</Text>
              </TouchableOpacity>
            </View>
          )}

          <SectionHeader title="Your Answers" action="Edit" onActionPress={handleEditAnswers} />
          <View style={[styles.answerCard, styles.cardShadow]}>
            {answerChips.length > 0 ? (
              <View style={styles.answerChipWrap}>
                {answerChips.map(chip => (
                  <AnswerChipView key={chip.id} chip={chip} />
                ))}
              </View>
            ) : (
              <View style={styles.emptyAnswers}>
                <Text style={styles.emptyAnswersTitle}>No answers yet</Text>
                <Text style={styles.emptyAnswersText}>
                  Add a goal and avoid list so scan results can explain fit more clearly.
                </Text>
              </View>
            )}
          </View>

          <SectionHeader title="My Stack & Tracking" />
          <View style={[styles.listCard, styles.cardShadow]}>
            <ProfileRow
              icon={Target}
              title="Saved supplements"
              subtitle={savedLimitLine}
              actionLabel="View"
              onPress={openSavedTab}
            />
            <ProfileRow
              icon={Clock3}
              title="Daily Check-in"
              subtitle={checkInStatus}
              subtitleTone={completedToday > 0 ? 'blue' : 'muted'}
              onPress={openHomeTab}
              separated
            />
            <ProfileRow
              icon={ShieldCheck}
              title="Stack Safety"
              subtitle={stackSafetyLine}
              subtitleTone={savedSupplements.length >= 2 && isPro ? 'green' : 'muted'}
              onPress={() => (isPro ? openSavedTab() : openPaywall('stack_safety'))}
              separated
            />
          </View>

          <SectionHeader title="Account & Data" />
          <View style={[styles.listCard, styles.cardShadow]}>
            <View style={styles.emailRow}>
              <Mail size={18} color="#99a1af" strokeWidth={2.1} />
              <View style={styles.emailCopy}>
                <Text style={styles.emailRowTitle} selectable numberOfLines={1}>
                  {cleanText(user?.email) ?? 'Not signed in'}
                </Text>
                <Text style={styles.emailRowSubtitle}>
                  Used only to personalize your results.
                </Text>
              </View>
            </View>
            <ProfileRow
              icon={ShieldCheck}
              title="Privacy Policy"
              onPress={() => {
                void openPrivacyPolicy();
              }}
              accessibilityRole="link"
              iconFrame="plain"
              separated
            />
            <ProfileRow
              icon={FileText}
              title="Terms of Service"
              onPress={() => {
                void openTermsOfService();
              }}
              accessibilityRole="link"
              iconFrame="plain"
              separated
            />
          </View>

          <SectionHeader title="Support" />
          <View style={[styles.listCard, styles.cardShadow]}>
            <ProfileRow
              icon={LifeBuoy}
              title="Contact us"
              onPress={() => {
                void openSupportEmail();
              }}
              iconFrame="plain"
              separated={false}
            />
            <ProfileRow
              icon={RotateCcw}
              title={subscription.restoreBusy ? 'Restoring...' : 'Restore purchases'}
              onPress={subscription.restoreBusy ? undefined : handleRestorePurchases}
              iconFrame="plain"
              separated
            />
            <View style={[styles.staticRow, styles.rowSeparator]}>
              <View style={styles.rowLeft}>
                <Smartphone size={18} color="#99a1af" strokeWidth={2.1} />
                <Text style={styles.staticRowTitle}>App version</Text>
              </View>
              <Text style={styles.versionText}>{getAppVersionLabel()}</Text>
            </View>
          </View>

          <View style={[styles.listCard, styles.cardShadow, styles.dangerCard]}>
            {user ? (
              <ProfileRow
                icon={LogOut}
                title="Sign out"
                onPress={handleSignOut}
                iconFrame="plain"
              />
            ) : null}
            <ProfileRow
              icon={Trash2}
              title={t.profileDeleteAccountAction}
              onPress={handleDeleteAccountPress}
              destructive
              iconFrame="plain"
              separated={Boolean(user)}
            />
          </View>
        </ContentFrame>
      </ScrollView>
    </View>
  );
}

function SectionHeader({
  title,
  action,
  onActionPress,
}: {
  title: string;
  action?: string;
  onActionPress?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && onActionPress ? (
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={onActionPress}
          accessibilityRole="button"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.sectionAction}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function AnswerChipView({ chip }: { chip: AnswerChip }) {
  const Icon = chip.icon;
  return (
    <View style={[styles.answerChip, chip.active ? styles.answerChipActive : null]}>
      <Icon
        size={16}
        color={chip.active ? '#ffffff' : '#9ca3af'}
        strokeWidth={2.15}
      />
      <Text style={[styles.answerChipText, chip.active ? styles.answerChipTextActive : null]}>
        {chip.label}
      </Text>
    </View>
  );
}

function ProfileRow({
  icon: Icon,
  title,
  subtitle,
  subtitleTone = 'muted',
  actionLabel,
  onPress,
  separated = false,
  destructive = false,
  accessibilityRole = 'button',
  iconFrame = 'circle',
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  subtitleTone?: 'muted' | 'blue' | 'green';
  actionLabel?: string;
  onPress?: () => void;
  separated?: boolean;
  destructive?: boolean;
  accessibilityRole?: 'button' | 'link';
  iconFrame?: 'circle' | 'plain';
}) {
  const iconColor = destructive
    ? '#dc2626'
    : subtitleTone === 'green'
      ? '#00a63e'
      : iconFrame === 'plain'
        ? '#99a1af'
        : '#64748b';

  const content = (
    <>
      <View style={styles.rowLeft}>
        {iconFrame === 'plain' ? (
          <Icon
            size={18}
            color={iconColor}
            strokeWidth={2.15}
          />
        ) : (
          <View
            style={[
              styles.rowIconWrap,
              subtitleTone === 'green' ? styles.rowIconGreen : null,
              destructive ? styles.rowIconDanger : null,
            ]}
          >
            <Icon
              size={18}
              color={iconColor}
              strokeWidth={2.15}
            />
          </View>
        )}
        <View style={styles.rowCopy}>
          <Text style={[styles.rowTitle, destructive ? styles.rowTitleDanger : null]}>{title}</Text>
          {subtitle ? (
            <Text
              style={[
                styles.rowSubtitle,
                subtitleTone === 'blue' ? styles.rowSubtitleBlue : null,
                subtitleTone === 'green' ? styles.rowSubtitleGreen : null,
              ]}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {actionLabel ? (
        <View style={styles.rowActionPill}>
          <Text style={styles.rowActionText}>{actionLabel}</Text>
        </View>
      ) : onPress ? (
        <ChevronRight size={18} color="#c4cad4" strokeWidth={2.3} />
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.row, separated ? styles.rowSeparator : null]}>{content}</View>;
  }

  return (
    <TouchableOpacity
      activeOpacity={0.78}
      style={[styles.row, separated ? styles.rowSeparator : null]}
      onPress={onPress}
      accessibilityRole={accessibilityRole}
    >
      {content}
    </TouchableOpacity>
  );
}

const cardShadow: ViewStyle = {
  shadowColor: '#0f172a',
  shadowOpacity: 0.1,
  shadowRadius: 3,
  shadowOffset: { width: 0, height: 1 },
  elevation: 2,
};

const h1Base: TextStyle = {
  fontFamily: SERIF_FONT,
  fontWeight: '500',
  color: '#111111',
  letterSpacing: -1.1,
  includeFontPadding: false,
};

const styles = StyleSheet.create({
  cardShadow,
  screen: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },
  scrollContent: {
    width: '100%',
  },
  headerBlock: {
    gap: 24,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  headerTitle: {
    ...h1Base,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: 'hidden',
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  displayName: {
    fontSize: 18.4,
    lineHeight: 27.6,
    fontWeight: '600',
    color: TEXT,
    letterSpacing: -0.9,
    includeFontPadding: false,
  },
  emailText: {
    fontSize: 15,
    lineHeight: 22.5,
    fontWeight: '400',
    color: MUTED,
    letterSpacing: -0.23,
    includeFontPadding: false,
  },
  planBadge: {
    marginTop: 7,
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  planBadgeFree: {
    backgroundColor: '#f0f1f3',
  },
  planBadgePro: {
    backgroundColor: '#e7f7fd',
  },
  planBadgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    includeFontPadding: false,
  },
  planBadgeTextFree: {
    color: '#4b5563',
  },
  planBadgeTextPro: {
    color: '#007ab8',
  },
  proCard: {
    height: 232.25,
    borderRadius: 32,
    overflow: 'hidden',
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 28,
    backgroundColor: '#aee0ff',
  },
  proCardImage: {
    ...StyleSheet.absoluteFillObject,
  },
  proCardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  proCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 18,
  },
  proCardTitle: {
    fontFamily: SERIF_FONT,
    fontSize: 28,
    lineHeight: 35,
    fontWeight: '500',
    letterSpacing: -0.7,
    color: '#111111',
    includeFontPadding: false,
  },
  activeBadge: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.62)',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  activeBadgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: '#111111',
    includeFontPadding: false,
  },
  proCardBody: {
    marginTop: 16,
    maxWidth: 259,
    fontSize: 15,
    lineHeight: 24.375,
    fontWeight: '500',
    letterSpacing: -0.23,
    color: 'rgba(17,17,17,0.78)',
    includeFontPadding: false,
  },
  freePlanCard: {
    height: 112,
    borderRadius: 24,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: SOFT_BORDER,
    paddingHorizontal: 22,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  freePlanCopy: {
    flex: 1,
    minWidth: 0,
  },
  freePlanTitle: {
    fontSize: 17,
    lineHeight: 25.5,
    fontWeight: '600',
    color: '#111111',
    includeFontPadding: false,
  },
  freePlanText: {
    marginTop: 6,
    fontSize: 15,
    lineHeight: 22.5,
    fontWeight: '400',
    color: MUTED,
    includeFontPadding: false,
  },
  upgradeButton: {
    height: 52.5,
    borderRadius: 999,
    backgroundColor: '#111111',
    paddingHorizontal: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  upgradeButtonText: {
    fontSize: 15,
    lineHeight: 22.5,
    fontWeight: '600',
    color: '#ffffff',
    includeFontPadding: false,
  },
  sectionHeader: {
    marginTop: 32,
    marginBottom: 16,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  sectionTitle: {
    fontSize: 17,
    lineHeight: 25.5,
    fontWeight: '600',
    letterSpacing: -0.86,
    color: TEXT,
    includeFontPadding: false,
  },
  sectionAction: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
    letterSpacing: -0.15,
    color: MUTED,
    includeFontPadding: false,
  },
  answerCard: {
    borderRadius: 24,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: SOFT_BORDER,
    paddingHorizontal: 21,
    paddingVertical: 21,
    minHeight: 128,
  },
  answerChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 8,
  },
  answerChip: {
    minHeight: 39,
    borderRadius: 14,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: SOFT_BORDER,
  },
  answerChipActive: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  answerChipText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '400',
    letterSpacing: -0.15,
    color: '#1e2939',
    includeFontPadding: false,
  },
  answerChipTextActive: {
    color: '#ffffff',
  },
  emptyAnswers: {
    gap: 8,
  },
  emptyAnswersTitle: {
    fontSize: 15,
    lineHeight: 22.5,
    fontWeight: '500',
    color: TEXT,
    includeFontPadding: false,
  },
  emptyAnswersText: {
    fontSize: 13,
    lineHeight: 19.5,
    fontWeight: '400',
    color: MUTED,
    includeFontPadding: false,
  },
  listCard: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: SOFT_BORDER,
  },
  row: {
    minHeight: 75,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  rowSeparator: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f9fafb',
  },
  rowLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f9fafb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconGreen: {
    backgroundColor: '#f0fdf4',
  },
  rowIconDanger: {
    backgroundColor: '#fef2f2',
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 15,
    lineHeight: 22.5,
    fontWeight: '500',
    letterSpacing: -0.23,
    color: TEXT,
    includeFontPadding: false,
  },
  rowTitleDanger: {
    color: '#dc2626',
  },
  rowSubtitle: {
    fontSize: 13,
    lineHeight: 19.5,
    fontWeight: '400',
    letterSpacing: -0.08,
    color: MUTED,
    includeFontPadding: false,
  },
  rowSubtitleBlue: {
    color: '#007ab8',
  },
  rowSubtitleGreen: {
    color: '#16a34a',
  },
  rowActionPill: {
    minHeight: 37,
    borderRadius: 999,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
  },
  rowActionText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
    letterSpacing: -0.15,
    color: '#111111',
    includeFontPadding: false,
  },
  emailRow: {
    minHeight: 79,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  emailCopy: {
    flex: 1,
    minWidth: 0,
  },
  emailRowTitle: {
    fontSize: 15,
    lineHeight: 22.5,
    fontWeight: '500',
    letterSpacing: -0.23,
    color: TEXT,
    includeFontPadding: false,
  },
  emailRowSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19.5,
    fontWeight: '400',
    letterSpacing: -0.08,
    color: MUTED,
    includeFontPadding: false,
  },
  staticRow: {
    minHeight: 55.5,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  staticRowTitle: {
    fontSize: 15,
    lineHeight: 22.5,
    fontWeight: '400',
    letterSpacing: -0.23,
    color: '#99a1af',
    includeFontPadding: false,
  },
  versionText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '400',
    letterSpacing: -0.15,
    color: '#99a1af',
    includeFontPadding: false,
  },
  dangerCard: {
    marginTop: 8,
    marginBottom: 24,
  },
});
