import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { GuardrailScreenShell } from '../shared/GuardrailScreenShell';
import { QuestionHeader } from '../question/QuestionHeader';

type SummaryScreenShellProps = {
  screenKey: string;
  questionIndex: number;
  eyebrow: string;
  title: string;
  subtitle: string;
  onBack: () => void;
  footer: React.ReactNode;
  scrollContentStyle?: StyleProp<ViewStyle>;
  bodyStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

export function SummaryScreenShell({
  screenKey,
  questionIndex,
  eyebrow,
  title,
  subtitle,
  onBack,
  footer,
  scrollContentStyle,
  bodyStyle,
  children,
}: SummaryScreenShellProps) {
  return (
    <GuardrailScreenShell
      screenKey={screenKey}
      topMode="progress"
      questionIndex={questionIndex}
      onBack={onBack}
      footer={footer}
    >
      <View style={styles.body}>
        <QuestionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} style={styles.headerBlock} />
        <View style={[styles.scrollWrap, bodyStyle]}>
          <View style={[styles.scrollContent, scrollContentStyle]}>{children}</View>
        </View>
      </View>
    </GuardrailScreenShell>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingTop: 22,
  },
  headerBlock: {
    marginBottom: 16,
  },
  scrollWrap: {
    flex: 1,
    position: 'relative',
  },
  scrollContent: {
    flex: 1,
  },
});

export default SummaryScreenShell;
