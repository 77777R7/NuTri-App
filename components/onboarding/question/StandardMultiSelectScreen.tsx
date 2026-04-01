import React from 'react';
import { StyleSheet, View } from 'react-native';

import { OptionRow } from './OptionRow';
import { QuestionScreenShell } from './QuestionScreenShell';
import type {
  BaseStandardQuestionScreenProps,
  QuestionOption,
} from './standardQuestionTypes';

type StandardMultiSelectScreenProps = BaseStandardQuestionScreenProps & {
  options: QuestionOption[];
  values: string[];
  onToggle: (value: string) => void;
};

export const StandardMultiSelectScreen = ({
  screenKey,
  questionIndex,
  eyebrow,
  title,
  subtitle,
  options,
  values,
  onToggle,
  onBack,
  onContinue,
  onSkip,
  continueLabel = 'Continue',
  footerHint,
  footerError,
}: StandardMultiSelectScreenProps) => {
  return (
    <QuestionScreenShell
      screenKey={screenKey}
      questionIndex={questionIndex}
      eyebrow={eyebrow}
      title={title}
      subtitle={subtitle}
      onBack={onBack}
      onContinue={onContinue}
      onSkip={onSkip}
      continueLabel={continueLabel}
      footerHint={footerHint}
      footerError={footerError}
    >
      <View style={styles.list}>
        {options.map((option) => {
          const optionValue = option.value ?? option.label;
          const selected = values.includes(optionValue);
          return (
            <OptionRow
              key={optionValue}
              label={option.label}
              description={option.description}
              selected={selected}
              onPress={() => onToggle(optionValue)}
              accessibilityLabel={`${option.label}${selected ? ' selected' : ''}`}
              selectionMode="multiple"
            />
          );
        })}
      </View>
    </QuestionScreenShell>
  );
};

const styles = StyleSheet.create({
  list: {
    gap: 14,
  },
});

export default StandardMultiSelectScreen;
