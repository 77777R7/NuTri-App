export const onboardingPalette = {
  background: '#F6F8FD',
  backgroundStrong: '#F1F4FB',
  text: '#0B1638',
  textMuted: '#78829B',
  textSoft: '#5D6A86',
  primary: '#5F83F5',
  primaryStrong: '#4C70EF',
  primarySoft: '#DCE7FF',
  border: 'rgba(255,255,255,0.88)',
  borderSoft: 'rgba(255,255,255,0.62)',
  glass: 'rgba(255,255,255,0.58)',
  glassSoft: 'rgba(255,255,255,0.26)',
  glassLabel: 'rgba(255,255,255,0.78)',
  shadow: 'rgba(15,23,42,0.08)',
  buttonShadow: 'rgba(95,131,245,0.28)',
  orb: 'rgba(95,131,245,0.18)',
  orbSoft: 'rgba(95,131,245,0.10)',
  line: 'rgba(180,193,224,0.58)',
  inactive: '#D7DEEF',
  progressTrack: 'rgba(11,22,56,0.06)',
  progressFill: '#0D0D0D',
  link: '#56637F',
  danger: '#E1567A',
  dangerSoft: 'rgba(225,86,122,0.10)',
  dangerBorder: 'rgba(225,86,122,0.24)',
};

export const onboardingRadii = {
  card: 32,
  option: 22,
  button: 999,
  pill: 999,
  label: 999,
};

export const onboardingSpacing = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
};

export const onboardingTypography = {
  heroTitle: {
    fontSize: 42,
    lineHeight: 42.84,
    fontWeight: '700' as const,
    letterSpacing: -1.6,
    color: onboardingPalette.text,
  },
  pageTitle: {
    fontSize: 34,
    lineHeight: 35.7,
    fontWeight: '700' as const,
    letterSpacing: -1.6,
    color: onboardingPalette.text,
  },
  pageSubtitle: {
    fontSize: 16,
    lineHeight: 23.2,
    fontWeight: '500' as const,
    color: onboardingPalette.textMuted,
  },
  body: {
    fontSize: 16,
    lineHeight: 23.2,
    color: onboardingPalette.textMuted,
  },
  eyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700' as const,
    letterSpacing: 1.8,
    color: onboardingPalette.textMuted,
    textTransform: 'uppercase' as const,
  },
};

export const onboardingShadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 16 },
    elevation: 10,
  },
  button: {
    shadowColor: onboardingPalette.buttonShadow,
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
};
