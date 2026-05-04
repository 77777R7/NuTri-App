import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated as RNAnimated,
  BackHandler,
  Easing as RNEasing,
  Linking,
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
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { StepSlide } from '@/components/animation/StepSlide';
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

const PRIVACY_POLICY_URL = 'https://www.nutri.app/privacy';

const BLUR_PROPS =
  Platform.OS === 'android'
    ? ({ experimentalBlurMethod: 'dimezisBlurView' } as const)
    : ({} as const);

const TRUST_ROWS = [
  {
    title: 'Private by default',
    body: 'We only ask for what helps narrow fit.',
    bodyMaxWidth: 232,
  },
  {
    title: 'Only what sharpens fit',
    body: 'Your answers shape recommendations, not ads.',
    bodyMaxWidth: 169,
  },
  {
    title: 'Still in your control',
    body: 'You can update this later in Profile.',
    bodyMaxWidth: 215,
  },
] as const;

type TrustHeroPanelProps = {
  panelWidth: number;
};

function TrustHeroPanel({ panelWidth }: TrustHeroPanelProps) {
  const pulse = useSharedValue(0);
  const diffuse = useSharedValue(0);
  const floatY = useSharedValue(0);

  useEffect(() => {
    floatY.value = withDelay(
      860,
      withRepeat(
        withSequence(
          withTiming(-5, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      ),
    );

    pulse.value = withDelay(
      860,
        withSequence(
          withTiming(0.34, { duration: 1200, easing: Easing.bezier(0.16, 1, 0.3, 1) }),
          withRepeat(
            withSequence(
              withTiming(0.62, { duration: 3200, easing: Easing.inOut(Easing.ease) }),
              withTiming(0.28, { duration: 3200, easing: Easing.inOut(Easing.ease) }),
            ),
            -1,
            false,
          ),
        ),
    );

    diffuse.value = withDelay(
      860,
        withSequence(
          withTiming(0.26, { duration: 1500, easing: Easing.bezier(0.16, 1, 0.3, 1) }),
          withRepeat(
            withSequence(
              withTiming(0.56, { duration: 4300, easing: Easing.inOut(Easing.ease) }),
              withTiming(0.2, { duration: 4300, easing: Easing.inOut(Easing.ease) }),
            ),
            -1,
            false,
          ),
        ),
    );

    return () => {
      cancelAnimation(floatY);
      cancelAnimation(pulse);
      cancelAnimation(diffuse);
    };
  }, [diffuse, floatY, pulse]);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }],
  }));

  const panelHeight = 236;
  const heroWidth = panelWidth;
  const heroHeight = panelHeight + 26;
  const glowCardHeight = Math.round(panelHeight * 0.76);

  return (
    <Animated.View style={[styles.heroShell, { width: heroWidth, height: heroHeight }, floatStyle]}>
      <View pointerEvents="none" style={styles.glowMount}>
        <WelcomeHeroGlow
          cardWidth={panelWidth}
          cardHeight={glowCardHeight}
          pulse={pulse}
          diffuse={diffuse}
        />
      </View>

      <View style={[styles.panelShell, { width: panelWidth, height: panelHeight }]}> 
        <BlurView intensity={18} tint="light" style={[StyleSheet.absoluteFillObject, styles.panelBlur]} {...BLUR_PROPS} />
        <LinearGradient
          colors={['rgba(255,255,255,0.56)', 'rgba(251,253,255,0.42)', 'rgba(244,248,255,0.28)']}
          start={{ x: 0.18, y: 0 }}
          end={{ x: 0.86, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.panelBorder} pointerEvents="none" />
        <View style={styles.panelTopSpecular} pointerEvents="none" />

        <View style={styles.panelContent}>
          <View style={styles.panelGuide} pointerEvents="none" />
          {TRUST_ROWS.map((row) => (
            <View key={row.title} style={styles.rowItem}>
              <View style={styles.dotWrap}>
                <View style={styles.dotShadow} />
                <View style={styles.dot} />
              </View>
              <View style={styles.rowTextWrap}>
                <Text allowFontScaling={false} style={styles.rowTitle}>
                  {row.title}
                </Text>
                <Text
                  allowFontScaling={false}
                  style={[styles.rowBody, { maxWidth: row.bodyMaxWidth }]}
                >
                  {row.body}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

export default function DataTrustScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { saveDraft } = useOnboarding();
  const { setDirection, consumeDirection } = useTransitionDir();

  const enterDir = useMemo(() => {
    const direction = consumeDirection();
    return direction === 'none' ? 'none' : direction;
  }, [consumeDirection]);

  const logoOpacity = useRef(new RNAnimated.Value(0)).current;
  const logoTranslate = useRef(new RNAnimated.Value(8)).current;
  const heroOpacity = useRef(new RNAnimated.Value(0)).current;
  const heroTranslate = useRef(new RNAnimated.Value(8)).current;
  const copyOpacity = useRef(new RNAnimated.Value(0)).current;
  const copyTranslate = useRef(new RNAnimated.Value(8)).current;
  const footerOpacity = useRef(new RNAnimated.Value(0)).current;
  const footerTranslate = useRef(new RNAnimated.Value(8)).current;
  const policyOpacity = useRef(new RNAnimated.Value(0)).current;
  const policyTranslate = useRef(new RNAnimated.Value(-8)).current;

  const panelWidth = Math.min(width - 110, 320);
  const isCompactHeight = height < 860;

  useFocusEffect(
    useCallback(() => {
      const onHardwareBackPress = () => true;
      const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBackPress);
      return () => subscription.remove();
    }, []),
  );

  useEffect(() => {
    trackOnboardingEvent('trust_page_viewed', { screen: 'data_trust', variant: 'figma_restore_v1' });
  }, []);

  useEffect(() => {
    RNAnimated.parallel([
      RNAnimated.timing(logoOpacity, {
        toValue: 1,
        duration: 560,
        easing: RNEasing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
      RNAnimated.timing(logoTranslate, {
        toValue: 0,
        duration: 560,
        easing: RNEasing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
      RNAnimated.timing(heroOpacity, {
        toValue: 1,
        duration: 600,
        easing: RNEasing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
      RNAnimated.timing(heroTranslate, {
        toValue: 0,
        duration: 600,
        easing: RNEasing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
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
      RNAnimated.timing(footerOpacity, {
        toValue: 1,
        duration: 560,
        easing: RNEasing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
      RNAnimated.timing(footerTranslate, {
        toValue: 0,
        duration: 560,
        easing: RNEasing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
      RNAnimated.sequence([
        RNAnimated.delay(130),
        RNAnimated.parallel([
          RNAnimated.timing(policyOpacity, {
            toValue: 1,
            duration: 420,
            easing: RNEasing.bezier(0.16, 1, 0.3, 1),
            useNativeDriver: true,
          }),
          RNAnimated.timing(policyTranslate, {
            toValue: 0,
            duration: 420,
            easing: RNEasing.bezier(0.16, 1, 0.3, 1),
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start();
  }, [
    copyOpacity,
    copyTranslate,
    footerOpacity,
    footerTranslate,
    heroOpacity,
    heroTranslate,
    logoOpacity,
    logoTranslate,
    policyOpacity,
    policyTranslate,
  ]);

  const handleOpenPolicy = useCallback(async () => {
    try {
      await Linking.openURL(PRIVACY_POLICY_URL);
    } catch (error) {
      console.warn('[onboarding] failed to open privacy policy', error);
    }
  }, []);

  const handleGetStarted = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }

    setDirection('forward');
    await saveDraft({ onboardingVersion: 'v2' }, 2);
    router.replace('/onboarding/goals');
  }, [router, saveDraft, setDirection]);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[WELCOME_BG_TOP, WELCOME_BG_BOTTOM]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <StepSlide
        direction={enterDir}
        slideOnFirst={false}
        mountKey={`data-trust-fidelity-restore-${enterDir}`}
        durationMs={620}
        fadeDurationMs={580}
        distancePctOverride={0.052}
        scaleFromOverride={0.998}
        style={styles.slideWrap}
      >
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
            <View style={styles.logoPillShell}>
              <BlurView intensity={18} tint="light" style={[StyleSheet.absoluteFillObject, styles.logoBlur]} {...BLUR_PROPS} />
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
            <View style={styles.viewport}>
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
                <TrustHeroPanel panelWidth={panelWidth} />
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
                  Only what helps us{`\n`}narrow what fits.
                </Text>
                <Text allowFontScaling={false} style={[styles.subtext, isCompactHeight && styles.subtextCompact]}>
                  A few answers help NuTri shape recommendations and setup. Nothing extra gets in the way.
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
                  paddingBottom: Math.max(insets.bottom, 18) + 8,
                },
              ]}
            >
              <View style={styles.progressRow}>
                <View style={styles.progressInactiveDot} />
                <View style={styles.progressActivePill} />
              </View>

              <WelcomePrimaryCTA title="Get Started" onPress={handleGetStarted} />

              <View style={styles.policySlot}>
                <RNAnimated.Text
                  allowFontScaling={false}
                  style={[
                    styles.policyLink,
                    {
                      opacity: policyOpacity,
                      transform: [{ translateY: policyTranslate }],
                    },
                  ]}
                  onPress={handleOpenPolicy}
                >
                  Read full Privacy Policy
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
  logoPillShell: {
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
  main: {
    flex: 1,
  },
  viewport: {
    flex: 1,
    marginTop: 6,
    paddingTop: 10,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
  heroArea: {
    flex: 1.02,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 22,
  },
  heroAreaCompact: {
    paddingTop: 14,
  },
  heroShell: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  glowMount: {
    ...StyleSheet.absoluteFillObject,
    top: 28,
  },
  panelShell: {
    position: 'relative',
    borderRadius: 32,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.24)',
    shadowColor: '#CCD4E6',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 9,
  },
  panelBlur: {
    borderRadius: 32,
  },
  panelBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
  },
  panelTopSpecular: {
    position: 'absolute',
    top: 0,
    left: 18,
    right: 18,
    height: 8,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  panelContent: {
    flex: 1,
    paddingHorizontal: 28,
    paddingVertical: 28,
    justifyContent: 'flex-start',
    gap: 24,
  },
  panelGuide: {
    position: 'absolute',
    left: 32.5,
    top: 40,
    bottom: 40,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  dotWrap: {
    width: 13,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 4,
  },
  dotShadow: {
    position: 'absolute',
    top: 4,
    width: 11,
    height: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(59,106,247,0.18)',
    shadowColor: ACTIVE_BLUE,
    shadowOpacity: 0.16,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  dot: {
    width: 11,
    height: 11,
    borderRadius: 999,
    backgroundColor: ACTIVE_BLUE,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.96)',
  },
  rowTextWrap: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: -0.53,
    color: FOREGROUND,
  },
  rowBody: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '500',
    letterSpacing: -0.08,
    color: MUTED,
  },
  copyWrap: {
    alignItems: 'center',
    paddingHorizontal: 36,
    paddingBottom: 8,
  },
  copyWrapCompact: {
    paddingBottom: 4,
  },
  headline: {
    fontSize: 39,
    lineHeight: 41,
    fontWeight: '700',
    letterSpacing: -1.9,
    textAlign: 'center',
    color: FOREGROUND,
  },
  headlineCompact: {
    fontSize: 37,
    lineHeight: 39,
    letterSpacing: -1.75,
  },
  subtext: {
    marginTop: 16,
    maxWidth: 314,
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
    minHeight: 158,
  },
  footerCompact: {
    paddingTop: 8,
    minHeight: 150,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 18,
  },
  progressInactiveDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: INACTIVE_DOT,
  },
  progressActivePill: {
    width: 26,
    height: 6,
    borderRadius: 999,
    backgroundColor: ACTIVE_BLUE,
  },
  policyLink: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
    color: ACTIVE_BLUE,
  },
  policySlot: {
    width: '100%',
    height: 20,
    marginTop: 18,
    position: 'relative',
  },
});
