import React from 'react';
import { ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { GuardrailScreenShell } from './GuardrailScreenShell';

type InfoScreenShellProps = {
  screenKey: string;
  topMode: 'brand' | 'back' | 'progress';
  questionIndex?: number;
  onBack?: () => void;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  scrollContentStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

export function InfoScreenShell({
  screenKey,
  topMode,
  questionIndex,
  onBack,
  header,
  footer,
  scrollContentStyle,
  children,
}: InfoScreenShellProps) {
  return (
    <GuardrailScreenShell
      screenKey={screenKey}
      topMode={topMode}
      questionIndex={questionIndex}
      onBack={onBack}
      footer={footer}
    >
      <ScrollView contentContainerStyle={[styles.scrollContent, scrollContentStyle]} showsVerticalScrollIndicator={false}>
        {header ? <View style={styles.headerWrap}>{header}</View> : null}
        {children}
      </ScrollView>
    </GuardrailScreenShell>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
  headerWrap: {
    width: '100%',
  },
});

export default InfoScreenShell;
