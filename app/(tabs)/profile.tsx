import React from 'react';
import { ScrollView, Text, View } from '@/components/ui/nativewind-primitives';
import { Card } from '@/components/ui/card';
import { useTranslation } from '@/lib/i18n';

export default function ProfileScreen() {
  const { t } = useTranslation();

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 20, gap: 16 }}>
      <View>
        <Text className="text-2xl font-semibold text-gray-900 dark:text-white">{t.userTitle}</Text>
        <Text className="mt-1 text-sm text-muted">{t.userSubtitle}</Text>
      </View>

      <Card className="gap-2">
        <Text className="text-base font-semibold text-gray-900 dark:text-white">{t.userPlanLabel}</Text>
        <Text className="text-sm text-muted">{t.userPlanFree}</Text>
        <Text className="text-xs text-muted">{t.userPlanHint}</Text>
      </Card>

      <Card className="gap-2">
        <Text className="text-base font-semibold text-gray-900 dark:text-white">{t.userNotificationsTitle}</Text>
        <Text className="text-sm text-muted">{t.userNotificationsHint}</Text>
      </Card>
    </ScrollView>
  );
}
