import React, { useMemo, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

type AutoFitTextProps = {
  text: string;
  baseFontSize: number;
  baseLineHeight: number;
  minFontSize?: number;
  style?: StyleProp<TextStyle>;
};

export function AutoFitText({
  text,
  baseFontSize,
  baseLineHeight,
  minFontSize = Math.round(baseFontSize * 0.86),
  style,
}: AutoFitTextProps) {
  const [containerW, setContainerW] = useState<number | null>(null);
  const [naturalW, setNaturalW] = useState<number | null>(null);

  const { fontSize, lineHeight } = useMemo(() => {
    if (!containerW || !naturalW) {
      return { fontSize: baseFontSize, lineHeight: baseLineHeight };
    }
    const scale = clamp(containerW / naturalW, minFontSize / baseFontSize, 1);
    const nextSize = Math.round(baseFontSize * scale);
    const ratio = baseLineHeight / baseFontSize;
    const nextLine = Math.round(nextSize * ratio);
    return { fontSize: nextSize, lineHeight: nextLine };
  }, [baseFontSize, baseLineHeight, containerW, naturalW, minFontSize]);

  const onContainerLayout = (event: LayoutChangeEvent) => {
    const w = event.nativeEvent.layout.width;
    if (w > 0) setContainerW(w);
  };

  const onNaturalLayout = (event: LayoutChangeEvent) => {
    const w = event.nativeEvent.layout.width;
    if (w > 0) setNaturalW(w);
  };

  return (
    <View onLayout={onContainerLayout} style={styles.container}>
      <Text numberOfLines={1} style={[{ fontSize, lineHeight }, style]} includeFontPadding={false}>
        {text}
      </Text>

      <View pointerEvents="none" style={styles.measure}>
        <Text
          numberOfLines={1}
          onLayout={onNaturalLayout}
          style={[{ fontSize: baseFontSize, lineHeight: baseLineHeight }, style]}
          includeFontPadding={false}
        >
          {text}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minWidth: 0 },
  measure: { position: 'absolute', opacity: 0, left: 9999, top: 0 },
});
