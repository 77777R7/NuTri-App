import React, { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { Stack, router } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SupplementItem } from '@/components/ui/supplement-item';
import { apiClient, SearchResponse } from '@/lib/api-client';
import { useTranslation } from '@/lib/i18n';
import { KeyboardAvoidingView, ScrollView, Text, TextInput, View } from '@/components/ui/nativewind-primitives';

type SearchResult = {
  id: string;
  name: string;
  brand: string;
  category: string;
  imageUrl?: string | null;
  score?: number;
};

export default function DatabaseScreen() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      setError(t.databaseEnterQuery);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setHasSearched(true);
      const response = await apiClient.search({ query: query.trim() });
      const data: SearchResponse =
        'success' in response && response.success ? response.data : (response as SearchResponse);
      setResults(
        Array.isArray(data?.supplements)
          ? data.supplements.map((supplement) => ({
              id: supplement.id ?? '',
              name: supplement.name ?? t.unknownSupplement,
              brand: supplement.brand ?? t.unknownBrand,
              category: supplement.category ?? t.unknownCategory,
              imageUrl: supplement.imageUrl,
              score: supplement.relevanceScore,
            }))
          : [],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t.databaseSearchFailed);
    } finally {
      setLoading(false);
    }
  }, [query, t]);

  return (
    <>
      <Stack.Screen options={{ title: t.quickActionDatabase }} />
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        className="flex-1 bg-background"
      >
        <ScrollView className="flex-1 px-5 pt-6" contentContainerStyle={{ paddingBottom: 120 }}>
          <Card className="mb-5 gap-4">
            <Text className="text-lg font-semibold text-gray-900 dark:text-white">{t.databaseTitle}</Text>
            <Text className="text-sm text-muted">{t.databaseSubtitle}</Text>
            <View className="mt-2 rounded-2xl border border-border bg-surface px-3 py-2">
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t.databasePlaceholder}
                placeholderTextColor="#94A3AB"
                autoCapitalize="none"
                autoCorrect={false}
                className="text-base text-gray-900 dark:text-white"
                returnKeyType="search"
                onSubmitEditing={handleSearch}
              />
            </View>
            <Button label={loading ? t.loading : t.databaseSearchCta} onPress={handleSearch} disabled={loading} />
            {error ? <Text className="text-sm text-red-600 dark:text-red-300">{error}</Text> : null}
          </Card>

          <Card className="gap-4">
            <Text className="text-base font-semibold text-gray-900 dark:text-white">{t.databaseResultsTitle}</Text>
            {loading ? (
              <View className="gap-3">
                {[0, 1, 2].map(index => (
                  <View key={index} className="h-16 rounded-2xl bg-primary-100/60" />
                ))}
              </View>
            ) : results.length === 0 ? (
              <Text className="text-sm text-muted">
                {hasSearched ? t.databaseNoResults : t.databaseIdleHint}
              </Text>
            ) : (
              results.map(result => (
                <SupplementItem
                  key={result.id}
                  name={result.name}
                  description={`${result.brand}${result.score ? ` · ${Math.round(result.score * 100)}% match` : ''}`}
                  dosage={result.category}
                  thumbnail={result.imageUrl ?? undefined}
                  onActionPress={() => router.push('/database')}
                  actionLabel={t.viewDetails}
                />
              ))
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
