import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { QAMoreOptionsPill } from '@/components/onboarding/qa/QAMoreOptionsPill';
import { QAOptionRow } from '@/components/onboarding/qa/QAOptionRow';
import { QAScreenShell } from '@/components/onboarding/qa/QAScreenShell';
import { QA_EYEBROW } from '@/components/onboarding/qa/qaTokens';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import {
  buildAvoidItemsFromStructuredPreferences,
  NO_KNOWN_ALLERGIES_LABEL,
  normalizeAvoidItemsSelection,
  PRIMARY_ALLERGY_UI_OPTIONS,
  RESTRICTION_UI_OPTIONS,
  SECONDARY_ALLERGY_UI_OPTIONS,
} from '@/lib/onboarding-v2';
import {
  appendPersonalizedGuideApplied,
  isPostScanMode,
  POST_SCAN_MODE,
  sanitizePostScanReturnTo,
} from '@/lib/onboarding/postScanReturn';
import {
  isProfileEditMode,
  PROFILE_EDIT_MODE,
  sanitizeProfileEditReturnTo,
} from '@/lib/onboarding/profileEditReturn';
const SCROLLBAR_HIDE_DELAY_MS = 1200;
const SCROLLBAR_FADE_DURATION_MS = 720;

function AllergyScrollbar({
  progress,
  opacity,
  top = 8,
  bottom = 14,
  thumbHeight = 40,
}: {
  progress: SharedValue<number>;
  opacity: SharedValue<number>;
  top?: number;
  bottom?: number;
  thumbHeight?: number;
}) {
  const [trackHeight, setTrackHeight] = useState(0);

  const rootStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));
  const thumbStyle = useAnimatedStyle(() => {
    const clamped = Math.max(0, Math.min(progress.value, 1));
    const travel = Math.max(trackHeight - thumbHeight, 0);
    return {
      transform: [{ translateY: clamped * travel }],
    };
  });

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    setTrackHeight((currentHeight) =>
      currentHeight === nextHeight ? currentHeight : nextHeight,
    );
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={handleLayout}
      style={[styles.scrollbarRoot, rootStyle, { top, bottom }]}
    >
      <Animated.View
        style={[styles.scrollbarThumb, thumbStyle, { height: thumbHeight }]}
      />
    </Animated.View>
  );
}

