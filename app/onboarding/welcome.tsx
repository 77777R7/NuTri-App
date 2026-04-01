import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated as RNAnimated,
  BackHandler,
  Easing as RNEasing,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { StepSlide } from '@/components/animation/StepSlide';
import { WelcomeHeroCarousel } from '@/components/onboarding/welcome/WelcomeHeroCarousel';
import { WelcomeHeroGlow } from '@/components/onboarding/welcome/WelcomeHeroGlow';
import { WelcomePrimaryCTA } from '@/components/onboarding/welcome/WelcomePrimaryCTA';
import {
  ACTIVE_BLUE,
  FOREGROUND,
  INACTIVE_DOT,
  MUTED,
  WELCOME_BG,
  WELCOME_BG_BOTTOM,
  WELCOME_BG_TOP,
} from '@/components/onboarding/welcome/welcomeTokens';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';

const BLUR_PROPS =
  Platform.OS === 'android'
    ? ({ experimentalBlurMethod: 'dimezisBlurView' } as const)
    : ({} as const);

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { progress, setProgress } = useOnboarding();
  const { setDirection, consumeDirection } = useTransitionDir();

  const cardWidth = Math.min(width - 56, 320);
  const cardHeight = Math.round(cardWidth * 0.553);
  const isCompactHeight = height < 860;

  const enterDir = useMemo(() => {
    const direction = consumeDirection();
    return direction === 'none' ? 'none' : direction;
  }, [consumeDirection]);

  const logoOpacity = useRef(new RNAnimated.Value(0)).current;
  const logoTranslate = useRef(new RNAnimated.Value(18)).current;
  const heroOpacity = useRef(new RNAnimated.Value(0)).current;
  const heroTranslate = useRef(new RNAnimated.Value(18)).current;
  const copyOpacity = useRef(new RNAnimated.Value(0)).current;
  const copyTranslate = useRef(new RNAnimated.Value(18)).current;
  const footerOpacity = useRef(new RNAnimated.Value(0)).current;
  const footerTranslate = useRef(new RNAnimated.Value(18)).current;
  const microcopyOpacity = useRef(new RNAnimated.Value(1)).current;
  const microcopyTranslate = useRef(new RNAnimated.Value(0)).current;
  const isNavigatingRef = useRef(false);

  const floatY = useSharedValue(0);
  const pulse = useSharedValue(0);
  const diffuse = useSharedValue(0);

  useFocusEffect(
    useCallback(() => {
      const onHardwareBackPress = () => true;
      const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBackPress);
      return () => subscription.remove();
    }, []),
  );

  useEffect(() => {
    if (progress !== 1) {
      void setProgress(1);
    }
  }, [progress, setProgress]);

  useEffect(() => {
    RNAnimated.sequence([
      RNAnimated.parallel([
        RNAnimated.timing(logoOpacity, {
          toValue: 1,
          duration: 620,
          easing: RNEasing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: true,
        }),
        RNAnimated.timing(logoTranslate, {
          toValue: 0,
          duration: 620,
          easing: RNEasing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: true,
        }),
      ]),
      RNAnimated.parallel([
        RNAnimated.timing(heroOpacity, {
          toValue: 1,
          duration: 720,
          easing: RNEasing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: true,
        }),
        RNAnimated.timing(heroTranslate, {
          toValue: 0,
          duration: 720,
          easing: RNEasing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: true,
        }),
      ]),
      RNAnimated.parallel([
        RNAnimated.timing(copyOpacity, {
          toValue: 1,
          duration: 560,
          easing: RNEasing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: true,
        }),
        RNAnimated.timing(copyTranslate, {
          toValue: 0,
          duration: 560,
          easing: RNEasing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: true,
        }),
      ]),
      RNAnimated.parallel([
        RNAnimated.timing(footerOpacity, {
          toValue: 1,
          duration: 520,
          easing: RNEasing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: true,
        }),
        RNAnimated.timing(footerTranslate, {
          toValue: 0,
          duration: 520,
          easing: RNEasing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [copyOpacity, copyTranslate, footerOpacity, footerTranslate, heroOpacity, heroTranslate, logoOpacity, logoTranslate]);

  useEffect(() => {
    floatY.value = withRepeat(
      withSequence(
        withTiming(-7, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );

    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2100, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 2100, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );

    diffuse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 3500, easing: Easing.bezier(0.16, 1, 0.3, 1) }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );

    return () => {
      cancelAnimation(floatY);
      cancelAnimation(pulse);
      cancelAnimation(diffuse);
    };
  }, [diffuse, floatY, pulse]);

  const heroFloatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }],
  }));

  const handleGetStarted = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;

    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }

    RNAnimated.parallel([
      RNAnimated.timing(microcopyOpacity, {
        toValue: 0,
        duration: 280,
        easing: RNEasing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
      RNAnimated.timing(microcopyTranslate, {
        toValue: 8,
        duration: 280,
        easing: RNEasing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
    ]).start();

    setDirection('forward');
    await new Promise((resolve) => setTimeout(resolve, 130));
    await setProgress(2);
    trackOnboardingEvent('onboarding_started', { version: 'welcome_cta_root_fix_v1' });
    router.replace('/onboarding/data-trust');
  }, [microcopyOpacity, microcopyTranslate, router, setDirection, setProgress]);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[WELCOME_BG_TOP, WELCOME_BG_BOTTOM]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <StepSlide direction={enterDir} slideOnFirst mountKey="welcome-cta-root-fix" style={styles.slideWrap}>
        <View style={[styles.screen, { paddingTop: insets.top + 10 }]}>
          <RNAnimated.View
            style={[
              styles.logoWrap,
              {
                opacity: logoOpacity,
                transform: [{ translateY: logoTranslate }],
              },
            ]}
          >
            <View style={styles.logoPill}>
              <BlurView
                intensity={18}
                tint="light"
                style={[StyleSheet.absoluteFillObject, styles.logoBlur]}
                {...BLUR_PROPS}
              />
              <LinearGradient
                colors={['rgba(255,255,255,0.58)', 'rgba(255,255,255,0.44)']}
                start={{ x: 0.18, y: 0 }}
                end={{ x: 0.82, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={styles.logoPillBorder} pointerEvents="none" />
              <Text allowFontScaling={false} style={styles.logoText}>
                NuTri
              </Text>
            </View>
          </RNAnimated.View>

          <View style={styles.main}>
            <View style={[styles.viewport, isCompactHeight && styles.viewportCompact]}>
              <RNAnimated.View
                style={[
                  styles.heroArea,
                  isCompactHeight && styles.heroAreaCompact,
                  {
                    opacity: heroOpacity,
                    transform: [{ translateY: heroTranslate }],
                  },
                ]}
              >
                <Animated.View style={[styles.heroShell, heroFloatStyle]}>
                  <WelcomeHeroGlow
                    cardWidth={cardWidth}
                    cardHeight={cardHeight}
                    pulse={pulse}
                    diffuse={diffuse}
                  />
                  <WelcomeHeroCarousel cardWidth={cardWidth} cardHeight={cardHeight} />
                </Animated.View>
              </RNAnimated.View>

              <RNAnimated.View
                style={[
                  styles.copyWrap,
                  isCompactHeight && styles.copyWrapCompact,
                  {
                    opacity: copyOpacity,
                    transform: [{ translateY: copyTranslate }],
                  },
                ]}
              >
                <Text allowFontScaling={false} style={[styles.headline, isCompactHeight && styles.headlineCompact]}>
                  Welcome to NuTri
                </Text>
                <Text allowFontScaling={false} style={[styles.subtext, isCompactHeight && styles.subtextCompact]}>
                  Answer a few quick questions and NuTri will shape the clearest next picks for you.
                </Text>
              </RNAnimated.View>
            </View>

            <RNAnimated.View
              style={[
                styles.footer,
                isCompactHeight && styles.footerCompact,
                {
                  opacity: footerOpacity,
                  transform: [{ translateY: footerTranslate }],
                  paddingBottom: Math.max(insets.bottom, 18) + 10,
                },
              ]}
            >
              <View style={styles.progressRow}>
                <View style={styles.progressActivePill} />
                <View style={styles.progressInactiveDot} />
              </View>

              <WelcomePrimaryCTA title="Get Started" onPress={handleGetStarted} />

              <View style={styles.microcopySlot}>
                <RNAnimated.Text
                  allowFontScaling={false}
                  style={[
                    styles.microcopy,
                    {
                      opacity: microcopyOpacity,
                      transform: [{ translateY: microcopyTranslate }],
                    },
                  ]}
                >
                  Takes less than a minute
                </RNAnimated.Text>
              </View>
            </RNAnimated.View>
          </View>
        </View>
      </StepSlide>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: WELCOME_BG,
  },
  slideWrap: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: WELCOME_BG,
  },
  logoWrap: {
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  main: {
    flex: 1,
  },
  logoPill: {
    minWidth: 86,
    height: 40,
    paddingHorizontal: 22,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#CAD4E8',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  logoBlur: {
    borderRadius: 999,
  },
  logoPillBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  logoText: {
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: -0.34,
    color: FOREGROUND,
  },
  viewport: {
    flex: 1,
    marginTop: 4,
    paddingTop: 0,
    paddingBottom: 16,
    justifyContent: 'space-between',
  },
  viewportCompact: {
    paddingBottom: 10,
  },
  heroArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 0,
    paddingBottom: 16,
  },
  heroAreaCompact: {
    paddingBottom: 8,
  },
  heroShell: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  copyWrap: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 0,
  },
  copyWrapCompact: {
    paddingBottom: 0,
  },
  headline: {
    fontSize: 44,
    lineHeight: 48,
    fontWeight: '700',
    letterSpacing: -2,
    textAlign: 'center',
    color: FOREGROUND,
  },
  headlineCompact: {
    fontSize: 42,
    lineHeight: 45,
    letterSpacing: -1.8,
  },
  subtext: {
    marginTop: 12,
    maxWidth: 312,
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '500',
    textAlign: 'center',
    color: MUTED,
  },
  subtextCompact: {
    fontSize: 16,
    lineHeight: 24,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 10,
    alignItems: 'center',
    minHeight: 166,
  },
  footerCompact: {
    paddingTop: 8,
    minHeight: 158,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  progressActivePill: {
    width: 28,
    height: 6,
    borderRadius: 999,
    backgroundColor: ACTIVE_BLUE,
  },
  progressInactiveDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: INACTIVE_DOT,
  },
  microcopy: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '500',
    color: MUTED,
  },
  microcopySlot: {
    width: '100%',
    height: 20,
    marginTop: 14,
    position: 'relative',
  },
});
