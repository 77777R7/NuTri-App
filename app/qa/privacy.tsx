import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, View } from 'react-native';

import AppHeader from '@/components/common/AppHeader';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useQA } from '@/contexts/QAContext';
import { colors, radii, spacing } from '@/lib/theme';

interface ToggleItemProps {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  important?: boolean;
}

function ToggleItem({ label, description, value, onValueChange, important }: ToggleItemProps) {
  const handleToggle = useCallback(
    (newValue: boolean) => {
      onValueChange(newValue);
      Haptics.selectionAsync().catch(() => {});
    },
    [onValueChange]
  );

  return (
    <View style={[styles.toggleItem, important && styles.toggleItemImportant]}>
      <View style={styles.toggleContent}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleDescription}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={handleToggle}
        trackColor={{ false: '#D1D5DB', true: colors.brand }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

export default function PrivacyScreen() {
  const router = useRouter();
  const { data, updateData, resetQA } = useQA();
  const [isSaving, setIsSaving] = useState(false);

  // Notification Settings
  const [notifyReminders, setNotifyReminders] = useState(data.notifyReminders);
  const [notifyEffectiveness, setNotifyEffectiveness] = useState(data.notifyEffectiveness);
  const [notifyResearch, setNotifyResearch] = useState(data.notifyResearch);
  const [notifyPriceDrops, setNotifyPriceDrops] = useState(data.notifyPriceDrops);
  const [notifyInteractions, setNotifyInteractions] = useState(data.notifyInteractions);

  // Privacy Settings
  const [privacyAnalytics, setPrivacyAnalytics] = useState(data.privacyAnalytics);
  const [privacyPersonalization, setPrivacyPersonalization] = useState(data.privacyPersonalization);
  const [privacyThirdParty, setPrivacyThirdParty] = useState(data.privacyThirdParty);

  const handleComplete = useCallback(async () => {
    setIsSaving(true);

    try {
      // Update final settings
      updateData({
        notifyReminders,
        notifyEffectiveness,
        notifyResearch,
        notifyPriceDrops,
        notifyInteractions,
        privacyAnalytics,
        privacyPersonalization,
        privacyThirdParty,
      });

      // Simulate API call to save data
      await new Promise(resolve => setTimeout(resolve, 1500));

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Show success alert
      Alert.alert(
        '🎉 Setup Complete!',
        'Your profile has been saved. You can now explore personalized supplement recommendations.',
        [
          {
            text: 'Get Started',
            onPress: () => {
              resetQA();
              router.replace('/(tabs)/home');
            },
          },
        ],
        { cancelable: false }
      );
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error('Failed to save Q&A data', error);
      Alert.alert(
        'Oops!',
        'Something went wrong. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    notifyReminders,
    notifyEffectiveness,
    notifyResearch,
    notifyPriceDrops,
    notifyInteractions,
    privacyAnalytics,
    privacyPersonalization,
    privacyThirdParty,
    router,
    updateData,
    resetQA,
  ]);

  return (
    <>
      <AppHeader title="Step 7 of 7" showBack />
      <OnboardingContainer
        step={7}
        totalSteps={7}
        title="Privacy & notifications"
        subtitle="Customize your experience and manage your data"
        fallbackHref="/qa/experience"
        onNext={handleComplete}
        disableNext={isSaving}
        nextLabel={isSaving ? 'Saving...' : 'Complete Setup 🎉'}
      >
        <View style={styles.content}>
          {/* Notifications Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📬 Notifications</Text>
            <View style={styles.togglesList}>
              <ToggleItem
                label="Supplement Reminders"
                description="Daily reminders to take your supplements"
                value={notifyReminders}
                onValueChange={setNotifyReminders}
              />
              <ToggleItem
                label="Effectiveness Tips"
                description="Tips to maximize supplement benefits"
                value={notifyEffectiveness}
                onValueChange={setNotifyEffectiveness}
              />
              <ToggleItem
                label="New Research"
                description="Updates on supplement research & studies"
                value={notifyResearch}
                onValueChange={setNotifyResearch}
              />
              <ToggleItem
                label="Price Drops"
                description="Alerts when supplements go on sale"
                value={notifyPriceDrops}
                onValueChange={setNotifyPriceDrops}
              />
              <ToggleItem
                label="⚠️ Interaction Warnings"
                description="Critical alerts about supplement interactions"
                value={notifyInteractions}
                onValueChange={setNotifyInteractions}
                important
              />
            </View>
          </View>

          {/* Privacy Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🔒 Privacy</Text>
            <View style={styles.togglesList}>
              <ToggleItem
                label="Analytics"
                description="Help us improve with anonymous usage data"
                value={privacyAnalytics}
                onValueChange={setPrivacyAnalytics}
              />
              <ToggleItem
                label="Personalization"
                description="Use your data to personalize recommendations"
                value={privacyPersonalization}
                onValueChange={setPrivacyPersonalization}
              />
              <ToggleItem
                label="Third-party Sharing"
                description="Share data with partner services"
                value={privacyThirdParty}
                onValueChange={setPrivacyThirdParty}
              />
            </View>
          </View>

          {/* Medical Disclaimer */}
          <View style={styles.disclaimerCard}>
            <Text style={styles.disclaimerTitle}>⚕️ Medical Disclaimer</Text>
            <Text style={styles.disclaimerText}>
              NuTri provides information only. Always consult your healthcare provider before 
              starting any supplement regimen, especially if you have medical conditions or take medications.
            </Text>
          </View>

          {/* Loading Indicator */}
          {isSaving && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.brand} />
              <Text style={styles.loadingText}>Saving your profile...</Text>
            </View>
          )}
        </View>
      </OnboardingContainer>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: spacing.xl,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  togglesList: {
    gap: spacing.sm,
  },
  toggleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleItemImportant: {
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  toggleContent: {
    flex: 1,
    gap: spacing.xs,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  toggleDescription: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  disclaimerCard: {
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.3)',
    gap: spacing.sm,
  },
  disclaimerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#B45309',
  },
  disclaimerText: {
    fontSize: 14,
    color: '#78350F',
    lineHeight: 20,
  },
  loadingContainer: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  loadingText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.brand,
  },
});

