import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { CARD_RADIUS, CARD_SHADOW, FOREGROUND, HERO_CARDS, LABEL_TEXT } from './welcomeTokens';

const BLUR_PROPS =
  Platform.OS === 'android'
    ? ({ experimentalBlurMethod: 'dimezisBlurView' } as const)
    : ({} as const);

const ROTATE_INTERVAL_MS = 3950;
const EXIT_DROP_MS = 760;
const EXIT_PAUSE_MS = 80;
const EXIT_RETURN_MS = 1100;
const SETTLE_MS = 1120;
const FRONT_CONTENT_DELAY_MS = 140;
const FRONT_CONTENT_FADE_MS = 320;
const EXIT_CONTENT_FADE_MS = 280;

const cardPose = (offset: number) => {
  if (offset === 0) {
    return { translateY: 0, scale: 1, opacity: 1, zIndex: 40 };
  }

  if (offset === 1) {
    return { translateY: 16, scale: 0.94, opacity: 0.85, zIndex: 30 };
  }

  if (offset === 2) {
    return { translateY: 32, scale: 0.88, opacity: 0.65, zIndex: 20 };
  }

  return { translateY: 48, scale: 0.82, opacity: 0.45, zIndex: 10 };
};

type WelcomeHeroCarouselProps = {
  cardWidth: number;
  cardHeight: number;
};

type HeroCardItemProps = {
  index: number;
  currentIndex: number;
  exitingIndex: number | null;
  cardWidth: number;
  cardHeight: number;
  onExitComplete: (index: number) => void;
};

