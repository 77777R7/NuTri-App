import React from 'react';
import { View, ViewProps } from '@/components/ui/nativewind-primitives';
import { cn } from '@/lib/utils';

type CardProps = ViewProps & { className?: string };

export const Card: React.FC<CardProps> = ({ className, children, ...rest }) => {
  return (
    <View
      className={cn('bg-surface rounded-2xl p-4 shadow-md shadow-black/5 border border-black/5', className)}
      {...rest}
    >
      {children}
    </View>
  );
};
