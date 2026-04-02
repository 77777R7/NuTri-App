import React, { useCallback } from 'react';
import * as Haptics from 'expo-haptics';

import { QAOptionRow } from './QAOptionRow';
import { QAScreenShell } from './QAScreenShell';

type QASingleSelectScreenProps = {
  screenKey: string;
  qaStepIndex: number;
  transitionDirection?: 'forward' | 'back' | 'none';
  disableStepSlide?: boolean;
  enableHardwareBackHandling?: boolean;
  progressFillWidthOverride?: number;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  options: string[];
  value?: string;
  onSelect: (value: string) => void;
  onBack: () => void | Promise<void>;
  onContinue: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
  continueLabel?: string;
  continueDisabled?: boolean;
  footerHint?: string;
  footerError?: string | null;
};

export function QASingleSelectScreen({
  screenKey,
  qaStepIndex,
  transitionDirection,
  disableStepSlide,
  enableHardwareBackHandling,
  progressFillWidthOverride,
  eyebrow,
  title,
  subtitle,
  options,
  value,
  onSelect,
  onBack,
  onContinue,
  onSkip,
  continueLabel,
  continueDisabled,
  footerHint,
  footerError,
}: QASingleSelectScreenProps) {
  const handleSelect = useCallback(
    async (nextValue: string) => {
      try {
        await Haptics.selectionAsync();
      } catch {
        // noop
      }

      onSelect(nextValue);
    },
    [onSelect],
  );

  return (
    <QAScreenShell
      screenKey={screenKey}
      qaStepIndex={qaStepIndex}
      transitionDirection={transitionDirection}
      disableStepSlide={disableStepSlide}
      enableHardwareBackHandling={enableHardwareBackHandling}
      progressFillWidthOverride={progressFillWidthOverride}
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
      {options.map((option) => (
        <QAOptionRow
          key={option}
          label={option}
          selected={value === option}
          selectionMode="single"
          onPress={() => void handleSelect(option)}
        />
      ))}
    </QAScreenShell>
  );
}

export default QASingleSelectScreen;