function HeroCardItem({
  index,
  currentIndex,
  exitingIndex,
  cardWidth,
  cardHeight,
  onExitComplete,
}: HeroCardItemProps) {
  const offset = (index - currentIndex + HERO_CARDS.length) % HERO_CARDS.length;
  const pose = cardPose(offset);
  const card = HERO_CARDS[index];
  const isFront = offset === 0;
  const isExiting = exitingIndex === index;
  const wasExitingRef = useRef(false);

  const translateY = useSharedValue(pose.translateY);
  const scale = useSharedValue(pose.scale);
  const opacity = useSharedValue(pose.opacity);
  const rotate = useSharedValue(0);
  const zIndex = useSharedValue(pose.zIndex);
  const contentOpacity = useSharedValue(isFront ? 1 : 0);
  const exitProgress = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(translateY);
    cancelAnimation(scale);
    cancelAnimation(opacity);
    cancelAnimation(rotate);
    cancelAnimation(exitProgress);
    cancelAnimation(contentOpacity);

    if (isExiting) {
      wasExitingRef.current = true;
      exitProgress.value = 0;
      zIndex.value = 50;
      exitProgress.value = withSequence(
        withTiming(0.4, {
          duration: EXIT_DROP_MS,
          easing: Easing.in(Easing.quad),
        }),
        withDelay(
          EXIT_PAUSE_MS,
          withTiming(
            1,
            {
              duration: EXIT_RETURN_MS,
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            },
            (done) => {
              'worklet';
              if (done) {
                runOnJS(onExitComplete)(index);
              }
            },
          ),
        ),
      );
      translateY.value = withTiming(
        48,
        {
          duration: EXIT_DROP_MS + EXIT_PAUSE_MS + EXIT_RETURN_MS,
          easing: Easing.linear,
        },
      );
      scale.value = withSequence(
        withTiming(0.85, {
          duration: EXIT_DROP_MS,
          easing: Easing.in(Easing.quad),
        }),
        withDelay(
          EXIT_PAUSE_MS,
          withTiming(0.82, {
            duration: EXIT_RETURN_MS,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        ),
      );
      opacity.value = withSequence(
        withTiming(0.85, {
          duration: EXIT_DROP_MS,
          easing: Easing.out(Easing.quad),
        }),
        withDelay(
          EXIT_PAUSE_MS,
          withTiming(0.45, {
            duration: EXIT_RETURN_MS,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        ),
      );
      rotate.value = withSequence(
        withTiming(-3, {
          duration: EXIT_DROP_MS,
          easing: Easing.in(Easing.quad),
        }),
        withDelay(
          EXIT_PAUSE_MS,
          withTiming(0, {
            duration: EXIT_RETURN_MS,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        ),
      );
      return;
    }

    if (wasExitingRef.current) {
      wasExitingRef.current = false;
      translateY.value = pose.translateY;
      scale.value = pose.scale;
      opacity.value = pose.opacity;
      rotate.value = 0;
      zIndex.value = pose.zIndex;
      exitProgress.value = 1;
      return;
    }

    translateY.value = withTiming(pose.translateY, {
      duration: SETTLE_MS,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
    scale.value = withTiming(pose.scale, {
      duration: SETTLE_MS,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
    opacity.value = withTiming(pose.opacity, {
      duration: SETTLE_MS,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
    rotate.value = withTiming(0, {
      duration: SETTLE_MS,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
      zIndex.value = pose.zIndex;
  }, [
    contentOpacity,
    exitProgress,
    index,
    isExiting,
    onExitComplete,
    opacity,
    pose.opacity,
    pose.scale,
    pose.translateY,
    pose.zIndex,
    rotate,
    scale,
    translateY,
    zIndex,
  ]);

  useEffect(() => {
    if (isExiting) {
      contentOpacity.value = withTiming(0, {
        duration: EXIT_CONTENT_FADE_MS,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }

    if (isFront) {
      contentOpacity.value = withDelay(
        FRONT_CONTENT_DELAY_MS,
        withTiming(1, {
          duration: FRONT_CONTENT_FADE_MS,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      );
      return;
    }

    contentOpacity.value = withTiming(0, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    });
  }, [contentOpacity, isExiting, isFront]);

  const animatedStyle = useAnimatedStyle(() => {
    if (isExiting) {
      const p = exitProgress.value;
      return {
        opacity: interpolate(p, [0, 0.4, 1], [1, 0.85, 0.45]),
        zIndex: p < 0.4 ? 50 : 10,
        transform: [
          { translateY: interpolate(p, [0, 0.4, 1], [0, 210, 48]) },
          { scale: interpolate(p, [0, 0.4, 1], [1, 0.85, 0.82]) },
          { rotate: `${interpolate(p, [0, 0.4, 1], [0, -3, 0])}deg` },
        ],
      };
    }

    return {
      opacity: opacity.value,
      zIndex: zIndex.value,
      transform: [
        { translateY: translateY.value },
        { scale: scale.value },
        { rotate: `${rotate.value}deg` },
      ],
    };
  }, [exitProgress, isExiting, opacity, rotate, scale, translateY, zIndex]);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.cardShell,
        { width: cardWidth, height: cardHeight },
        animatedStyle,
      ]}
    >
      <BlurView
        intensity={44}
        tint="light"
        style={[StyleSheet.absoluteFillObject, styles.cardBlur]}
        {...BLUR_PROPS}
      />
      <LinearGradient
        colors={[
          'rgba(255,255,255,0.88)',
          'rgba(252,253,255,0.78)',
          'rgba(245,248,255,0.62)',
        ]}
        start={{ x: 0.22, y: 0 }}
        end={{ x: 0.82, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        colors={[
          'rgba(255,255,255,0.68)',
          'rgba(255,255,255,0.14)',
          'rgba(102,136,255,0.06)',
        ]}
        start={{ x: 0.08, y: 0.02 }}
        end={{ x: 0.88, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.cardBorder} pointerEvents="none" />
      <View style={styles.cardTopSpecular} pointerEvents="none" />
      <View style={styles.cardBottomBounce} pointerEvents="none" />

      <Animated.View style={[styles.cardContent, contentStyle]}>
        <View style={styles.labelShell}>
          <BlurView
            intensity={18}
            tint="light"
            style={[StyleSheet.absoluteFillObject, styles.labelBlur]}
            {...BLUR_PROPS}
          />
          <LinearGradient
            colors={['rgba(255,255,255,0.76)', 'rgba(255,255,255,0.54)']}
            start={{ x: 0.18, y: 0 }}
            end={{ x: 0.82, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.labelBorder} pointerEvents="none" />
          <View style={styles.labelTopSpecular} pointerEvents="none" />
          <Text allowFontScaling={false} style={styles.labelText}>
            {card.label}
          </Text>
        </View>

        <Text allowFontScaling={false} style={styles.titleText}>
          {card.title}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

export function WelcomeHeroCarousel({
  cardWidth,
  cardHeight,
}: WelcomeHeroCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [exitingIndex, setExitingIndex] = useState<number | null>(null);

  const currentRef = useRef(0);

  useEffect(() => {
    currentRef.current = currentIndex;
  }, [currentIndex]);

  const handleExitComplete = (index: number) => {
    setExitingIndex((active) => (active === index ? null : active));
  };

  useEffect(() => {
    const timer = setInterval(() => {
      const previous = currentRef.current;
      const next = (previous + 1) % HERO_CARDS.length;

      setExitingIndex(previous);
      setCurrentIndex(next);
      currentRef.current = next;
    }, ROTATE_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const stackHeight = useMemo(() => cardHeight + 58, [cardHeight]);

  return (
    <View style={[styles.stackShell, { width: cardWidth, height: stackHeight }]}>
      {HERO_CARDS.map((_, index) => (
        <HeroCardItem
          key={index}
          index={index}
          currentIndex={currentIndex}
          exitingIndex={exitingIndex}
          cardWidth={cardWidth}
          cardHeight={cardHeight}
          onExitComplete={handleExitComplete}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stackShell: {
    position: 'relative',
    overflow: 'visible',
  },
  cardShell: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.36)',
    shadowColor: CARD_SHADOW,
    shadowOpacity: 0.56,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 18 },
    elevation: 16,
  },
  cardBlur: {
    borderRadius: CARD_RADIUS,
  },
  cardBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.82)',
  },
  cardTopSpecular: {
    position: 'absolute',
    top: 0,
    left: 18,
    right: 18,
    height: 8,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  cardBottomBounce: {
    position: 'absolute',
    left: 44,
    right: 44,
    bottom: 11,
    height: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(108,140,255,0.018)',
  },
  cardContent: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 26,
    paddingBottom: 24,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  labelShell: {
    minHeight: 31,
    paddingHorizontal: 18,
    borderRadius: 999,
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.62)',
    marginBottom: 18,
    shadowColor: '#D7DFF0',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  labelBlur: {
    borderRadius: 999,
  },
  labelBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.88)',
  },
  labelTopSpecular: {
    position: 'absolute',
    top: 1,
    left: 12,
    right: 12,
    height: 7,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  labelText: {
    fontSize: 10.5,
    lineHeight: 11,
    fontWeight: '700',
    letterSpacing: 2.6,
    textTransform: 'uppercase',
    color: LABEL_TEXT,
  },
  titleText: {
    maxWidth: 252,
    fontSize: 25,
    lineHeight: 34,
    fontWeight: '600',
    letterSpacing: -1.05,
    color: FOREGROUND,
  },
});
