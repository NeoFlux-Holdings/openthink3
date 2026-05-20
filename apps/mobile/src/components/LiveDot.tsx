/* Live indicator dot with a pulsing ring — used in the Today card,
 * Threads list, Conversation header, browser overlay.
 *
 * Uses Reanimated 4 shared values for native-thread driven pulses so the ring
 * doesn't stutter when the JS thread is busy rendering a long feed.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../theme/ThemeContext';

interface Props {
  kind?: 'coral' | 'brand' | 'green' | 'amber';
  size?: number;
  /** When false, the ring stays still — useful for non-active threads. */
  pulse?: boolean;
}

export function LiveDot({ kind = 'coral', size = 8, pulse = true }: Props) {
  const { colors } = useTheme();
  const color = kind === 'coral' ? colors.coral : kind === 'brand' ? colors.brand : kind === 'green' ? colors.green : colors.amber;

  const scale = useSharedValue(0.7);
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    if (!pulse) {
      scale.value = 0.7;
      opacity.value = 0;
      return;
    }
    scale.value = withRepeat(withTiming(1.9, { duration: 2000, easing: Easing.out(Easing.ease) }), -1, false);
    opacity.value = withRepeat(withTiming(0, { duration: 2000, easing: Easing.out(Easing.ease) }), -1, false);
    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, [pulse, scale, opacity]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
          },
          ringStyle,
        ]}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}
