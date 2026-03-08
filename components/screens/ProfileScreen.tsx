import React from 'react';
import { ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Bell,
  Cloud,
  Database,
  FileText,
  Fingerprint,
  Images,
  Leaf,
  MapPin,
  ShieldCheck,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react-native';

import { ContentFrame } from '@/components/common/ContentFrame';
import { useAuth } from '@/contexts/AuthContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useScreenTokens } from '@/hooks/useScreenTokens';
import { useTranslation } from '@/lib/i18n';
import {
  buildProfileScreenModel,
  type ProfileSnapshotId,
  type ProfileStatusId,
  type ProfileStatusState,
} from '@/lib/profile/viewModel';

const SCREEN_BG = '#F2F3F7';
const STACK_GAP = 16;
const SNAPSHOT_GAP = 12;
const MIN_TWO_UP_CARD_WIDTH = 148;

export type ProfileScreenProps = {
  navHeight: number;
};

type SnapshotMeta = {
  icon: LucideIcon;
  accent: string;
  soft: string;
  title: string;
  hint: string;
};

type StatusMeta = {
  icon: LucideIcon;
  accent: string;
  soft: string;
  title: string;
  hint: string;
};

const getStateLabel = (state: ProfileStatusState, t: ReturnType<typeof useTranslation>['t']) => {
  switch (state) {
    case 'connected':
      return t.profileStateConnected;
    case 'preview':
      return t.profileStatePreview;
    case 'enabled':
      return t.profileStateEnabled;
    case 'off':
      return t.profileStateOff;
    case 'allowed':
      return t.profileStateAllowed;
    case 'denied':
      return t.profileStateDenied;
    case 'accepted':
      return t.profileStateAccepted;
    case 'pending':
      return t.profileStatePending;
    case 'local_only':
      return t.profileStateLocalOnly;
    case 'soon':
      return t.profileStateSoon;
    case 'not_set':
    default:
      return t.profileStateNotSet;
  }
};

const getStateTone = (state: ProfileStatusState) => {
  switch (state) {
    case 'connected':
    case 'enabled':
    case 'allowed':
    case 'accepted':
      return {
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        borderColor: 'rgba(16, 185, 129, 0.18)',
        textColor: '#047857',
      };
    case 'pending':
      return {
        backgroundColor: 'rgba(245, 158, 11, 0.14)',
        borderColor: 'rgba(245, 158, 11, 0.18)',
        textColor: '#b45309',
      };
    case 'soon':
      return {
        backgroundColor: 'rgba(59, 130, 246, 0.12)',
        borderColor: 'rgba(59, 130, 246, 0.16)',
        textColor: '#2563eb',
      };
    case 'preview':
    case 'local_only':
    case 'not_set':
      return {
        backgroundColor: 'rgba(148, 163, 184, 0.12)',
        borderColor: 'rgba(148, 163, 184, 0.16)',
        textColor: '#64748b',
      };
    case 'denied':
    case 'off':
    default:
      return {
        backgroundColor: 'rgba(71, 85, 105, 0.1)',
        borderColor: 'rgba(71, 85, 105, 0.16)',
        textColor: '#475569',
      };
  }
};

export default function ProfileScreen({ navHeight }: ProfileScreenProps) {
  const { user, isBiometricEnabled } = useAuth();
  const { draft } = useOnboarding();
  const { t } = useTranslation();
  const tokens = useScreenTokens(navHeight);
  const model = buildProfileScreenModel({ user, draft, isBiometricEnabled });

  const contentTopPadding = tokens.contentTopPadding;
  const contentBottomPadding = tokens.contentBottomPadding;
  const snapshotColumns = (tokens.contentWidth - SNAPSHOT_GAP) / 2 >= MIN_TWO_UP_CARD_WIDTH ? 2 : 1;
  const snapshotCardWidth =
    snapshotColumns === 2 ? (tokens.contentWidth - SNAPSHOT_GAP) / 2 : tokens.contentWidth;

  const snapshotMeta: Record<ProfileSnapshotId, SnapshotMeta> = {
    goals: {
      icon: Target,
      accent: '#0f766e',
      soft: 'rgba(20, 184, 166, 0.14)',
      title: t.profileSnapshotGoalsTitle,
      hint: t.profileSnapshotGoalsHint,
    },
    experience: {
      icon: Sparkles,
      accent: '#4f46e5',
      soft: 'rgba(99, 102, 241, 0.12)',
      title: t.profileSnapshotExperienceTitle,
      hint: t.profileSnapshotExperienceHint,
    },
    diet: {
      icon: Leaf,
      accent: '#16a34a',
      soft: 'rgba(34, 197, 94, 0.12)',
      title: t.profileSnapshotDietTitle,
      hint: t.profileSnapshotDietHint,
    },
    region: {
      icon: MapPin,
      accent: '#2563eb',
      soft: 'rgba(59, 130, 246, 0.12)',
      title: t.profileSnapshotRegionTitle,
      hint: t.profileSnapshotRegionHint,
    },
  };

  const statusMeta: Record<ProfileStatusId, StatusMeta> = {
    biometric: {
      icon: Fingerprint,
      accent: '#0f766e',
      soft: 'rgba(20, 184, 166, 0.12)',
      title: t.profilePreferencesBiometricTitle,
      hint: t.profilePreferencesBiometricHint,
    },
    notifications: {
      icon: Bell,
      accent: '#4f46e5',
      soft: 'rgba(99, 102, 241, 0.12)',
      title: t.profilePreferencesNotificationsTitle,
      hint: t.profilePreferencesNotificationsHint,
    },
    photos: {
      icon: Images,
      accent: '#2563eb',
      soft: 'rgba(59, 130, 246, 0.12)',
      title: t.profilePreferencesPhotosTitle,
      hint: t.profilePreferencesPhotosHint,
    },
    consent: {
      icon: ShieldCheck,
      accent: '#16a34a',
      soft: 'rgba(34, 197, 94, 0.12)',
      title: t.profilePreferencesConsentTitle,
      hint: t.profilePreferencesConsentHint,
    },
    sync: {
      icon: Cloud,
      accent: '#0f766e',
      soft: 'rgba(20, 184, 166, 0.12)',
      title: t.profileAccountSyncTitle,
      hint: t.profileAccountSyncHint,
    },
    help: {
      icon: FileText,
      accent: '#4f46e5',
      soft: 'rgba(99, 102, 241, 0.12)',
      title: t.profileAccountHelpTitle,
      hint: t.profileAccountHelpHint,
    },
    tools: {
      icon: Database,
      accent: '#2563eb',
      soft: 'rgba(59, 130, 246, 0.12)',
      title: t.profileAccountToolsTitle,
      hint: t.profileAccountToolsHint,
    },
  };

  const overviewTone = getStateTone(model.hero.overviewState);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: contentTopPadding, bottom: contentBottomPadding }}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: contentTopPadding,
            paddingBottom: contentBottomPadding,
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
              {t.profileTitle}
            </Text>
            <Text style={styles.headerSubtitle}>{t.profileSubtitle}</Text>
          </View>

          <View style={styles.card}>
            <LinearGradient
              colors={['rgba(45, 212, 191, 0.16)', 'rgba(125, 211, 252, 0.08)', 'rgba(255,255,255,0)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cardGlow}
            />

            <View style={styles.heroTopBar}>
              <Text style={styles.heroEyebrow}>{t.profileOverviewTitle}</Text>
              <View
                style={[
                  styles.statusPill,
                  styles.heroStatusPill,
                  {
                    backgroundColor: overviewTone.backgroundColor,
                    borderColor: overviewTone.borderColor,
                  },
                ]}
              >
                <Text style={[styles.statusPillText, { color: overviewTone.textColor }]}>
                  {getStateLabel(model.hero.overviewState, t)}
                </Text>
              </View>
            </View>

            <View style={styles.heroRow}>
              <LinearGradient
                colors={['#0f172a', '#0f766e', '#60a5fa']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.avatar}
              >
                <Text style={styles.avatarText}>{model.hero.initials}</Text>
              </LinearGradient>

              <View style={styles.heroTextWrap}>
                <Text style={styles.heroName}>{model.hero.displayName}</Text>
                <Text style={styles.heroMeta}>{model.hero.secondaryText}</Text>
              </View>
            </View>

            <View style={styles.heroDivider} />
            <Text style={styles.heroBody}>{t.profileOverviewBody}</Text>
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>{t.profileHealthSnapshotTitle}</Text>
            <View
              style={[
                styles.snapshotGrid,
                {
                  flexDirection: snapshotColumns === 2 ? 'row' : 'column',
                },
              ]}
            >
              {model.snapshot.map(item => {
                const meta = snapshotMeta[item.id];
                const Icon = meta.icon;

                return (
                  <View
                    key={item.id}
                    style={[
                      styles.snapshotCard,
                      snapshotColumns === 2 ? { width: snapshotCardWidth } : null,
                    ]}
                  >
                    <View style={[styles.snapshotIconWrap, { backgroundColor: meta.soft }]}>
                      <Icon color={meta.accent} size={18} strokeWidth={2.2} />
                    </View>
                    <View style={styles.snapshotCopy}>
                      <Text style={styles.snapshotTitle}>{meta.title}</Text>
                      <Text style={[styles.snapshotValue, !item.value ? styles.snapshotValueMuted : null]}>
                        {item.value ?? t.profileNotSet}
                      </Text>
                    </View>
                    <Text style={styles.snapshotHint}>{meta.hint}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t.profilePersonalizationTitle}</Text>
              <Text style={styles.cardBody}>{t.profilePersonalizationBody}</Text>
              <View style={styles.chipWrap}>
                {model.personalization.chips.map(chip => (
                  <View
                    key={chip.id}
                    style={[
                      styles.chip,
                      chip.preview ? styles.chipPreview : styles.chipLive,
                    ]}
                  >
                    <Text style={[styles.chipText, chip.preview ? styles.chipTextPreview : null]}>
                      {chip.label}
                    </Text>
                    {chip.preview ? (
                      <View style={styles.previewBadge}>
                        <Text style={styles.previewBadgeText}>{t.profilePreviewBadge}</Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t.profilePreferencesTitle}</Text>
              <Text style={styles.cardBody}>{t.profilePreferencesBody}</Text>
              <View style={styles.statusList}>
                {model.preferences.map((item, index) => {
                  const meta = statusMeta[item.id];
                  const Icon = meta.icon;
                  const tone = getStateTone(item.state);

                  return (
                    <View
                      key={item.id}
                      style={[styles.statusRow, index > 0 ? styles.statusRowBorder : null]}
                    >
                      <View style={[styles.statusIconWrap, { backgroundColor: meta.soft }]}>
                        <Icon color={meta.accent} size={18} strokeWidth={2.2} />
                      </View>
                      <View style={styles.statusTextWrap}>
                        <Text style={styles.statusTitle}>{meta.title}</Text>
                        <Text style={styles.statusHint}>{meta.hint}</Text>
                      </View>
                      <View
                        style={[
                          styles.statusPill,
                          {
                            backgroundColor: tone.backgroundColor,
                            borderColor: tone.borderColor,
                          },
                        ]}
                      >
                        <Text style={[styles.statusPillText, { color: tone.textColor }]}>
                          {getStateLabel(item.state, t)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t.profileAccountTitle}</Text>
              <Text style={styles.cardBody}>{t.profileAccountBody}</Text>
              <View style={styles.statusList}>
                {model.accountData.map((item, index) => {
                  const meta = statusMeta[item.id];
                  const Icon = meta.icon;
                  const tone = getStateTone(item.state);

                  return (
                    <View
                      key={item.id}
                      style={[styles.statusRow, index > 0 ? styles.statusRowBorder : null]}
                    >
                      <View style={[styles.statusIconWrap, { backgroundColor: meta.soft }]}>
                        <Icon color={meta.accent} size={18} strokeWidth={2.2} />
                      </View>
                      <View style={styles.statusTextWrap}>
                        <Text style={styles.statusTitle}>{meta.title}</Text>
                        <Text style={styles.statusHint}>{meta.hint}</Text>
                      </View>
                      <View
                        style={[
                          styles.statusPill,
                          {
                            backgroundColor: tone.backgroundColor,
                            borderColor: tone.borderColor,
                          },
                        ]}
                      >
                        <Text style={[styles.statusPillText, { color: tone.textColor }]}>
                          {getStateLabel(item.state, t)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>

          <Text style={styles.footnote}>{t.profileFootnote}</Text>
        </ContentFrame>
      </ScrollView>
    </View>
  );
}

const cardShadow: ViewStyle = {
  shadowColor: '#0f172a',
  shadowOpacity: 0.08,
  shadowRadius: 22,
  shadowOffset: { width: 0, height: 10 },
  elevation: 8,
};

const h1Base: TextStyle = {
  fontWeight: '800',
  color: '#0f172a',
  letterSpacing: -0.2,
  includeFontPadding: false,
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },
  scrollContent: {
    width: '100%',
  },
  headerBlock: {
    marginBottom: 20,
  },
  headerTitle: {
    ...h1Base,
  },
  headerSubtitle: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    color: '#66758f',
    includeFontPadding: false,
    maxWidth: 320,
  },
  sectionBlock: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 19,
    lineHeight: 23,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
    marginBottom: 14,
  },
  card: {
    ...cardShadow,
    backgroundColor: '#ffffff',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.82)',
    paddingHorizontal: 22,
    paddingVertical: 22,
  },
  cardGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
  },
  heroTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 18,
  },
  heroEyebrow: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '900',
    color: '#64748b',
    includeFontPadding: false,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  heroStatusPill: {
    minWidth: 82,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: STACK_GAP,
  },
  avatar: {
    width: 82,
    height: 82,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '900',
    color: '#ffffff',
    includeFontPadding: false,
    letterSpacing: 0.4,
  },
  heroTextWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  heroName: {
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
    letterSpacing: -0.4,
  },
  heroMeta: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    color: '#66758f',
    includeFontPadding: false,
  },
  heroDivider: {
    marginTop: 20,
    marginBottom: 16,
    height: 1,
    backgroundColor: 'rgba(148, 163, 184, 0.18)',
  },
  heroBody: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    color: '#334155',
    includeFontPadding: false,
  },
  cardTitle: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
    color: '#475569',
    includeFontPadding: false,
  },
  snapshotGrid: {
    flexWrap: 'wrap',
    gap: SNAPSHOT_GAP,
  },
  snapshotCard: {
    ...cardShadow,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.84)',
    paddingHorizontal: 18,
    paddingVertical: 18,
    minHeight: 218,
    justifyContent: 'space-between',
  },
  snapshotIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snapshotCopy: {
    marginTop: 18,
    gap: 8,
  },
  snapshotTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
    color: '#64748b',
    includeFontPadding: false,
  },
  snapshotValue: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '900',
    color: '#0f172a',
    includeFontPadding: false,
    minHeight: 46,
  },
  snapshotValueMuted: {
    color: '#94a3b8',
  },
  snapshotHint: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#64748b',
    includeFontPadding: false,
    minHeight: 54,
  },
  chipWrap: {
    marginTop: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
  },
  chipLive: {
    backgroundColor: 'rgba(45, 212, 191, 0.1)',
    borderColor: 'rgba(45, 212, 191, 0.16)',
  },
  chipPreview: {
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
    borderColor: 'rgba(148, 163, 184, 0.14)',
  },
  chipText: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '800',
    color: '#0f172a',
    includeFontPadding: false,
  },
  chipTextPreview: {
    color: '#475569',
  },
  previewBadge: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  previewBadgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800',
    color: '#64748b',
    includeFontPadding: false,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statusList: {
    marginTop: 14,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
  },
  statusRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148, 163, 184, 0.25)',
  },
  statusIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTextWrap: {
    flex: 1,
    gap: 2,
  },
  statusTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    color: '#0f172a',
    includeFontPadding: false,
  },
  statusHint: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#64748b',
    includeFontPadding: false,
  },
  statusPill: {
    minWidth: 74,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPillText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '800',
    includeFontPadding: false,
  },
  footnote: {
    marginTop: 18,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: '#64748b',
    includeFontPadding: false,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
});
