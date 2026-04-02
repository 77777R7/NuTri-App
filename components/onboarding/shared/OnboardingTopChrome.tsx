import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';

import { ProgressBar } from './ProgressBar';
import { GlassSurface } from './GlassSurface';
import { onboardingPalette } from './theme';

type OnboardingTopChromeProps =
  | {
      mode: 'brand';
      brandLabel?: string;
    }
  | {
      mode: 'back';
      onBack: () => void;
    }
  | {
      mode: 'progress';
      onBack: () => void;
      questionIndex: number;
      totalQuestions?: number;
    };

export const OnboardingTopChrome = (props: OnboardingTopChromeProps) => {
  if (props.mode === 'brand') {
    return (
      <View style={styles.brandWrap}>
        <GlassSurface variant="label" borderRadius={999} style={styles.brandPill}>
          <Text style={styles.brandText}>{props.brandLabel ?? 'NuTri'}</Text>
        </GlassSurface>
      </View>
    );
  }

  if (props.mode === 'back') {
    return (
      <View style={styles.utilityWrap}>
        <BackButton onPress={props.onBack} />
        <View style={styles.utilitySpacer} />
      </View>
    );
  }

  return (
    <View style={styles.progressWrap}>
      <BackButton onPress={props.onBack} />
      <View style={styles.progressCenter}>
        <ProgressBar step={props.questionIndex} total={props.totalQuestions ?? 10} />
      </View>
      <View style={styles.utilitySpacer} />
    </View>
  );
};

const BackButton = ({ onPress }: { onPress: () => void }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.backPressed]} accessibilityRole="button" accessibilityLabel="Back">
    <GlassSurface variant="soft" borderRadius={20} style={styles.backButton}>
      <ChevronLeft size={22} color={onboardingPalette.text} strokeWidth={2.5} />
    </GlassSurface>
  </Pressable>
);

const styles = StyleSheet.create({
  brandWrap: {
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandPill: {
    minWidth: 114,
    paddingHorizontal: 24,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: {
    color: onboardingPalette.text,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  utilityWrap: {
    height: 40,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressWrap: {
    height: 40,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilitySpacer: {
    width: 40,
    height: 40,
  },
  backPressed: {
    transform: [{ scale: 0.96 }],
  },
});

export default OnboardingTopChrome;
