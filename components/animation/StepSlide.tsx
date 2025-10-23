import React, { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, useWindowDimensions, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { TransitionDir } from '@/contexts/TransitionContext';

/**
 * NuTri StepSlide
 * 设计：轻量位移 + 淡入 + 0.985→1 的微缩放，曲线用 iOS 感较强的 easeOut
 * 目标：清爽、不夸张；方向明确；首屏也能看见（但不刺眼）
 */
const MOTION = {
  // 位移占屏宽比例（设上限，防止大屏过远）
  distancePct: 0.28,    // 28% 屏宽
  tinyPct: 0.12,        // 首屏轻滑占比
  capPx: 120,           // 最大位移上限
  duration: 360,        // 位移动画时长
  fade: 280,            // 透明度动画时长
  easingOut: Easing.bezier(0.16, 1, 0.3, 1), // 更自然的 ease-out
  scaleFrom: 0.985,     // 微缩放起点 → 1
};

type Props = {
  direction: TransitionDir;         // 'forward' | 'back' | 'none'
  children: React.ReactNode;
  style?: ViewStyle;
  durationMs?: number;              // 覆盖位移时长（可选）
  slideOnFirst?: boolean;           // 首屏是否也轻滑（默认 true）
  mountKey?: string | number;       // 强制重放用（推荐 `${step}-${direction}`）
};

export const StepSlide: React.FC<Props> = ({
  direction,
  children,
  style,
  durationMs,
  slideOnFirst = true,
  mountKey,
}) => {
  const { width } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => setReduceMotion(!!v));
  }, []);

  // 计算起点位移（含上限）
  const base = Math.min(width * MOTION.distancePct, MOTION.capPx);
  const tiny = Math.min(width * MOTION.tinyPct, MOTION.capPx * 0.6);

  const fromX = useMemo(() => {
    if (direction === 'forward') return +base;
    if (direction === 'back') return -base;
    return slideOnFirst ? +tiny : 0;
  }, [direction, base, tiny, slideOnFirst]);

  // 如果系统“减少动态效果”开启，则直接无动画静态呈现
  const DURATION = durationMs ?? MOTION.duration;
  const FADE = MOTION.fade;

  const tx = useSharedValue(reduceMotion ? 0 : fromX);
  const op = useSharedValue(reduceMotion ? 1 : 0);
  const sc = useSharedValue(reduceMotion ? 1 : MOTION.scaleFrom);

  useEffect(() => {
    if (reduceMotion) return;
    // 入场动画：位移 + 淡入 + 轻微缩放回弹
    tx.value = withTiming(0, { duration: DURATION, easing: MOTION.easingOut });
    op.value = withTiming(1, { duration: FADE, easing: MOTION.easingOut });
    sc.value = withTiming(1, { duration: DURATION, easing: MOTION.easingOut });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountKey, fromX, reduceMotion]);

  const anim = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { scale: sc.value }],
    opacity: op.value,
  }));

  return (
    <Animated.View style={[{ flex: 1 }, style, anim]}>
      {children}
    </Animated.View>
  );
};
