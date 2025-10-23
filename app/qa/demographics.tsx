import { zodResolver } from '@hookform/resolvers/zod';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import AppHeader from '@/components/common/AppHeader';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useQA } from '@/contexts/QAContext';
import { colors, radii, spacing } from '@/lib/theme';
import { demographicsSchema, type DemographicsFormValues } from '@/lib/validation/qa';

const GENDER_OPTIONS = [
  { value: 'Male', emoji: '👨', label: 'Male' },
  { value: 'Female', emoji: '👩', label: 'Female' },
  { value: 'Other', emoji: '🧑', label: 'Other' },
  { value: 'Prefer not to say', emoji: '🤐', label: 'Prefer not to say' },
];

export default function DemographicsScreen() {
  const router = useRouter();
  const { data, updateData, setStep } = useQA();
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { isValid, errors },
    watch,
    reset,
  } = useForm<DemographicsFormValues>({
    resolver: zodResolver(demographicsSchema),
    mode: 'onChange',
    defaultValues: {
      age: data.age,
      gender: data.gender,
    },
  });

  useEffect(() => {
    reset({
      age: data.age,
      gender: data.gender,
    });
  }, [data.age, data.gender, reset]);

  const selectedGender = watch('gender');

  const onSubmit = useCallback(
    async (values: DemographicsFormValues) => {
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        updateData({
          age: values.age,
          gender: values.gender,
        });
        setStep(3);
        router.push('/qa/physical-stats');
      } catch (error) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        console.error('Failed to save demographics', error);
      }
    },
    [router, updateData, setStep]
  );

  const handleError = useCallback(async () => {
    setAttemptedSubmit(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, []);

  return (
    <>
      <AppHeader title="Step 2 of 7" showBack />
      <OnboardingContainer
        step={2}
        totalSteps={7}
        title="Tell us about yourself"
        subtitle="This helps us provide age-appropriate recommendations"
        fallbackHref="/qa/welcome"
        onNext={handleSubmit(onSubmit, handleError)}
        disableNext={!isValid}
        nextLabel="Continue →"
      >
        <View style={styles.content}>
          {/* Age Input */}
          <View style={styles.field}>
            <Text style={styles.label}>Age</Text>
            <Controller
              control={control}
              name="age"
              render={({ field: { onChange, value } }) => (
                <>
                  <View style={[styles.inputContainer, (attemptedSubmit || value) && errors.age && styles.inputError]}>
                    <TextInput
                      value={value?.toString() || ''}
                      onChangeText={(text) => {
                        const num = parseInt(text, 10);
                        onChange(isNaN(num) ? undefined : num);
                      }}
                      placeholder="Enter your age"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="number-pad"
                      style={styles.input}
                      maxLength={3}
                    />
                  </View>
                  {(attemptedSubmit || value) && errors.age && (
                    <Text style={styles.errorText}>{errors.age.message}</Text>
                  )}
                </>
              )}
            />
          </View>

          {/* Gender Selection */}
          <View style={styles.field}>
            <Text style={styles.label}>Gender</Text>
            <Controller
              control={control}
              name="gender"
              render={({ field: { onChange, value } }) => (
                <>
                  <View style={styles.genderGrid}>
                    {GENDER_OPTIONS.map((option) => (
                      <Pressable
                        key={option.value}
                        onPress={() => {
                          onChange(option.value);
                          Haptics.selectionAsync().catch(() => {});
                        }}
                        style={[
                          styles.genderCard,
                          value === option.value && styles.genderCardSelected,
                        ]}
                      >
                        <Text style={styles.genderEmoji}>{option.emoji}</Text>
                        <Text
                          style={[
                            styles.genderLabel,
                            value === option.value && styles.genderLabelSelected,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {attemptedSubmit && errors.gender && (
                    <Text style={styles.errorText}>{errors.gender.message}</Text>
                  )}
                </>
              )}
            />
          </View>

          {/* Helper Text */}
          <View style={styles.helperBox}>
            <Text style={styles.helperText}>
              💡 Your information is confidential and used only to personalize your experience
            </Text>
          </View>
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
  field: {
    gap: spacing.sm,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  inputContainer: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    height: 60,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  inputError: {
    borderColor: '#EF4444',
  },
  input: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  genderGrid: {
    gap: spacing.md,
  },
  genderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.xl,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  genderCardSelected: {
    borderColor: colors.brand,
    backgroundColor: 'rgba(16,185,129,0.08)',
    shadowOpacity: 0.08,
    elevation: 3,
  },
  genderEmoji: {
    fontSize: 28,
  },
  genderLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  genderLabelSelected: {
    color: colors.brandDark,
    fontWeight: '700',
  },
  errorText: {
    fontSize: 13,
    color: '#EF4444',
    marginTop: spacing.xs,
  },
  helperBox: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.15)',
  },
  helperText: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
});

