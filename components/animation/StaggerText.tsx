import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleProp,
  StyleSheet,
  TextStyle,
  View,
} from 'react-native';

import { Text } from '@/components/ui/nativewind-primitives';

type StaggerTextProps = {
  text: string;
  style?: StyleProp<TextStyle>;
  delay?: number;
  duration?: number;
  wordDelay?: number;
  translateY?: number;
};

type StaggerTextComponent = React.FC<StaggerTextProps> & {
  H1: React.FC<StaggerTextProps>;
  P: React.FC<StaggerTextProps>;
};

const AnimatedText = Animated.createAnimatedComponent(Text as any);

const useReduceMotion = () => {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let isMounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then(value => {
      if (isMounted) {
        setReduceMotion(Boolean(value));
      }
    });

    const listener = AccessibilityInfo.addEventListener?.('reduceMotionChanged', value => {
      setReduceMotion(Boolean(value));
    });

    return () => {
      isMounted = false;
      listener?.remove?.();
    };
  }, []);

  return reduceMotion;
};

type AnimatedWordProps = {
  word: string;
  index: number;
  isLast: boolean;
  style?: StyleProp<TextStyle>;
  delay: number;
  duration: number;
  wordDelay: number;
  translateFrom: number;
  reduceMotion: boolean;
};

const AnimatedWord = ({
  word,
  index,
  isLast,
  style,
  delay,
  duration,
  wordDelay,
  translateFrom,
  reduceMotion,
}: AnimatedWordProps) => {
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const translate = useRef(new Animated.Value(reduceMotion ? 0 : translateFrom)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      translate.setValue(0);
      return;
    }

    opacity.setValue(0);
    translate.setValue(translateFrom);

    const easing = Easing.out(Easing.cubic);
    const timingConfig = {
      toValue: 1,
      duration,
      easing,
      delay: delay + index * wordDelay,
      useNativeDriver: true,
    };

    Animated.timing(opacity, timingConfig).start();
    Animated.timing(translate, {
      ...timingConfig,
      toValue: 0,
    }).start();
  }, [delay, duration, index, opacity, reduceMotion, translate, translateFrom, wordDelay]);

  const animatedStyle = {
    opacity,
    transform: [{ translateY: translate }],
  };

  return (
    <AnimatedText style={[styles.word, style, animatedStyle]}>
      {isLast ? word : `${word} `}
    </AnimatedText>
  );
};

const StaggerTextBase: React.FC<StaggerTextProps> = ({
  text,
  style,
  delay = 0,
  duration = 320,
  wordDelay = 40,
  translateY = 12,
}) => {
  const reduceMotion = useReduceMotion();
  const words = useMemo(() => {
    if (!text?.trim()) return [];
    return text.trim().split(/\s+/);
  }, [text]);

  return (
    <View style={styles.container} accessibilityRole="text">
      {words.map((word, index) => (
        <AnimatedWord
          key={`${word}-${index}`}
          word={word}
          index={index}
          isLast={index === words.length - 1}
          style={style}
          delay={delay}
          duration={duration}
          wordDelay={wordDelay}
          translateFrom={translateY}
          reduceMotion={reduceMotion}
        />
      ))}
    </View>
  );
};

const StaggerText = StaggerTextBase as StaggerTextComponent;

const StaggerTextH1: React.FC<StaggerTextProps> = props => (
  <StaggerTextBase
    translateY={props.translateY ?? 18}
    duration={props.duration ?? 360}
    wordDelay={props.wordDelay ?? 60}
    {...props}
  />
);

StaggerTextH1.displayName = 'StaggerText.H1';

const StaggerTextP: React.FC<StaggerTextProps> = props => (
  <StaggerTextBase
    translateY={props.translateY ?? 12}
    duration={props.duration ?? 280}
    wordDelay={props.wordDelay ?? 40}
    {...props}
  />
);

StaggerTextP.displayName = 'StaggerText.P';

StaggerText.H1 = StaggerTextH1;
StaggerText.P = StaggerTextP;

export { StaggerText };

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  word: {
    includeFontPadding: false,
  },
});
