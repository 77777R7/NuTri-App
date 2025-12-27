import React from 'react';
import { useRouter, type Href } from 'expo-router';
import { Image, Pressable, Text, View } from '@/components/ui/nativewind-primitives';

const categoryEmojis: Record<string, string> = {
  vitamins: '💊',
  minerals: '⚡',
  probiotics: '🦠',
  omega3: '🐟',
  herbs: '🌿',
  amino_acids: '🧬',
  other: '📦',
};

type Supplement = {
  id?: string;
  product_name?: string;
  brand?: string;
  category?: string;
  image_url?: string;
  created_date?: string;
};

type Props = {
  supplements?: Supplement[];
  isLoading?: boolean;
};

export default function RecentSupplements({ supplements = [], isLoading = false }: Props) {
  const router = useRouter();

  if (isLoading) {
    return (
      <View className="space-y-3">
        {[0, 1, 2].map((index) => (
          <View key={index} className="rounded-2xl bg-white p-4 shadow">
            <View className="flex-row items-center gap-3">
              <View className="h-12 w-12 rounded-xl bg-gray-200" />
              <View className="flex-1">
                <View className="mb-2 h-4 w-3/4 rounded bg-gray-200" />
                <View className="h-3 w-1/2 rounded bg-gray-200" />
              </View>
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (!supplements.length) {
    return (
      <Pressable onPress={() => router.push('/scan/label')}>
        <View className="items-center rounded-3xl border border-dashed border-gray-300 bg-white p-8">
          <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-gray-100">
            <Text className="text-3xl">＋</Text>
          </View>
          <Text className="mb-1 font-medium text-gray-500">No supplements yet</Text>
          <Text className="text-sm text-gray-400">Tap + to scan your first supplement</Text>
        </View>
      </Pressable>
    );
  }

  const recent = supplements.slice(0, 5);

  return (
    <View className="space-y-3">
      {recent.map((supplement, index) => (
        <Pressable
          key={supplement.id ?? index}
          onPress={() => {
            if (!supplement.id) {
              return;
            }
            router.push(`/supplement?id=${supplement.id}` as Href);
          }}
        >
          <View className="rounded-2xl bg-white p-4 shadow">
            <View className="flex-row items-center gap-3">
              <View className="h-14 w-14 items-center justify-center rounded-xl bg-emerald-50">
                {supplement.image_url ? (
                  <Image source={{ uri: supplement.image_url }} className="h-14 w-14 rounded-xl" />
                ) : (
                  <Text className="text-3xl">{categoryEmojis[supplement.category ?? ''] ?? '📦'}</Text>
                )}
              </View>
              <View className="flex-1">
                <Text className="font-semibold text-gray-900" numberOfLines={1}>
                  {supplement.product_name ?? 'Untitled'}
                </Text>
                <Text className="text-sm text-gray-500" numberOfLines={1}>
                  {supplement.brand ?? 'Unknown brand'}
                </Text>
                {supplement.created_date ? (
                  <Text className="mt-1 text-xs text-gray-400">
                    {new Date(supplement.created_date).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </Text>
                ) : null}
              </View>
              <View className="rounded-full bg-gray-100 px-3 py-1">
                <Text className="text-xs font-medium text-gray-600">
                  {(supplement.category ?? '').replace(/_/g, ' ').trim()}
                </Text>
              </View>
            </View>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
