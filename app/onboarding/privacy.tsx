import React, { useCallback, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';

import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { PermissionCard } from '@/components/onboarding/PermissionCard';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { colors } from '@/lib/theme';
import { privacySchema, type PrivacyFormValues } from '@/lib/validation/onboarding';

const PrivacyScreen = () => {
  const router = useRouter();
  const { draft, loading, saveDraft } = useOnboarding();

  const {
    control,
    handleSubmit,
    formState: { isValid, isSubmitting },
    reset,
  } = useForm<PrivacyFormValues>({
    resolver: zodResolver(privacySchema),
    mode: 'onChange',
    defaultValues: {
      agreed: Boolean(draft?.privacy?.agreed),
      camera: draft?.privacy?.camera ?? false,
      notifications: draft?.privacy?.notifications ?? false,
      photos: draft?.privacy?.photos ?? false,
    },
  });

  useEffect(() => {
    if (!loading) {
      reset({
        agreed: Boolean(draft?.privacy?.agreed),
        camera: draft?.privacy?.camera ?? false,
        notifications: draft?.privacy?.notifications ?? false,
        photos: draft?.privacy?.photos ?? false,
      });
    }
  }, [draft?.privacy, loading, reset]);

  const onSubmit = useCallback(
    async (values: PrivacyFormValues) => {
      const parsed = privacySchema.parse(values);
      try {
        await saveDraft(
          {
            privacy: {
              agreed: parsed.agreed,
              camera: parsed.camera,
              notifications: parsed.notifications,
              photos: parsed.photos,
            },
          },
          7,
        );
        console.log('🔒 Terms accepted; permissions selected', parsed);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.push('/onboarding/trial-offer');
      } catch (error) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        console.error('Failed to save privacy selections', error);
      }
    },
    [router, saveDraft],
  );

  const handleError = useCallback(async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, []);

  return (
    <OnboardingContainer
      step={7}
      totalSteps={7}
      title="Privacy & permissions"
      subtitle="Review our terms and choose what app features you want to enable."
      onBack={() => router.back()}
      onNext={handleSubmit(onSubmit, handleError)}
      disableNext={!isValid || isSubmitting}
      nextLabel={isSubmitting ? 'Finishing...' : 'Finish Setup'}
    >
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Required</Text>
        <Controller
          control={control}
          name="agreed"
          render={({ field: { value, onChange } }) => (
            <PermissionCard
              title="I agree to NuTri’s Terms & Privacy Policy"
              description="This is required to continue using the app."
              value={value}
              required
              onPress={() => onChange(!value)}
            />
          )}
        />
        {!isValid ? <Text style={styles.helperError}>You must accept the terms to proceed.</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Optional permissions</Text>
        <Controller
          control={control}
          name="camera"
          render={({ field: { value, onChange } }) => (
            <PermissionCard
              title="Camera access"
              description="Scan supplement labels to extract nutrition details faster."
              value={value}
              onPress={() => onChange(!value)}
            />
          )}
        />
        <Controller
          control={control}
          name="notifications"
          render={({ field: { value, onChange } }) => (
            <PermissionCard
              title="Notifications"
              description="Get reminders to take supplements and log progress."
              value={value}
              onPress={() => onChange(!value)}
            />
          )}
        />
        <Controller
          control={control}
          name="photos"
          render={({ field: { value, onChange } }) => (
            <PermissionCard
              title="Photo library"
              description="Attach photos of supplements or lab results for deeper insights."
              value={value}
              onPress={() => onChange(!value)}
            />
          )}
        />
      </View>
    </OnboardingContainer>
  );
};

const styles = StyleSheet.create({
  section: {
    gap: 16,
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  helperError: {
    fontSize: 14,
    color: '#EF4444',
  },
});

export default PrivacyScreen;
