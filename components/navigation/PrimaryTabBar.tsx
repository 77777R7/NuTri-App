import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Pressable, Text, View } from '@/components/ui/nativewind-primitives';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type TabConfig = {
  name: string;
  label: string;
  type: 'text' | 'icon';
  icon?: IconSymbolName;
  accentColor?: string;
  highlight?: boolean;
};

const TAB_CONFIG: TabConfig[] = [
  { name: 'home', label: 'Home', type: 'text' },
  { name: 'progress', label: 'Progress', type: 'icon', icon: 'chart.line.uptrend.xyaxis', accentColor: '#6366f1' },
  { name: 'saved-supplements', label: 'Saved', type: 'icon', icon: 'bookmark.fill', accentColor: '#f97316', highlight: true },
  { name: 'profile', label: 'Profile', type: 'icon', icon: 'person.crop.circle', accentColor: '#10b981' },
];

const triggerHaptic = () => {
  if (process.env.EXPO_OS === 'ios') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }
};

export const PrimaryTabBar: React.FC<BottomTabBarProps> = ({ state, navigation }) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom, 10),
          backgroundColor: colors.background,
          borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(15, 23, 42, 0.06)',
        },
      ]}
    >
      <View style={styles.row}>
        {TAB_CONFIG.map(tab => {
          const route = state.routes.find(item => item.name === tab.name);
          if (!route) {
            return null;
          }

          const routeIndex = state.routes.indexOf(route);
          const isFocused = state.index === routeIndex;
          const iconColor = isFocused ? tab.accentColor ?? colors.tabIconSelected : colors.tabIconDefault;

          const onPress = () => {
            triggerHaptic();
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };

          return (
            <Pressable
              key={tab.name}
              onPress={onPress}
              onLongPress={onLongPress}
              style={[styles.item, tab.type === 'text' ? styles.textItem : styles.iconItem]}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
            >
              {tab.type === 'text' ? (
                <Text style={[styles.homeLabel, { color: isFocused ? colors.text : colors.tabIconDefault }]}>
                  {tab.label}
                </Text>
              ) : (
                <View style={styles.iconWrapper}>
                  {tab.highlight && isFocused ? (
                    <View style={styles.highlightCircle}>
                      <IconSymbol name={tab.icon as IconSymbolName} size={22} color={iconColor} />
                    </View>
                  ) : (
                    <IconSymbol name={tab.icon as IconSymbolName} size={22} color={iconColor} />
                  )}
                </View>
              )}
            </Pressable>
          );
        })}

        <Pressable
          onPress={() => {
            triggerHaptic();
            router.push('/scan/label');
          }}
          style={[styles.item, styles.plusSlot]}
          accessibilityRole="button"
          accessibilityLabel="Scan"
        >
          <View style={styles.plusButton}>
            <IconSymbol name="plus" size={24} color="#0f172a" />
          </View>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textItem: {
    alignItems: 'flex-start',
  },
  iconItem: {
    alignItems: 'center',
  },
  homeLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  iconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightCircle: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  plusSlot: {
    alignItems: 'flex-end',
  },
  plusButton: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
});
