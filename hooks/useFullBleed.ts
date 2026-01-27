import { useMemo } from 'react';
import type { ViewStyle } from 'react-native';

type FullBleedStyles = {
  bleedStyle: ViewStyle;
  contentStyle: ViewStyle;
};

export const useFullBleed = (bleed: number): FullBleedStyles =>
  useMemo(
    () => ({
      bleedStyle: { marginHorizontal: -bleed },
      contentStyle: { paddingHorizontal: bleed },
    }),
    [bleed],
  );
