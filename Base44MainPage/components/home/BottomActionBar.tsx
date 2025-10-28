import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Heart, Home, MessageSquare, Plus, Search, TrendingUp, User } from 'lucide-react-native';

import type { FloatingAction, HomeTabKey } from '@/Base44MainPage/entities/navigation';

type BottomActionBarProps = {
  activeTab: HomeTabKey;
  onTabPress: (tab: HomeTabKey) => void;
  onActionSelect: (action: FloatingAction) => void;
};

const addMenuOptions: Array<{
  key: FloatingAction;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  colors: [string, string];
}> = [
  { key: 'scan', label: 'Scan', icon: Camera, colors: ['#3b82f6', '#2563eb'] },
  { key: 'assistant', label: 'AI Helper', icon: MessageSquare, colors: ['#a855f7', '#7c3aed'] },
  { key: 'search', label: 'Search', icon: Search, colors: ['#10b981', '#059669'] },
];

const tabs: Array<{ key: HomeTabKey; label: string; icon: React.ComponentType<{ size?: number; color?: string }> }> = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'progress', label: 'Progress', icon: TrendingUp },
  { key: 'favourite', label: 'Favourite', icon: Heart },
  { key: 'profile', label: 'Profile', icon: User },
];

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

export function BottomActionBar({ activeTab, onTabPress, onActionSelect }: BottomActionBarProps) {
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuMounted, setMenuMounted] = useState(false);

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const rotation = useRef(new Animated.Value(0)).current;
  const itemAnimations = useMemo(
    () => addMenuOptions.map(() => new Animated.Value(0)),
    [],
  );

  const runOpenAnimation = useCallback(() => {
    setMenuMounted(true);
    setMenuOpen(true);

    const itemAnimationsTo = itemAnimations.map((item, index) =>
      Animated.timing(item, {
        toValue: 1,
        duration: 220,
        delay: index * 40,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    );

    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(rotation, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.stagger(30, itemAnimationsTo),
    ]).start();
  }, [itemAnimations, overlayOpacity, rotation]);

  const runCloseAnimation = useCallback(() => {
    setMenuOpen(false);

    const itemAnimationsTo = itemAnimations
      .map((item, index) =>
        Animated.timing(item, {
          toValue: 0,
          duration: 160,
          delay: index * 20,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      )
      .reverse();

    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(rotation, {
        toValue: 0,
        duration: 200,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.stagger(20, itemAnimationsTo),
    ]).start(({ finished }) => {
      if (finished) {
        setMenuMounted(false);
      }
    });
  }, [itemAnimations, overlayOpacity, rotation]);

  const handleToggle = useCallback(() => {
    if (menuOpen) {
      runCloseAnimation();
    } else {
      runOpenAnimation();
    }
  }, [menuOpen, runCloseAnimation, runOpenAnimation]);

  const handleSelectAction = useCallback(
    (action: FloatingAction) => {
      runCloseAnimation();
      onActionSelect(action);
    },
    [onActionSelect, runCloseAnimation],
  );

  const plusTransform = {
    transform: [
      {
        rotate: rotation.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '45deg'],
        }),
      },
    ],
  };

  const overlayPointerEvents = menuMounted ? 'auto' : 'none';

  return (
    <>
      {menuMounted ? (
        <Animated.View
          pointerEvents={overlayPointerEvents as 'auto' | 'none'}
          style={[StyleSheet.absoluteFillObject, styles.overlay, { opacity: overlayOpacity }]}
        >
          <AnimatedBlurView intensity={45} tint="default" style={StyleSheet.absoluteFill} />
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={runCloseAnimation} />
          <View style={[StyleSheet.absoluteFillObject, styles.menuHost]}>
            {addMenuOptions.map((option, index) => {
              const progress = itemAnimations[index];
              const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });
              const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
              const opacity = progress;
              return (
                <Animated.View
                  key={option.key}
                  style={[
                    styles.menuItemWrapper,
                    {
                      opacity,
                      transform: [
                        { translateY },
                        { scale },
                      ],
                    },
                  ]}
                >
                  <TouchableOpacity activeOpacity={0.9} onPress={() => handleSelectAction(option.key)} style={styles.menuItem}>
                    <LinearGradient colors={option.colors} start={[0, 0]} end={[1, 1]} style={styles.menuIcon}>
                      <option.icon color="#fff" size={22} />
                    </LinearGradient>
                    <Text style={styles.menuLabel}>{option.label}</Text>
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </View>
        </Animated.View>
      ) : null}

      <View style={[styles.navContainer, { paddingBottom: Math.max(insets.bottom - 10, 0) }]}>
        <View style={styles.navContent}>
          {tabs.slice(0, 2).map(tab => (
            <NavButton key={tab.key} tab={tab} activeTab={activeTab} onPress={onTabPress} />
          ))}

          <TouchableOpacity activeOpacity={0.9} onPress={handleToggle} style={styles.addButtonWrap}>
            <Animated.View style={[styles.addButton, plusTransform]}>
              <Plus size={28} color="#fff" />
            </Animated.View>
          </TouchableOpacity>

          {tabs.slice(2).map(tab => (
            <NavButton key={tab.key} tab={tab} activeTab={activeTab} onPress={onTabPress} />
          ))}
        </View>
      </View>
    </>
  );
}

type NavButtonProps = {
  tab: { key: HomeTabKey; label: string; icon: React.ComponentType<{ size?: number; color?: string }> };
  activeTab: HomeTabKey;
  onPress: (tab: HomeTabKey) => void;
};

function NavButton({ tab, activeTab, onPress }: NavButtonProps) {
  const focused = activeTab === tab.key;
  const color = focused ? '#111827' : '#9ca3af';
  const IconComponent = tab.icon;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
      onPress={() => onPress(tab.key)}
      activeOpacity={0.85}
      style={styles.navButton}
    >
      <IconComponent size={24} color={color} />
      <Text style={[styles.navLabel, focused && styles.navLabelFocused]}>{tab.label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: {
    zIndex: 40,
  },
  menuHost: {
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 140,
  },
  menuItemWrapper: {
    marginBottom: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 18,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  menuIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  navContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  navContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 32,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
    width: '90%',
  },
  navButton: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  navLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#9ca3af',
  },
  navLabelFocused: {
    color: '#111827',
  },
  addButtonWrap: {
    marginTop: -24,
  },
  addButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#111827',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
});

export default BottomActionBar;
