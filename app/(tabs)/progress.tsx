import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { router } from 'expo-router';
import { Pressable, Text, View } from '@/components/ui/nativewind-primitives';

export default function ProgressPage() {
  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="w-full max-w-xl self-center px-6 py-6">
        <View className="mb-8 flex-row items-center gap-4">
          <Pressable
            onPress={() => router.replace('/main')}
            className="h-10 w-10 items-center justify-center rounded-full bg-white shadow"
          >
            <ArrowLeft size={20} color="#374151" />
          </Pressable>
          <Text className="text-2xl font-bold text-gray-900">Progress</Text>
        </View>

        <View className="items-center rounded-3xl bg-white p-8">
          <Text className="mb-4 text-6xl">📊</Text>
          <Text className="mb-2 text-xl font-semibold text-gray-900">Coming Soon</Text>
          <Text className="text-center text-gray-500">
            Track your supplement effectiveness and health progress over time
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
