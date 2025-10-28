import React from 'react';
import { View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radii } from '@/lib/theme';

type Props = {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  radius?: number;
};

/**
 * 更贴近 Web 的 inset 效果：
 * - 顶/底/左/右 四条渐变叠层（顶亮、底暗、左右微暗），阴影更均匀
 * - 背景使用 surfaceSoft，输入本体透明
 */
export function InnerNeumorphic({ children, style, radius = radii.xl }: Props) {
  return (
    <View
      style={[
        { borderRadius: radius, backgroundColor: colors.surfaceSoft, overflow: 'hidden' },
        style,
      ]}
    >
      {/* 顶部高光（更柔） */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0.75)', 'transparent']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 12 }}
      />
      {/* 底部内阴影（减淡） */}
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', 'rgba(0,0,0,0.06)']}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 12 }}
      />
      {/* 左右微阴影，避免只有上下的“金属管”感 */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.04)', 'transparent']}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 10 }}
        start={[0, 0.5]}
        end={[1, 0.5]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', 'rgba(0,0,0,0.04)']}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 10 }}
        start={[0, 0.5]}
        end={[1, 0.5]}
      />
      {children}
    </View>
  );
}
