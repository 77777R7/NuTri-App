import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export interface QAData {
  // Step 2: Demographics
  age?: number;
  gender?: string;
  
  // Step 3: Physical Stats
  weight?: number;
  weightUnit: 'kg' | 'lbs';
  height?: number;
  heightUnit: 'cm' | 'ft';
  
  // Step 4: Health Goals
  healthGoals: string[];
  
  // Step 5: Dietary
  dietaryRestrictions: string[];
  
  // Step 6: Experience
  experienceLevel?: string;
  
  // Step 7: Privacy & Notifications
  notifyReminders: boolean;
  notifyEffectiveness: boolean;
  notifyResearch: boolean;
  notifyPriceDrops: boolean;
  notifyInteractions: boolean;
  privacyAnalytics: boolean;
  privacyPersonalization: boolean;
  privacyThirdParty: boolean;
}

interface QAContextType {
  data: QAData;
  currentStep: number;
  updateData: (updates: Partial<QAData>) => void;
  setStep: (step: number) => void;
  resetQA: () => void;
  isComplete: boolean;
}

const defaultQAData: QAData = {
  weightUnit: 'kg',
  heightUnit: 'cm',
  healthGoals: [],
  dietaryRestrictions: [],
  notifyReminders: true,
  notifyEffectiveness: true,
  notifyResearch: false,
  notifyPriceDrops: false,
  notifyInteractions: true,
  privacyAnalytics: true,
  privacyPersonalization: true,
  privacyThirdParty: false,
};

const QAContext = createContext<QAContextType | undefined>(undefined);

export const QAProvider = ({ children }: { children: ReactNode }) => {
  const [data, setData] = useState<QAData>(defaultQAData);
  const [currentStep, setCurrentStep] = useState(1);

  const updateData = useCallback((updates: Partial<QAData>) => {
    setData(prev => ({ ...prev, ...updates }));
  }, []);

  const setStep = useCallback((step: number) => {
    setCurrentStep(Math.max(1, Math.min(step, 7)));
  }, []);

  const resetQA = useCallback(() => {
    setData(defaultQAData);
    setCurrentStep(1);
  }, []);

  const isComplete = useMemo(() => {
    return Boolean(
      data.age &&
      data.gender &&
      data.healthGoals.length > 0 &&
      data.experienceLevel
    );
  }, [data]);

  const value = useMemo(
    () => ({
      data,
      currentStep,
      updateData,
      setStep,
      resetQA,
      isComplete,
    }),
    [data, currentStep, updateData, setStep, resetQA, isComplete]
  );

  return <QAContext.Provider value={value}>{children}</QAContext.Provider>;
};

export const useQA = () => {
  const context = useContext(QAContext);
  if (!context) {
    throw new Error('useQA must be used within QAProvider');
  }
  return context;
};

