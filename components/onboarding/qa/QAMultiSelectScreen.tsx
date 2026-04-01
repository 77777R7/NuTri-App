import React, { useCallback } from 'react';
import * as Haptics from 'expo-haptics';

import { QAOptionRow } from './QAOptionRow';
import { QAScreenShell } from './QAScreenShell';

type QAMultiSelectScreenProps = {
  screenKey: string;
  qaStepIndex: number;
  transitionDirection?: 'forward' | 'back' | 'none';
  disableStepSlide?: boolean;
  enableHardwareBackHandling?: boolean;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  options: string[];
  values: string[];
  onToggle: (value: string) => void;
  onBack: () => void | Promise<void>;
  onContinue: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
  continueLabel?: string;
  continueDisabled?: boolean;
  footerHint?: string;
  footerError?: string | null;
};

export function QAMultiSelectScreen({
  screenKey,
  qaStepIndex,
  transitionDirection,
  disableStepSlide,
  enableHardwareBackHandling,
  eyebrow,
  title,
  subtitle,
  options,
  values,
  onToggle,
  onBack,
  onContinue,
  onSkip,
  continueLabel,
  continueDisabled,
  footerHint,
  footerError,
}: QAMultiSelectScreenProps) {
  const handleToggle = useCallback(
    async (nextValue: string) => {
      try {
        await Haptics.selectionAsync();
      } catch {
        // noop
      }

      onToggle(nextValue);
    },
    [onToggle],
  );

  return (
    <QAScreenShell
      screenKey={screenKey}
      qaStepIndex={qaStepIndex}
      transitionDirection={transitionDirection}
      disableStepSlide={disableStepSlide}
      enableHardwareBackHandling={enableHardwareBackHandling}
      eyebrow={eyebrow}
      title={title}
      subtitle={subtitle}
      onBack={onBack}
      onContinue={onContinue}
      onSkip={onSkip}
      continueLabel={continueLabel}
      continueDisabled={continueDisabled}
      footerHint={footerHint}
      footerError={footerError}
    >
      {options.map((option) => {
        const selected = values.includes(option);
        return (
          <QAOptionRow
            key={option}
            label={option}
            selected={selected}
            selectionMode="multiple"
            onPress={() => void handleToggle(option)}
          />
        );
      })}
    </QAScreenShell>
  );
}

export default QAMultiSelectScreen;
