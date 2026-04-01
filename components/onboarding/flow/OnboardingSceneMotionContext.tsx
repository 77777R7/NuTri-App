import { createContext, useContext } from 'react';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';

import type { OnboardingFlowDirection } from './OnboardingSceneViewport';

type SceneMotionContextValue = {
  role: 'incoming' | 'outgoing' | 'idle';
  direction: OnboardingFlowDirection;
  progress: Animated.SharedValue<number> | null;
};

export const OnboardingSceneMotionContext = createContext<SceneMotionContextValue>({
  role: 'idle',
  direction: 'none',
  progress: null,
});

type SceneZone = 'copy' | 'content';

export function useOnboardingSceneZoneStyle(zone: SceneZone) {
  const { role, direction, progress } = useContext(OnboardingSceneMotionContext);

  return useAnimatedStyle(() => {
    if (!progress || role === 'idle' || direction === 'none') {
      return {
        opacity: 1,
        transform: [{ translateX: 0 }, { translateY: 0 }],
      };
    }

    const incomingSign = direction === 'forward' ? 1 : -1;
    const outgoingSign = direction === 'forward' ? -1 : 1;

    const incomingBaseOffset = zone === 'copy' ? 18 : 28;
    const outgoingBaseOffset = zone === 'copy' ? 10 : 16;
    const incomingStart = zone === 'copy' ? 0 : 0.08;
    const incomingEnd = zone === 'copy' ? 0.72 : 0.9;
    const outgoingEnd = zone === 'copy' ? 0.84 : 0.72;
    const outgoingY = zone === 'copy' ? -2 : 2;

    if (role === 'incoming') {
      return {
        opacity: interpolate(
          progress.value,
          [incomingStart, incomingEnd],
          [0, 1],
          Extrapolation.CLAMP,
        ),
        transform: [
          {
            translateX: interpolate(
              progress.value,
              [incomingStart, incomingEnd],
              [incomingBaseOffset * incomingSign, 0],
              Extrapolation.CLAMP,
            ),
          },
          {
            translateY: interpolate(
              progress.value,
              [incomingStart, incomingEnd],
              [zone === 'copy' ? 2 : 4, 0],
              Extrapolation.CLAMP,
            ),
          },
        ],
      };
    }

    return {
      opacity: interpolate(
        progress.value,
        [0, outgoingEnd],
        [1, 0],
        Extrapolation.CLAMP,
      ),
      transform: [
        {
          translateX: interpolate(
            progress.value,
            [0, outgoingEnd],
            [0, outgoingBaseOffset * outgoingSign],
            Extrapolation.CLAMP,
          ),
        },
        {
          translateY: interpolate(
            progress.value,
            [0, outgoingEnd],
            [0, outgoingY],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  }, [direction, progress, role, zone]);
}
