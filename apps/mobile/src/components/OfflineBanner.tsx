/* Slim banner that surfaces when the agent API is unreachable. Shows
 * across every tab; clicking it triggers a retry. Auto-hides once the
 * next request succeeds.
 *
 * Usage:
 *   <OfflineBanner online={online} onRetry={refetch} />
 *
 * Screens own their own `online` state — they call `setOnline(true)` after a
 * successful API call and `setOnline(false)` on any thrown error.
 */
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../theme/tokens';

interface Props {
  online: boolean;
  onRetry?: () => void;
}

export function OfflineBanner({ online, onRetry }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const offset = useSharedValue(-80);

  useEffect(() => {
    if (online) {
      offset.value = withTiming(-80, { duration: 260, easing: Easing.in(Easing.ease) });
    } else {
      offset.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.ease) });
    }
  }, [online, offset]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: insets.top + space.s3,
          left: space.s4,
          right: space.s4,
          backgroundColor: colors.coralSoft,
          borderColor: colors.coral,
          borderWidth: 1,
          borderRadius: radius.r3,
          paddingHorizontal: space.s3,
          paddingVertical: space.s2,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s2,
          zIndex: 50,
        },
        style,
      ]}
      pointerEvents={online ? 'none' : 'auto'}
    >
      <Ionicons name="cloud-offline-outline" size={18} color={colors.coralInk} />
      <Text style={{ flex: 1, color: colors.coralInk, fontFamily: fontFamily.bodyMedium, fontSize: 12.5 }}>
        Reconnecting to your agent…
      </Text>
      {onRetry && (
        <Pressable
          onPress={() => {
            runOnJS(onRetry)();
          }}
          hitSlop={8}
        >
          <Text style={{ color: colors.coralInk, fontFamily: fontFamily.bodyMedium, fontSize: 12 }}>
            Retry
          </Text>
        </Pressable>
      )}
    </Animated.View>
  );
}
