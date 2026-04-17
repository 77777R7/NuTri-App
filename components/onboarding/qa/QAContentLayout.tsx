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
import { useOnboardingLayoutTokens } from '@/hooks/useOnboardingLayoutTokens';

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
  const layoutTokens = useOnboardingLayoutTokens();
  const titleLineCount = title.split('\n').length;
  const useTightTitle = layoutTokens.density === 'tight' || titleLineCount >= 2 || title.length >= 26;
  const titleSize = useTightTitle
    ? Math.max(layoutTokens.qaTitleSize - 2, 26)
    : layoutTokens.qaTitleSize;
  const titleLineHeight = useTightTitle
    ? Math.max(layoutTokens.qaTitleLineHeight - 2, titleSize + 2)
    : layoutTokens.qaTitleLineHeight;
  const subtitleMarginTop = useTightTitle
    ? Math.max(layoutTokens.qaSubtitleMarginTop - 2, 8)
    : layoutTokens.qaSubtitleMarginTop;
  const copyToListGap = useTightTitle
    ? Math.max(layoutTokens.qaCopyToListGap - 2, 10)
    : layoutTokens.qaCopyToListGap;
  const listBottomFadeHeight =
    layoutTokens.density === 'tight' ? 30 : layoutTokens.density === 'compact' ? 34 : 40;
  const requestedListPaddingBottom = StyleSheet.flatten(listContentContainerStyle)?.paddingBottom;
  const listPaddingBottom = Math.max(
    layoutTokens.qaListGap - 2,
    listBottomFadeHeight + layoutTokens.qaListGap,
    typeof requestedListPaddingBottom === 'number' ? requestedListPaddingBottom : 0,
  );

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

      <View
        style={[
          styles.content,
          {
            paddingHorizontal: layoutTokens.qaContentPaddingX,
            paddingTop: layoutTokens.qaContentPaddingTop,
          },
        ]}
      >
        <Animated.View style={[styles.copyBlock, copyZoneStyle]}>
          {eyebrow ? (
            <Text
              allowFontScaling={false}
              style={[
                styles.eyebrow,
                { marginBottom: layoutTokens.qaEyebrowMarginBottom },
              ]}
            >
              {eyebrow}
            </Text>
          ) : null}
          <Text
            allowFontScaling={false}
              style={[
                styles.title,
                {
                  fontSize: titleSize,
                  lineHeight: titleLineHeight,
                },
              ]}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              allowFontScaling={false}
              style={[
                styles.subtitle,
                {
                  marginTop: subtitleMarginTop,
                  fontSize: layoutTokens.qaSubtitleSize,
                  lineHeight: layoutTokens.qaSubtitleLineHeight,
                },
              ]}
            >
              {subtitle}
            </Text>
          ) : null}
        </Animated.View>

        <Animated.View
          style={[
            styles.listViewport,
            contentZoneStyle,
            { marginTop: copyToListGap },
          ]}
        >
          <Animated.ScrollView
            style={styles.listScroll}
            contentContainerStyle={[
              styles.listContent,
              {
                gap: layoutTokens.qaListGap,
              },
              listContentContainerStyle,
              { paddingBottom: listPaddingBottom },
            ]}
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
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(245,247,252,0)', QA_BG_BOTTOM]}
            locations={[0, 1]}
            style={[styles.listBottomFade, { height: listBottomFadeHeight }]}
          />
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
    textTransform: 'uppercase',
  },
  title: {
    fontWeight: '700',
    letterSpacing: -1.6,
    color: QA_FOREGROUND,
  },
  subtitle: {
    fontWeight: '500',
    color: QA_MUTED,
  },
  listViewport: {
    flex: 1,
    minHeight: 0,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    gap: 14,
  },
  listOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  listBottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});

export default QAContentLayout;
