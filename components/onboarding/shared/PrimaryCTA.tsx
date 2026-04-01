import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { onboardingShadow } from './theme';

const HERO_CTA_HEIGHT = 63.5;
const HERO_CTA_HALO = 'rgba(80,140,255,0.6)';
const HERO_CTA_TOP_HIGHLIGHT = 'rgba(255,255,255,0.6)';
const HERO_CTA_BOTTOM_SHADOW = 'rgba(0,0,0,0.1)';
const HERO_CTA_BLUE = 'rgba(80,140,255,0.85)';

type PrimaryCTAProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'default' | 'welcomeHero';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
};

export const PrimaryCTA = ({
  title,
  onPress,
  disabled,
  variant = 'default',
  style,
  textStyle,
  testID,
}: PrimaryCTAProps) => {
  const handlePress = async () => {
    if (disabled) return;
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    onPress();
  };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={handlePress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.pressable,
        pressed && !disabled ? (variant === 'welcomeHero' ? styles.heroPressed : styles.pressed) : null,
        style,
      ]}
    >
      <View
        style={[
          styles.button,
          variant === 'welcomeHero' ? styles.heroButton : null,
          disabled ? styles.buttonDisabled : null,
        ]}
      >
        {variant === 'welcomeHero' ? (
          <View style={styles.heroSolidFill} pointerEvents="none" />
        ) : (
          <>
            <LinearGradient
              colors={['#7F9DF5', '#6C8EF2']}
              start={{ x: 0.08, y: 0.22 }}
              end={{ x: 0.96, y: 0.9 }}
              style={StyleSheet.absoluteFillObject}
            />
            <LinearGradient
              colors={['rgba(255,255,255,0.24)', 'rgba(255,255,255,0.04)']}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          </>
        )}
        <View style={[styles.topHighlight, variant === 'welcomeHero' ? styles.heroTopHighlight : null]} />
        {variant === 'welcomeHero' ? <View style={styles.heroBottomInset} pointerEvents="none" /> : null}
        <Text style={[styles.text, variant === 'welcomeHero' ? styles.heroText : null, textStyle]}>{title}</Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  pressable: {
    width: '100%',
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  heroPressed: {
    transform: [{ scale: 0.985 }],
  },
  button: {
    minHeight: 74,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.38)',
    ...onboardingShadow.button,
  },
  heroButton: {
    minHeight: HERO_CTA_HEIGHT,
    shadowColor: HERO_CTA_HALO,
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  buttonDisabled: {
    opacity: 0.58,
  },
  topHighlight: {
    position: 'absolute',
    top: 2,
    left: 12,
    right: 12,
    height: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  heroTopHighlight: {
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: HERO_CTA_TOP_HIGHLIGHT,
  },
  heroBottomInset: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    borderBottomLeftRadius: 999,
    borderBottomRightRadius: 999,
    backgroundColor: HERO_CTA_BOTTOM_SHADOW,
  },
  heroSolidFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    backgroundColor: HERO_CTA_BLUE,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  heroText: {
    fontWeight: '600',
    letterSpacing: -0.77,
  },
});

export default PrimaryCTA;
