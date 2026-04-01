import React from 'react';
import { StyleSheet, View } from 'react-native';

import { OptionRow } from './OptionRow';
import { QuestionScreenShell } from './QuestionScreenShell';
import type {
  BaseStandardQuestionScreenProps,
  QuestionOption,
} from './standardQuestionTypes';

type StandardSingleSelectScreenProps = BaseStandardQuestionScreenProps & {
  options: QuestionOption[];
  value?: string;
  onSelect: (value: string) => void;
};

export const StandardSingleSelectScreen = ({
  screenKey,
  questionIndex,
  eyebrow,
  title,
  subtitle,
  options,
  value,
  onSelect,
  onBack,
  onContinue,
  onSkip,
  continueLabel = 'Continue',
  footerHint,
}: StandardSingleSelectScreenProps) => {
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
    >
      <View style={styles.list}>
        {options.map((option) => {
          const optionValue = option.value ?? option.label;
          return (
            <OptionRow
              key={optionValue}
              label={option.label}
              description={option.description}
              selected={value === optionValue}
              onPress={() => onSelect(optionValue)}
              accessibilityLabel={`${option.label}${value === optionValue ? ' selected' : ''}`}
              selectionMode="single"
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

export default StandardSingleSelectScreen;
