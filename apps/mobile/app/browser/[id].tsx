/* Browser session — full-screen view of an agent-driven browser.
 *
 * Renders a faithful preview of the calendar booking flow with the
 * agent cursor pulsing over the next click target. The bottom bar
 * shows live status ("Agent driving · 4.2 fps · 0:43") and a Take over
 * CTA that swaps to manual control.
 *
 * This is the deepest interactive surface in the app and the place
 * the user is most likely to want to intervene — make it obvious
 * what the agent is doing and easy to grab the wheel.
 */
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentCursor } from '../../src/components/AgentCursor';
import { LiveDot } from '../../src/components/LiveDot';
import { Mono, Screen } from '../../src/components/primitives';
import { confirm as hapticConfirm } from '../../src/lib/haptics';
import { useTheme } from '../../src/theme/ThemeContext';
import { radius, space, type as fontFamily } from '../../src/theme/tokens';

export default function BrowserSession() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // Agent cursor — gently breathes around the chosen slot, then "clicks"
  // by scaling down briefly before drifting on to the next thought.
  const cursorX = useSharedValue(110);
  const cursorY = useSharedValue(220);
  const cursorScale = useSharedValue(1);

  useEffect(() => {
    cursorX.value = withRepeat(
      withSequence(
        withTiming(102, { duration: 1100, easing: Easing.inOut(Easing.cubic) }),
        withTiming(120, { duration: 1100, easing: Easing.inOut(Easing.cubic) }),
      ),
      -1,
      true,
    );
    cursorY.value = withRepeat(
      withSequence(
        withTiming(215, { duration: 1300, easing: Easing.inOut(Easing.cubic) }),
        withTiming(228, { duration: 1300, easing: Easing.inOut(Easing.cubic) }),
      ),
      -1,
      true,
    );
    cursorScale.value = withRepeat(
      withSequence(
        withTiming(0.92, { duration: 220, easing: Easing.in(Easing.cubic) }),
        withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }),
        withTiming(1, { duration: 1900 }),
      ),
      -1,
      false,
    );
  }, [cursorScale, cursorX, cursorY]);

  const cursorStyle = useAnimatedStyle(() => ({
    left: cursorX.value,
    top: cursorY.value,
    transform: [{ scale: cursorScale.value }],
  }));

  return (
    <Screen style={{ backgroundColor: '#000' }}>
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingHorizontal: space.s2,
          paddingBottom: 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s2,
          backgroundColor: colors.surface,
          borderBottomColor: colors.rule,
          borderBottomWidth: 0.5,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4 }}
        >
          <Ionicons name="chevron-back" size={22} color={colors.brand} />
          <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 15, color: colors.brand }}>
            Thread
          </Text>
        </Pressable>
        <View
          style={{
            flex: 1,
            backgroundColor: colors.surface2,
            borderRadius: radius.pill,
            paddingHorizontal: 10,
            paddingVertical: 5,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            justifyContent: 'center',
          }}
        >
          <Ionicons name="lock-closed" size={10} color={colors.green} />
          <Mono style={{ fontSize: 11, color: colors.mute }} numberOfLines={1}>
            calendly.com/derek-m
          </Mono>
        </View>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="close" size={20} color={colors.mute} />
        </Pressable>
      </View>

      {/* Calendar mock — light cream so the orange cursor pops */}
      <View style={{ flex: 1, backgroundColor: '#FAFAF7', position: 'relative' }}>
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 14,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              gap: 14,
              paddingBottom: 8,
              borderBottomWidth: 1,
              borderBottomColor: '#E5E2DA',
            }}
          >
            <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 11, color: '#111' }}>
              Schedule
            </Text>
            <Text style={{ fontFamily: fontFamily.body, fontSize: 11, color: '#555' }}>
              About
            </Text>
            <Text style={{ fontFamily: fontFamily.body, fontSize: 11, color: '#555' }}>
              Pricing
            </Text>
          </View>
          <Text
            style={{
              fontFamily: fontFamily.display,
              fontSize: 17,
              color: '#111',
              marginTop: 14,
              marginBottom: 4,
              letterSpacing: -0.2,
            }}
          >
            Book time with Derek M.
          </Text>
          <Text style={{ fontFamily: fontFamily.body, fontSize: 12, color: '#666', marginBottom: 14 }}>
            30 min · Eastern Time
          </Text>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 5,
            }}
          >
            {['9:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '1:00', '1:30'].map((t, i) => {
              const on = i === 3;
              return (
                <View
                  key={t}
                  style={{
                    width: '31%',
                    paddingVertical: 9,
                    alignItems: 'center',
                    backgroundColor: on ? '#111' : '#FFFFFF',
                    borderColor: on ? '#111' : '#E2E2DC',
                    borderWidth: 1,
                    borderRadius: 4,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: on ? fontFamily.bodyMedium : fontFamily.body,
                      fontSize: 12,
                      color: on ? '#FFFFFF' : '#111',
                    }}
                  >
                    {t}
                  </Text>
                </View>
              );
            })}
          </View>
          <View
            style={{
              marginTop: 14,
              paddingHorizontal: 16,
              paddingVertical: 10,
              alignItems: 'center',
              borderRadius: 999,
              backgroundColor: '#F38020',
              alignSelf: 'flex-start',
            }}
          >
            <Text style={{ color: '#FFFFFF', fontFamily: fontFamily.bodyMedium, fontSize: 13 }}>
              Confirm 11:00 AM
            </Text>
          </View>
        </View>

        <AgentCursor caption="click 11:00 AM" style={cursorStyle as never} />
      </View>

      {/* Bottom overlay — driving pill + Take over CTA */}
      <View
        style={{
          paddingHorizontal: space.s4,
          paddingTop: space.s3,
          paddingBottom: insets.bottom > 0 ? insets.bottom + space.s3 : space.s5,
          gap: space.s2,
          backgroundColor: colors.bg,
          borderTopColor: colors.rule,
          borderTopWidth: 0.5,
        }}
      >
        <View
          style={{
            alignSelf: 'center',
            backgroundColor: 'rgba(14,15,18,0.92)',
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: radius.pill,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <LiveDot kind="coral" size={6} />
          <Mono style={{ fontSize: 11, color: '#FFFFFF' }}>
            Agent driving · 4.2 fps · 0:43
          </Mono>
        </View>
        <Pressable
          onPress={() => {
            hapticConfirm();
            /* TODO: actually take over the session */
          }}
          style={({ pressed }) => ({
            backgroundColor: pressed ? colors.brand2 : colors.brand,
            paddingVertical: 14,
            borderRadius: radius.r4,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            shadowColor: colors.brand,
            shadowOpacity: 0.35,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
          })}
        >
          <Ionicons name="hand-left-outline" size={16} color="#FFFFFF" />
          <Text
            style={{
              color: '#FFFFFF',
              fontFamily: fontFamily.bodyMedium,
              fontSize: 15,
              letterSpacing: -0.1,
            }}
          >
            Take over
          </Text>
        </Pressable>
        {id && (
          <Mono style={{ alignSelf: 'center', fontSize: 10, color: colors.soft }}>
            session · {id}
          </Mono>
        )}
      </View>
    </Screen>
  );
}
