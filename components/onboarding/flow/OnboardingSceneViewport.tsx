import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';

import {
  FLOW_INCOMING_OFFSET_PX,
  FLOW_INCOMING_SCALE,
  FLOW_OUTGOING_OFFSET_PX,
  FLOW_OUTGOING_SCALE,
} from './onboardingMotion';
import { OnboardingSceneMotionContext } from './OnboardingSceneMotionContext';

export type OnboardingFlowDirection = 'forward' | 'back' | 'none';

type OnboardingSceneViewportProps<Step extends string> = {
  activeStep: Step;
  leavingStep: Step | null;
  direction: OnboardingFlowDirection;
  progress: Animated.SharedValue<number>;
  renderScene: (step: Step, sceneActive: boolean) => React.ReactNode;
};

type SceneLayerProps = {
  role: 'incoming' | 'outgoing' | 'idle';
  direction: OnboardingFlowDirection;
  progress: Animated.SharedValue<number>;
  children: React.ReactNode;
  sceneActive: boolean;
};

function SceneLayer({
  role,
  direction,
  progress,
  children,
  sceneActive,
}: SceneLayerProps) {
  const animatedStyle = useAnimatedStyle(() => {
    if (role === 'idle' || direction === 'none') {
      return {
        opacity: 1,
        transform: [{ translateX: 0 }, { scale: 1 }],
      };
    }

    const incomingOffset =
      direction === 'forward' ? FLOW_INCOMING_OFFSET_PX : -FLOW_INCOMING_OFFSET_PX;
    const outgoingOffset =
      direction === 'forward' ? -FLOW_OUTGOING_OFFSET_PX : FLOW_OUTGOING_OFFSET_PX;

    if (role === 'incoming') {
      return {
        opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
        transform: [
          {
            translateX: interpolate(
              progress.value,
              [0, 1],
              [incomingOffset, 0],
              Extrapolation.CLAMP,
            ),
          },
          {
            scale: interpolate(
              progress.value,
              [0, 1],
              [FLOW_INCOMING_SCALE, 1],
              Extrapolation.CLAMP,
            ),
          },
        ],
      };
    }

    return {
      opacity: interpolate(progress.value, [0, 1], [1, 0], Extrapolation.CLAMP),
      transform: [
        {
          translateX: interpolate(
            progress.value,
            [0, 1],
            [0, outgoingOffset],
            Extrapolation.CLAMP,
          ),
        },
        {
          scale: interpolate(
            progress.value,
            [0, 1],
            [1, FLOW_OUTGOING_SCALE],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });

  return (
    <OnboardingSceneMotionContext.Provider
      value={{ role, direction, progress: direction === 'none' ? null : progress }}
    >
      <Animated.View
        pointerEvents={sceneActive ? 'auto' : 'none'}
        style={[styles.layer, animatedStyle]}
      >
        {children}
      </Animated.View>
    </OnboardingSceneMotionContext.Provider>
  );
}

export function OnboardingSceneViewport<Step extends string>({
  activeStep,
  leavingStep,
  direction,
  progress,
  renderScene,
}: OnboardingSceneViewportProps<Step>) {
  return (
    <View style={styles.root}>
      {leavingStep && leavingStep !== activeStep ? (
        <SceneLayer
          role="outgoing"
          direction={direction}
          progress={progress}
          sceneActive={false}
        >
          {renderScene(leavingStep, false)}
        </SceneLayer>
      ) : null}

      <SceneLayer
        role={leavingStep ? 'incoming' : 'idle'}
        direction={direction}
        progress={progress}
        sceneActive
      >
        {renderScene(activeStep, true)}
      </SceneLayer>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
  },
});
