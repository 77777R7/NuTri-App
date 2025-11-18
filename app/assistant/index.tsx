import React, { useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ArrowLeft, Send, Sparkles } from 'lucide-react-native';
import { router } from 'expo-router';

import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import type { DesignTokens } from '@/constants/designTokens';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';

type Message = { role: 'user' | 'assistant'; content: string };

export default function AIHelperPage() {
  const { tokens } = useResponsiveTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
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
    <ResponsiveScreen contentStyle={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', android: undefined })} style={styles.keyboard}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => router.replace('/main')} activeOpacity={0.85} style={styles.backButton}>
              <ArrowLeft size={tokens.components.iconButton.iconSize} color={tokens.colors.textPrimary} />
            </TouchableOpacity>
            <View style={styles.headerTextGroup}>
              <View style={styles.headerTitleRow}>
                <Sparkles size={Math.round(tokens.components.iconButton.iconSize * 1.1)} color={tokens.colors.accent} />
                <Text style={styles.headerTitle}>AI Helper</Text>
              </View>
              <Text style={styles.headerSubtitle}>Ask me about supplements</Text>
            </View>
          </View>
        </View>

        <ScrollView style={styles.messagesScroller} contentContainerStyle={styles.messagesContent} keyboardShouldPersistTaps="handled">
          {messages.map((message, index) => (
            <View key={index} style={[styles.messageRow, message.role === 'user' ? styles.messageRowUser : styles.messageRowAssistant]}>
              <View style={[styles.bubbleBase, message.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
                <Text style={message.role === 'user' ? styles.userBubbleText : styles.assistantBubbleText}>{message.content}</Text>
              </View>
            </View>
          ))}
          {isLoading ? (
            <View style={[styles.messageRow, styles.messageRowAssistant]}>
              <View style={styles.loadingBubble}>
                <ActivityIndicator color={tokens.colors.accent} />
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.composerWrapper}>
          <View style={styles.composerRow}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask about supplements..."
              placeholderTextColor={tokens.colors.textMuted}
              style={styles.input}
              editable={!isLoading}
              multiline
            />
            <TouchableOpacity
              onPress={handleSend}
              disabled={isLoading || !input.trim()}
              activeOpacity={0.85}
              style={[styles.sendButton, (isLoading || !input.trim()) && styles.sendButtonDisabled]}
            >
              <Send size={tokens.components.iconButton.iconSize} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ResponsiveScreen>
  );
}

const createStyles = (tokens: DesignTokens) => {
  const bubbleWidth = '80%';

  return StyleSheet.create({
    screen: {
      flex: 1,
      paddingVertical: tokens.spacing.xl,
    },
    keyboard: {
      flex: 1,
    },
    header: {
      width: '100%',
      backgroundColor: tokens.colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.colors.border,
      paddingBottom: tokens.spacing.md,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens.spacing.md,
    },
    backButton: {
      width: tokens.components.iconButton.size,
      height: tokens.components.iconButton.size,
      borderRadius: tokens.components.iconButton.radius,
      backgroundColor: tokens.colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTextGroup: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    headerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens.spacing.xs,
    },
    headerTitle: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.subtitle,
    },
    headerSubtitle: {
      color: tokens.colors.textMuted,
      ...tokens.typography.bodySmall,
    },
    messagesScroller: {
      flex: 1,
      width: '100%',
      marginTop: tokens.spacing.lg,
      backgroundColor: tokens.colors.background,
    },
    messagesContent: {
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.sm,
    },
    messageRow: {
      width: '100%',
    },
    messageRowUser: {
      alignItems: 'flex-end',
    },
    messageRowAssistant: {
      alignItems: 'flex-start',
    },
    bubbleBase: {
      maxWidth: bubbleWidth,
      borderRadius: tokens.radius['2xl'],
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
    },
    userBubble: {
      backgroundColor: tokens.colors.textPrimary,
    },
    assistantBubble: {
      backgroundColor: tokens.colors.surface,
      borderWidth: 1,
      borderColor: tokens.colors.border,
    },
    userBubbleText: {
      color: '#FFFFFF',
      ...tokens.typography.body,
    },
    assistantBubbleText: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.body,
    },
    loadingBubble: {
      borderRadius: tokens.radius['2xl'],
      borderWidth: 1,
      borderColor: tokens.colors.border,
      backgroundColor: tokens.colors.surface,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
    },
    composerWrapper: {
      width: '100%',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.colors.border,
      backgroundColor: tokens.colors.surface,
      paddingTop: tokens.spacing.sm,
    },
    composerRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: tokens.spacing.sm,
    },
    input: {
      flex: 1,
      minHeight: Math.round(tokens.components.iconButton.size * 1.2),
      maxHeight: Math.round(tokens.components.iconButton.size * 3),
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.colors.border,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.xs,
      color: tokens.colors.textPrimary,
      ...tokens.typography.body,
    },
    sendButton: {
      width: Math.round(tokens.components.iconButton.size * 1.3),
      height: Math.round(tokens.components.iconButton.size * 1.3),
      borderRadius: Math.round(tokens.components.iconButton.size * 0.65),
      backgroundColor: tokens.colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendButtonDisabled: {
      opacity: 0.6,
    },
  });
};
