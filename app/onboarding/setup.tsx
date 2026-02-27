import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { PermissionCard } from '@/components/onboarding/PermissionCard';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding-v2';
import { colors } from '@/lib/theme';

type SetupState = {
  camera: boolean;
  notifications: boolean;
  photos: boolean;
};

export default function SetupPreferencesScreen() {
  const router = useRouter();
  const { draft, saveDraft } = useOnboarding();
  const [values, setValues] = useState<SetupState>({
    camera: Boolean(draft?.permissionPreferences?.camera),
    notifications: Boolean(draft?.permissionPreferences?.notifications),
    photos: Boolean(draft?.permissionPreferences?.photos),
  });

  useEffect(() => {
    setValues({
      camera: Boolean(draft?.permissionPreferences?.camera),
      notifications: Boolean(draft?.permissionPreferences?.notifications),
      photos: Boolean(draft?.permissionPreferences?.photos),
    });
  }, [draft?.permissionPreferences]);

  const toggle = useCallback((key: keyof SetupState) => {
    setValues((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  const handleNext = useCallback(async () => {
    await saveDraft({ permissionPreferences: values }, 9);
    trackOnboardingEvent('question_answered', {
      question: 'setup_preferences',
      answers: values,
    });
    router.push('/onboarding/plan-preview');
  }, [router, saveDraft, values]);

  return (
    <OnboardingContainer
      step={9}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      title="Which setup would help you start strong?"
      subtitle="These are preferences only. We ask for OS permissions only when you use the feature."
      fallbackHref="/onboarding/blocker"
      onNext={handleNext}
      nextLabel="Preview my plan"
    >
      <View style={styles.content}>
        <Text style={styles.why}>Why we ask: this lets us tune onboarding without interrupting you with permission popups now.</Text>

        <PermissionCard
          title="Camera for label scan"
          description="Request only when you tap Scan."
          value={values.camera}
          onPress={() => toggle('camera')}
        />

        <PermissionCard
          title="Daily reminder nudges"
          description="Request only when you enable reminders."
          value={values.notifications}
          onPress={() => toggle('notifications')}
        />

        <PermissionCard
          title="Photo library upload"
          description="Request only when you tap Upload/Attach."
          value={values.photos}
          onPress={() => toggle('photos')}
        />
      </View>
    </OnboardingContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: 16,
  },
  why: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textMuted,
  },
});
