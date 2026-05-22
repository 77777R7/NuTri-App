import React, { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { QAMultiSelectScreen } from '@/components/onboarding/qa/QAMultiSelectScreen';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { buildSmartFilterConfig, GOAL_OPTIONS } from '@/lib/onboarding-v2';
import {
  isPostScanMode,
  POST_SCAN_MODE,
  sanitizePostScanReturnTo,
} from '@/lib/onboarding/postScanReturn';
import {
  isProfileEditMode,
  PROFILE_EDIT_MODE,
  sanitizeProfileEditReturnTo,
} from '@/lib/onboarding/profileEditReturn';

export default function GoalsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; returnTo?: string }>();
  const { draft, progress, saveDraft, setProgress } = useOnboarding();
  const { setDirection } = useTransitionDir();
  const [selectedGoals, setSelectedGoals] = useState<string[]>(
    draft?.goals ?? [],
  );

  useEffect(() => {
    setSelectedGoals(draft?.goals ?? []);
  }, [draft?.goals]);

  useEffect(() => {
    if (progress < 5) {
      void setProgress(5);
    }
  }, [progress, setProgress]);

  const safeReturnTo = sanitizePostScanReturnTo(params.returnTo);
  const isPostScan = isPostScanMode(params.mode) && Boolean(safeReturnTo);
  const safeProfileReturnTo = sanitizeProfileEditReturnTo(params.returnTo);
  const isProfileEdit = isProfileEditMode(params.mode) && Boolean(safeProfileReturnTo);

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
      5,
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
    router.replace({
      pathname: '/onboarding/allergy',
      params: isPostScan && safeReturnTo
        ? { mode: POST_SCAN_MODE, returnTo: safeReturnTo }
        : isProfileEdit && safeProfileReturnTo
          ? { mode: PROFILE_EDIT_MODE, returnTo: safeProfileReturnTo }
          : undefined,
    });
  }, [
    draft?.preferredTypes,
    isPostScan,
    isProfileEdit,
    router,
    safeProfileReturnTo,
    safeReturnTo,
    saveDraft,
    selectedGoals,
    setDirection,
  ]);

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
        if (isProfileEdit && safeProfileReturnTo) {
          router.replace(safeProfileReturnTo);
          return;
        }
        router.replace({
          pathname: '/onboarding/data-trust',
          params: isPostScan && safeReturnTo
            ? { mode: POST_SCAN_MODE, returnTo: safeReturnTo }
            : undefined,
        });
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
