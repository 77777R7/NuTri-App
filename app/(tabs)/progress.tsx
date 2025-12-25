import React from 'react';
import { ScrollView, Text, View } from '@/components/ui/nativewind-primitives';
import { Card } from '@/components/ui/card';
import { useTranslation } from '@/lib/i18n';

export default function ProgressScreen() {
  const { t } = useTranslation();

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 20, gap: 16 }}>
      <View>
        <Text className="text-2xl font-semibold text-gray-900 dark:text-white">{t.progressTitle}</Text>
        <Text className="mt-1 text-sm text-muted">{t.progressSubtitle}</Text>
      </View>

      <Card className="gap-2">
        <Text className="text-base font-semibold text-gray-900 dark:text-white">{t.progressUploadsTitle}</Text>
        <Text className="text-sm text-muted">{t.progressUploadsSubtitle}</Text>
        <Text className="text-xs text-muted">{t.progressUploadsHint}</Text>
      </Card>

      <Card className="gap-2">
        <Text className="text-base font-semibold text-gray-900 dark:text-white">{t.progressRewardsTitle}</Text>
        <Text className="text-sm text-muted">{t.progressRewardsDescription}</Text>
        <Text className="text-xs text-muted">{t.progressRewardsSoon}</Text>
      </Card>
    </ScrollView>
  );
}
