import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { resolveDesignTokens } from '@/constants/designTokens';

export const useResponsiveTokens = () => {
  const { width, height } = useWindowDimensions();

  return useMemo(() => resolveDesignTokens(width || 0, height || undefined), [width, height]);
};