export default function AllergyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; returnTo?: string }>();
  const { draft, progress, saveDraft, setProgress } = useOnboarding();
  const { setDirection } = useTransitionDir();
  const [selected, setSelected] = useState<string[]>(
    buildAvoidItemsFromStructuredPreferences({
      avoidItems: draft?.avoidItems,
      allergyFlags: draft?.allergyFlags,
      ingredientRestrictions: draft?.ingredientRestrictions,
      noKnownAllergies: draft?.noKnownAllergies,
    }),
  );
  const [showMore, setShowMore] = useState(false);
  const [moreOptionsHeight, setMoreOptionsHeight] = useState(0);
  const expandProgress = useSharedValue(0);
  const scrollProgress = useSharedValue(0);
  const scrollbarOpacity = useSharedValue(1);

  const fadeOutScrollbar = useCallback(() => {
    'worklet';
    cancelAnimation(scrollbarOpacity);
    scrollbarOpacity.value = withDelay(
      SCROLLBAR_HIDE_DELAY_MS,
      withTiming(0, {
        duration: SCROLLBAR_FADE_DURATION_MS,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
      }),
    );
  }, [scrollbarOpacity]);

  const showScrollbar = useCallback(() => {
    'worklet';
    cancelAnimation(scrollbarOpacity);
    scrollbarOpacity.value = withTiming(1, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    });
  }, [scrollbarOpacity]);

  const commonOptions = useMemo(
    () => PRIMARY_ALLERGY_UI_OPTIONS.map((option) => option.label),
    [],
  );
  const secondaryOptions = useMemo(
    () => SECONDARY_ALLERGY_UI_OPTIONS.map((option) => option.label),
    [],
  );
  const restrictionOptions = useMemo(
    () => [
      ...RESTRICTION_UI_OPTIONS.map((option) => option.label),
      NO_KNOWN_ALLERGIES_LABEL,
    ],
    [],
  );
  const safeReturnTo = sanitizePostScanReturnTo(params.returnTo);
  const isPostScan = isPostScanMode(params.mode) && Boolean(safeReturnTo);
  const safeProfileReturnTo = sanitizeProfileEditReturnTo(params.returnTo);
  const isProfileEdit = isProfileEditMode(params.mode) && Boolean(safeProfileReturnTo);

  useEffect(() => {
    setSelected(
      buildAvoidItemsFromStructuredPreferences({
        avoidItems: draft?.avoidItems,
        allergyFlags: draft?.allergyFlags,
        ingredientRestrictions: draft?.ingredientRestrictions,
        noKnownAllergies: draft?.noKnownAllergies,
      }),
    );
  }, [draft?.allergyFlags, draft?.avoidItems, draft?.ingredientRestrictions, draft?.noKnownAllergies]);

  useEffect(() => {
    if (progress < 6) {
      void setProgress(6);
    }
  }, [progress, setProgress]);

  useEffect(() => {
    expandProgress.value = withTiming(showMore ? 1 : 0, {
      duration: 600,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [expandProgress, showMore]);

  const moreOptionsStyle = useAnimatedStyle(() => ({
    height: moreOptionsHeight * expandProgress.value,
    opacity: expandProgress.value,
    marginTop: 16 * expandProgress.value,
  }));

  const toggleItem = useCallback((item: string) => {
    if (item === NO_KNOWN_ALLERGIES_LABEL) {
      setSelected((current) => (current.includes(item) ? [] : [item]));
      return;
    }

    setSelected((current) => {
      const withoutNoKnown = current.filter(
        (entry) => entry !== NO_KNOWN_ALLERGIES_LABEL,
      );
      return withoutNoKnown.includes(item)
        ? withoutNoKnown.filter((entry) => entry !== item)
        : [...withoutNoKnown, item];
    });
  }, []);

  const handleScroll = useAnimatedScrollHandler({
    onBeginDrag: () => {
      showScrollbar();
    },
    onScroll: (event) => {
      const range = Math.max(
        event.contentSize.height - event.layoutMeasurement.height,
        1,
      );
      scrollProgress.value = event.contentOffset.y / range;
    },
    onEndDrag: (event) => {
      const velocityY = Math.abs(event.velocity?.y ?? 0);
      if (velocityY < 0.05) {
        fadeOutScrollbar();
      }
    },
    onMomentumBegin: () => {
      showScrollbar();
    },
    onMomentumEnd: () => {
      fadeOutScrollbar();
    },
  });

  const persist = useCallback(async (skipped = false) => {
    const normalized = normalizeAvoidItemsSelection(selected);
    await saveDraft(
      {
        avoidItems: normalized.avoidItems,
        allergyFlags: normalized.allergyFlags,
        ingredientRestrictions: normalized.ingredientRestrictions,
        noKnownAllergies: normalized.noKnownAllergies,
      },
      6,
    );
    trackOnboardingEvent('question_answered', {
      question: 'avoid_items',
      answerCount: selected.length,
      answers: selected,
    });
    trackOnboardingEvent(skipped ? 'allergy_skipped' : 'allergy_completed', {
      answerCount: selected.length,
      answers: selected,
      source: 'onboarding_allergy',
      mode: isPostScan ? POST_SCAN_MODE : isProfileEdit ? PROFILE_EDIT_MODE : 'onboarding',
    });
    setDirection('forward');
    if (isPostScan && safeReturnTo) {
      router.replace(appendPersonalizedGuideApplied(safeReturnTo) ?? '/scan/result');
      return;
    }
    if (isProfileEdit && safeProfileReturnTo) {
      router.replace(safeProfileReturnTo);
      return;
    }
    router.replace('/onboarding/done');
  }, [isPostScan, isProfileEdit, router, safeProfileReturnTo, safeReturnTo, saveDraft, selected, setDirection]);

  return (
    <QAScreenShell
      screenKey="allergy"
      qaStepIndex={2}
      eyebrow=""
      title="Anything to avoid?"
      subtitle="Optional. We'll flag ingredients that may not fit your routine."
      onBack={() => {
        setDirection('back');
        router.replace({
          pathname: '/onboarding/goals',
          params: isPostScan && safeReturnTo
            ? { mode: POST_SCAN_MODE, returnTo: safeReturnTo }
            : isProfileEdit && safeProfileReturnTo
              ? { mode: PROFILE_EDIT_MODE, returnTo: safeProfileReturnTo }
              : undefined,
        });
      }}
      onContinue={() => persist(false)}
      onSkip={() => persist(true)}
      continueLabel={isPostScan ? 'Show my result' : isProfileEdit ? 'Save answers' : 'Continue'}
      skipLabel={isPostScan ? 'Skip and show my result' : isProfileEdit ? 'Keep current answers' : undefined}
      onListScroll={handleScroll}
      listOverlay={
        <AllergyScrollbar
          progress={scrollProgress}
          opacity={scrollbarOpacity}
          top={6}
          bottom={18}
        />
      }
      listContentContainerStyle={styles.listContent}
    >
      <Text allowFontScaling={false} style={styles.sectionTitle}>
        Most common in supplements
      </Text>

      <View style={styles.groupList}>
        {commonOptions.map((option) => (
          <QAOptionRow
            key={option}
            label={option}
            selected={selected.includes(option)}
            selectionMode="multiple"
            onPress={() => toggleItem(option)}
          />
        ))}
      </View>

      <View style={styles.moreSection}>
        <QAMoreOptionsPill
          expanded={showMore}
          onPress={() => setShowMore((current) => !current)}
        />

        <Animated.View style={[styles.moreRowsWrap, moreOptionsStyle]}>
          <View style={styles.moreRowsInner}>
            {secondaryOptions.map((option) => (
              <QAOptionRow
                key={option}
                label={option}
                selected={selected.includes(option)}
                selectionMode="multiple"
                onPress={() => toggleItem(option)}
              />
            ))}
          </View>
        </Animated.View>

        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.measureProxy}
        >
          <View
            onLayout={(event) => {
              const nextHeight = Math.round(event.nativeEvent.layout.height);
              setMoreOptionsHeight((currentHeight) =>
                currentHeight === nextHeight ? currentHeight : nextHeight,
              );
            }}
            style={styles.moreRowsInner}
          >
            {secondaryOptions.map((option) => (
              <QAOptionRow
                key={`measure-${option}`}
                label={option}
                selected={false}
                selectionMode="multiple"
                onPress={() => undefined}
              />
            ))}
          </View>
        </View>
      </View>

      <Text allowFontScaling={false} style={styles.sectionTitle}>
        Restrictions
      </Text>

      <View style={styles.groupList}>
        {restrictionOptions.map((option) => (
          <QAOptionRow
            key={option}
            label={option}
            selected={selected.includes(option)}
            selectionMode="multiple"
            onPress={() => toggleItem(option)}
          />
        ))}
      </View>
    </QAScreenShell>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: 14,
  },
  sectionTitle: {
    fontSize: 14.5,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: -0.19,
    color: QA_EYEBROW,
    marginBottom: 16,
  },
  groupList: {
    gap: 14,
    marginBottom: 24,
  },
  moreSection: {
    position: 'relative',
    marginBottom: 24,
  },
  moreRowsWrap: {
    overflow: 'hidden',
  },
  moreRowsInner: {
    gap: 14,
  },
  measureProxy: {
    position: 'absolute',
    left: 0,
    right: 0,
    opacity: 0,
    zIndex: -1,
  },
  scrollbarRoot: {
    position: 'absolute',
    right: 4,
    width: 6,
  },
  scrollbarThumb: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: 999,
    backgroundColor: 'rgba(17,17,17,0.72)',
    shadowColor: '#111111',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
});
