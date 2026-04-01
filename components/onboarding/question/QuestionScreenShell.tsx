import React from 'react';
import { ScrollView, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { onboardingPalette } from '../shared/theme';
import { GuardrailScreenShell } from '../shared/GuardrailScreenShell';
import { PrimaryCTA } from '../shared/PrimaryCTA';
import { QuestionHeader } from './QuestionHeader';

type QuestionScreenShellProps = {
  screenKey: string;
  questionIndex: number;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  onBack: () => void;
  onContinue: () => void;
  onSkip?: () => void;
  continueLabel?: string;
  footerHint?: string;
  footerError?: string | null;
  contentContainerStyle?: StyleProp<ViewStyle>;
  bodyStyle?: StyleProp<ViewStyle>;
  scrollable?: boolean;
  children: React.ReactNode;
};

export function QuestionScreenShell({
  screenKey,
  questionIndex,
  eyebrow,
  title,
  subtitle,
  onBack,
  onContinue,
  onSkip,
  continueLabel = 'Continue',
  footerHint,
  footerError,
  contentContainerStyle,
  bodyStyle,
  scrollable = true,
  children,
}: QuestionScreenShellProps) {
  const content = (
    <>
      <QuestionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <View style={bodyStyle}>{children}</View>
    </>
  );

  return (
    <GuardrailScreenShell
      screenKey={screenKey}
      topMode="progress"
      questionIndex={questionIndex}
      onBack={onBack}
      footer={
        <View style={styles.footerWrap}>
          <PrimaryCTA title={continueLabel} onPress={onContinue} />
          {onSkip ? (
            <Text onPress={onSkip} style={styles.skipText}>
              Skip for now
            </Text>
          ) : null}
          {footerError ? <Text style={styles.footerError}>{footerError}</Text> : null}
          {footerHint ? <Text style={styles.footerHint}>{footerHint}</Text> : null}
        </View>
      }
    >
      {scrollable ? (
        <ScrollView contentContainerStyle={[styles.scrollContent, contentContainerStyle]} showsVerticalScrollIndicator={false}>
          {content}
        </ScrollView>
      ) : (
        <View style={[styles.staticBody, contentContainerStyle]}>{content}</View>
      )}
    </GuardrailScreenShell>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingTop: 24,
    paddingBottom: 8,
  },
  staticBody: {
    flex: 1,
    paddingTop: 24,
  },
  footerWrap: {
    gap: 14,
  },
  skipText: {
    alignSelf: 'center',
    color: onboardingPalette.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  footerHint: {
    alignSelf: 'center',
    color: onboardingPalette.textMuted,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  footerError: {
    alignSelf: 'center',
    color: '#E1567A',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default QuestionScreenShell;
