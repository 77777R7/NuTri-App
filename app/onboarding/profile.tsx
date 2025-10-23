import React, { useCallback, useEffect } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, Controller } from 'react-hook-form';

import AppHeader from '@/components/common/AppHeader';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { FormInput } from '@/components/onboarding/FormInput';
import { UnitToggle } from '@/components/onboarding/UnitToggle';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { colors } from '@/lib/theme';
import { profileSchema, type ProfileFormValues, GENDER_OPTIONS } from '@/lib/validation/onboarding';

type ProfileFormInputs = Partial<ProfileFormValues>;

const ProfileScreen = () => {
  const router = useRouter();
  const { draft, loading, saveDraft } = useOnboarding();

  const {
    control,
    handleSubmit,
    reset,
    formState: { isValid, isSubmitting },
  } = useForm<ProfileFormInputs>({
    resolver: zodResolver(profileSchema),
    mode: 'onChange',
    defaultValues: {
      height: draft?.height,
      weight: draft?.weight,
      age: draft?.age,
      gender: draft?.gender as ProfileFormValues['gender'] | undefined,
    },
  });

  useEffect(() => {
    if (!loading) {
      reset({
        height: draft?.height,
        weight: draft?.weight,
        age: draft?.age,
        gender: draft?.gender as ProfileFormValues['gender'] | undefined,
      });
    }
  }, [draft?.age, draft?.gender, draft?.height, draft?.weight, loading, reset]);

  const onSubmit = useCallback(
    async (values: ProfileFormInputs) => {
      const parsed = profileSchema.parse(values);
      try {
        await saveDraft(parsed, 3);
        console.log('📝 Profile saved');
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.push('/onboarding/diet');
      } catch (error) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        console.error('Failed to save profile draft', error);
      }
    },
    [router, saveDraft],
  );

  const handleError = useCallback(async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, []);

  return (
    <>
      <AppHeader title="Step 2 of 7" showBack />
      <OnboardingContainer
        step={2}
        totalSteps={7}
        title="Tell us about you"
        subtitle="We’ll use this information to personalize your plan."
        fallbackHref="/onboarding/welcome"
        onNext={handleSubmit(onSubmit, handleError)}
        disableNext={!isValid || isSubmitting}
        nextLabel={isSubmitting ? 'Saving...' : 'Next'}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
        >
          <View style={styles.formContent}>
            <Controller<ProfileFormInputs>
              control={control}
              name="height"
              render={(controllerProps: any) => {
                const { field, fieldState } = controllerProps;
                const { value, onChange, onBlur } = field as {
                  value?: number;
                  onChange: (val?: number) => void;
                  onBlur: () => void;
                };
                const { error } = fieldState;

                return <UnitToggle label="Height" type="height" value={value} onChange={onChange} onBlur={onBlur} error={error?.message} />;
              }}
            />

            <Controller<ProfileFormInputs>
              control={control}
              name="weight"
              render={(controllerProps: any) => {
                const { field, fieldState } = controllerProps;
                const { value, onChange, onBlur } = field as {
                  value?: number;
                  onChange: (val?: number) => void;
                  onBlur: () => void;
                };
                const { error } = fieldState;

                return <UnitToggle label="Weight" type="weight" value={value} onChange={onChange} onBlur={onBlur} error={error?.message} />;
              }}
            />

            <FormInput
              control={control}
              name="age"
              label="Age"
              keyboardType="number-pad"
              inputMode="numeric"
              placeholder="How old are you?"
              helperText="You must be at least 13 years old."
              parseValue={text => {
                const sanitized = text.replace(/[^0-9]/g, '');
                if (!sanitized) return undefined;
                const numeric = Number(sanitized);
                return Number.isFinite(numeric) ? numeric : undefined;
              }}
              formatValue={value => (value ? String(value) : '')}
            />

            <Controller<ProfileFormInputs>
              control={control}
              name="gender"
              render={(controllerProps: any) => {
                const { field, fieldState } = controllerProps;
                const { value, onChange } = field as {
                  value?: ProfileFormValues['gender'];
                  onChange: (val: ProfileFormValues['gender']) => void;
                };
                const { error } = fieldState;

                return (
                  <View style={styles.group}>
                    <Text style={styles.groupLabel}>Gender</Text>
                    <View style={styles.chips}>
                      {GENDER_OPTIONS.map(option => {
                        const selected = value === option;
                        return (
                          <TouchableOpacity
                            key={option}
                            style={[styles.chip, selected && styles.chipSelected]}
                            onPress={() => onChange(option)}
                          >
                            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {error ? <Text style={styles.error}>{error.message}</Text> : null}
                  </View>
                );
              }}
            />
        </View>
      </KeyboardAvoidingView>
    </OnboardingContainer>
    </>
  );
};

const styles = StyleSheet.create({
  formContent: {
    flex: 1,
    gap: 20,
  },
  group: {
    gap: 12,
  },
  groupLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#ffffff',
  },
  chipSelected: {
    borderColor: colors.brand,
    backgroundColor: '#DDF5EE',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  chipTextSelected: {
    color: colors.text,
  },
  error: {
    fontSize: 13,
    color: '#EF4444',
  },
});

export default ProfileScreen;
