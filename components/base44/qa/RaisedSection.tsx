import React from 'react';
import { View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, spacing } from '@/lib/theme';

type Props = {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
};

/**
 * 分组卡片的“漂浮层”：大半径 + 软长阴影 + 顶部轻高光
 * 用在 Gender 整组/输入整组外层，营造 Web 图那种层级
 */
export function RaisedSection({ children, style }: Props) {
  return (
    <View
      style={[
        {
          borderRadius: 28,
          backgroundColor: colors.surfaceSoft,
          padding: spacing.lg,
          // 软、长下投影（iOS）
          shadowColor: '#000',
          shadowOpacity: 0.08,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 12 },
          // Android
          elevation: 8,
        },
        style,
      ]}
    >
      {/* 顶部轻高光，模拟 Web 的上缘反射 */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0.6)', 'transparent']}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 10, borderTopLeftRadius: 28, borderTopRightRadius: 28 }}
      />
      {children}
    </View>
  );
}
