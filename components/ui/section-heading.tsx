import React from 'react';
import { Text, View } from '@/components/ui/nativewind-primitives';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  subtitle?: string;
  className?: string;
}

export const SectionHeading: React.FC<Props> = ({ title, subtitle, className }) => (
  <View className={cn('mb-3 gap-1', className)}>
    <Text className="text-lg font-semibold text-gray-900 dark:text-white">{title}</Text>
    {subtitle ? <Text className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</Text> : null}
  </View>
);
