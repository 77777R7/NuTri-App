import React from 'react';
import { Pressable, Text, View } from '@/components/ui/nativewind-primitives';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { cn } from '@/lib/utils';

export type QuickAction = {
  label: string;
  caption?: string;
  icon: IconSymbolName;
  onPress?: () => void;
  accent?: 'mint' | 'sky' | 'amber' | 'rose';
};

const accentMap: Record<
  NonNullable<QuickAction['accent']>,
  { background: string; icon: string }
> = {
  mint: { background: 'bg-primary-50', icon: '#2CC2B3' },
  sky: { background: 'bg-sky-100', icon: '#0EA5E9' },
  amber: { background: 'bg-amber-100', icon: '#F59E0B' },
  rose: { background: 'bg-rose-100', icon: '#F43F5E' },
};

type QuickActionsProps = {
  actions: QuickAction[];
  columns?: 4 | 3 | 2;
};

export const QuickActions: React.FC<QuickActionsProps> = ({ actions, columns = 4 }) => {
  const columnClass = {
    2: 'w-1/2',
    3: 'w-1/3',
    4: 'w-1/4',
  }[columns];

  return (
    <View className="flex-row flex-wrap">
      {actions.map((action) => {
        const accent = accentMap[action.accent ?? 'mint'];

        return (
          <View key={action.label} className={cn(columnClass, 'p-2')}>
            <Pressable
              onPress={action.onPress}
              className="h-28 justify-between rounded-3xl bg-surface p-4 shadow-soft border border-transparent"
            >
              <View
                className={cn(
                  'h-10 w-10 items-center justify-center rounded-2xl border border-black/5',
                  accent.background ?? 'bg-primary-50',
                )}
              >
                <IconSymbol name={action.icon} size={20} color={accent.icon} />
              </View>
              <View>
                <Text className="text-[15px] font-semibold text-gray-900 dark:text-white">{action.label}</Text>
                {action.caption ? (
                  <Text className="mt-1 text-xs text-muted dark:text-gray-400">{action.caption}</Text>
                ) : null}
              </View>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
};
