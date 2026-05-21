/* SwipeRow — list row with left + right swipe-to-action panels.
 *
 * Drag left (negative dx) to reveal the right action (typically Archive).
 * Drag right (positive dx) to reveal the left action (typically Pin).
 * Release past |80px| commits the action; anything shorter rubber-bands back.
 *
 * Built on Reanimated + gesture-handler so the row drags on the UI thread
 * (no React state updates during the drag). Action panels expand to match
 * the drag distance — feels native.
 *
 * Thresholds + curves from the design handoff:
 *   action-fire: |dx| > 80px on release
 *   release ease: cubic-bezier(0.22, 0.61, 0.36, 1) at 240ms
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../theme/ThemeContext';
import { type } from '../theme/tokens';
import { confirm as hapticConfirm } from '../lib/haptics';

const FIRE = 80;
const REVEAL = 120;
const RELEASE = { duration: 240, easing: Easing.bezier(0.22, 0.61, 0.36, 1) };

export interface SwipeAction {
  /** Ionicons name. */
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Tone — color of the action panel. */
  tone?: 'pin' | 'archive' | 'mark' | 'mute';
}

interface Props {
  children: ReactNode;
  left?: SwipeAction;
  right?: SwipeAction;
  onLeft?: () => void;
  onRight?: () => void;
}

export function SwipeRow({ children, left, right, onLeft, onRight }: Props) {
  const { colors } = useTheme();
  const dx = useSharedValue(0);

  const fireLeft = () => {
    hapticConfirm();
    onLeft?.();
  };
  const fireRight = () => {
    hapticConfirm();
    onRight?.();
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12]) // require horizontal intent
    .failOffsetY([-12, 12])
    .onChange((e) => {
      // Clamp drag to ±REVEAL. Asymmetric — only allow drag in directions
      // that have actions configured.
      const can = e.translationX > 0 ? !!left : !!right;
      const target = can ? Math.max(Math.min(e.translationX, REVEAL), -REVEAL) : 0;
      dx.value = target;
    })
    .onEnd(() => {
      if (dx.value <= -FIRE && right) {
        dx.value = withTiming(-REVEAL, RELEASE, (done) => {
          if (done) {
            runOnJS(fireRight)();
            dx.value = withTiming(0, RELEASE);
          }
        });
        return;
      }
      if (dx.value >= FIRE && left) {
        dx.value = withTiming(REVEAL, RELEASE, (done) => {
          if (done) {
            runOnJS(fireLeft)();
            dx.value = withTiming(0, RELEASE);
          }
        });
        return;
      }
      dx.value = withTiming(0, RELEASE);
    });

  // Row offset
  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value }],
  }));

  // Left action panel — grows as the user drags right.
  const leftStyle = useAnimatedStyle(() => ({
    width: Math.max(0, dx.value),
    opacity: interpolate(dx.value, [0, FIRE], [0, 1], Extrapolation.CLAMP),
  }));

  // Right action panel — grows as the user drags left.
  const rightStyle = useAnimatedStyle(() => ({
    width: Math.max(0, -dx.value),
    opacity: interpolate(dx.value, [0, -FIRE], [0, 1], Extrapolation.CLAMP),
  }));

  const TONE_COLOR: Record<NonNullable<SwipeAction['tone']>, string> = {
    pin: colors.blue,
    mark: colors.brand,
    mute: colors.amber,
    archive: colors.coral,
  };

  return (
    <View style={{ position: 'relative', overflow: 'hidden' }}>
      {left && (
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              backgroundColor: TONE_COLOR[left.tone ?? 'pin'],
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 14,
              overflow: 'hidden',
            },
            leftStyle,
          ]}
        >
          <ActionContent icon={left.icon} label={left.label} />
        </Animated.View>
      )}
      {right && (
        <Animated.View
          style={[
            {
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              backgroundColor: TONE_COLOR[right.tone ?? 'archive'],
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 14,
              overflow: 'hidden',
            },
            rightStyle,
          ]}
        >
          <ActionContent icon={right.icon} label={right.label} />
        </Animated.View>
      )}
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

function ActionContent({
  icon,
  label,
}: {
  icon: SwipeAction['icon'];
  label: string;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 2, minWidth: 64 }}>
      <Ionicons name={icon} size={18} color="#FFFFFF" />
      <Animated.Text
        style={{
          color: '#FFFFFF',
          fontSize: 11,
          fontFamily: type.bodyMedium,
          letterSpacing: -0.05,
        }}
        numberOfLines={1}
      >
        {label}
      </Animated.Text>
    </View>
  );
}
