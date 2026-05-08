import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { QA_CTA_BLACK, QA_CTA_BLACK_EDGE } from '@/components/onboarding/qa/qaTokens';

type WelcomePrimaryCTAProps = {
  title: string;
  onPress: () => void | Promise<void>;
  style?: StyleProp<ViewStyle>;
};

export function WelcomePrimaryCTA({
  title,
  onPress,
  style,
}: WelcomePrimaryCTAProps) {
  return (
    <View style={[styles.outer, style]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={title}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
      >
        <View style={styles.buttonFrame}>
          <View style={styles.clipShell}>
            <LinearGradient
              pointerEvents="none"
              colors={['#171717', QA_CTA_BLACK, '#050505']}
              locations={[0, 0.52, 1]}
              start={{ x: 0.14, y: 0.06 }}
              end={{ x: 0.92, y: 0.96 }}
              style={styles.fill}
            />

            <LinearGradient
              pointerEvents="none"
              colors={[
                'rgba(255,255,255,0.18)',
                'rgba(255,255,255,0.06)',
                'rgba(255,255,255,0)',
              ]}
              locations={[0, 0.56, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.topCap}
            />
            <View style={styles.outerStroke} pointerEvents="none" />

            <Text allowFontScaling={false} style={styles.text}>
              {title}
            </Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const BUTTON_HEIGHT = 70;

const styles = StyleSheet.create({
  outer: {
    width: '100%',
    maxWidth: 392,
    position: 'relative',
    alignSelf: 'center',
  },
  pressable: {
    width: '100%',
  },
  buttonFrame: {
    height: BUTTON_HEIGHT,
    borderRadius: 999,
    backgroundColor: 'transparent',
    shadowColor: QA_CTA_BLACK_EDGE,
    shadowOpacity: 0.13,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 6 },
    elevation: 14,
  },
  clipShell: {
    flex: 1,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: QA_CTA_BLACK,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  pressed: {
    transform: [{ scale: 0.985 }],
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
  },
  topCap: {
    position: 'absolute',
    left: 26,
    right: 26,
    top: 5,
    height: 12,
    borderRadius: 999,
  },
  outerStroke: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  text: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.45,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
