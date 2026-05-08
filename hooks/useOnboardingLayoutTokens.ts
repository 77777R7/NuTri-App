import { useMemo } from 'react';
import { PixelRatio, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PHONE_FRAME_WIDTH, isPhoneLike } from '@/constants/designTokens';

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const BASE_WIDTH = 390;
const NOTCH_TOP_TARGET = 59;
const NO_NOTCH_TOP_TARGET = 20;
const HOME_INDICATOR_BOTTOM_TARGET = 34;

type OnboardingDensity = 'regular' | 'compact' | 'tight';

type SharedShellFooterReserveArgs = {
  backgroundVariant: 'qa' | 'summary';
  hasSkip: boolean;
  hasHelper: boolean;
};

const DENSITY_VALUES: Record<
  OnboardingDensity,
  {
    shellTopOffset: number;
    shellHeaderHeight: number;
    shellFooterInsetFloor: number;
    qaContentPaddingX: number;
    qaContentPaddingTop: number;
    qaEyebrowMarginBottom: number;
    qaTitleSize: number;
    qaTitleLineHeight: number;
    qaSubtitleMarginTop: number;
    qaSubtitleSize: number;
    qaSubtitleLineHeight: number;
    qaCopyToListGap: number;
    qaListGap: number;
    optionRowMinHeight: number;
    optionRowWithDescriptionMinHeight: number;
    optionRowPaddingX: number;
    optionRowPaddingY: number;
    optionRowDescriptionPaddingY: number;
    optionLabelSize: number;
    optionLabelLineHeight: number;
    optionDescriptionSize: number;
    optionDescriptionLineHeight: number;
    welcomeHeadlineSize: number;
    welcomeHeadlineLineHeight: number;
    welcomeSubtextSize: number;
    welcomeSubtextLineHeight: number;
    welcomeFooterMinHeight: number;
    welcomeFooterPaddingTop: number;
    welcomeProgressMarginBottom: number;
    welcomeMicrocopyMarginTop: number;
    welcomeCopyPaddingX: number;
    dataTrustHeadlineSize: number;
    dataTrustHeadlineLineHeight: number;
    dataTrustSubtextSize: number;
    dataTrustSubtextLineHeight: number;
    dataTrustHeroTopPadding: number;
    dataTrustViewportPaddingBottom: number;
    dataTrustCopyPaddingX: number;
    dataTrustPanelHeight: number;
    dataTrustRowGap: number;
    summaryContentPaddingX: number;
    summaryContentPaddingTop: number;
    summaryTitleSize: number;
    summaryTitleLineHeight: number;
    summarySubtitleSize: number;
    summarySubtitleLineHeight: number;
    summaryListGap: number;
    summaryCardPadding: number;
    summaryCardSectionGap: number;
    summaryCardTitleSize: number;
    summaryCardTitleLineHeight: number;
    summaryScrollbarTop: number;
    firstStackListGap: number;
    firstStackDetailRowMinHeight: number;
    qaCtaHeight: number;
    qaCtaLabelSize: number;
    qaCtaLabelLineHeight: number;
    qaFooterTopPadding: number;
    qaFooterHelperPaddingTop: number;
    qaFooterSkipMinHeight: number;
    qaFooterSkipTextSize: number;
    qaFooterSkipTextLineHeight: number;
  }
