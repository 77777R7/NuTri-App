import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';

import { QASingleSelectScreen } from '@/components/onboarding/qa/QASingleSelectScreen';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { ADHERENCE_BLOCKER_OPTIONS } from '@/lib/onboarding-v2';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';

export default function BlockerScreen() {
  const router = useRouter();
  const { draft, saveDraft } = useOnboarding();
  const { setDirection } = useTransitionDir();
  const [selected, setSelected] = useState(draft?.adherenceBlocker ?? '');

  useEffect(() => {
    setSelected(draft?.adherenceBlocker ?? '');
  }, [draft?.adherenceBlocker]);

  const persist = useCallback(async () => {
    await saveDraft({ adherenceBlocker: selected || undefined }, 9);
    trackOnboardingEvent('question_answered', { question: 'adherence_blocker', answer: selected || 'skipped' });
    setDirection('forward');
    router.replace('/onboarding/setup');
  }, [router, saveDraft, selected, setDirection]);

  return (
    <QASingleSelectScreen
      screenKey="blocker"
      qaStepIndex={7}
      eyebrow="Daily rhythm"
      title="What usually gets in the way?"
      subtitle="Pick the one that fits best right now."
      options={[...ADHERENCE_BLOCKER_OPTIONS]}
      value={selected}
      onSelect={setSelected}
      onBack={() => {
        setDirection('back');
        router.replace('/onboarding/allergy');
      }}
      onContinue={persist}
      onSkip={persist}
      continueLabel="Continue"
    />
  );
}
