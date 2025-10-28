export type Base44Step =
  | 'welcome'
  | 'demographics'
  | 'physical-stats'
  | 'health-goals'
  | 'dietary'
  | 'experience'
  | 'privacy';

type StepConfig = {
  key: Base44Step;
  path: `/base44/${string}`;
  stepNumber: number;
};

export const stepSequence: StepConfig[] = [
  { key: 'welcome', path: '/base44/welcome', stepNumber: 1 },
  { key: 'demographics', path: '/base44/demographics', stepNumber: 2 },
  { key: 'physical-stats', path: '/base44/physical-stats', stepNumber: 3 },
  { key: 'health-goals', path: '/base44/health-goals', stepNumber: 4 },
  { key: 'dietary', path: '/base44/dietary', stepNumber: 5 },
  { key: 'experience', path: '/base44/experience', stepNumber: 6 },
  { key: 'privacy', path: '/base44/privacy', stepNumber: 7 },
];

const stepMap = new Map<Base44Step, StepConfig>(stepSequence.map((config) => [config.key, config]));

export const getStepConfig = (step: Base44Step) => {
  const config = stepMap.get(step);
  if (!config) {
    throw new Error(`Unknown Base44 step "${step}"`);
  }
  return config;
};

export const getNextStep = (current: Base44Step): Base44Step | null => {
  const index = stepSequence.findIndex((item) => item.key === current);
  if (index === -1 || index >= stepSequence.length - 1) {
    return null;
  }
  return stepSequence[index + 1]!.key;
};

export const getPrevStep = (current: Base44Step): Base44Step | null => {
  const index = stepSequence.findIndex((item) => item.key === current);
  if (index <= 0) {
    return null;
  }
  return stepSequence[index - 1]!.key;
};
