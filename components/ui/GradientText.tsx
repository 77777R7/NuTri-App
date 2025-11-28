import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { StyleSheet, Text, type TextProps, type ViewStyle } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';

interface GradientTextProps extends TextProps {
    colors?: string[];
    style?: any;
    containerStyle?: ViewStyle;
    animationDuration?: number;
}

export function GradientText({
    children,
    colors = ['#ffaa40', '#9c40ff', '#ffaa40'], // Default orange -> purple -> orange
    style,
    containerStyle,
    animationDuration = 2000,
    ...props
}: GradientTextProps) {
    const translateX = useSharedValue(-100);

    useEffect(() => {
        translateX.value = withRepeat(
            withTiming(100, {
                duration: animationDuration,
                easing: Easing.linear,
            }),
            -1, // Infinite
            false // No reverse
        );
    }, [animationDuration, translateX]);

    const animatedGradientStyle = useAnimatedStyle(() => {
        return {
            transform: [{ translateX: `${translateX.value}%` }],
        };
    });

    return (
        <MaskedView
            style={[styles.maskedView, containerStyle]}
            maskElement={
                <Text style={[styles.text, style]} {...props}>
                    {children}
                </Text>
            }
        >
            {/* 
        We create a gradient that is 3x the width of the text container.
        We animate it from left to right to create the shimmer effect.
      */}
            <Animated.View style={[styles.gradientContainer, animatedGradientStyle]}>
                <LinearGradient
                    colors={colors as any}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                />
            </Animated.View>
        </MaskedView>
    );
}

const styles = StyleSheet.create({
    maskedView: {
        flexDirection: 'row',
        height: 'auto',
        alignSelf: 'center',
    },
    text: {
        backgroundColor: 'transparent',
        textAlign: 'center',
    },
    gradientContainer: {
        flex: 1,
        width: '300%', // Make it wide enough for the slide animation
        marginLeft: '-100%', // Start offset
        height: '100%',
    },
});
