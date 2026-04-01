import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';

import { QAMultiSelectScreen } from '@/components/onboarding/qa/QAMultiSelectScreen';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { buildSmartFilterConfig, TYPE_OPTIONS } from '@/lib/onboarding-v2';

export default function TypesScreen() {
  const router = useRouter();
  const { draft, progress, saveDraft, setProgress } = useOnboarding();
  const { setDirection } = useTransitionDir();
  const [selectedTypes, setSelectedTypes] = useState<string[]>(
    draft?.preferredTypes ?? [],
  );

  useEffect(() => {
    setSelectedTypes(draft?.preferredTypes ?? []);
  }, [draft?.preferredTypes]);

  useEffect(() => {
    if (progress < 7) {
      void setProgress(7);
    }
  }, [progress, setProgress]);

  const toggleType = useCallback((value: string) => {
    setSelectedTypes((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }, []);

  const persist = useCallback(async () => {
    await saveDraft(
      {
        preferredTypes: selectedTypes,
        smartFilterConfig: buildSmartFilterConfig({
          goals: draft?.goals ?? [],
          preferredTypes: selectedTypes,
        }),
      },
      7,
    );
    trackOnboardingEvent('question_answered', {
      question: 'preferred_types',
      answerCount: selectedTypes.length,
      answers: selectedTypes,
      source: 'gemini_port',
    });
    setDirection('forward');
    router.replace('/onboarding/allergy');
  }, [draft?.goals, router, saveDraft, selectedTypes, setDirection]);

  return (
    <QAMultiSelectScreen
      screenKey="types"
      qaStepIndex={5}
      eyebrow="Your focus"
      title="Which supplement types do you want to focus on first?"
      subtitle="Optional. Choose any you want to focus on first."
      options={[...TYPE_OPTIONS]}
      values={selectedTypes}
      onToggle={toggleType}
      onBack={() => {
        setDirection('back');
        router.replace('/onboarding/goals');
      }}
      onContinue={persist}
      onSkip={persist}
      continueLabel="Continue"
    />
  );
}
