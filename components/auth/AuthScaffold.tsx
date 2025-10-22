import React, { PropsWithChildren } from 'react';
import { Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, ScrollView, Text, View } from '@/components/ui/nativewind-primitives';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { colors, shadow } from '@/lib/theme';

type AuthScaffoldProps = PropsWithChildren<{
  title: string;
  subtitle: string;
  badge?: {
    icon: IconSymbolName;
    label: string;
  };
  footer?: React.ReactNode;
  accent?: 'mint' | 'sky' | 'amber' | 'rose';
  hero?: React.ReactNode;
}>;

const ACCENT_STYLES: Record<
  NonNullable<AuthScaffoldProps['accent']>,
  { blob: string; ring: string; iconColor: string }
> = {
  mint: {
    blob: 'bg-emerald-300/60',
    ring: 'bg-emerald-100/50',
    iconColor: '#047857',
  },
  sky: {
    blob: 'bg-sky-300/60',
    ring: 'bg-sky-100/50',
    iconColor: '#0369A1',
  },
  amber: {
    blob: 'bg-amber-300/60',
    ring: 'bg-amber-100/50',
    iconColor: '#B45309',
  },
  rose: {
    blob: 'bg-rose-300/60',
    ring: 'bg-rose-100/50',
    iconColor: '#BE123C',
  },
};

export function AuthScaffold({
  title,
  subtitle,
  badge,
  footer,
  accent = 'mint',
  hero,
  children,
}: AuthScaffoldProps) {
  const insets = useSafeAreaInsets();
  const accentStyles = ACCENT_STYLES[accent];

  return (
    <LinearGradient
      colors={[colors.bgMintFrom, colors.bgMintTo]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1, paddingTop: Math.max(insets.top, 24) }}
    >
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingBottom: insets.bottom + 48,
            flexGrow: 1,
          }}
        >
          <View className="relative flex-1 px-6 pb-10 pt-8">
            <View className="absolute -right-16 top-6 h-36 w-36 rounded-full bg-white/50 opacity-50" />
            <View className={`absolute -right-10 top-12 h-32 w-32 rounded-full ${accentStyles.blob}`} />
            <View className={`absolute -right-14 top-28 h-20 w-20 rounded-full ${accentStyles.ring}`} />

            <View className="mb-10">
              {hero ? <View className="mb-8 items-center">{hero}</View> : null}
              <Text className="text-xs font-semibold uppercase tracking-[0.35em] text-gray-600 dark:text-gray-300">
                NuTri
              </Text>
              <View className="mt-3 flex-row items-center gap-3">
                <Text className="text-4xl font-semibold leading-tight text-gray-900 dark:text-white">
                  {title}
                </Text>
                {badge ? (
                  <View className="rounded-full bg-white/70 px-3 py-2 shadow-md shadow-primary-500/10">
                    <View className="flex-row items-center gap-1.5">
                      <IconSymbol name={badge.icon} size={16} color={accentStyles.iconColor} />
                      <Text className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                        {badge.label}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>
              <Text className="mt-3 text-base text-gray-700 dark:text-gray-300">{subtitle}</Text>
            </View>

            <View
              className="overflow-hidden rounded-3xl border border-white/60 bg-white/95 p-6 dark:border-white/10 dark:bg-gray-900/95"
              style={shadow.card}
            >
              {children}
            </View>

            {footer ? <View className="mt-8">{footer}</View> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

export default AuthScaffold;
