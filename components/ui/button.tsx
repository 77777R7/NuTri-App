import React from 'react';
import { ActivityIndicator, Pressable, PressableProps, Text } from '@/components/ui/nativewind-primitives';
import { cn } from '@/lib/utils';

interface ButtonProps extends PressableProps {
  label: string;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
}

export const Button: React.FC<ButtonProps> = ({ label, loading = false, variant = 'primary', className, ...rest }) => {
  const baseStyles = 'rounded-xl px-4 py-3 flex-row items-center justify-center';
  const variantStyles = {
    primary: 'bg-primary',
    secondary: 'bg-surface border border-primary',
    ghost: 'bg-transparent',
  }[variant];

  const textColor = {
    primary: 'text-white',
    secondary: 'text-primary',
    ghost: 'text-primary',
  }[variant];

  return (
    <Pressable className={cn(baseStyles, variantStyles, className)} disabled={loading || rest.disabled} {...rest}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#FFFFFF' : '#2CC2B3'} />
      ) : (
        <Text className={cn('text-base font-semibold', textColor)}>{label}</Text>
      )}
    </Pressable>
  );
};
