export const WELCOME_BG = '#F3F5FB';
export const WELCOME_BG_TOP = '#F4F6FB';
export const WELCOME_BG_BOTTOM = '#EEF2FA';

export const FOREGROUND = '#0C1531';
export const MUTED = '#7A859F';
export const LABEL_TEXT = '#6F7A96';

export const CTA_BLUE = '#6391F1';
export const CTA_BLUE_EDGE = '#7EA3FA';
export const ACTIVE_BLUE = '#4D6EFF';
export const INACTIVE_DOT = '#D7DCE8';

export const CARD_RADIUS = 32;
export const CARD_SHADOW = '#CDD6EA';

export const HERO_CARDS = [
  {
    label: 'BUILT FOR YOU',
    title: 'Made for your body and goals.',
  },
  {
    label: 'SCAN IN SECONDS',
    title: 'See what fits your plan in seconds.',
  },
  {
    label: 'SMARTER STACKS',
    title: 'Build a stack that works together.',
  },
  {
    label: 'ADAPTS WITH YOU',
    title: 'Updates as your needs change.',
  },
] as const;

export type HeroCard = (typeof HERO_CARDS)[number];
