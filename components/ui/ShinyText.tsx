import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, TextStyle, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';

interface ShinyTextProps {
  text: string;
  style?: TextStyle;
  disabled?: boolean;
  speed?: number;
  className?: string;
}

export const ShinyText: React.FC<ShinyTextProps> = ({
  text,
  style,
  disabled = false,
  speed = 2.0,
}) => {
  const [textWidth, setTextWidth] = useState(0);
  const translateX = useSharedValue(-100);

  useEffect(() => {
    if (!disabled && textWidth > 0) {
      translateX.value = withRepeat(
        withTiming(textWidth, {
          duration: speed * 1000,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
    }
  }, [disabled, speed, textWidth, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    setTextWidth(event.nativeEvent.layout.width);
  };

  const flatStyle = StyleSheet.flatten(style);
  const color = flatStyle?.color || '#71717a';
  const textStyle: TextStyle = {
    ...(flatStyle || {}),
    includeFontPadding: false,
    textAlignVertical: 'center',
  };

  return (
    <View style={{ alignSelf: 'flex-start', justifyContent: 'center' }} onLayout={onLayout}>
      <Text style={[textStyle, { opacity: 0 }]}>{text}</Text>

      <View style={StyleSheet.absoluteFill}>
        <Text style={[textStyle, { color }]}>{text}</Text>
      </View>

      <MaskedView
        style={StyleSheet.absoluteFill}
        maskElement={
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={[textStyle, { color: 'black' }]}>{text}</Text>
          </View>
        }
      >
        <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
          <LinearGradient
            colors={['transparent', 'rgba(255,255,255,0.9)', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </MaskedView>
    </View>
  );
};

// styles removed (unused)
