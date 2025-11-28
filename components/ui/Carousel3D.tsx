import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
    Extrapolation,
    interpolate,
    runOnJS,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Carousel3DProps<T> {
    data: T[];
    renderItem: (item: T, index: number) => React.ReactElement;
    itemWidth?: number;
    itemHeight?: number;
    gap?: number;
}

export function Carousel3D<T>({
    data,
    renderItem,
    itemWidth = SCREEN_WIDTH * 0.85,
    itemHeight = 500,
    gap = 0,
}: Carousel3DProps<T>) {
    const scrollX = useSharedValue(0);
    const [currentIndex, setCurrentIndex] = useState(0);
    const spacerWidth = (SCREEN_WIDTH - itemWidth) / 2;
    const snapInterval = itemWidth + gap;

    const handleSnap = (index: number) => {
        if (index !== currentIndex) {
            setCurrentIndex(index);
            Haptics.selectionAsync();
        }
    };

    const onScroll = useAnimatedScrollHandler((event) => {
        scrollX.value = event.contentOffset.x;
        const index = Math.round(event.contentOffset.x / snapInterval);
        runOnJS(handleSnap)(index);
    });

    return (
        <View style={styles.container}>
            <Animated.ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={16}
                snapToInterval={snapInterval}
                decelerationRate="fast"
                contentContainerStyle={{
                    paddingHorizontal: spacerWidth,
                    alignItems: 'center',
                }}
                onScroll={onScroll}
            >
                {data.map((item, index) => {
                    const inputRange = [
                        (index - 1) * snapInterval,
                        index * snapInterval,
                        (index + 1) * snapInterval,
                    ];

                    const animatedStyle = useAnimatedStyle(() => {
                        const scale = interpolate(
                            scrollX.value,
                            inputRange,
                            [0.9, 1, 0.9],
                            Extrapolation.CLAMP
                        );

                        const rotateY = interpolate(
                            scrollX.value,
                            inputRange,
                            [45, 0, -45],
                            Extrapolation.CLAMP
                        );

                        const opacity = interpolate(
                            scrollX.value,
                            inputRange,
                            [0.6, 1, 0.6],
                            Extrapolation.CLAMP
                        );

                        const translateX = interpolate(
                            scrollX.value,
                            inputRange,
                            [-itemWidth * 0.1, 0, itemWidth * 0.1],
                            Extrapolation.CLAMP
                        );

                        return {
                            transform: [
                                { perspective: 1000 },
                                { translateX },
                                { scale },
                                { rotateY: `${rotateY}deg` },
                            ],
                            opacity,
                            zIndex: index === Math.round(scrollX.value / snapInterval) ? 10 : 1,
                        };
                    });

                    return (
                        <Animated.View
                            key={index}
                            style={[
                                {
                                    width: itemWidth,
                                    height: itemHeight,
                                    marginRight: index === data.length - 1 ? 0 : gap,
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                },
                                animatedStyle,
                            ]}
                        >
                            {renderItem(item, index)}
                        </Animated.View>
                    );
                })}
            </Animated.ScrollView>

            <View style={styles.pagination}>
                {data.map((_, index) => (
                    <View
                        key={index}
                        style={[
                            styles.dot,
                            {
                                backgroundColor: index === currentIndex ? '#FFF' : 'rgba(255,255,255,0.3)',
                                width: index === currentIndex ? 24 : 8,
                            },
                        ]}
                    />
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
    },
    pagination: {
        flexDirection: 'row',
        marginTop: 20,
        gap: 8,
        alignItems: 'center',
    },
    dot: {
        height: 8,
        borderRadius: 4,
    },
});
