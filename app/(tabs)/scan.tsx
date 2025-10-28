import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Camera, Upload } from 'lucide-react-native';
import { router } from 'expo-router';
import { ActivityIndicator, Image, Pressable, Text, View } from '@/components/ui/nativewind-primitives';

export default function ScanPage() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const simulateProcess = () => {
    setIsProcessing(true);
    setPreviewUri('https://placehold.co/800x500/png');
    setTimeout(() => setIsProcessing(false), 1200);
  };

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
          <View>
            <Text className="text-2xl font-bold text-gray-900">Scan Supplement</Text>
            <Text className="text-sm text-gray-500">Take a photo of the label</Text>
          </View>
        </View>

        {previewUri ? (
          <View className="mb-6 overflow-hidden rounded-2xl bg-white shadow">
            <Image source={{ uri: previewUri }} className="h-64 w-full" />
          </View>
        ) : null}

        <View className="space-y-4">
          <Pressable
            onPress={simulateProcess}
            disabled={isProcessing}
            className="h-16 w-full items-center justify-center rounded-2xl bg-gray-900"
          >
            {isProcessing ? (
              <View className="flex-row items-center">
                <ActivityIndicator color="#fff" />
                <Text className="ml-3 font-semibold text-white">Processing...</Text>
              </View>
            ) : (
              <View className="flex-row items-center">
                <Camera size={24} color="#fff" />
                <Text className="ml-3 font-semibold text-white">Take Photo</Text>
              </View>
            )}
          </Pressable>

          <Pressable
            onPress={simulateProcess}
            disabled={isProcessing}
            className="h-16 w-full items-center justify-center rounded-2xl border border-gray-200 bg-white"
          >
            <View className="flex-row items-center">
              <Upload size={24} color="#374151" />
              <Text className="ml-3 font-semibold text-gray-900">Upload from Gallery</Text>
            </View>
          </Pressable>
        </View>

        <View className="mt-8 rounded-2xl border border-emerald-100 bg-emerald-50 p-6">
          <Text className="mb-3 font-semibold text-gray-900">Tips for best results:</Text>
          <View className="space-y-2">
            <Text className="text-sm text-gray-700">• Make sure the supplement facts label is clearly visible</Text>
            <Text className="text-sm text-gray-700">• Use good lighting and avoid shadows</Text>
            <Text className="text-sm text-gray-700">• Hold your phone steady and capture the full label</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
