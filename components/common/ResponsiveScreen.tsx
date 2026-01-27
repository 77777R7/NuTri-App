import type { PropsWithChildren } from 'react';
import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';

type ResponsiveScreenProps = PropsWithChildren<{
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  gutter?: number;
}>;

export const ResponsiveScreen: React.FC<ResponsiveScreenProps> = ({
  children,
  edges = ['top', 'bottom'],
  style,
  contentStyle,
  gutter,
}) => {
  const { tokens } = useResponsiveTokens();
  const insets = useSafeAreaInsets();

  const topInset = edges.includes('top') ? insets.top : 0;
  const bottomInset = edges.includes('bottom') ? insets.bottom : 0;

  const safeAreaStyle: StyleProp<ViewStyle> = {
    backgroundColor: tokens.colors.background,
    paddingTop: Math.max(tokens.safeArea.top - topInset, 0),
    paddingBottom: Math.max(tokens.safeArea.bottom - bottomInset, 0),
  };

  const outerPadding: StyleProp<ViewStyle> = {
    paddingHorizontal: gutter ?? tokens.layout.gutter,
  };

  const contentFrame: StyleProp<ViewStyle> = {
    maxWidth: tokens.layout.maxContentWidth,
  };

  return (
    <SafeAreaView edges={edges} style={[styles.safeArea, safeAreaStyle, style]}>
      <View style={[styles.outer, outerPadding]}>
        <View style={[styles.content, contentFrame, contentStyle]}>{children}</View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  outer: {
    flex: 1,
    width: '100%',
  },
  content: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
  },
});
