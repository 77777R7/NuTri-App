import React from 'react';
import { Image, Pressable, Text, View } from '@/components/ui/nativewind-primitives';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { cn } from '@/lib/utils';

export type SupplementItemProps = {
  name: string;
  description?: string;
  dosage?: string;
  thumbnail?: string;
  onPress?: () => void;
  onActionPress?: () => void;
  actionLabel?: string;
  className?: string;
};

export const SupplementItem: React.FC<SupplementItemProps> = ({
  name,
  description,
  dosage,
  thumbnail,
  onPress,
  onActionPress,
  actionLabel = 'Details',
  className,
}) => {
  return (
    <Pressable onPress={onPress} className={cn('flex-row items-center py-3', className)}>
      <View className="mr-4 h-12 w-12 overflow-hidden rounded-2xl border border-border bg-primary-50">
        {thumbnail ? (
          <Image
            source={{ uri: thumbnail }}
            className="h-full w-full"
            resizeMode="cover"
            accessibilityLabel={name}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <IconSymbol name="pills.fill" size={20} color="#2CC2B3" />
          </View>
        )}
      </View>
      <View className="flex-1">
        <Text className="text-[15px] font-semibold text-gray-900 dark:text-white">{name}</Text>
        {description ? (
          <Text className="mt-0.5 text-xs text-muted dark:text-gray-400" numberOfLines={2}>
            {description}
          </Text>
        ) : null}
        {dosage ? <Text className="mt-0.5 text-xs text-primary-600">{dosage}</Text> : null}
      </View>
      <Pressable
        onPress={onActionPress}
        className="ml-3 rounded-full bg-primary px-4 py-2 shadow-soft"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text className="text-xs font-semibold text-white">{actionLabel}</Text>
      </Pressable>
    </Pressable>
  );
};
