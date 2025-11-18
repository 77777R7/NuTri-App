import type { TextStyle, ViewStyle } from 'react-native';

export type BreakpointKey = 'small' | 'default' | 'standard' | 'plus' | 'xl';

export type SpacingToken = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
export type RadiusToken = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
export type TypographyToken = 'display' | 'title' | 'subtitle' | 'body' | 'bodySmall' | 'label';

export type ShadowToken = 'card' | 'lifted';

export interface TypographyDefinition {
  fontSize: number;
  lineHeight: number;
  fontWeight?: TextStyle['fontWeight'];
  letterSpacing?: number;
}

export interface ShadowDefinition
  extends Pick<ViewStyle, 'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'> {}

export interface ComponentTokens {
  iconButton: {
    size: number;
    radius: number;
    iconSize: number;
  };
  card: {
    radius: number;
    paddingVertical: number;
    paddingHorizontal: number;
    gap: number;
  };
}

export interface LayoutTokens {
  gutter: number;
  stack: number;
  maxContentWidth: number;
}

export interface ColorTokens {
  background: string;
  surface: string;
  surfaceMuted: string;
  textPrimary: string;
  textMuted: string;
  accent: string;
  border: string;
  accentSoft: string;
  danger: string;
  warning: string;
  info: string;
}

export interface SafeAreaTokens {
  top: number;
  bottom: number;
}

export interface DesignTokens {
  spacing: Record<SpacingToken, number>;
  radius: Record<RadiusToken, number>;
  typography: Record<TypographyToken, TypographyDefinition>;
  colors: ColorTokens;
  safeArea: SafeAreaTokens;
  layout: LayoutTokens;
  components: ComponentTokens;
  shadow: Record<ShadowToken, ShadowDefinition>;
}

export interface DesignTokenResult {
  breakpoint: BreakpointKey;
  scale: number;
  tokens: DesignTokens;
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const BREAKPOINTS: { key: BreakpointKey; minWidth: number }[] = [
  { key: 'small', minWidth: 0 },
  { key: 'default', minWidth: 361 },
  { key: 'standard', minWidth: 391 },
  { key: 'plus', minWidth: 415 },
  { key: 'xl', minWidth: 435 },
];

const BASE_WIDTH = 390;
const BASE_HEIGHT = 844;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);


const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const baseTokens: DesignTokens = {
  spacing: {
    xs: 6,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    '2xl': 32,
    '3xl': 40,
  },
  radius: {
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    '2xl': 28,
    full: 999,
  },
  typography: {
    display: {
      fontSize: 40,
      lineHeight: 46,
      fontWeight: '700',
    },
    title: {
      fontSize: 24,
      lineHeight: 30,
      fontWeight: '700',
    },
    subtitle: {
      fontSize: 18,
      lineHeight: 26,
      fontWeight: '600',
    },
    body: {
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '500',
    },
    bodySmall: {
      fontSize: 13,
      lineHeight: 18,
    },
    label: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '600',
      letterSpacing: 0.2,
    },
  },
  colors: {
    background: '#F4FBF9',
    surface: '#FFFFFF',
    surfaceMuted: '#F1F5F9',
    textPrimary: '#0F1F1C',
    textMuted: '#6A8C86',
    accent: '#2CC2B3',
    border: '#E1F0EB',
    accentSoft: 'rgba(44, 194, 179, 0.12)',
    danger: '#EF4444',
    warning: '#F59E0B',
    info: '#0EA5E9',
  },
  safeArea: {
    top: 16,
    bottom: 24,
  },
  layout: {
    gutter: 24,
    stack: 24,
    maxContentWidth: 520,
  },
  components: {
    iconButton: {
      size: 44,
      radius: 22,
      iconSize: 20,
    },
    card: {
      radius: 28,
      paddingVertical: 28,
      paddingHorizontal: 24,
      gap: 16,
    },
  },
  shadow: {
    card: {
      shadowColor: 'rgba(15, 31, 28, 0.25)',
      shadowOpacity: 0.12,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
      elevation: 10,
    },
    lifted: {
      shadowColor: 'rgba(17, 24, 39, 0.18)',
      shadowOpacity: 0.12,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
  },
};

const breakpointOverrides: Partial<Record<BreakpointKey, DeepPartial<DesignTokens>>> = {
  small: {
    typography: {
      display: {
        fontSize: 36,
        lineHeight: 42,
      },
      title: {
        fontSize: 22,
        lineHeight: 28,
      },
      subtitle: {
        fontSize: 17,
      },
      body: {
        fontSize: 14,
        lineHeight: 20,
      },
    },
    layout: {
      gutter: 20,
      stack: 20,
      maxContentWidth: 480,
    },
    components: {
      iconButton: {
        size: 40,
      },
      card: {
        paddingVertical: 24,
        paddingHorizontal: 20,
      },
    },
  },
  standard: {
    layout: {
      gutter: 26,
      stack: 26,
    },
    typography: {
      title: {
        fontSize: 25,
      },
    },
  },
  plus: {
    typography: {
      display: {
        fontSize: 42,
      },
      title: {
        fontSize: 26,
      },
      body: {
        fontSize: 16,
        lineHeight: 24,
      },
    },
    layout: {
      gutter: 28,
      stack: 28,
      maxContentWidth: 560,
    },
    components: {
      card: {
        radius: 30,
        paddingVertical: 32,
        paddingHorizontal: 28,
      },
    },
  },
  xl: {
    typography: {
      display: {
        fontSize: 44,
        lineHeight: 50,
      },
      title: {
        fontSize: 28,
        lineHeight: 34,
      },
    },
    layout: {
      gutter: 32,
      stack: 32,
      maxContentWidth: 600,
    },
    components: {
      card: {
        radius: 32,
        paddingVertical: 36,
        paddingHorizontal: 32,
      },
    },
  },
};

