import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { QAMultiSelectScreen } from '@/components/onboarding/qa/QAMultiSelectScreen';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { buildSmartFilterConfig, GOAL_OPTIONS } from '@/lib/onboarding-v2';

const normalizePostScanReturnTo = (value: unknown) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if ((trimmed !== '/scan/result' && !trimmed.startsWith('/scan/result?')) || trimmed.startsWith('//')) return null;
  return trimmed;
};

export default function GoalsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; returnTo?: string }>();
  const { draft, progress, saveDraft, setProgress } = useOnboarding();
  const { setDirection } = useTransitionDir();
  const postScanReturnTo = useMemo(
    () => normalizePostScanReturnTo(params.returnTo),
    [params.returnTo],
  );
  const isPostScanMode = params.mode === 'post_scan' && Boolean(postScanReturnTo);
  const [selectedGoals, setSelectedGoals] = useState<string[]>(
    draft?.goals ?? [],
  );

  useEffect(() => {
    setSelectedGoals(draft?.goals ?? []);
  }, [draft?.goals]);

  useFocusEffect(
    useCallback(() => {
      if (progress < 3) {
        void setProgress(3);
      }
    }, [progress, setProgress]),
  );

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
      3,
    );
    trackOnboardingEvent('question_answered', {
      question: 'goals',
      answerCount: selectedGoals.length,
      answers: selectedGoals,
      source: 'gemini_port',
    });
    trackOnboardingEvent('goals_completed', {
      answerCount: selectedGoals.length,
      answers: selectedGoals,
      source: 'onboarding_goals',
    });
    setDirection('forward');
    if (isPostScanMode && postScanReturnTo) {
      router.replace({
        pathname: '/onboarding/allergy',
        params: {
          mode: 'post_scan',
          returnTo: postScanReturnTo,
        },
      });
      return;
    }
    router.replace('/onboarding/allergy');
  }, [draft?.preferredTypes, isPostScanMode, postScanReturnTo, router, saveDraft, selectedGoals, setDirection]);

  return (
    <QAMultiSelectScreen
      screenKey="goals"
      qaStepIndex={1}
      eyebrow="Your goal"
      title="What are your goals right now?"
      subtitle="Select at least one."
      options={[...GOAL_OPTIONS]}
      values={selectedGoals}
      onToggle={toggleGoal}
      onBack={() => {
        setDirection('back');
        if (isPostScanMode && postScanReturnTo) {
          router.replace(postScanReturnTo as never);
          return;
        }
        router.replace('/onboarding/data-trust');
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
