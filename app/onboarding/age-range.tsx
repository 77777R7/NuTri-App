import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';

import { QASingleSelectScreen } from '@/components/onboarding/qa/QASingleSelectScreen';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { AGE_RANGE_OPTIONS } from '@/lib/onboarding-v2';

export default function AgeRangeScreen() {
  const router = useRouter();
  const { draft, progress, saveDraft, setProgress } = useOnboarding();
  const { setDirection } = useTransitionDir();
  const [selected, setSelected] = useState<string>(draft?.ageRange ?? '');

  useEffect(() => {
    setSelected(draft?.ageRange ?? '');
  }, [draft?.ageRange]);

  useEffect(() => {
    if (progress < 3) {
      void setProgress(3);
    }
  }, [progress, setProgress]);

  const goNext = useCallback(
    async (skip: boolean) => {
      if (!skip && !selected) return;

      const answer = skip ? 'skipped' : selected;

      setDirection('forward');
      await saveDraft({ ageRange: skip ? undefined : selected }, 3);
      trackOnboardingEvent('question_answered', {
        question: 'age_range',
        answer: answer,
      });
      router.replace('/onboarding/sex');
    },
    [router, saveDraft, selected, setDirection],
  );

  return (
    <QASingleSelectScreen
      screenKey="age-range"
      qaStepIndex={1}
      eyebrow="About you"
      title={'Which age range are\nyou in?'}
      subtitle="This helps tailor how guidance fits you."
      options={[...AGE_RANGE_OPTIONS]}
      value={selected}
      onSelect={setSelected}
      onBack={() => {
        setDirection('back');
        router.replace('/onboarding/data-trust');
      }}
      onContinue={() => goNext(false)}
      onSkip={() => goNext(true)}
      continueLabel="Continue"
      continueDisabled={!selected}
    />
  );
}
