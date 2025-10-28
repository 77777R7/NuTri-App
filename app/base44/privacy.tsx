import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Lock } from 'lucide-react-native';

import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { NeumorphicCard } from '@/components/base44/qa/NeumorphicCard';
import { colors, spacing } from '@/lib/theme';
import { getStepConfig } from '@/lib/base44/routes';
import { loadCurrentProfile, upsertProfile } from '@/lib/base44/profile';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useFadeSlideIn } from '@/hooks/useFadeSlideIn';

export default function PrivacyScreen() {
  const router = useRouter();
  const { stepNumber } = getStepConfig('privacy');
  const { markCompletedLocal } = useOnboarding();

  const [dataConsent, setDataConsent] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [thirdParty, setThirdParty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      const load = async () => {
        setLoading(true);
        try {
          const profile = await loadCurrentProfile();
          if (profile && isActive) {
            setDataConsent(profile.consent_data_collection ?? false);
            setNotifications(profile.consent_notifications ?? false);
            setThirdParty(profile.consent_third_party ?? false);
          }
        } catch (error) {
          console.warn('[base44] failed to load consents', error);
        } finally {
          if (isActive) setLoading(false);
        }
      };

      load();
      return () => {
        isActive = false;
      };
    }, []),
  );

  const disableNext = useMemo(() => saving || !dataConsent, [dataConsent, saving]);

  const handleFinish = useCallback(async () => {
    if (disableNext) return;
    setSaving(true);
    try {
      await upsertProfile({
        consent_data_collection: dataConsent,
        consent_notifications: notifications,
        consent_third_party: thirdParty,
        completed_steps: 7,
        onboardingCompleted: true,
      });
      await markCompletedLocal();

      router.replace('/(auth)/gate');
    } catch (error) {
      console.warn('[base44] failed to save consents', error);
    } finally {
      setSaving(false);
    }
  }, [dataConsent, disableNext, markCompletedLocal, notifications, router, thirdParty]);

  const heroAnim = useFadeSlideIn(120);
  const consentsAnim = useFadeSlideIn(240);
  const footnoteAnim = useFadeSlideIn(360);

  return (
    <OnboardingContainer
      step={stepNumber}
      totalSteps={7}
      title="Privacy & Consent"
      subtitle="Control how we handle your information"
      nextLabel={saving ? 'Saving…' : 'Finish'}
      disableNext={disableNext}
      fallbackHref="/base44/experience"
      onNext={handleFinish}
    >
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <View style={styles.content}>
          <Animated.View style={heroAnim}>
            <View style={styles.iconWrap}>
              <Lock size={28} color={colors.brand} />
              <Text style={styles.lead}>Your trust matters. Choose what to share.</Text>
            </View>
          </Animated.View>

          <Animated.View style={consentsAnim}>
            <NeumorphicCard>
              <View style={styles.row}>
                <View style={styles.rowCopy}>
                  <Text style={styles.label}>Data collection*</Text>
                <Text style={styles.caption}>Allow NuTri to store your onboarding responses securely.</Text>
              </View>
              <Switch
                value={dataConsent}
                onValueChange={setDataConsent}
                trackColor={{ false: '#D1D5DB', true: colors.brand }}
                thumbColor={dataConsent ? colors.surface : '#FFFFFF'}
              />
            </View>

            <View style={styles.row}>
              <View style={styles.rowCopy}>
                <Text style={styles.label}>Motivational nudges</Text>
                <Text style={styles.caption}>Receive gentle reminders and tailored check-ins.</Text>
              </View>
              <Switch
                value={notifications}
                onValueChange={setNotifications}
                trackColor={{ false: '#D1D5DB', true: colors.brand }}
                thumbColor={notifications ? colors.surface : '#FFFFFF'}
              />
            </View>

            <View style={styles.row}>
              <View style={styles.rowCopy}>
                <Text style={styles.label}>Share anonymized insights</Text>
                <Text style={styles.caption}>Help improve nutrition research with de-identified trends.</Text>
              </View>
              <Switch
                value={thirdParty}
                onValueChange={setThirdParty}
                trackColor={{ false: '#D1D5DB', true: colors.brand }}
                thumbColor={thirdParty ? colors.surface : '#FFFFFF'}
              />
              </View>
            </NeumorphicCard>
          </Animated.View>

          <Animated.View style={footnoteAnim}>
            <Text style={styles.footnote}>
              You can update these preferences anytime from Settings. We never share identifiable data without your explicit consent.
            </Text>
          </Animated.View>
        </View>
      )}
    </OnboardingContainer>
  );
}

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: spacing.lg,
  },
  iconWrap: {
    gap: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  lead: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  rowCopy: {
    flex: 1,
    gap: 4,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  caption: {
    fontSize: 13,
    color: colors.subtext,
  },
  footnote: {
    fontSize: 13,
    color: colors.subtext,
    lineHeight: 18,
  },
});
