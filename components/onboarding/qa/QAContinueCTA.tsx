import React from 'react';
import { Pressable, StyleSheet, Text, View, type ReactNode } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { QA_CTA_BLACK, QA_CTA_BLACK_EDGE, QA_CTA_HEIGHT } from './qaTokens';

type QAContinueCTAProps = {
  title: string;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  showLabel?: boolean;
  children?: ReactNode;
};

export function QAContinueCTA({
  title,
  onPress,
  disabled = false,
  showLabel = true,
  children,
}: QAContinueCTAProps) {
  return (
    <View style={[styles.outer, disabled && styles.outerDisabled]}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={title}
        style={({ pressed }) => [styles.pressable, pressed && !disabled && styles.pressed]}
      >
        <View style={[styles.buttonFrame, disabled && styles.buttonFrameDisabled]}>
          <View style={styles.clipShell}>
            <LinearGradient
              pointerEvents="none"
              colors={
                disabled
                  ? ['#C8C8C8', '#BEBEBE', '#B4B4B4']
                  : ['#171717', QA_CTA_BLACK, '#050505']
              }
              locations={[0, 0.52, 1]}
              start={{ x: 0.14, y: 0.06 }}
              end={{ x: 0.92, y: 0.96 }}
              style={styles.fill}
            />

            <LinearGradient
              pointerEvents="none"
              colors={
                disabled
                  ? [
                      'rgba(255,255,255,0.10)',
                      'rgba(255,255,255,0.04)',
                      'rgba(255,255,255,0)',
                    ]
                  : [
                      'rgba(255,255,255,0.16)',
                      'rgba(255,255,255,0.05)',
                      'rgba(255,255,255,0)',
                    ]
              }
              locations={[0, 0.56, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.topCap}
            />
            <View style={styles.outerStroke} pointerEvents="none" />

            {children ? children : null}
            {showLabel ? (
              <Text allowFontScaling={false} style={styles.text}>
                {title}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    width: '100%',
    maxWidth: 392,
    alignSelf: 'center',
  },
  outerDisabled: {
    opacity: 0.9,
  },
  pressable: {
    width: '100%',
  },
  buttonFrame: {
    height: QA_CTA_HEIGHT,
    borderRadius: 999,
    backgroundColor: 'transparent',
    shadowColor: QA_CTA_BLACK_EDGE,
    shadowOpacity: 0.14,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 7 },
    elevation: 12,
  },
  buttonFrameDisabled: {
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  clipShell: {
    flex: 1,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: QA_CTA_BLACK,
  },
  pressed: {
    transform: [{ scale: 0.986 }],
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
    borderColor: 'rgba(255,255,255,0.12)',
  },
  text: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: 0,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
