import React, { ComponentRef, forwardRef } from 'react';
import { Text, TextInput, TextInputProps, View } from '@/components/ui/nativewind-primitives';
import { cn } from '@/lib/utils';

type FormInputProps = TextInputProps & {
  label: string;
  error?: string;
  containerClassName?: string;
};

type NativeTextInput = ComponentRef<typeof TextInput>;

export const FormInput = forwardRef<NativeTextInput, FormInputProps>(
  ({ label, error, containerClassName, className, ...props }, ref) => {
    return (
      <View className={cn('gap-2', containerClassName)}>
        <Text className="text-sm font-semibold text-muted">{label}</Text>
        <TextInput
          ref={ref}
          className={cn(
            'rounded-2xl border border-border bg-surface px-4 py-3 text-base text-gray-900 dark:text-white',
            error ? 'border-red-400 focus:border-red-400' : 'focus:border-primary-500',
            className,
          )}
          placeholderTextColor="#9CA3AF"
          {...props}
        />
        {error ? <Text className="text-xs text-red-500">{error}</Text> : null}
      </View>
    );
  },
);

FormInput.displayName = 'FormInput';
