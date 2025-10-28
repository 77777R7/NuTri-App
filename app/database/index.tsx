import React, { useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Search as SearchIcon } from 'lucide-react-native';
import { router, type Href } from 'expo-router';
import { Image, Pressable, ScrollView, Text, TextInput, View } from '@/components/ui/nativewind-primitives';

const categoryEmojis: Record<string, string> = {
  vitamins: '💊',
  minerals: '⚡',
  probiotics: '🦠',
  omega3: '🐟',
  herbs: '🌿',
  amino_acids: '🧬',
  other: '📦',
};

const SAMPLE: any[] = [];

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return SAMPLE;
    return SAMPLE.filter(
      (supplement) =>
        supplement.product_name?.toLowerCase().includes(q) ||
        supplement.brand?.toLowerCase().includes(q) ||
        supplement.category?.toLowerCase().includes(q) ||
        supplement.ingredients?.some((ing: any) => ing.name?.toLowerCase().includes(q)),
    );
  }, [searchQuery]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="w-full max-w-xl self-center px-6 py-6">
        <View className="mb-6 flex-row items-center gap-4">
          <Pressable
            onPress={() => router.replace('/main')}
            className="h-10 w-10 items-center justify-center rounded-full bg-white shadow"
          >
            <ArrowLeft size={20} color="#374151" />
          </Pressable>
          <View className="flex-1">
            <Text className="text-2xl font-bold text-gray-900">Search</Text>
            <Text className="text-sm text-gray-500">Find your supplements</Text>
          </View>
        </View>

        <View className="mb-6">
          <View className="absolute left-4 top-1/2 -translate-y-1/2">
            <SearchIcon size={20} color="#9ca3af" />
          </View>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by name, brand, or ingredient..."
            className="h-14 rounded-2xl border border-gray-200 bg-white pl-12"
          />
        </View>

        {!searchQuery ? (
          <View className="items-center rounded-3xl bg-white p-12">
            <View className="mb-4 h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
              <SearchIcon size={40} color="#059669" />
            </View>
            <Text className="mb-2 text-xl font-semibold text-gray-900">Search Your Supplements</Text>
            <Text className="text-center text-gray-500">Start typing to find supplements by name, brand, or ingredient</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View className="items-center rounded-3xl bg-white p-12">
            <View className="mb-4 h-20 w-20 items-center justify-center rounded-full bg-gray-100">
              <SearchIcon size={40} color="#d1d5db" />
            </View>
            <Text className="mb-2 text-xl font-semibold text-gray-900">No results found</Text>
            <Text className="text-center text-gray-500">Try searching with different keywords</Text>
          </View>
        ) : (
          <ScrollView className="space-y-3">
            {filtered.map((supplement, index) => (
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
                        {supplement.product_name}
                      </Text>
                      <Text className="text-sm text-gray-500" numberOfLines={1}>
                        {supplement.brand}
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
                      <Text className="text-xs font-medium text-gray-600">{(supplement.category || '').replace(/_/g, ' ')}</Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}
