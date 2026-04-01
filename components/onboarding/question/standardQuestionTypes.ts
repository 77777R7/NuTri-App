export type QuestionOption = {
  label: string;
  value?: string;
  description?: string;
};

export type BaseStandardQuestionScreenProps = {
  screenKey: string;
  questionIndex: number;
  eyebrow?: string;
  title: string;
  subtitle: string;
  onBack: () => void;
  onContinue: () => void;
  onSkip?: () => void;
  continueLabel?: string;
  footerHint?: string;
  footerError?: string | null;
};
