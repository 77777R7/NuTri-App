import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import AppHeader from '@/components/common/AppHeader';
import { OnboardingCard } from '@/components/onboarding/OnboardingCard';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useQA } from '@/contexts/QAContext';
import { colors, spacing } from '@/lib/theme';

const HEALTH_GOALS = [
  { id: 'muscle', emoji: '💪', label: 'Build Muscle & Strength' },
  { id: 'immune', emoji: '🛡️', label: 'Boost Immune System' },
  { id: 'energy', emoji: '⚡', label: 'Increase Energy' },
  { id: 'sleep', emoji: '🌙', label: 'Improve Sleep' },
  { id: 'stress', emoji: '🧠', label: 'Reduce Stress' },
  { id: 'digestion', emoji: '🌿', label: 'Better Digestion' },
  { id: 'skin', emoji: '✨', label: 'Healthy Skin & Hair' },
  { id: 'wellness', emoji: '❤️', label: 'General Wellness' },
];

export default function HealthGoalsScreen() {
  const router = useRouter();
  const { data, updateData, setStep } = useQA();
  const [selectedGoals, setSelectedGoals] = useState<string[]>(data.healthGoals || []);

  const toggleGoal = useCallback(
    (goalId: string) => {
      setSelectedGoals((prev) => {
        const isSelected = prev.includes(goalId);
        if (isSelected) {
          return prev.filter((id) => id !== goalId);
        }
        return [...prev, goalId];
      });
      Haptics.selectionAsync().catch(() => {});
    },
    []
  );

  const handleContinue = useCallback(async () => {
    if (selectedGoals.length === 0) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      updateData({
        healthGoals: selectedGoals,
      });
      setStep(5);
      router.push('/qa/dietary');
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error('Failed to save health goals', error);
    }
  }, [selectedGoals, router, updateData, setStep]);

  const isValid = selectedGoals.length > 0;

  return (
    <>
      <AppHeader title="Step 4 of 7" showBack />
      <OnboardingContainer
        step={4}
        totalSteps={7}
        title="What are your health goals?"
        subtitle="Select all that apply - we'll prioritize these areas"
        fallbackHref="/qa/physical-stats"
        onNext={handleContinue}
        disableNext={!isValid}
        nextLabel="Continue →"
      >
        <View style={styles.content}>
          {/* Selection Counter */}
          {selectedGoals.length > 0 && (
            <View style={styles.counterBadge}>
              <Text style={styles.counterText}>
                {selectedGoals.length} {selectedGoals.length === 1 ? 'goal' : 'goals'} selected
              </Text>
            </View>
          )}

          {/* Goals Grid */}
          <View style={styles.goalsGrid}>
            {HEALTH_GOALS.map((goal) => (
              <OnboardingCard
                key={goal.id}
                label={`${goal.emoji} ${goal.label}`}
                selected={selectedGoals.includes(goal.id)}
                onPress={() => toggleGoal(goal.id)}
                accessibilityLabel={`${goal.label}${selectedGoals.includes(goal.id) ? ' selected' : ''}`}
              />
            ))}
          </View>

          {/* Helper Text */}
          {!isValid && (
            <Text style={styles.helperError}>
              Please select at least one health goal to continue
            </Text>
          )}
          {isValid && (
            <Text style={styles.helper}>
              💡 You can select multiple goals. We'll tailor recommendations to help you achieve them.
            </Text>
          )}
        </View>
      </OnboardingContainer>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: spacing.md,
  },
  counterBadge: {
    alignSelf: 'center',
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    shadowColor: colors.brandDark,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  counterText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  goalsGrid: {
    gap: spacing.md,
  },
  helper: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  helperError: {
    fontSize: 14,
    color: '#EF4444',
    textAlign: 'center',
    fontWeight: '600',
  },
});

