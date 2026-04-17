import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
  Easing as RNEasing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QAContinueCTA } from '@/components/onboarding/qa/QAContinueCTA';
import { QA_MUTED } from '@/components/onboarding/qa/qaTokens';
import { useOnboardingLayoutTokens } from '@/hooks/useOnboardingLayoutTokens';

import {
  FLOW_EASE_BEZIER,
  ONBOARDING_FOOTER_TRANSITION_DURATION_MS,
} from './onboardingMotion';

type FooterVisualPayload = {
  identity: string;
  continueLabel: string;
  continueDisabled: boolean;
  hasSkip: boolean;
};

type OnboardingFooterProps = {
  backgroundVariant?: 'qa' | 'summary';
  footerIdentity: string;
  continueLabel: string;
  onContinue: () => void | Promise<void>;
  continueDisabled?: boolean;
  onSkip?: () => void | Promise<void>;
  footerHint?: string;
  footerError?: string | null;
};

function FooterMetaLayer({
  payload,
  reserveHelperSpace,
  helperPaddingTop,
  footerHint,
  footerError,
  onSkip,
  interactive,
  skipMinHeight,
  skipTextSize,
  skipTextLineHeight,
}: {
  payload: FooterVisualPayload;
  reserveHelperSpace: boolean;
  helperPaddingTop: number;
  footerHint?: string;
  footerError?: string | null;
  onSkip?: () => void | Promise<void>;
  interactive: boolean;
  skipMinHeight: number;
  skipTextSize: number;
  skipTextLineHeight: number;
}) {
  return (
    <View pointerEvents={interactive ? 'auto' : 'none'} style={styles.layerInner}>
      <View
        style={[
          styles.helperZone,
          reserveHelperSpace ? styles.helperZoneReserved : styles.helperZoneCollapsed,
          reserveHelperSpace ? { paddingTop: helperPaddingTop } : null,
        ]}
      >
        {footerError ? (
          <Text allowFontScaling={false} style={styles.footerError}>
            {footerError}
          </Text>
        ) : footerHint ? (
          <Text allowFontScaling={false} style={styles.footerHint}>
            {footerHint}
          </Text>
        ) : (
          <View style={styles.helperPlaceholder} />
        )}
      </View>

      {payload.hasSkip && onSkip ? (
        <View style={[styles.skipZone, { minHeight: skipMinHeight }]}>
          <Pressable
            onPress={() => void onSkip()}
            style={({ pressed }) => [styles.skipWrap, pressed && styles.skipPressed]}
          >
            <Text
              allowFontScaling={false}
              style={[
                styles.skipText,
                {
                  fontSize: skipTextSize,
                  lineHeight: skipTextLineHeight,
                },
              ]}
            >
              Skip for now
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function CTAButtonLayer({
  payload,
  onContinue,
  interactive,
  previousLabel,
  showLabelTransition,
  labelIncomingStyle,
  labelOutgoingStyle,
  ctaLabelSize,
  ctaLabelLineHeight,
}: {
  payload: FooterVisualPayload;
  onContinue: () => void | Promise<void>;
  interactive: boolean;
  previousLabel?: string | null;
  showLabelTransition: boolean;
  labelIncomingStyle: object;
  labelOutgoingStyle: object;
  ctaLabelSize: number;
  ctaLabelLineHeight: number;
}) {
  return (
    <View pointerEvents={interactive ? 'auto' : 'none'} style={styles.buttonLayerInner}>
      <QAContinueCTA
        title={payload.continueLabel}
        onPress={onContinue}
        disabled={payload.continueDisabled}
        showLabel={false}
      >
        <View pointerEvents="none" style={styles.ctaLabelStack}>
          {showLabelTransition && previousLabel ? (
            <RNAnimated.Text
              allowFontScaling={false}
              style={[
                styles.ctaLabel,
                {
                  fontSize: ctaLabelSize,
                  lineHeight: ctaLabelLineHeight,
                },
                labelOutgoingStyle,
              ]}
            >
              {previousLabel}
            </RNAnimated.Text>
          ) : null}
          <RNAnimated.Text
            allowFontScaling={false}
            style={[
              styles.ctaLabel,
              {
                fontSize: ctaLabelSize,
                lineHeight: ctaLabelLineHeight,
              },
              showLabelTransition ? labelIncomingStyle : styles.layerStatic,
            ]}
          >
            {payload.continueLabel}
          </RNAnimated.Text>
        </View>
      </QAContinueCTA>
    </View>
  );
}

export function OnboardingFooter({
  backgroundVariant = 'qa',
  footerIdentity,
  continueLabel,
  onContinue,
  continueDisabled = false,
  onSkip,
  footerHint,
  footerError,
}: OnboardingFooterProps) {
  const insets = useSafeAreaInsets();
  const layoutTokens = useOnboardingLayoutTokens();
  const transition = useRef(new RNAnimated.Value(1)).current;
  const initialHelperPresenceRef = useRef(Boolean(footerHint || footerError));
  const [reserveHelperSpace, setReserveHelperSpace] = useState(
    Boolean(footerHint || footerError),
  );
  const [currentPayload, setCurrentPayload] = useState<FooterVisualPayload>({
    identity: footerIdentity,
    continueLabel,
    continueDisabled,
    hasSkip: Boolean(onSkip),
  });
  const [previousPayload, setPreviousPayload] = useState<FooterVisualPayload | null>(null);

  const nextPayload = useMemo<FooterVisualPayload>(
    () => ({
      identity: footerIdentity,
      continueLabel,
      continueDisabled,
      hasSkip: Boolean(onSkip),
    }),
    [continueDisabled, continueLabel, footerIdentity, onSkip],
  );

  const payloadSignature = useMemo(
    () =>
      JSON.stringify([
        nextPayload.continueLabel,
        nextPayload.hasSkip,
      ]),
    [nextPayload],
  );

  const handleContinue = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }

    await onContinue();
  }, [onContinue]);

  const handleSkip = useCallback(async () => {
    if (!onSkip) return;

    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }

    await onSkip();
  }, [onSkip]);

  useEffect(() => {
    initialHelperPresenceRef.current = Boolean(footerHint || footerError);
  }, [footerError, footerHint]);

  useEffect(() => {
    setReserveHelperSpace(initialHelperPresenceRef.current);
  }, [footerIdentity]);

  useEffect(() => {
    if (footerHint || footerError) {
      setReserveHelperSpace(true);
    }
  }, [footerError, footerHint]);

  useEffect(() => {
    const currentSignature = JSON.stringify([
      currentPayload.continueLabel,
      currentPayload.hasSkip,
    ]);

    if (currentSignature === payloadSignature) {
      if (currentPayload.continueDisabled !== nextPayload.continueDisabled) {
        setCurrentPayload((existing) => ({
          ...existing,
          continueDisabled: nextPayload.continueDisabled,
        }));
      }
      return;
    }

    setPreviousPayload(currentPayload);
    setCurrentPayload(nextPayload);
    transition.setValue(0);

    RNAnimated.timing(transition, {
      toValue: 1,
      duration: ONBOARDING_FOOTER_TRANSITION_DURATION_MS,
      easing: RNEasing.bezier(...FLOW_EASE_BEZIER),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setPreviousPayload(null);
      }
    });
  }, [currentPayload, nextPayload, payloadSignature, transition]);

  const incomingStyle = useMemo(
    () => ({
      opacity: transition,
      transform: [
        {
          translateY: transition.interpolate({
            inputRange: [0, 1],
            outputRange: [6, 0],
          }),
        },
      ],
    }),
    [transition],
  );

  const outgoingStyle = useMemo(
    () => ({
      opacity: transition.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
      }),
      transform: [
        {
          translateY: transition.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 4],
          }),
        },
      ],
    }),
    [transition],
  );

  const ctaIncomingStyle = useMemo(
    () => ({
      opacity: transition.interpolate({
        inputRange: [0, 0.18, 1],
        outputRange: [0, 0.15, 1],
      }),
      transform: [
        {
          translateY: transition.interpolate({
            inputRange: [0, 1],
            outputRange: [8, 0],
          }),
        },
        {
          scale: transition.interpolate({
            inputRange: [0, 1],
            outputRange: [0.992, 1],
          }),
        },
      ],
    }),
    [transition],
  );

  const ctaOutgoingStyle = useMemo(
    () => ({
      opacity: transition.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0.18],
      }),
      transform: [
        {
          translateY: transition.interpolate({
            inputRange: [0, 1],
            outputRange: [0, -4],
          }),
        },
        {
          scale: transition.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0.996],
          }),
        },
      ],
    }),
    [transition],
  );

  const hasSkip = Boolean(currentPayload.hasSkip || previousPayload?.hasSkip);
  const contentMinHeight = layoutTokens.getSharedShellFooterReserveHeight({
    backgroundVariant,
    hasSkip,
    hasHelper: reserveHelperSpace,
  });

  return (
    <View
      style={[
        styles.root,
        {
          left: layoutTokens.shellHorizontal,
          right: layoutTokens.shellHorizontal,
          paddingBottom: Math.max(insets.bottom - 4, layoutTokens.shellFooterInset),
        },
      ]}
    >
      <View style={[styles.contentStack, { minHeight: contentMinHeight }]}>
        <View style={[styles.buttonStack, { minHeight: layoutTokens.qaCtaHeight }]}>
          <RNAnimated.View
            style={[
              styles.buttonLayer,
              previousPayload ? ctaIncomingStyle : styles.layerStatic,
            ]}
          >
            <CTAButtonLayer
              payload={currentPayload}
              onContinue={() => void handleContinue()}
              interactive
              ctaLabelSize={layoutTokens.qaCtaLabelSize}
              ctaLabelLineHeight={layoutTokens.qaCtaLabelLineHeight}
              previousLabel={previousPayload?.continueLabel}
              showLabelTransition={
                Boolean(previousPayload) &&
                previousPayload?.continueLabel !== currentPayload.continueLabel
              }
              labelIncomingStyle={ctaIncomingStyle}
              labelOutgoingStyle={ctaOutgoingStyle}
            />
          </RNAnimated.View>
        </View>

        <View style={styles.metaStack}>
          {previousPayload ? (
            <RNAnimated.View style={[styles.layer, outgoingStyle]}>
              <FooterMetaLayer
                payload={previousPayload}
                reserveHelperSpace={reserveHelperSpace}
                helperPaddingTop={layoutTokens.qaFooterHelperPaddingTop}
                footerHint={footerHint}
                footerError={footerError}
                onSkip={undefined}
                interactive={false}
                skipMinHeight={layoutTokens.qaFooterSkipMinHeight}
                skipTextSize={layoutTokens.qaFooterSkipTextSize}
                skipTextLineHeight={layoutTokens.qaFooterSkipTextLineHeight}
              />
            </RNAnimated.View>
          ) : null}

          <RNAnimated.View
            style={[
              styles.layer,
              previousPayload ? incomingStyle : styles.layerStatic,
            ]}
          >
            <FooterMetaLayer
              payload={currentPayload}
              reserveHelperSpace={reserveHelperSpace}
              helperPaddingTop={layoutTokens.qaFooterHelperPaddingTop}
              footerHint={footerHint}
              footerError={footerError}
              onSkip={onSkip ? () => void handleSkip() : undefined}
              interactive
              skipMinHeight={layoutTokens.qaFooterSkipMinHeight}
              skipTextSize={layoutTokens.qaFooterSkipTextSize}
              skipTextLineHeight={layoutTokens.qaFooterSkipTextLineHeight}
            />
          </RNAnimated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    bottom: 0,
    zIndex: 20,
    paddingTop: 8,
  },
  contentStack: {
    position: 'relative',
    width: '100%',
  },
  buttonStack: {
    position: 'relative',
    minHeight: 0,
  },
  buttonLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  buttonLayerInner: {
    width: '100%',
  },
  ctaLabelStack: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: {
    position: 'absolute',
    fontWeight: '600',
    letterSpacing: -0.45,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  metaStack: {
    position: 'relative',
    width: '100%',
  },
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  layerStatic: {
    position: 'relative',
  },
  layerInner: {
    width: '100%',
  },
  buttonZone: {
    width: '100%',
  },
  helperZone: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  helperZoneReserved: {
    minHeight: 18,
    paddingTop: 4,
  },
  helperZoneCollapsed: {
    minHeight: 0,
    paddingTop: 0,
  },
  helperPlaceholder: {
    width: '100%',
    minHeight: 0,
  },
  footerHint: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: QA_MUTED,
    textAlign: 'center',
  },
  footerError: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#E1567A',
    textAlign: 'center',
  },
  skipZone: {
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 2,
  },
  skipWrap: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  skipPressed: {
    transform: [{ scale: 0.97 }],
  },
  skipText: {
    fontWeight: '500',
    letterSpacing: -0.4,
    color: QA_MUTED,
  },
});

export default OnboardingFooter;
