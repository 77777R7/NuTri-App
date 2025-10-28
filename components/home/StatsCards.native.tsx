import React, { useMemo, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, useWindowDimensions } from 'react-native';
import { Bookmark } from 'lucide-react-native';
import { useRouter, type Href } from 'expo-router';
import { Image, Pressable, ScrollView, Text, View } from '@/components/ui/nativewind-primitives';

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
  is_active?: boolean;
  ingredients?: Array<{ name?: string; dosage?: string; unit?: string }>;
};

type Props = {
  supplements?: Supplement[];
  isLoading?: boolean;
};

export default function StatsCards({ supplements = [], isLoading = false }: Props) {
  const router = useRouter();
  const activeSupplements = useMemo(() => supplements.filter((item) => item?.is_active), [supplements]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const { width } = useWindowDimensions();
  const cardWidth = width - 48;

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const idx = Math.round(offsetX / cardWidth);
    setCurrentIndex(idx);
  };

  if (isLoading) {
    return (
      <View className="space-y-4">
        <Text className="px-1 text-2xl font-bold text-gray-900">Favourite Supplements</Text>
        <View className="rounded-3xl bg-white p-8 shadow">
          <View className="h-64 rounded-2xl bg-gray-200" />
        </View>
      </View>
    );
  }

  if (activeSupplements.length === 0) {
    return (
      <View className="space-y-4">
        <Text className="px-1 text-2xl font-bold text-gray-900">Favourite Supplements</Text>
        <View className="items-center rounded-3xl bg-white p-12 shadow">
          <Text className="mb-4 text-6xl">📦</Text>
          <Text className="mb-2 text-lg font-semibold text-gray-900">No favourites yet</Text>
          <Text className="text-sm text-gray-500">Scan supplements to add them to your favourites</Text>
        </View>
      </View>
    );
  }

  return (
    <View className="space-y-4">
      <Text className="px-1 text-2xl font-bold text-gray-900">Favourite Supplements</Text>
      <View>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          {activeSupplements.map((supplement, index) => (
            <Pressable
              key={supplement.id ?? index}
              onPress={() => {
                if (!supplement.id) {
                  return;
                }
                router.push(`/supplement?id=${supplement.id}` as Href);
              }}
              style={{ width: cardWidth, marginRight: index < activeSupplements.length - 1 ? 16 : 0 }}
              className="flex-shrink rounded-3xl bg-white p-8 shadow"
            >
              <View className="absolute right-6 top-6 h-10 w-10 items-center justify-center rounded-lg bg-green-500">
                <Bookmark size={20} color="#fff" />
              </View>

              <View className="mb-6 h-24 w-24 items-center justify-center rounded-2xl bg-gray-100">
                {supplement.image_url ? (
                  <Image source={{ uri: supplement.image_url }} className="h-24 w-24 rounded-2xl" />
                ) : (
                  <Text className="text-5xl">{categoryEmojis[supplement.category ?? ''] ?? '📦'}</Text>
                )}
              </View>

              <Text className="mb-2 text-2xl font-bold text-gray-900">{supplement.product_name ?? 'Untitled'}</Text>
              <Text className="mb-6 text-lg text-gray-500">{supplement.brand ?? 'Unknown brand'}</Text>

              {supplement.ingredients?.length ? (
                <View className="self-start rounded-xl bg-green-50 px-4 py-2">
                  <Text className="font-medium text-green-600">
                    {supplement.ingredients[0]?.name}{' '}
                    {`${supplement.ingredients[0]?.dosage ?? ''} ${supplement.ingredients[0]?.unit ?? ''}`.trim()}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>

        {activeSupplements.length > 1 ? (
          <View className="mt-6 flex-row justify-center gap-2">
            {activeSupplements.map((_, index) => (
              <View
                key={index}
                className={`h-2 rounded-full ${index === currentIndex ? 'w-8 bg-green-500' : 'w-2 bg-gray-300'}`}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}
