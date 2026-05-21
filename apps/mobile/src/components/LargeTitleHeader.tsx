/* LargeTitleHeader — iOS-style title that collapses on scroll.
 *
 * Drop this above the scrolling area and pass it the scroll Y as a shared
 * value. As the user scrolls past ~40px the big title fades out + nudges up
 * while the inline nav title fades in. At t > 0.3 the nav strip picks up a
 * blur tint; at t > 0.9 the rule line appears.
 *
 * Scroll math from the design handoff:
 *   t = clamp(scrollY / 40, 0, 1)
 *   big-title opacity   = 1 - t
 *   big-title translateY = -t * 8
 *   nav-title opacity   = t
 *   nav backdrop tint   = (t > 0.3) ? blur(20px) : transparent
 *   nav border-bottom   = (t > 0.9) ? hairline : transparent
 *
 * Implementation note: we use Reanimated shared values so the transition is
 * UI-thread driven — no per-frame React re-renders, no jank during scroll.
 */
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { Mono } from './primitives';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, space, type } from '../theme/tokens';

interface Props {
  title: string;
  subtitle?: string;
  scrollY: SharedValue<number>;
  rightAccessory?: React.ReactNode;
  /** When set, renders a back chevron + label on the left. */
  back?: { label: string; onPress: () => void };
}

export function LargeTitleHeader({ title, subtitle, scrollY, rightAccessory, back }: Props) {
  const { colors, theme } = useTheme();

  // Inline nav title: invisible until the big title has mostly faded out.
  const navTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 40], [0, 1], Extrapolation.CLAMP),
  }));

  // Big title: fade + shift up.
  const bigTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 40], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollY.value, [0, 40], [0, -8], Extrapolation.CLAMP) },
    ],
  }));

  // Backdrop tint: invisible at top, ramps in as scroll grows. We layer
  // a slightly-translucent fill behind the blur so the tint comes through
  // in both themes.
  const navFillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [12, 40], [0, 1], Extrapolation.CLAMP),
  }));

  // Hairline rule appears only once collapsed.
  const navRuleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [36, 44], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <View style={{ paddingTop: space.s2 }}>
      {/* Compact nav strip — fixed height, sticky-feeling via z-index. */}
      <View
        style={{
          height: 44,
          paddingHorizontal: space.s4,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'relative',
          zIndex: 2,
        }}
      >
        {/* Tinted backdrop — we fade in a near-opaque fill that picks up
            the theme bg color. iOS would normally use a real material
            blur but RN doesn't ship one and we don't want a hard dep on
            expo-blur. The fill at 88% opacity reads as a frosted lift. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor:
                theme === 'dark' ? 'rgba(10,11,14,0.88)' : 'rgba(251,248,242,0.88)',
            },
            navFillStyle,
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 0.5,
              backgroundColor: colors.rule2,
            },
            navRuleStyle,
          ]}
        />

        {/* Left slot — back button or empty spacer to balance the right. */}
        <View style={{ minWidth: 56, alignItems: 'flex-start' }}>
          {back ? (
            <Pressable
              onPress={back.onPress}
              hitSlop={8}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 1, paddingVertical: 6 }}
              accessibilityRole="button"
              accessibilityLabel={`Back to ${back.label}`}
            >
              <Ionicons name="chevron-back" size={22} color={colors.brand} />
              <Animated.Text
                style={{
                  fontFamily: type.bodyMedium,
                  fontSize: 15,
                  color: colors.brand,
                  letterSpacing: -0.1,
                }}
                numberOfLines={1}
              >
                {back.label}
              </Animated.Text>
            </Pressable>
          ) : null}
        </View>

        <Animated.Text
          numberOfLines={1}
          style={[
            {
              flex: 1,
              textAlign: 'center',
              fontFamily: type.display500,
              fontSize: 16,
              color: colors.ink,
              letterSpacing: -0.1,
            },
            navTitleStyle,
          ]}
        >
          {title}
        </Animated.Text>

        <View style={{ minWidth: 56, alignItems: 'flex-end' }}>
          {rightAccessory}
        </View>
      </View>

      {/* Big title block — sits beneath the nav strip and is what fades. */}
      <Animated.View
        style={[
          { paddingHorizontal: space.s4, paddingTop: space.s2, paddingBottom: space.s3 },
          bigTitleStyle,
        ]}
      >
        {subtitle != null && <Mono>{subtitle}</Mono>}
        <Animated.Text
          style={{
            fontFamily: type.display,
            fontSize: fontSize.h1,
            letterSpacing: -0.5,
            color: colors.ink,
            lineHeight: fontSize.h1 * 1.05,
          }}
        >
          {title}
        </Animated.Text>
      </Animated.View>
    </View>
  );
}
