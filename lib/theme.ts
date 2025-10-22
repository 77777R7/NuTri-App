export const colors = {
  brand: '#10B981',
  brandDark: '#059669',
  surface: '#FFFFFF',
  surfaceSoft: '#F6FBF9',
  text: '#0B1020',
  subtext: '#6B7280',
  border: '#E5E7EB',
  shadow: 'rgba(16,185,129,0.18)',
  // legacy aliases for existing components
  card: '#FFFFFF',
  textMuted: '#6B7280',
  bgMintFrom: '#F1FFF7',
  bgMintTo: '#FFFFFF',
};

export const gradients = {
  mint: ['#F1FFF7', '#FFFFFF'] as const,
};

export const radii = {
  xl: 24,
  full: 999,
  md: 16,
};

export const spacing = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
};

export const type = {
  h1: { fontSize: 32, lineHeight: 40, fontWeight: '800', letterSpacing: 0.2 },
  h2: { fontSize: 24, lineHeight: 30, fontWeight: '800' },
  p: { fontSize: 16, lineHeight: 22, color: colors.subtext },
  caption: { fontSize: 12, lineHeight: 16, color: colors.subtext },
};

export const radius = {
  xl: radii.xl,
  md: radii.md,
};

export const shadow = {
  card: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  } as const,
};
