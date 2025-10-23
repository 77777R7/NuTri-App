import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import AppHeader from '@/components/common/AppHeader';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useQA } from '@/contexts/QAContext';
import { colors, radii, spacing } from '@/lib/theme';

const EXPERIENCE_LEVELS = [
  {
    id: 'beginner',
    emoji: '🌱',
    label: 'Beginner',
    description: 'New to supplements',
    features: [
      'Simple recommendations',
      'Educational content',
      'Safety-first approach',
    ],
  },
  {
    id: 'intermediate',
    emoji: '🌿',
    label: 'Intermediate',
    description: 'Some experience',
    features: [
      'Detailed analysis',
      'Stacking suggestions',
      'Advanced insights',
    ],
  },
  {
    id: 'advanced',
    emoji: '🌳',
    label: 'Advanced',
    description: 'Experienced user',
    features: [
      'Complex protocols',
      'Research citations',
      'Expert recommendations',
    ],
  },
];

export default function ExperienceScreen() {
  const router = useRouter();
  const { data, updateData, setStep } = useQA();
  const [selectedLevel, setSelectedLevel] = useState<string | undefined>(data.experienceLevel);

  const selectLevel = useCallback(
    (levelId: string) => {
      setSelectedLevel(levelId);
      Haptics.selectionAsync().catch(() => {});
    },
    []
  );

  const handleContinue = useCallback(async () => {
    if (!selectedLevel) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      updateData({
        experienceLevel: selectedLevel,
      });
      setStep(7);
      router.push('/qa/privacy');
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error('Failed to save experience level', error);
    }
  }, [selectedLevel, router, updateData, setStep]);

  const isValid = Boolean(selectedLevel);

  return (
    <>
      <AppHeader title="Step 6 of 7" showBack />
      <OnboardingContainer
        step={6}
        totalSteps={7}
        title="Your supplement experience"
        subtitle="Help us match the right level of detail to your expertise"
        fallbackHref="/qa/dietary"
        onNext={handleContinue}
        disableNext={!isValid}
        nextLabel="Continue →"
      >
        <View style={styles.content}>
          {/* Experience Level Cards */}
          <View style={styles.levelsList}>
            {EXPERIENCE_LEVELS.map((level) => (
              <Pressable
                key={level.id}
                onPress={() => selectLevel(level.id)}
                style={[
                  styles.levelCard,
                  selectedLevel === level.id && styles.levelCardSelected,
                ]}
              >
                {/* Radio Button */}
                <View style={styles.radioContainer}>
                  <View style={[
                    styles.radioOuter,
                    selectedLevel === level.id && styles.radioOuterSelected,
                  ]}>
                    {selectedLevel === level.id && (
                      <View style={styles.radioInner} />
                    )}
                  </View>
                </View>

                {/* Content */}
                <View style={styles.levelContent}>
                  <View style={styles.levelHeader}>
                    <Text style={styles.levelEmoji}>{level.emoji}</Text>
                    <View style={styles.levelTitles}>
                      <Text style={[
                        styles.levelLabel,
                        selectedLevel === level.id && styles.levelLabelSelected,
                      ]}>
                        {level.label}
                      </Text>
                      <Text style={styles.levelDescription}>{level.description}</Text>
                    </View>
                  </View>

                  {/* Features List */}
                  <View style={styles.featuresList}>
                    {level.features.map((feature, index) => (
                      <View key={index} style={styles.featureItem}>
                        <Text style={styles.featureBullet}>•</Text>
                        <Text style={styles.featureText}>{feature}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </Pressable>
            ))}
          </View>

          {/* Helper Text */}
          {!isValid && (
            <Text style={styles.helperError}>
              Please select your experience level to continue
            </Text>
          )}
          {isValid && (
            <Text style={styles.helper}>
              💡 Don't worry, you can adjust this later in settings
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
  levelsList: {
    gap: spacing.md,
  },
  levelCard: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  levelCardSelected: {
    borderColor: colors.brand,
    backgroundColor: 'rgba(16,185,129,0.06)',
    shadowOpacity: 0.12,
    elevation: 4,
  },
  radioContainer: {
    paddingTop: 2,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  radioOuterSelected: {
    borderColor: colors.brand,
  },
  radioInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.brand,
  },
  levelContent: {
    flex: 1,
    gap: spacing.sm,
  },
  levelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  levelEmoji: {
    fontSize: 32,
  },
  levelTitles: {
    flex: 1,
  },
  levelLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  levelLabelSelected: {
    color: colors.brandDark,
  },
  levelDescription: {
    fontSize: 14,
    color: colors.textMuted,
  },
  featuresList: {
    gap: spacing.xs,
    paddingLeft: spacing.sm,
  },
  featureItem: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  featureBullet: {
    fontSize: 14,
    color: colors.brand,
    fontWeight: '700',
  },
  featureText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
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

