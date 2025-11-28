import { LinearGradient } from 'expo-linear-gradient';
import { Check } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
    ZoomIn,
} from 'react-native-reanimated';

interface GradientIndicatorProps {
    status: 'pending' | 'loading' | 'completed';
    colors?: string[];
    size?: number;
}

export function GradientIndicator({
    status,
    colors = ['#ffaa40', '#9c40ff', '#ffaa40'],
    size = 24,
}: GradientIndicatorProps) {
    const rotation = useSharedValue(0);

    useEffect(() => {
        if (status === 'loading') {
            rotation.value = withRepeat(
                withTiming(360, { duration: 1000, easing: Easing.linear }),
                -1
            );
        } else {
            rotation.value = 0;
        }
    }, [status]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${rotation.value}deg` }],
    }));

    if (status === 'completed') {
        return (
            <Animated.View entering={ZoomIn.duration(300)} style={{ width: size, height: size }}>
                <LinearGradient
                    colors={colors as any}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.completedContainer, { width: size, height: size, borderRadius: size / 2 }]}
                >
                    <Check size={size * 0.6} color="#fff" strokeWidth={3} />
                </LinearGradient>
            </Animated.View>
        );
    }

    if (status === 'loading') {
        return (
            <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
                <Animated.View style={[animatedStyle, { width: size, height: size }]}>
                    <LinearGradient
                        colors={colors as any}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{ flex: 1, borderRadius: size / 2, padding: 2 }} // padding creates the border width
                    >
                        {/* Inner circle to create the ring effect */}
                        <View
                            style={{
                                flex: 1,
                                backgroundColor: '#fff', // Match background color
                                borderRadius: (size - 4) / 2,
                            }}
                        />
                    </LinearGradient>
                </Animated.View>
            </View>
        );
    }

    // Pending state
    return (
        <View
            style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                borderWidth: 2,
                borderColor: 'rgba(255,255,255,0.2)',
            }}
        />
    );
}

const styles = StyleSheet.create({
    completedContainer: {
        justifyContent: 'center',
        alignItems: 'center',
    },
});
