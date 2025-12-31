import { useMemo } from 'react';
import { PixelRatio, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const BASE_WIDTH = 390;
const NOTCH_TOP_TARGET = 59;
const NO_NOTCH_TOP_TARGET = 20;
const HOME_INDICATOR_BOTTOM_TARGET = 34;
const GLOBAL_TOP_OFFSET = 8;

export const useScreenTokens = (navHeight: number) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scale = width / BASE_WIDTH;

  const ms = (size: number, factor = 0.22) => {
    const scaled = size * scale;
    const mixed = size + (scaled - size) * factor;
    return PixelRatio.roundToNearestPixel(mixed);
  };

  const hasNotch = insets.top > 20;
  const visualSafeTop = hasNotch ? Math.max(insets.top, NOTCH_TOP_TARGET) : Math.max(insets.top, NO_NOTCH_TOP_TARGET);
  const visualSafeBottom = hasNotch
    ? Math.max(insets.bottom, HOME_INDICATOR_BOTTOM_TARGET)
    : insets.bottom;

  const pageX = clamp(ms(24), 20, 28);
  const pageTop = clamp(ms(24), 18, 28);
  const sectionGap = clamp(ms(24), 18, 28);

  const h1Size = clamp(ms(36, 0.18), 32, 38);
  const h1Line = clamp(ms(40, 0.18), 36, 42);

  const extraTop = clamp(ms(GLOBAL_TOP_OFFSET, 0.18), 6, 12);
  const contentTopPadding = visualSafeTop + pageTop + extraTop;
  const contentBottomPadding = navHeight + visualSafeBottom + clamp(ms(24), 18, 28);

  return useMemo(
    () => ({
      width,
      height,
      insets,
      pageX,
      pageTop,
      sectionGap,
      h1Size,
      h1Line,
      contentTopPadding,
      contentBottomPadding,
    }),
    [
      width,
      height,
      insets,
      pageX,
      pageTop,
      sectionGap,
      h1Size,
      h1Line,
      contentTopPadding,
      contentBottomPadding,
    ],
  );
};
