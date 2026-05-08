import { Platform } from 'react-native';

export const QA_BG = '#F3F5FB';
export const QA_BG_TOP = '#F4F6FB';
export const QA_BG_BOTTOM = '#EEF2FA';

export const QA_FOREGROUND = '#0C1531';
export const QA_MUTED = '#7B879E';
export const QA_EYEBROW = '#6E7B97';

export const QA_SERIF_FONT = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
});

export const QA_ACTIVE_BLUE = '#4D6EFF';
export const QA_ACTIVE_BLUE_SOFT = '#6B90F4';
export const QA_INACTIVE_DOT = '#D5DAE6';

export const QA_CTA_BLACK = '#0D0D0D';
export const QA_CTA_BLACK_EDGE = '#111111';

export const QA_GLASS_WHITE = 'rgba(255,255,255,0.56)';
export const QA_GLASS_WHITE_SOFT = 'rgba(255,255,255,0.38)';
export const QA_GLASS_BORDER = 'rgba(255,255,255,0.78)';
export const QA_GLASS_BORDER_SOFT = 'rgba(255,255,255,0.62)';

export const QA_ROW_RADIUS = 22;
export const QA_CTA_HEIGHT = 72;
export const QA_PROGRESS_TRACK_WIDTH = 110;
export const QA_PROGRESS_TRACK_HEIGHT = 6;
export const QA_PROGRESS_FILL_WIDTH = 13;
export const QA_TOTAL_STEPS = 7;

export const getQaProgressFillWidth = (
  stepIndex: number,
  totalSteps: number = QA_TOTAL_STEPS,
) => {
  const clampedStep = Math.max(1, Math.min(stepIndex, totalSteps));

  if (totalSteps <= 1) {
    return QA_PROGRESS_TRACK_WIDTH;
  }

  const ratio = (clampedStep - 1) / (totalSteps - 1);
  return Math.round(
    QA_PROGRESS_FILL_WIDTH +
      (QA_PROGRESS_TRACK_WIDTH - QA_PROGRESS_FILL_WIDTH) * ratio,
  );
};
