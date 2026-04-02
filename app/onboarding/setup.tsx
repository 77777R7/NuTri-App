import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { QAOptionRow } from '@/components/onboarding/qa/QAOptionRow';
import { QAScreenShell } from '@/components/onboarding/qa/QAScreenShell';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { SETUP_OPTIONS } from '@/lib/onboarding-v2';

const SETUP_UI_OPTIONS = SETUP_OPTIONS.map((option, index) => ({
  label: option.title,
  value: index === 0 ? 'camera' : index === 1 ? 'notifications' : 'photos',
  description: option.description,
})) as const;

type SetupPreferenceValue = (typeof SETUP_UI_OPTIONS)[number]['value'];

const DEFAULT_SETUP_VALUES: SetupPreferenceValue[] = ['camera', 'notifications', 'photos'];

export default function SetupPreferencesScreen() {
  const router = useRouter();
  const { draft, saveDraft } = useOnboarding();
  const { setDirection } = useTransitionDir();
  const permissionPreferences = draft?.permissionPreferences;

  const initialSelection = useMemo(() => {
    const hasExplicitPreference =
      typeof permissionPreferences?.camera === 'boolean' ||
      typeof permissionPreferences?.notifications === 'boolean' ||
      typeof permissionPreferences?.photos === 'boolean';

    if (!hasExplicitPreference) {
      return [...DEFAULT_SETUP_VALUES];
    }

    const selected: SetupPreferenceValue[] = [];
    if (permissionPreferences?.camera) selected.push('camera');
    if (permissionPreferences?.notifications) selected.push('notifications');
    if (permissionPreferences?.photos) selected.push('photos');
    return selected;
  }, [
    permissionPreferences,
  ]);

  const [selectedSetup, setSelectedSetup] =
    useState<SetupPreferenceValue[]>(initialSelection);

  useEffect(() => {
    setSelectedSetup(initialSelection);
  }, [initialSelection]);

  const toggle = useCallback(async (value: SetupPreferenceValue) => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }

    setSelectedSetup((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }, []);

  const persistSelection = useCallback(
    async (values: SetupPreferenceValue[]) => {
      const permissionPreferences = {
        camera: values.includes('camera'),
        notifications: values.includes('notifications'),
        photos: values.includes('photos'),
      };
      const selectedSetupLabels = SETUP_UI_OPTIONS.filter((option) =>
        values.includes(option.value),
      ).map((option) => option.label);

      await saveDraft(
        {
          permissionPreferences,
          setupPreferences: selectedSetupLabels,
        },
        10,
      );

      trackOnboardingEvent('question_answered', {
        question: 'setup_preferences',
        answers: selectedSetupLabels,
        permissionPreferences,
      });
    },
    [saveDraft],
  );

  const handleContinue = useCallback(async () => {
    await persistSelection(selectedSetup);
    setDirection('forward');
    router.replace('/onboarding/plan-preview');
  }, [persistSelection, router, selectedSetup, setDirection]);

  const handleSkip = useCallback(async () => {
    await persistSelection([]);
    setDirection('forward');
    router.replace('/onboarding/plan-preview');
  }, [persistSelection, router, setDirection]);

  return (
    <QAScreenShell
      screenKey="setup"
      qaStepIndex={7}
      eyebrow="Start setup"
      title="Which setup would help you start strong?"
      subtitle="These are only preferences. We ask for access only when you use the feature."
      onBack={() => {
        setDirection('back');
        router.replace('/onboarding/blocker');
      }}
      onContinue={handleContinue}
      onSkip={handleSkip}
      continueLabel="Preview my plan"
      listContentContainerStyle={styles.listContent}
    >
      {SETUP_UI_OPTIONS.map((option) => (
        <QAOptionRow
          key={option.value}
          label={option.label}
          description={option.description}
          selected={selectedSetup.includes(option.value)}
          selectionMode="multiple"
          onPress={() => void toggle(option.value)}
        />
      ))}
    </QAScreenShell>
  );
}

const styles = {
  listContent: {
    gap: 18,
    paddingBottom: 18,
  },
} as const;
