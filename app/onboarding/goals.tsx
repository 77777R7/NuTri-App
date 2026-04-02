import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';

import { QAMultiSelectScreen } from '@/components/onboarding/qa/QAMultiSelectScreen';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { buildSmartFilterConfig, GOAL_OPTIONS } from '@/lib/onboarding-v2';

export default function GoalsScreen() {
  const router = useRouter();
  const { draft, progress, saveDraft, setProgress } = useOnboarding();
  const { setDirection } = useTransitionDir();
  const [selectedGoals, setSelectedGoals] = useState<string[]>(
    draft?.goals ?? [],
  );

  useEffect(() => {
    setSelectedGoals(draft?.goals ?? []);
  }, [draft?.goals]);

  useEffect(() => {
    if (progress < 6) {
      void setProgress(6);
    }
  }, [progress, setProgress]);

  const toggleGoal = useCallback((goal: string) => {
    setSelectedGoals((current) =>
      current.includes(goal)
        ? current.filter((item) => item !== goal)
        : [...current, goal],
    );
  }, []);

  const persist = useCallback(async () => {
    await saveDraft(
      {
        goals: selectedGoals,
        smartFilterConfig: buildSmartFilterConfig({
          goals: selectedGoals,
          preferredTypes: draft?.preferredTypes ?? [],
        }),
      },
      6,
    );
    trackOnboardingEvent('question_answered', {
      question: 'goals',
      answerCount: selectedGoals.length,
      answers: selectedGoals,
      source: 'gemini_port',
    });
    setDirection('forward');
    router.replace('/onboarding/types');
  }, [draft?.preferredTypes, router, saveDraft, selectedGoals, setDirection]);

  return (
    <QAMultiSelectScreen
      screenKey="goals"
      qaStepIndex={4}
      eyebrow="Your goal"
      title="What are your goals right now?"
      subtitle="Select at least one."
      options={[...GOAL_OPTIONS]}
      values={selectedGoals}
      onToggle={toggleGoal}
      onBack={() => {
        setDirection('back');
        router.replace('/onboarding/experience');
      }}
      onContinue={persist}
      onSkip={persist}
      continueLabel="Continue"
      footerHint={
        selectedGoals.length === 0
          ? 'Select at least one goal to continue.'
          : undefined
      }
    />
  );
}
