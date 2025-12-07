// components/ui/motion-native.tsx
import React, { ComponentProps } from 'react';
import { View, Text, Pressable } from 'react-native';
import { MotiView, MotiText, AnimatePresence as MotiAnimatePresence } from 'moti';
import { MotiPressable } from 'moti/interactions';
import { cssInterop } from 'nativewind';

// 让 MotiView 支持 className
cssInterop(MotiView, {
  className: {
    target: 'style',
  },
});

// 让 MotiText 支持 className
cssInterop(MotiText, {
  className: {
    target: 'style',
  },
});

// 让 MotiPressable 支持 className（注意：先确认它存在）
if (MotiPressable) {
  cssInterop(MotiPressable, {
    className: {
      target: 'style',
    },
  });
}

type WithClassName<P> = P & { className?: string };
type ViewProps = WithClassName<ComponentProps<typeof MotiView>>;
type TextProps = WithClassName<ComponentProps<typeof MotiText>>;
type PressableProps = WithClassName<ComponentProps<typeof MotiPressable>>;

// 对外导出的“motion 组件”
export const MotionView = (props: ViewProps) => <MotiView {...props} />;
export const MotionText = (props: TextProps) => <MotiText {...props} />;
export const MotionPressable = (props: PressableProps) => {
  if (MotiPressable) {
    return <MotiPressable {...props} />;
  }

  const { children, ...rest } = props;
  const fallbackChildren =
    typeof children === 'function'
      ? (children as unknown as ComponentProps<typeof Pressable>['children'])
      : children;

  return (
    <Pressable {...(rest as ComponentProps<typeof Pressable>)}>
      {fallbackChildren}
    </Pressable>
  );
};

// 用来模拟 web 里的 div/span/button
export const Div = (props: WithClassName<ComponentProps<typeof View>>) => <View {...props} />;
export const Span = (props: WithClassName<ComponentProps<typeof Text>>) => <Text {...props} />;
export const Btn = (props: WithClassName<ComponentProps<typeof Pressable>>) => <Pressable {...props} />;

// AnimatePresence 直接透传
export const AnimatePresence = MotiAnimatePresence;
