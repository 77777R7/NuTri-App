console.log('✅ Start button rendered')
// app/onboarding/welcome.tsx
import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, BackHandler, Dimensions, Easing, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

// ✅ 使用你们的 primitives，修复 Animated 类型问题
import { Text, View } from '@/components/ui/nativewind-primitives';

// ✅ 所有 import 均放在文件顶部（修复 import/first）
import AppHeader from '@/components/common/AppHeader';
// 若 ProgressBar 是命名导出（通常如此），用命名导入；若是默认导出请改回默认写法
import { ProgressBar } from '@/components/onboarding/ProgressBar';
import { PrimaryButton } from '@/components/ui/Buttons';
import { BrandGradient } from '@/components/BrandGradient';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { colors, radii, spacing, type } from '@/lib/theme';

// ✅ 用 primitives 作为宿主，生成动画组件，避免 AnimatedProps<{}> 导致的 JSX 报错
const AnimView = Animated.createAnimatedComponent(View as any);
const AnimText = Animated.createAnimatedComponent(Text as any);

export default function WelcomeScreen() {
  const router = useRouter();
  const { setProgress } = useOnboarding();
  const insets = useSafeAreaInsets();

  // entrance animations
  const progressSlide = useRef(new Animated.Value(-12)).current;
  const progressOpacity = useRef(new Animated.Value(0)).current;
  const headlineOpacity = useRef(new Animated.Value(0)).current;
  const headlineTranslate = useRef(new Animated.Value(12)).current;
  const subOpacity = useRef(new Animated.Value(0)).current;
  const subTranslate = useRef(new Animated.Value(12)).current;
  const badgeScale = useRef(new Animated.Value(0.85)).current;
  const accentFade = useRef(new Animated.Value(0)).current;
  const accentScale = useRef(new Animated.Value(0.8)).current;

  useFocusEffect(
    useCallback(() => {
      const onHardwareBackPress = () => true;
      const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBackPress);

      return () => subscription.remove();
    }, []),
  );

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(progressOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(progressSlide, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(headlineOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(headlineTranslate, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(subOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(subTranslate, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.sequence([
          Animated.timing(badgeScale, {
            toValue: 1,
            duration: 360,
            easing: Easing.out(Easing.exp),
            useNativeDriver: true,
          }),
          Animated.timing(badgeScale, {
            toValue: 0.97,
            duration: 220,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(badgeScale, {
            toValue: 1,
            duration: 240,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(accentFade, {
            toValue: 1,
            duration: 500,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(accentScale, {
            toValue: 1,
            duration: 500,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start();
  }, [
    accentFade,
    accentScale,
    badgeScale,
    headlineOpacity,
    headlineTranslate,
    progressOpacity,
    progressSlide,
    subOpacity,
    subTranslate,
  ]);

  const screenH = Dimensions.get('window').height;
  const isSmall = screenH < 740;

  const onGetStarted = () => {
    setProgress(2);
    router.push('/onboarding/profile');
  };

  return (
    <BrandGradient>
      {/* 主内容 */}
      <View style={{ flex: 1 }}>
        {/* 背景点缀（放在独立容器，避免 Animated 指针事件类型噪音） */}
        <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
          <AnimView
            style={{
              position: 'absolute',
              top: -80,
              right: -60,
              width: 220,
              height: 220,
              borderRadius: 110,
              backgroundColor: 'rgba(16,185,129,0.12)',
              opacity: accentFade,
              transform: [{ scale: accentScale }],
            }}
          />
          <AnimView
            style={{
              position: 'absolute',
              bottom: 60,
              left: -80,
              width: 200,
              height: 200,
              borderRadius: 100,
              backgroundColor: 'rgba(5,150,105,0.08)',
              opacity: accentFade,
              transform: [
                {
                  scale: accentScale.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.6, 1],
                  }),
                },
              ],
            }}
          />
        </View>

        <AppHeader showBack title="Step 1 of 7" fallbackHref="/index" />

        {/* 进度条 */}
        <AnimView
          style={{
            paddingHorizontal: spacing.lg,
            opacity: progressOpacity,
            transform: [{ translateY: progressSlide }],
          }}
        >
          <ProgressBar step={1} total={7} />
        </AnimView>

        {/* 文案与徽章 */}
        <View
          style={{
            flex: 1,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.lg,
          }}
        >
          <AnimText
            style={[
              type.h1 as any,
              {
                color: colors.text,
                opacity: headlineOpacity,
                transform: [{ translateY: headlineTranslate }],
              },
            ]}
          >
            Welcome to NuTri
          </AnimText>

          <AnimText
            style={[
              type.p as any,
              {
                marginTop: spacing.sm,
                opacity: subOpacity,
                transform: [{ translateY: subTranslate }],
              },
            ]}
          >
            Let’s personalise your supplement routine in a few guided steps.
          </AnimText>

          <AnimView
            style={{
              marginTop: spacing.xl,
              alignSelf: 'center',
              width: 104,
              height: 104,
              borderRadius: 52,
              backgroundColor: colors.brand,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: colors.brandDark,
              shadowOpacity: 0.25,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 12 },
              transform: [{ scale: badgeScale }],
            }}
            accessibilityLabel="NuTri logo"
          >
            <Text
              style={{
                color: '#FFFFFF',
                fontSize: 34,
                fontWeight: '900',
                letterSpacing: 0.5,
              }}
            >
              Nu
            </Text>
          </AnimView>

          {/* 说明卡片 */}
          <AnimView
            style={{
              marginTop: spacing.xl,
              backgroundColor: colors.surfaceSoft,
              borderRadius: radii.xl,
              paddingVertical: spacing.xl,
              paddingHorizontal: spacing.xl,
              borderWidth: 1,
              borderColor: 'rgba(16,185,129,0.12)',
              opacity: subOpacity,
              transform: [
                {
                  translateY: subTranslate.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                },
              ],
            }}
          >
            <Text
              style={{
                color: colors.brandDark,
                fontSize: 16,
                fontWeight: '700',
                textAlign: 'center',
              }}
            >
              What you’ll see next
            </Text>
            <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
              {[
                'A quick profile check so NuTri learns the basics.',
                'Diet & activity questions to fine tune recommendations.',
                'Optional goals and privacy preferences to finish strong.',
              ].map((item) => (
                <View
                  key={item}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: spacing.sm,
                  }}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: colors.brand,
                      marginTop: 6,
                    }}
                  />
                  <Text
                    style={{
                      flex: 1,
                      color: colors.subtext,
                      fontSize: 15,
                      lineHeight: 22,
                    }}
                  >
                    {item}
                  </Text>
                </View>
              ))}
            </View>
          </AnimView>
        </View>
      </View>

      {/* 浮动按钮层（与内容同级；覆盖全屏作为定位锚点） */}
      <View pointerEvents="box-none" style={StyleSheet.absoluteFillObject}>
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            right: spacing.lg,
            bottom: insets.bottom + (isSmall ? spacing.lg : spacing.xl),
            zIndex: 1000,
            elevation: 12,
          }}
        >
          <PrimaryButton
            title="Start"
            onPress={onGetStarted}
            style={{
              minWidth: 168,
              paddingHorizontal: 24,
              shadowColor: '#000',
              shadowOpacity: 0.12,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 6 },
            }}
            testID="welcome-start"
          />
        </View>
      </View>
    </BrandGradient>
  );
}
