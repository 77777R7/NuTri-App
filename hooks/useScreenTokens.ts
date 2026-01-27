import { useMemo } from 'react';
import { PixelRatio, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isPhoneLike, PHONE_FRAME_WIDTH } from '@/constants/designTokens';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const BASE_WIDTH = 390;
const NOTCH_TOP_TARGET = 59;
const NO_NOTCH_TOP_TARGET = 20;
const HOME_INDICATOR_BOTTOM_TARGET = 34;
const GLOBAL_TOP_OFFSET = 8;
const GUTTER_RATIO = 0.06;
const SECTION_GAP_RATIO = 0.052;
const TITLE_RATIO = 0.092;
const TITLE_LINE_RATIO = 0.103;

export const useScreenTokens = (navHeight: number) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const phoneLike = isPhoneLike(width, height);
  const frameWidth = phoneLike ? Math.min(width, PHONE_FRAME_WIDTH) : width;
  const widthBasis = Math.min(frameWidth, PHONE_FRAME_WIDTH);
  const ratioScale = phoneLike ? clamp(widthBasis / BASE_WIDTH, 0.92, 1.05) : widthBasis / BASE_WIDTH;

  const round = (value: number) => PixelRatio.roundToNearestPixel(value);

  const hasNotch = insets.top > 20;
  const visualSafeTop = hasNotch ? Math.max(insets.top, NOTCH_TOP_TARGET) : Math.max(insets.top, NO_NOTCH_TOP_TARGET);
  const visualSafeBottom = hasNotch
    ? Math.max(insets.bottom, HOME_INDICATOR_BOTTOM_TARGET)
    : insets.bottom;

  const pageX = clamp(round(widthBasis * GUTTER_RATIO), 18, 30);
  const pageTop = clamp(round(widthBasis * GUTTER_RATIO), 18, 30);
  const sectionGap = clamp(round(widthBasis * SECTION_GAP_RATIO), 16, 28);

  const h1Size = clamp(round(widthBasis * TITLE_RATIO), 32, 40);
  const h1Line = clamp(round(widthBasis * TITLE_LINE_RATIO), 36, 44);

  const extraTop = clamp(round(GLOBAL_TOP_OFFSET * ratioScale), 6, 12);
  const bottomPad = clamp(round(24 * ratioScale), 18, 30);
  const contentTopPadding = visualSafeTop + pageTop + extraTop;
  const contentBottomPadding = navHeight + visualSafeBottom + bottomPad;
  const contentWidth = Math.max(0, frameWidth - pageX * 2);
  const sideMargin = Math.max(0, (width - frameWidth) / 2);

  return useMemo(
    () => ({
      width,
      height,
      insets,
      frameWidth,
      contentWidth,
      sideMargin,
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
      frameWidth,
      contentWidth,
      sideMargin,
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
