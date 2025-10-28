import React, { useState } from 'react';
import { Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Send, Sparkles } from 'lucide-react-native';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from '@/components/ui/nativewind-primitives';

type Message = { role: 'user' | 'assistant'; content: string };

export default function AIHelperPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        "Hi! I'm your supplement AI assistant. Ask me anything about supplements, ingredients, dosages, or health recommendations!",
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    const question = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setIsLoading(true);
    setTimeout(() => {
      setMessages((prev) => [...prev, { role: 'assistant', content: '（演示回复）Thanks! We will connect the LLM later.' }]);
      setIsLoading(false);
    }, 600);
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', android: undefined })} className="flex-1">
        <View className="border-b border-gray-200 bg-white px-6 py-6">
          <View className="flex-row items-center gap-4">
            <Pressable
              onPress={() => router.replace('/main')}
              className="h-10 w-10 items-center justify-center rounded-full bg-gray-100"
            >
              <ArrowLeft size={20} color="#374151" />
            </Pressable>
            <View className="flex-1">
              <View className="flex-row items-center">
                <Sparkles size={24} color="#a855f7" />
                <Text className="ml-2 text-2xl font-bold text-gray-900">AI Helper</Text>
              </View>
              <Text className="text-sm text-gray-500">Ask me about supplements</Text>
            </View>
          </View>
        </View>

        <ScrollView className="flex-1 px-6 py-6">
          {messages.map((message, index) => (
            <View key={index} className={`mb-3 ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
              <View
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  message.role === 'user' ? 'bg-gray-900' : 'bg-white'
                }`}
              >
                <Text className={`${message.role === 'user' ? 'text-white' : 'text-gray-900'} text-sm`}>
                  {message.content}
                </Text>
              </View>
            </View>
          ))}
          {isLoading ? (
            <View className="items-start">
              <View className="rounded-2xl border border-gray-100 bg-white px-4 py-3">
                <ActivityIndicator />
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View className="border-t border-gray-200 bg-white px-6 py-4">
          <View className="flex-row items-center gap-3">
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask about supplements..."
              className="flex-1 h-12 rounded-xl border border-gray-200 px-4"
              editable={!isLoading}
            />
            <Pressable
              onPress={handleSend}
              disabled={isLoading || !input.trim()}
              className="h-12 items-center justify-center rounded-xl bg-purple-600 px-4"
            >
              <Send size={20} color="#fff" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
