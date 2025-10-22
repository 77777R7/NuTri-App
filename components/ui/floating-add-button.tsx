import React from 'react';
import { Pressable, Text } from '@/components/ui/nativewind-primitives';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { cn } from '@/lib/utils';

type FloatingAddButtonProps = {
  onPress?: () => void;
  label?: string;
  className?: string;
  disabled?: boolean;
};

export const FloatingAddButton: React.FC<FloatingAddButtonProps> = ({
  onPress,
  label = 'Add',
  className,
  disabled = false,
}) => {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={cn(
        'absolute bottom-8 flex-row items-center justify-center rounded-full bg-primary px-6 py-4 shadow-card',
        disabled ? 'opacity-70' : '',
        className,
      )}
      style={{ alignSelf: 'center', minWidth: 120 }}
    >
      <IconSymbol name="plus" size={18} color="#FFFFFF" />
      <Text className="ml-2 text-base font-semibold text-white">{label}</Text>
    </Pressable>
  );
};
