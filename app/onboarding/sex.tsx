import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';

import { QASingleSelectScreen } from '@/components/onboarding/qa/QASingleSelectScreen';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { SEX_OPTIONS } from '@/lib/onboarding-v2';

export default function SexScreen() {
  const router = useRouter();
  const { draft, progress, saveDraft, setProgress } = useOnboarding();
  const { setDirection } = useTransitionDir();
  const [selected, setSelected] = useState(draft?.sex ?? draft?.gender ?? '');

  useEffect(() => {
    setSelected(draft?.sex ?? draft?.gender ?? '');
  }, [draft?.gender, draft?.sex]);

  useEffect(() => {
    if (progress < 4) {
      void setProgress(4);
    }
  }, [progress, setProgress]);

  const persist = useCallback(async () => {
    await saveDraft(
      { sex: selected || undefined, gender: selected || undefined },
      4,
    );
    trackOnboardingEvent('question_answered', {
      question: 'sex',
      answer: selected || 'skipped',
    });
    setDirection('forward');
    router.replace('/onboarding/experience');
  }, [router, saveDraft, selected, setDirection]);

  return (
    <QASingleSelectScreen
      screenKey="sex"
      qaStepIndex={2}
      eyebrow="About you"
      title="How do you identify?"
      subtitle="Choose what feels right for your profile."
      options={[...SEX_OPTIONS]}
      value={selected}
      onSelect={setSelected}
      onBack={() => {
        setDirection('back');
        router.replace('/onboarding/age-range');
      }}
      onContinue={persist}
      onSkip={persist}
      continueLabel="Continue"
    />
  );
}
