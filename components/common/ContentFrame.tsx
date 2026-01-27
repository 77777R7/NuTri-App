import type { PropsWithChildren } from 'react';
import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';

import { useScreenTokens } from '@/hooks/useScreenTokens';

type ContentFrameProps = PropsWithChildren<{
  navHeight: number;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}>;

export const ContentFrame: React.FC<ContentFrameProps> = ({ children, navHeight, style, containerStyle }) => {
  const tokens = useScreenTokens(navHeight);

  return (
    <View style={[styles.container, { paddingHorizontal: tokens.pageX }, containerStyle]}>
      <View style={[styles.frame, { maxWidth: tokens.frameWidth }, style]}>{children}</View>
    </View>
  );
};

const styles = {
  container: {
    width: '100%',
  } as ViewStyle,
  frame: {
    width: '100%',
    alignSelf: 'center',
  } as ViewStyle,
};
