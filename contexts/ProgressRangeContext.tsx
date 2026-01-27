import React, { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type ProgressRange = 'today' | '7d' | '30d';

type ProgressRangeContextValue = {
  range: ProgressRange;
  setRange: (next: ProgressRange) => void;
};

const ProgressRangeContext = createContext<ProgressRangeContextValue | null>(null);

export const ProgressRangeProvider = ({ children }: { children: ReactNode }) => {
  const [range, setRange] = useState<ProgressRange>('7d');
  const value = useMemo(() => ({ range, setRange }), [range]);

  return <ProgressRangeContext.Provider value={value}>{children}</ProgressRangeContext.Provider>;
};

export const useProgressRange = () => {
  const context = useContext(ProgressRangeContext);
  if (!context) {
    throw new Error('useProgressRange must be used within ProgressRangeProvider');
  }
  return context;
};