> = {
  regular: {
    shellTopOffset: 10,
    shellHeaderHeight: 44,
    shellFooterInsetFloor: 14,
    qaContentPaddingX: 32,
    qaContentPaddingTop: 48,
    qaEyebrowMarginBottom: 14,
    qaTitleSize: 34,
    qaTitleLineHeight: 36,
    qaSubtitleMarginTop: 16,
    qaSubtitleSize: 16,
    qaSubtitleLineHeight: 23,
    qaCopyToListGap: 38,
    qaListGap: 14,
    optionRowMinHeight: 58,
    optionRowWithDescriptionMinHeight: 84,
    optionRowPaddingX: 24,
    optionRowPaddingY: 16,
    optionRowDescriptionPaddingY: 18,
    optionLabelSize: 17,
    optionLabelLineHeight: 22,
    optionDescriptionSize: 14,
    optionDescriptionLineHeight: 20,
    welcomeHeadlineSize: 44,
    welcomeHeadlineLineHeight: 48,
    welcomeSubtextSize: 17,
    welcomeSubtextLineHeight: 25,
    welcomeFooterMinHeight: 166,
    welcomeFooterPaddingTop: 10,
    welcomeProgressMarginBottom: 16,
    welcomeMicrocopyMarginTop: 14,
    welcomeCopyPaddingX: 32,
    dataTrustHeadlineSize: 30,
    dataTrustHeadlineLineHeight: 34,
    dataTrustSubtextSize: 17,
    dataTrustSubtextLineHeight: 25,
    dataTrustHeroTopPadding: 22,
    dataTrustViewportPaddingBottom: 24,
    dataTrustCopyPaddingX: 36,
    dataTrustPanelHeight: 236,
    dataTrustRowGap: 24,
    summaryContentPaddingX: 32,
    summaryContentPaddingTop: 24,
    summaryTitleSize: 34,
    summaryTitleLineHeight: 36,
    summarySubtitleSize: 16,
    summarySubtitleLineHeight: 23.2,
    summaryListGap: 24,
    summaryCardPadding: 24,
    summaryCardSectionGap: 24,
    summaryCardTitleSize: 22,
    summaryCardTitleLineHeight: 33,
    summaryScrollbarTop: 212,
    firstStackListGap: 32,
    firstStackDetailRowMinHeight: 78,
    qaCtaHeight: 72,
    qaCtaLabelSize: 17,
    qaCtaLabelLineHeight: 22,
    qaFooterTopPadding: 12,
    qaFooterHelperPaddingTop: 12,
    qaFooterSkipMinHeight: 50,
    qaFooterSkipTextSize: 14,
    qaFooterSkipTextLineHeight: 18,
  },
  compact: {
    shellTopOffset: 8,
    shellHeaderHeight: 42,
    shellFooterInsetFloor: 12,
    qaContentPaddingX: 26,
    qaContentPaddingTop: 26,
    qaEyebrowMarginBottom: 12,
    qaTitleSize: 32,
    qaTitleLineHeight: 34,
    qaSubtitleMarginTop: 14,
    qaSubtitleSize: 15,
    qaSubtitleLineHeight: 21,
    qaCopyToListGap: 16,
    qaListGap: 9,
    optionRowMinHeight: 50,
    optionRowWithDescriptionMinHeight: 72,
    optionRowPaddingX: 20,
    optionRowPaddingY: 12,
    optionRowDescriptionPaddingY: 15,
    optionLabelSize: 16,
    optionLabelLineHeight: 21,
    optionDescriptionSize: 13,
    optionDescriptionLineHeight: 18,
    welcomeHeadlineSize: 40,
    welcomeHeadlineLineHeight: 42,
    welcomeSubtextSize: 16,
    welcomeSubtextLineHeight: 23,
    welcomeFooterMinHeight: 150,
    welcomeFooterPaddingTop: 8,
    welcomeProgressMarginBottom: 14,
    welcomeMicrocopyMarginTop: 12,
    welcomeCopyPaddingX: 28,
    dataTrustHeadlineSize: 28,
    dataTrustHeadlineLineHeight: 32,
    dataTrustSubtextSize: 16,
    dataTrustSubtextLineHeight: 23,
    dataTrustHeroTopPadding: 14,
    dataTrustViewportPaddingBottom: 18,
    dataTrustCopyPaddingX: 28,
    dataTrustPanelHeight: 236,
    dataTrustRowGap: 16,
    summaryContentPaddingX: 28,
    summaryContentPaddingTop: 16,
    summaryTitleSize: 32,
    summaryTitleLineHeight: 34,
    summarySubtitleSize: 15,
    summarySubtitleLineHeight: 21.5,
    summaryListGap: 16,
    summaryCardPadding: 20,
    summaryCardSectionGap: 16,
    summaryCardTitleSize: 21,
    summaryCardTitleLineHeight: 30,
    summaryScrollbarTop: 192,
    firstStackListGap: 20,
    firstStackDetailRowMinHeight: 70,
    qaCtaHeight: 64,
    qaCtaLabelSize: 16,
    qaCtaLabelLineHeight: 21,
    qaFooterTopPadding: 8,
    qaFooterHelperPaddingTop: 8,
    qaFooterSkipMinHeight: 34,
    qaFooterSkipTextSize: 13.5,
    qaFooterSkipTextLineHeight: 17,
  },
  tight: {
    shellTopOffset: 4,
    shellHeaderHeight: 36,
    shellFooterInsetFloor: 8,
    qaContentPaddingX: 20,
    qaContentPaddingTop: 12,
    qaEyebrowMarginBottom: 6,
    qaTitleSize: 26,
    qaTitleLineHeight: 28,
    qaSubtitleMarginTop: 8,
    qaSubtitleSize: 14,
    qaSubtitleLineHeight: 18,
    qaCopyToListGap: 10,
    qaListGap: 7,
    optionRowMinHeight: 44,
    optionRowWithDescriptionMinHeight: 62,
    optionRowPaddingX: 18,
    optionRowPaddingY: 9,
    optionRowDescriptionPaddingY: 10,
    optionLabelSize: 14.5,
    optionLabelLineHeight: 19,
    optionDescriptionSize: 12.5,
    optionDescriptionLineHeight: 16,
    welcomeHeadlineSize: 36,
    welcomeHeadlineLineHeight: 38,
    welcomeSubtextSize: 15,
    welcomeSubtextLineHeight: 21,
    welcomeFooterMinHeight: 138,
    welcomeFooterPaddingTop: 6,
    welcomeProgressMarginBottom: 12,
    welcomeMicrocopyMarginTop: 10,
    welcomeCopyPaddingX: 24,
    dataTrustHeadlineSize: 26,
    dataTrustHeadlineLineHeight: 30,
    dataTrustSubtextSize: 15,
    dataTrustSubtextLineHeight: 21,
    dataTrustHeroTopPadding: 8,
    dataTrustViewportPaddingBottom: 12,
    dataTrustCopyPaddingX: 22,
    dataTrustPanelHeight: 230,
    dataTrustRowGap: 12,
    summaryContentPaddingX: 24,
    summaryContentPaddingTop: 12,
    summaryTitleSize: 30,
    summaryTitleLineHeight: 32,
    summarySubtitleSize: 15,
    summarySubtitleLineHeight: 20,
    summaryListGap: 12,
    summaryCardPadding: 18,
    summaryCardSectionGap: 14,
    summaryCardTitleSize: 20,
    summaryCardTitleLineHeight: 28,
    summaryScrollbarTop: 176,
    firstStackListGap: 14,
    firstStackDetailRowMinHeight: 62,
    qaCtaHeight: 58,
    qaCtaLabelSize: 15,
    qaCtaLabelLineHeight: 20,
    qaFooterTopPadding: 4,
    qaFooterHelperPaddingTop: 4,
    qaFooterSkipMinHeight: 24,
    qaFooterSkipTextSize: 12.5,
    qaFooterSkipTextLineHeight: 15,
  },
};

