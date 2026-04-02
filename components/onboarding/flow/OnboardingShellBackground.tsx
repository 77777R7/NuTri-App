import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
  Easing as RNEasing,
  StyleSheet,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import {
  QA_BG,
  QA_BG_BOTTOM,
  QA_BG_TOP,
} from '@/components/onboarding/qa/qaTokens';

import type { OnboardingShellBackgroundVariant } from './onboardingShell';

const SUMMARY_BG_TOP = 'rgba(240,244,255,0.4)';
const SUMMARY_BG_BOTTOM = 'rgba(230,237,255,0.5)';

type OnboardingShellBackgroundProps = {
  variant: OnboardingShellBackgroundVariant;
};

function BackgroundLayer({
  variant,
}: {
  variant: OnboardingShellBackgroundVariant;
}) {
  const isSummary = variant === 'summary';

  return (
    <View
      pointerEvents="none"
      style={[
        styles.root,
        isSummary ? styles.summaryRoot : styles.qaRoot,
      ]}
    >
      <LinearGradient
        colors={isSummary ? [SUMMARY_BG_TOP, SUMMARY_BG_BOTTOM] : [QA_BG_TOP, QA_BG_BOTTOM]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View
        style={[
          styles.ambient,
          isSummary ? styles.summaryAmbient : styles.qaAmbient,
        ]}
      />
    </View>
  );
}

export function OnboardingShellBackground({
  variant,
}: OnboardingShellBackgroundProps) {
  const transition = useRef(new RNAnimated.Value(1)).current;
  const [currentVariant, setCurrentVariant] = useState(variant);
  const [previousVariant, setPreviousVariant] =
    useState<OnboardingShellBackgroundVariant | null>(null);

  useEffect(() => {
    if (variant === currentVariant) {
      return;
    }

    setPreviousVariant(currentVariant);
    setCurrentVariant(variant);
    transition.setValue(0);
    RNAnimated.timing(transition, {
      toValue: 1,
      duration: 420,
      easing: RNEasing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setPreviousVariant(null);
      }
    });
  }, [currentVariant, transition, variant]);

  const incomingStyle = useMemo(
    () => ({
      opacity: transition,
    }),
    [transition],
  );

  const outgoingStyle = useMemo(
    () => ({
      opacity: transition.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
      }),
    }),
    [transition],
  );

  return (
    <View pointerEvents="none" style={styles.stack}>
      {previousVariant ? (
        <RNAnimated.View style={[styles.layer, outgoingStyle]}>
          <BackgroundLayer variant={previousVariant} />
        </RNAnimated.View>
      ) : null}

      <RNAnimated.View
        style={[styles.layer, previousVariant ? incomingStyle : styles.layerStatic]}
      >
        <BackgroundLayer variant={currentVariant} />
      </RNAnimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    ...StyleSheet.absoluteFillObject,
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
  },
  layerStatic: {
    opacity: 1,
  },
  root: {
    ...StyleSheet.absoluteFillObject,
  },
  qaRoot: {
    backgroundColor: QA_BG,
  },
  summaryRoot: {
    backgroundColor: '#F6F7F9',
  },
  ambient: {
    position: 'absolute',
    left: '-11%',
    width: '122%',
    borderRadius: 9999,
  },
  qaAmbient: {
    top: 42,
    height: '120%',
    backgroundColor: 'rgba(235,239,248,0.68)',
    opacity: 0.74,
  },
  summaryAmbient: {
    top: 86,
    height: '118%',
    backgroundColor: 'rgba(235,239,248,0.68)',
    opacity: 0.82,
  },
});

export default OnboardingShellBackground;
