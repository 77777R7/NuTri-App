import React, { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { apiClient } from '@/lib/api-client';
import { useTranslation } from '@/lib/i18n';
import { KeyboardAvoidingView, ScrollView, Text, TextInput, View } from '@/components/ui/nativewind-primitives';

export default function AssistantScreen() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<string | null>(null);

  const handleAsk = useCallback(async () => {
    if (!prompt.trim()) {
      setError(t.assistantEnterPrompt);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setResponse(null);
      const result = await apiClient.analyze({ text: prompt.trim() });
      setResponse(JSON.stringify(result, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.assistantRequestFailed);
    } finally {
      setLoading(false);
    }
  }, [prompt, t]);

  return (
    <>
      <Stack.Screen options={{ title: t.quickActionAI }} />
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        className="flex-1 bg-background"
      >
        <ScrollView className="flex-1 px-5 pt-6" contentContainerStyle={{ paddingBottom: 120 }}>
          <Card className="mb-5 gap-4">
            <Text className="text-lg font-semibold text-gray-900 dark:text-white">{t.assistantTitle}</Text>
            <Text className="text-sm text-muted">{t.assistantSubtitle}</Text>
            <View className="mt-2 rounded-2xl border border-border bg-surface px-3 py-2">
              <TextInput
                value={prompt}
                onChangeText={setPrompt}
                placeholder={t.assistantPlaceholder}
                placeholderTextColor="#94A3AB"
                autoCapitalize="sentences"
                multiline
                numberOfLines={4}
                className="text-base text-gray-900 dark:text-white"
                onSubmitEditing={handleAsk}
                returnKeyType="send"
                blurOnSubmit
              />
            </View>
            <Button label={loading ? t.loading : t.assistantSendCta} onPress={handleAsk} disabled={loading} />
            {error ? <Text className="text-sm text-red-600 dark:text-red-300">{error}</Text> : null}
          </Card>

          <Card className="gap-3">
            <Text className="text-base font-semibold text-gray-900 dark:text-white">{t.assistantResponseTitle}</Text>
            {loading ? (
              <View className="h-32 rounded-2xl bg-primary-100/60" />
            ) : response ? (
              <View className="rounded-2xl bg-surface px-4 py-3">
                <Text className="font-mono text-sm text-gray-800 dark:text-gray-200">{response}</Text>
              </View>
            ) : (
              <Text className="text-sm text-muted">{t.assistantIdleHint}</Text>
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