const getSharedShellFooterReserveHeight = (
  density: OnboardingDensity,
  { backgroundVariant, hasSkip, hasHelper }: SharedShellFooterReserveArgs,
) => {
  if (backgroundVariant === 'summary') {
    return density === 'tight' ? 92 : density === 'compact' ? 102 : 120;
  }

  if (hasSkip) {
    if (hasHelper) {
      return density === 'tight' ? 86 : density === 'compact' ? 104 : 132;
    }
    return density === 'tight' ? 72 : density === 'compact' ? 84 : 108;
  }

  return density === 'tight' ? 66 : density === 'compact' ? 80 : 102;
};

export const useOnboardingLayoutTokens = () => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const round = PixelRatio.roundToNearestPixel;
  const phoneLike = isPhoneLike(width, height);
  const frameWidth = phoneLike ? Math.min(width, PHONE_FRAME_WIDTH) : width;
  const widthBasis = Math.min(frameWidth, PHONE_FRAME_WIDTH);
  const ratioScale = phoneLike
    ? clamp(widthBasis / BASE_WIDTH, 0.92, 1.05)
    : widthBasis / BASE_WIDTH;

  const hasNotch = insets.top > 20;
  const visualSafeTop = hasNotch
    ? Math.max(insets.top, NOTCH_TOP_TARGET)
    : Math.max(insets.top, NO_NOTCH_TOP_TARGET);
  const visualSafeBottom = hasNotch
    ? Math.max(insets.bottom, HOME_INDICATOR_BOTTOM_TARGET)
    : insets.bottom;

  const availableVertical = height - visualSafeTop - visualSafeBottom;
  const density: OnboardingDensity =
    availableVertical <= 720 ? 'tight' : availableVertical <= 800 ? 'compact' : 'regular';
  const values = DENSITY_VALUES[density];

  const pageX = clamp(round(widthBasis * 0.06), 18, 30);
  const shellHorizontal = clamp(
    round(pageX + (density === 'regular' ? 0 : density === 'compact' ? -1 : -2)),
    18,
    24,
  );
  const heroCardScale = density === 'tight' ? 0.88 : density === 'compact' ? 0.94 : 1;
  const contentWidth = Math.max(0, frameWidth - pageX * 2);
  const sideMargin = Math.max(0, (width - frameWidth) / 2);
  const shellFooterInset = Math.max(insets.bottom - 4, values.shellFooterInsetFloor);
  const welcomeTopPadding = insets.top + values.shellTopOffset;
  const welcomeCardWidth = clamp(round(Math.min(width - 56, 320) * heroCardScale), 236, 320);
  const dataTrustPanelInset = density === 'tight' ? 92 : density === 'compact' ? 100 : 110;
  const dataTrustPanelWidth = clamp(
    round(Math.min(width - dataTrustPanelInset, 320) * heroCardScale),
    220,
    320,
  );
  const dataTrustPanelHeight = values.dataTrustPanelHeight;

  return useMemo(
    () => ({
      width,
      height,
      insets,
      density,
      ratioScale,
      frameWidth,
      contentWidth,
      sideMargin,
      pageX,
      shellHorizontal,
      shellTopOffset: values.shellTopOffset,
      sharedShellHeaderHeight: values.shellHeaderHeight,
      shellFooterInset,
      getSharedShellFooterReserveHeight: (args: SharedShellFooterReserveArgs) =>
        getSharedShellFooterReserveHeight(density, args),
      qaContentPaddingX: values.qaContentPaddingX,
      qaContentPaddingTop: values.qaContentPaddingTop,
      qaEyebrowMarginBottom: values.qaEyebrowMarginBottom,
      qaTitleSize: values.qaTitleSize,
      qaTitleLineHeight: values.qaTitleLineHeight,
      qaSubtitleMarginTop: values.qaSubtitleMarginTop,
      qaSubtitleSize: values.qaSubtitleSize,
      qaSubtitleLineHeight: values.qaSubtitleLineHeight,
      qaCopyToListGap: values.qaCopyToListGap,
      qaListGap: values.qaListGap,
      optionRowMinHeight: values.optionRowMinHeight,
      optionRowWithDescriptionMinHeight: values.optionRowWithDescriptionMinHeight,
      optionRowPaddingX: values.optionRowPaddingX,
      optionRowPaddingY: values.optionRowPaddingY,
      optionRowDescriptionPaddingY: values.optionRowDescriptionPaddingY,
      optionLabelSize: values.optionLabelSize,
      optionLabelLineHeight: values.optionLabelLineHeight,
      optionDescriptionSize: values.optionDescriptionSize,
      optionDescriptionLineHeight: values.optionDescriptionLineHeight,
      welcomeTopPadding,
      welcomeCardWidth,
      welcomeCardHeight: Math.round(welcomeCardWidth * 0.553),
      welcomeHeadlineSize: values.welcomeHeadlineSize,
      welcomeHeadlineLineHeight: values.welcomeHeadlineLineHeight,
      welcomeSubtextSize: values.welcomeSubtextSize,
      welcomeSubtextLineHeight: values.welcomeSubtextLineHeight,
      welcomeFooterMinHeight: values.welcomeFooterMinHeight,
      welcomeFooterPaddingTop: values.welcomeFooterPaddingTop,
      welcomeProgressMarginBottom: values.welcomeProgressMarginBottom,
      welcomeMicrocopyMarginTop: values.welcomeMicrocopyMarginTop,
      welcomeCopyPaddingX: values.welcomeCopyPaddingX,
      dataTrustHeadlineSize: values.dataTrustHeadlineSize,
      dataTrustHeadlineLineHeight: values.dataTrustHeadlineLineHeight,
      dataTrustSubtextSize: values.dataTrustSubtextSize,
      dataTrustSubtextLineHeight: values.dataTrustSubtextLineHeight,
      dataTrustHeroTopPadding: values.dataTrustHeroTopPadding,
      dataTrustViewportPaddingBottom: values.dataTrustViewportPaddingBottom,
      dataTrustCopyPaddingX: values.dataTrustCopyPaddingX,
      dataTrustPanelWidth,
      dataTrustPanelHeight,
      dataTrustRowGap: values.dataTrustRowGap,
      summaryContentPaddingX: values.summaryContentPaddingX,
      summaryContentPaddingTop: values.summaryContentPaddingTop,
      summaryTitleSize: values.summaryTitleSize,
      summaryTitleLineHeight: values.summaryTitleLineHeight,
      summarySubtitleSize: values.summarySubtitleSize,
      summarySubtitleLineHeight: values.summarySubtitleLineHeight,
      summaryListGap: values.summaryListGap,
      summaryCardPadding: values.summaryCardPadding,
      summaryCardSectionGap: values.summaryCardSectionGap,
      summaryCardTitleSize: values.summaryCardTitleSize,
      summaryCardTitleLineHeight: values.summaryCardTitleLineHeight,
      summaryScrollbarTop: values.summaryScrollbarTop,
      firstStackListGap: values.firstStackListGap,
      firstStackDetailRowMinHeight: values.firstStackDetailRowMinHeight,
      qaCtaHeight: values.qaCtaHeight,
      qaCtaLabelSize: values.qaCtaLabelSize,
      qaCtaLabelLineHeight: values.qaCtaLabelLineHeight,
      qaFooterTopPadding: values.qaFooterTopPadding,
      qaFooterHelperPaddingTop: values.qaFooterHelperPaddingTop,
      qaFooterSkipMinHeight: values.qaFooterSkipMinHeight,
      qaFooterSkipTextSize: values.qaFooterSkipTextSize,
      qaFooterSkipTextLineHeight: values.qaFooterSkipTextLineHeight,
    }),
    [
      contentWidth,
      dataTrustPanelHeight,
      dataTrustPanelWidth,
      density,
      frameWidth,
      height,
      insets,
      pageX,
      ratioScale,
      shellFooterInset,
      shellHorizontal,
      sideMargin,
      values.dataTrustCopyPaddingX,
      values.dataTrustHeadlineLineHeight,
      values.dataTrustHeadlineSize,
      values.dataTrustHeroTopPadding,
      values.dataTrustRowGap,
      values.dataTrustSubtextLineHeight,
      values.dataTrustSubtextSize,
      values.dataTrustViewportPaddingBottom,
      values.firstStackDetailRowMinHeight,
      values.firstStackListGap,
      values.optionDescriptionLineHeight,
      values.optionDescriptionSize,
      values.optionLabelLineHeight,
      values.optionLabelSize,
      values.optionRowDescriptionPaddingY,
      values.optionRowMinHeight,
      values.optionRowPaddingX,
      values.optionRowPaddingY,
      values.optionRowWithDescriptionMinHeight,
      values.qaCtaHeight,
      values.qaCtaLabelLineHeight,
      values.qaCtaLabelSize,
      values.qaContentPaddingTop,
      values.qaContentPaddingX,
      values.qaCopyToListGap,
      values.qaEyebrowMarginBottom,
      values.qaFooterHelperPaddingTop,
      values.qaFooterSkipMinHeight,
      values.qaFooterSkipTextLineHeight,
      values.qaFooterSkipTextSize,
      values.qaFooterTopPadding,
      values.qaListGap,
      values.qaSubtitleLineHeight,
      values.qaSubtitleMarginTop,
      values.qaSubtitleSize,
      values.qaTitleLineHeight,
      values.qaTitleSize,
      values.shellHeaderHeight,
      values.shellTopOffset,
      values.summaryCardPadding,
      values.summaryCardSectionGap,
      values.summaryCardTitleLineHeight,
      values.summaryCardTitleSize,
      values.summaryContentPaddingTop,
      values.summaryContentPaddingX,
      values.summaryListGap,
      values.summaryScrollbarTop,
      values.summarySubtitleLineHeight,
      values.summarySubtitleSize,
      values.summaryTitleLineHeight,
      values.summaryTitleSize,
      values.welcomeCopyPaddingX,
      values.welcomeFooterMinHeight,
      values.welcomeFooterPaddingTop,
      values.welcomeHeadlineLineHeight,
      values.welcomeHeadlineSize,
      values.welcomeMicrocopyMarginTop,
      values.welcomeProgressMarginBottom,
      values.welcomeSubtextLineHeight,
      values.welcomeSubtextSize,
      welcomeCardWidth,
      welcomeTopPadding,
      width,
    ],
  );
};

export default useOnboardingLayoutTokens;
