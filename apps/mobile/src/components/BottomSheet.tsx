/* BottomSheet — a real, gesture-driven bottom sheet.
 *
 * - Slides up on mount via Reanimated spring (no jump cut)
 * - Drag down on the grabber (or anywhere in the header) to dismiss
 * - Velocity-based dismiss threshold (slow drag must pass 35% height;
 *   a flick dismisses regardless of distance)
 * - Backdrop fades from 0 → 0.55 alpha as the sheet rises
 * - Tap backdrop or hardware back to dismiss
 * - Safe-area bottom inset baked in so content never hides behind home
 *   indicator on iOS
 *
 * Pass `onClose` from the route to navigate back.
 */
import { useEffect } from 'react';
import { BackHandler, Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeContext';
import { radius, space } from '../theme/tokens';

interface Props {
  children: React.ReactNode;
  /** Called when the sheet should dismiss (drag-down / backdrop / back-button). */
  onClose: () => void;
  /** Max height as a fraction of screen — default 0.85 */
  maxHeightFraction?: number;
  /** Optional fixed minimum content height — useful for tall keyboards. */
  minHeight?: number;
}

const DISMISS_DISTANCE_FRACTION = 0.35;
const DISMISS_VELOCITY = 800;

export function BottomSheet({ children, onClose, maxHeightFraction = 0.85 }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // 0 = fully visible; positive = dragged down (off-screen)
  const translateY = useSharedValue(1000); // start off-screen
  const measuredHeight = useSharedValue(0);

  useEffect(() => {
    // Slide in with a small spring overshoot; mirrors iOS sheet behavior.
    translateY.value = withSpring(0, { damping: 26, stiffness: 240 });
  }, [translateY]);

  // Android hardware back closes the sheet first.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    translateY.value = withTiming(
      measuredHeight.value || 800,
      { duration: 220, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onClose)();
      },
    );
  };

  // Pan handler — drag down to dismiss, drag up snaps back to 0.
  const pan = Gesture.Pan()
    .onChange((e) => {
      if (e.translationY > 0) {
        translateY.value = e.translationY;
      } else {
        // Allow a little rubber-banding when dragging up
        translateY.value = e.translationY * 0.18;
      }
    })
    .onEnd((e) => {
      const dismissThreshold = measuredHeight.value * DISMISS_DISTANCE_FRACTION;
      const fast = e.velocityY > DISMISS_VELOCITY;
      if (e.translationY > dismissThreshold || fast) {
        translateY.value = withTiming(
          measuredHeight.value || 800,
          { duration: 200, easing: Easing.in(Easing.cubic) },
          (finished) => {
            if (finished) runOnJS(onClose)();
          },
        );
      } else {
        translateY.value = withSpring(0, { damping: 26, stiffness: 220 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => {
    const alpha = interpolate(
      translateY.value,
      [0, measuredHeight.value || 800],
      [0.55, 0],
      'clamp',
    );
    return { backgroundColor: `rgba(0,0,0,${alpha})` };
  });

  return (
    <View style={{ flex: 1 }}>
      <Animated.View style={[{ position: 'absolute', inset: 0 }, backdropStyle]}>
        <Pressable style={{ flex: 1 }} onPress={dismiss} />
      </Animated.View>

      <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
        <Animated.View
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0 && measuredHeight.value !== h) measuredHeight.value = h;
          }}
          style={[
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius.r5,
              borderTopRightRadius: radius.r5,
              paddingTop: space.s3,
              paddingBottom: insets.bottom + space.s5,
              maxHeight: '85%',
              shadowColor: '#000',
              shadowOpacity: 0.2,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: -8 },
              elevation: 12,
            },
            sheetStyle,
          ]}
        >
          <GestureDetector gesture={pan}>
            <View style={{ alignItems: 'center', paddingBottom: space.s2 }}>
              <View
                style={{
                  width: 40,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: colors.rule2,
                }}
              />
            </View>
          </GestureDetector>
          {/* Body wraps children — screens own their own padding. We give them
              the full sheet space minus the grabber. */}
          <View style={{ paddingHorizontal: space.s5, flexShrink: 1 }}>
            {children}
          </View>
        </Animated.View>
      </View>
    </View>
  );
}
