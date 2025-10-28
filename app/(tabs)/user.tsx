import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, LogOut, User as UserIcon } from 'lucide-react-native';
import { router } from 'expo-router';
import { Pressable, Text, View } from '@/components/ui/nativewind-primitives';

export default function ProfilePage() {
  const [user] = useState<{ full_name: string; email: string }>({
    full_name: 'User',
    email: 'user@example.com',
  });

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
          <Text className="text-2xl font-bold text-gray-900">Profile</Text>
        </View>

        <View className="space-y-4">
          <View className="rounded-2xl bg-white p-6">
            <View className="mb-6 flex-row items-center gap-4">
              <View className="h-16 w-16 items-center justify-center rounded-full bg-emerald-500">
                <UserIcon size={32} color="#fff" />
              </View>
              <View>
                <Text className="text-xl font-bold text-gray-900">{user.full_name}</Text>
                <Text className="text-sm text-gray-500">{user.email}</Text>
              </View>
            </View>
          </View>

          <Pressable className="h-14 w-full items-center justify-center rounded-2xl border border-gray-200">
            <View className="flex-row items-center">
              <LogOut size={20} color="#374151" />
              <Text className="ml-2 text-gray-800">Sign Out</Text>
            </View>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
