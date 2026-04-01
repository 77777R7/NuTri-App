import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';

import { QASingleSelectScreen } from '@/components/onboarding/qa/QASingleSelectScreen';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { SUPPLEMENT_EXPERIENCE_OPTIONS } from '@/lib/onboarding-v2';

export default function ExperienceScreen() {
  const router = useRouter();
  const { draft, progress, saveDraft, setProgress } = useOnboarding();
  const { setDirection } = useTransitionDir();
  const [selected, setSelected] = useState(draft?.supplementExperience ?? '');

  useEffect(() => {
    setSelected(draft?.supplementExperience ?? '');
  }, [draft?.supplementExperience]);

  useEffect(() => {
    if (progress < 5) {
      void setProgress(5);
    }
  }, [progress, setProgress]);

  const persist = useCallback(async () => {
    await saveDraft({ supplementExperience: selected || undefined }, 5);
    trackOnboardingEvent('question_answered', {
      question: 'supplement_experience',
      answer: selected || 'skipped',
    });
    setDirection('forward');
    router.replace('/onboarding/goals');
  }, [router, saveDraft, selected, setDirection]);

  return (
    <QASingleSelectScreen
      screenKey="experience"
      qaStepIndex={3}
      eyebrow="About you"
      title="How familiar are you with supplements?"
      subtitle="This helps shape how much guidance feels right."
      options={[...SUPPLEMENT_EXPERIENCE_OPTIONS]}
      value={selected}
      onSelect={setSelected}
      onBack={() => {
        setDirection('back');
        router.replace('/onboarding/sex');
      }}
      onContinue={persist}
      onSkip={persist}
      continueLabel="Continue"
    />
  );
}
