import React, { createContext, useCallback, useContext, useRef } from 'react';

export type TransitionDir = 'forward' | 'back' | 'none';

type TransitionContextValue = {
  setDirection: (dir: TransitionDir) => void;
  consumeDirection: () => TransitionDir;
};

const TransitionContext = createContext<TransitionContextValue | null>(null);

export const TransitionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const directionRef = useRef<TransitionDir>('none');

  const setDirection = useCallback((dir: TransitionDir) => {
    directionRef.current = dir;
  }, []);

  const consumeDirection = useCallback<() => TransitionDir>(() => {
    const current = directionRef.current;
    directionRef.current = 'none';
    return current;
  }, []);

  return (
    <TransitionContext.Provider value={{ setDirection, consumeDirection }}>
      {children}
    </TransitionContext.Provider>
  );
};

export const useTransitionDir = () => {
  const context = useContext(TransitionContext);
  if (!context) {
    throw new Error('useTransitionDir must be used within TransitionProvider');
  }
  return context;
};
