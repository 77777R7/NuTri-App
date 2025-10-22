import { ReactNode } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { gradients } from '@/lib/theme';

type BrandGradientProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function BrandGradient({ children, style }: BrandGradientProps) {
  return (
    <LinearGradient
      colors={gradients.mint}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ flex: 1 }, style]}
    >
      {children}
    </LinearGradient>
  );
}