const deepMerge = <T,>(base: T, override?: DeepPartial<T>): T => {
  if (!override) {
    return base;
  }

  const result: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };

  Object.entries(override).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }

    const baseValue = (base as any)[key];

    if (isObject(baseValue) && isObject(value)) {
      result[key] = deepMerge(baseValue, value as DeepPartial<typeof baseValue>);
    } else {
      result[key] = value;
    }
  });

  return result as T;
};

const scaleNumber = (value: number, scale: number, options?: { min?: number; max?: number }) => {
  const scaled = value * scale;
  const min = options?.min ?? 0;
  const max = options?.max ?? Number.POSITIVE_INFINITY;
  return clamp(Math.round(scaled), min, max);
};

const scaleNumericRecord = <T extends Record<string, number>>(record: T, scale: number, options?: { min?: number }) => {
  const min = options?.min ?? 1;
  const next: Partial<T> = {};
  Object.keys(record).forEach((key) => {
    const typedKey = key as keyof T;
    next[typedKey] = scaleNumber(record[typedKey], scale, { min }) as T[keyof T];
  });
  return next as T;
};

const scaleTypographyRecord = (record: Record<TypographyToken, TypographyDefinition>, scale: number) => {
  return Object.entries(record).reduce((acc, [key, value]) => {
    acc[key as TypographyToken] = {
      ...value,
      fontSize: scaleNumber(value.fontSize, scale, { min: 11 }),
      lineHeight: scaleNumber(value.lineHeight, scale, { min: value.fontSize + 4 }),
      letterSpacing:
        typeof value.letterSpacing === 'number'
          ? Number((value.letterSpacing * scale).toFixed(2))
          : value.letterSpacing,
    };
    return acc;
  }, {} as Record<TypographyToken, TypographyDefinition>);
};

const applyScaling = (tokens: DesignTokens, scale: number): DesignTokens => {
  const scaledIconButtonSize = scaleNumber(tokens.components.iconButton.size, scale, { min: 36 });

  return {
    spacing: scaleNumericRecord(tokens.spacing, scale, { min: 4 }),
    radius: scaleNumericRecord(tokens.radius, scale, { min: 8 }),
    typography: scaleTypographyRecord(tokens.typography, scale),
    colors: tokens.colors,
    safeArea: {
      top: scaleNumber(tokens.safeArea.top, scale, { min: 16 }),
      bottom: scaleNumber(tokens.safeArea.bottom, scale, { min: 20 }),
    },
    layout: {
      gutter: scaleNumber(tokens.layout.gutter, scale, { min: 18 }),
      stack: scaleNumber(tokens.layout.stack, scale, { min: 18 }),
      maxContentWidth: tokens.layout.maxContentWidth,
    },
    components: {
      iconButton: {
        size: scaledIconButtonSize,
        radius: scaleNumber(tokens.components.iconButton.radius, scale, { min: Math.round(scaledIconButtonSize / 2) }),
        iconSize: scaleNumber(tokens.components.iconButton.iconSize, scale, { min: 18 }),
      },
      card: {
        radius: scaleNumber(tokens.components.card.radius, scale, { min: 20 }),
        paddingVertical: scaleNumber(tokens.components.card.paddingVertical, scale, { min: 20 }),
        paddingHorizontal: scaleNumber(tokens.components.card.paddingHorizontal, scale, { min: 16 }),
        gap: scaleNumber(tokens.components.card.gap, scale, { min: 12 }),
      },
    },
    shadow: tokens.shadow,
  };
};

const calculateModerateScale = (width: number, height?: number) => {
  const widthScale = width / BASE_WIDTH;
  const heightScale = height ? height / BASE_HEIGHT : widthScale;
  // Weighted blend to avoid over-scaling tall devices.
  const blended = widthScale * 0.7 + heightScale * 0.3;
  return clamp(blended, 0.9, 1.08);
};

export const getBreakpoint = (width: number): BreakpointKey => {
  const sorted = [...BREAKPOINTS].sort((a, b) => b.minWidth - a.minWidth);
  for (const breakpoint of sorted) {
    if (width >= breakpoint.minWidth) {
      return breakpoint.key;
    }
  }
  return 'small';
};

export const resolveDesignTokens = (width: number, height?: number): DesignTokenResult => {
  const breakpoint = getBreakpoint(width);
  const scale = calculateModerateScale(width, height);
  const merged = deepMerge(baseTokens, breakpointOverrides[breakpoint]);
  const tokens = applyScaling(merged, scale);

  return {
    breakpoint,
    scale,
    tokens,
  };
};
