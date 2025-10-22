import React, { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import Toast from 'react-native-toast-message';

import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/auth/FormInput';
import { AuthScaffold } from '@/components/auth/AuthScaffold';
import { colors } from '@/lib/theme';
import { getAuthErrorMessage } from '@/lib/errors';
import { useAuth } from '@/contexts/AuthContext';
import { Image, Text, View } from '@/components/ui/nativewind-primitives';

const schema = z.object({
  email: z.string().email('Please enter a valid email address.'),
});

type ForgotForm = z.infer<typeof schema>;
type TextControllerField = {
  onChange: (value: string) => void;
  onBlur: () => void;
  value: string | null | undefined;
};

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { requestPasswordReset } = useAuth();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const onSubmit = handleSubmit(async ({ email }: ForgotForm) => {
    setSubmitting(true);
    setMessage(null);
    setIsSuccess(false);
    try {
      await requestPasswordReset(email.trim());
      setIsSuccess(true);
      setMessage('Check your inbox for a secure link. It stays active for 30 minutes.');
    } catch (error) {
      setIsSuccess(false);
      setMessage(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  });

  useEffect(() => {
    if (!message) return;
    Toast.show({
      type: isSuccess ? 'success' : 'error',
      text1: isSuccess ? 'Reset email on the way' : 'Reset failed',
      text2: message,
    });
  }, [message, isSuccess]);

  return (
    <AuthScaffold
      title="Reset your password"
      subtitle="We’ll email you a secure link so you can create a new password and get back to your routine."
      badge={{ icon: 'lock.rotation.open', label: 'Secure' }}
      accent="rose"
      footer={
        <View className="items-center gap-2">
          <Text className="text-xs text-center text-muted">
            Didn’t receive the message? Check your spam folder or try another email.
          </Text>
          <Text className="text-xs text-center text-muted">Still stuck? support@nutri.app</Text>
        </View>
      }
      hero={
        <View className="items-center gap-3">
          <View className="h-20 w-20 items-center justify-center rounded-3xl bg-white/90 shadow-soft">
            <Image
              source={require('@/assets/images/icon.png')}
              style={{ width: 60, height: 60 }}
              resizeMode="contain"
            />
          </View>
          <Text className="text-sm font-medium uppercase tracking-[0.4em]" style={{ color: colors.brand }}>
            Support
          </Text>
        </View>
      }
    >
      <View className="gap-6">
        {message ? (
          <View
            className={`rounded-2xl border px-4 py-3 ${
              isSuccess
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-400/40 dark:bg-emerald-900/20'
                : 'border-red-200 bg-red-50 dark:border-red-400/40 dark:bg-red-900/20'
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                isSuccess ? 'text-emerald-700 dark:text-emerald-200' : 'text-red-600 dark:text-red-200'
              }`}
            >
              {message}
            </Text>
          </View>
        ) : null}

        <Controller
          control={control}
          name="email"
          render={({ field }: { field: unknown }) => {
            const { onChange, onBlur, value } = field as TextControllerField;
            return (
              <FormInput
                label="Email"
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                onChangeText={onChange}
                onBlur={onBlur}
                value={value ?? ''}
                error={errors.email?.message}
              />
            );
          }}
        />

        <Button label="Send reset link" onPress={onSubmit} loading={submitting} />

        <Button
          label="Back to login"
          variant="secondary"
          onPress={() => router.replace('/auth/login')}
          disabled={submitting}
        />
      </View>
    </AuthScaffold>
  );
}
