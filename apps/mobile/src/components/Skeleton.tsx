/* Shimmer placeholder used while screens are waiting on their first
 * /api/mobile/* response. The shimmer is Reanimated so it stays smooth
 * even on slower phones.
 */
import { useEffect } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../theme/ThemeContext';
import { radius } from '../theme/tokens';

interface Props {
  width?: number | `${number}%`;
  height?: number;
  style?: ViewStyle;
  borderRadius?: number;
}

export function Skeleton({ width = '100%', height = 16, style, borderRadius: br = 6 }: Props) {
  const { colors } = useTheme();
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const aStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: br,
          backgroundColor: colors.surface2,
        },
        aStyle,
        style,
      ]}
    />
  );
}

export function SkeletonRow({ lines = 3 }: { lines?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.rule,
        borderWidth: 1,
        borderRadius: radius.r3,
        padding: 14,
        gap: 8,
      }}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === 0 ? '70%' : i === lines - 1 ? '45%' : '90%'} />
      ))}
    </View>
  );
}
