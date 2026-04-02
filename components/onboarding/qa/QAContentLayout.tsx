import React from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated from 'react-native-reanimated';
import { useOnboardingSceneZoneStyle } from '@/components/onboarding/flow/OnboardingSceneMotionContext';

import {
  QA_BG,
  QA_BG_BOTTOM,
  QA_BG_TOP,
  QA_EYEBROW,
  QA_FOREGROUND,
  QA_MUTED,
} from './qaTokens';

type QAContentLayoutProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  showBackground?: boolean;
  onListScroll?: any;
  listScrollEventThrottle?: number;
  listOverlay?: React.ReactNode;
  listContentContainerStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

export function QAContentLayout({
  eyebrow,
  title,
  subtitle,
  showBackground = true,
  onListScroll,
  listScrollEventThrottle = 16,
  listOverlay,
  listContentContainerStyle,
  children,
}: QAContentLayoutProps) {
  const copyZoneStyle = useOnboardingSceneZoneStyle('copy');
  const contentZoneStyle = useOnboardingSceneZoneStyle('content');

  return (
    <View style={[styles.root, !showBackground && styles.rootTransparent]}>
      {showBackground ? (
        <>
          <LinearGradient
            colors={[QA_BG_TOP, QA_BG_BOTTOM]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />

          <View pointerEvents="none" style={styles.pageAmbient} />
        </>
      ) : null}

      <View style={styles.content}>
        <Animated.View style={[styles.copyBlock, copyZoneStyle]}>
          {eyebrow ? (
            <Text allowFontScaling={false} style={styles.eyebrow}>
              {eyebrow}
            </Text>
          ) : null}
          <Text allowFontScaling={false} style={styles.title}>
            {title}
          </Text>
          {subtitle ? (
            <Text allowFontScaling={false} style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </Animated.View>

        <Animated.View style={[styles.listViewport, contentZoneStyle]}>
          <Animated.ScrollView
            style={styles.listScroll}
            contentContainerStyle={[styles.listContent, listContentContainerStyle]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onScroll={onListScroll}
            scrollEventThrottle={listScrollEventThrottle}
          >
            {children}
          </Animated.ScrollView>
          {listOverlay ? (
            <View pointerEvents="none" style={styles.listOverlay}>
              {listOverlay}
            </View>
          ) : null}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: QA_BG,
  },
  rootTransparent: {
    backgroundColor: 'transparent',
  },
  pageAmbient: {
    position: 'absolute',
    top: 42,
    left: '-11%',
    width: '122%',
    height: '120%',
    borderRadius: 9999,
    backgroundColor: 'rgba(235,239,248,0.68)',
    opacity: 0.74,
  },
  content: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 32,
    paddingTop: 48,
  },
  copyBlock: {
    alignItems: 'flex-start',
  },
  eyebrow: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 2.4,
    color: QA_EYEBROW,
    marginBottom: 14,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 34,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -1.6,
    color: QA_FOREGROUND,
  },
  subtitle: {
    marginTop: 16,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '500',
    color: QA_MUTED,
  },
  listViewport: {
    flex: 1,
    minHeight: 0,
    marginTop: 38,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    gap: 14,
    paddingBottom: 12,
  },
  listOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
});

export default QAContentLayout;
