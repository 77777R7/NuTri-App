import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';

import { onboardingTypography } from '../shared/theme';

type QuestionHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
};

export function QuestionHeader({
  eyebrow,
  title,
  subtitle,
  style,
  titleStyle,
  subtitleStyle,
}: QuestionHeaderProps) {
  return (
    <View style={[styles.root, style]}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={[styles.title, titleStyle]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, subtitleStyle]}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 12,
    marginBottom: 24,
  },
  eyebrow: {
    ...onboardingTypography.eyebrow,
  },
  title: {
    ...onboardingTypography.pageTitle,
  },
  subtitle: {
    ...onboardingTypography.pageSubtitle,
  },
});

export default QuestionHeader;
