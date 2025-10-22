import React from 'react';
import { Text, View } from '@/components/ui/nativewind-primitives';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function ScanScreen() {
  return (
    <View className="flex-1 bg-background px-4 pt-6">
      <Card className="gap-4">
        <Text className="text-xl font-semibold text-gray-900 dark:text-white">Smart Scan</Text>
        <Text className="text-sm text-gray-500 dark:text-gray-400">
          Capture supplement labels to analyze ingredients and match products. Integrate the OCR workflow here.
        </Text>
        <Button label="Start Scan" onPress={() => {}} />
      </Card>
    </View>
  );
}
