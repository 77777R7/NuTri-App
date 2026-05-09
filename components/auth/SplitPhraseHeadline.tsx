import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import {
  Canvas,
  Group,
  matchFont,
  Text as SkiaText,
} from "@shopify/react-native-skia";

type SplitPhrase = string | string[];

type SplitPhraseHeadlineProps = {
  phrases: SplitPhrase[];
  textStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  lineStyle?: StyleProp<ViewStyle>;
  enterDuration?: number;
  exitDuration?: number;
  enterStaggerMs?: number;
  exitStaggerMs?: number;
  holdDurationMs?: number;
  travelY?: number;
};

type SplitChar = {
  char: string;
  id: string;
  lineIndex: number;
};

function normalizePhrase(phrase: SplitPhrase) {
  return Array.isArray(phrase) ? phrase : [phrase];
}

function buildChars(lines: string[]) {
  return lines.flatMap((line, lineIndex) =>
    Array.from(line).map((char, charIndex) => ({
      char,
      id: `${lineIndex}-${charIndex}-${char}`,
      lineIndex,
    })),
  );
}

function buildLineChars(chars: SplitChar[], lineIndex: number) {
  return chars.filter(char => char.lineIndex === lineIndex);
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - clamp(t), 3);
}

function easeInOutCubic(t: number) {
  const value = clamp(t);
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

export function SplitPhraseHeadline({
  phrases,
  textStyle,
  containerStyle,
  lineStyle,
  enterDuration = 560,
  exitDuration = 420,
  enterStaggerMs = 30,
  exitStaggerMs = 24,
  holdDurationMs = 1650,
  travelY = 34,
}: SplitPhraseHeadlineProps) {
  const normalizedPhrases = useMemo(() => phrases.map(normalizePhrase), [phrases]);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [now, setNow] = useState(0);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const cycleStart = useRef(0);
  const frameRef = useRef<number | null>(null);
  const activeLines = useMemo(
    () => normalizedPhrases[phraseIndex] ?? normalizedPhrases[0] ?? [""],
    [normalizedPhrases, phraseIndex],
  );
  const chars = useMemo(() => buildChars(activeLines), [activeLines]);
  const flattenedTextStyle = StyleSheet.flatten(textStyle) ?? {};
  const fontSize = typeof flattenedTextStyle.fontSize === "number" ? flattenedTextStyle.fontSize : 52;
  const lineHeight = typeof flattenedTextStyle.lineHeight === "number" ? flattenedTextStyle.lineHeight : 66;
  const fontFamily = typeof flattenedTextStyle.fontFamily === "string" ? flattenedTextStyle.fontFamily : "Georgia";
  const fontWeight =
    typeof flattenedTextStyle.fontWeight === "string" ? flattenedTextStyle.fontWeight : "500";
  const color = typeof flattenedTextStyle.color === "string" ? flattenedTextStyle.color : "#0B1020";
  const font = useMemo(
    () =>
      matchFont({
        fontFamily,
        fontSize,
        fontStyle: "normal",
        fontWeight,
      }),
    [fontFamily, fontSize, fontWeight],
  );
  const metrics = useMemo(() => font.getMetrics(), [font]);
  const lineMeasurements = useMemo(() => {
    return activeLines.map(line => {
      const lineChars = Array.from(line);
      const advances = lineChars.map(char => (char === " " ? font.getTextWidth(" ") : font.getTextWidth(char)));
      const width = advances.reduce((sum, advance) => sum + advance, 0);
      return { advances, width };
    });
  }, [activeLines, font]);

  const enterTotal = enterDuration + Math.max(0, chars.length - 1) * enterStaggerMs;
  const exitTotal = exitDuration + Math.max(0, chars.length - 1) * exitStaggerMs;
  const cycleTotal = enterTotal + holdDurationMs + exitTotal;

  useEffect(() => {
    if (!chars.length || normalizedPhrases.length === 0) return;

    cycleStart.current = Date.now();
    setNow(cycleStart.current);

    const tick = () => {
      const timestamp = Date.now();
      const elapsed = timestamp - cycleStart.current;

      if (elapsed >= cycleTotal) {
        cycleStart.current = timestamp;
        setPhraseIndex(value => (value + 1) % normalizedPhrases.length);
        setNow(timestamp);
      } else {
        setNow(timestamp);
      }

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [
    chars.length,
    cycleTotal,
    enterDuration,
    enterStaggerMs,
    exitDuration,
    exitStaggerMs,
    holdDurationMs,
    normalizedPhrases.length,
    phraseIndex,
  ]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout(value => (value.width === width && value.height === height ? value : { width, height }));
  };

  const elapsed = Math.max(0, now - cycleStart.current);
  const totalTextHeight = activeLines.length * lineHeight;
  const textTop = Math.max(0, (layout.height - totalTextHeight) / 2);

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={activeLines.join(" ")}
      onLayout={handleLayout}
      pointerEvents="none"
      style={[styles.container, containerStyle]}
    >
      {layout.width > 0 && layout.height > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          {activeLines.map((line, lineIndex) => {
            const lineChars = buildLineChars(chars, lineIndex);
            const measurement = lineMeasurements[lineIndex] ?? { advances: [], width: 0 };
            let cursorX = (layout.width - measurement.width) / 2;
            const lineTop = textTop + lineIndex * lineHeight;
            const baseline =
              lineTop + (lineHeight - (metrics.descent - metrics.ascent)) / 2 - metrics.ascent;

            return lineChars.map(item => {
              const absoluteIndex = chars.findIndex(char => char.id === item.id);
              const advance = measurement.advances[absoluteIndex - chars.findIndex(char => char.lineIndex === lineIndex)] ?? 0;
              const x = cursorX;
              cursorX += advance;

              if (item.char === " ") return null;

              const enterDelay = absoluteIndex * enterStaggerMs;
              const exitOrder = chars.length - 1 - absoluteIndex;
              const exitDelay = enterTotal + holdDurationMs + exitOrder * exitStaggerMs;
              const enterProgress = easeOutCubic((elapsed - enterDelay) / enterDuration);
              const exitProgress = easeInOutCubic((elapsed - exitDelay) / exitDuration);
              const opacity = elapsed < enterTotal + holdDurationMs ? enterProgress : 1 - exitProgress;
              const translateY =
                elapsed < enterTotal + holdDurationMs
                  ? -travelY * (1 - enterProgress)
                  : travelY * exitProgress;

              return (
                <Group key={item.id} opacity={opacity}>
                  <SkiaText
                    color={color}
                    font={font}
                    text={item.char}
                    x={x}
                    y={baseline + translateY}
                  />
                </Group>
              );
            });
          })}
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
});

export default SplitPhraseHeadline;
