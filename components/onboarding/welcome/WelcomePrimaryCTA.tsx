import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

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
    shadowColor: '#0D0D0D',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  clipShell: {
    flex: 1,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0D0D0D',
  },
  pressed: {
    transform: [{ scale: 0.985 }],
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
