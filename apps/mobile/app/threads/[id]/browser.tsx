/* Full-bleed browser session — the agent is driving a real browser tab.
 * Top chrome shows back/url/close. Bottom overlay shows the "Take over"
 * button and an animated agent-cursor (real SVG path with brand-orange
 * drop shadow) on top of a Calendly mock.
 *
 * Cursor + halos run on Reanimated 4 shared values so the JS thread stays
 * free for scrolling + composer typing.
 */
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentCursor } from '../../../src/components/AgentCursor';
import { LiveDot } from '../../../src/components/LiveDot';
import { Mono, Screen } from '../../../src/components/primitives';
import { useTheme } from '../../../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../../../src/theme/tokens';

const PATH = [
  { x: 60, y: 100, caption: 'reading page' },
  { x: 220, y: 160, caption: 'click 11:00am slot' },
  { x: 220, y: 220, caption: 'confirm selection' },
  { x: 220, y: 280, caption: 'submit booking' },
];

export default function BrowserSession() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const x = useSharedValue(PATH[0]!.x);
  const y = useSharedValue(PATH[0]!.y);

  // Caption lives on the JS thread (it's plain text, not a transform), so we
  // mirror its value into React state from the worklet via runOnJS.
  const captionShared = useSharedValue('reading page');
  const setCaption = (text: string) => {
    captionShared.value = text;
  };

  useEffect(() => {
    let i = 0;
    const tick = () => {
      i = (i + 1) % PATH.length;
      const next = PATH[i]!;
      x.value = withTiming(next.x, { duration: 700, easing: Easing.bezier(0.4, 0, 0.2, 1) });
      y.value = withTiming(next.y, { duration: 700, easing: Easing.bezier(0.4, 0, 0.2, 1) });
      runOnJS(setCaption)(next.caption);
    };
    const handle = setInterval(tick, 2200);
    return () => clearInterval(handle);
  }, [x, y, captionShared]);

  const cursorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  return (
    <Screen style={{ backgroundColor: colors.surface }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingTop: insets.top + space.s2,
          paddingHorizontal: space.s4,
          paddingBottom: space.s2,
          backgroundColor: colors.surface,
          borderBottomColor: colors.rule,
          borderBottomWidth: 1,
          gap: space.s2,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <View
          style={{
            flex: 1,
            height: 30,
            paddingHorizontal: space.s3,
            backgroundColor: colors.surface2,
            borderRadius: radius.pill,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.s2,
            borderColor: colors.rule,
            borderWidth: 1,
          }}
        >
          <Ionicons name="lock-closed" size={11} color={colors.green} />
          <Text style={{ fontFamily: fontFamily.mono, color: colors.mute, fontSize: 11.5 }} numberOfLines={1}>
            calendly.com/derek-m
          </Text>
          <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <LiveDot kind="coral" size={6} />
            <Text style={{ fontFamily: fontFamily.mono, color: colors.coralInk, fontSize: 10.5 }}>4.2 fps</Text>
          </View>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close-outline" size={24} color={colors.mute} />
        </Pressable>
      </View>

      <View style={{ flex: 1, backgroundColor: '#FAFAF7', padding: space.s5 }}>
        <Text style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Schedule · About · Pricing · Help</Text>
        <Text style={{ fontSize: 22, fontFamily: fontFamily.bodyMedium, color: '#111', marginBottom: 4 }}>
          Book time with Derek Mason
        </Text>
        <Text style={{ fontSize: 12.5, color: '#666', marginBottom: 16 }}>Engineering lead. Loves talking infra.</Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {['9:30', '10:00', '10:30', '11:00', '11:30', '12:00'].map((t, i) => {
            const selected = i === 3;
            return (
              <View
                key={t}
                style={{
                  width: '32%',
                  paddingVertical: 9,
                  alignItems: 'center',
                  backgroundColor: selected ? '#111' : 'white',
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: selected ? '#111' : '#E2E2DC',
                }}
              >
                <Text style={{ color: selected ? 'white' : '#111', fontFamily: fontFamily.body, fontSize: 12 }}>
                  {t} AM
                </Text>
              </View>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.brand, borderRadius: radius.pill }}>
            <Text style={{ color: 'white', fontFamily: fontFamily.bodyMedium, fontSize: 12 }}>
              Confirm 11:00 AM
            </Text>
          </View>
        </View>

        <AgentCursor style={cursorStyle} caption={PATH[0]!.caption} />
      </View>

      <View
        style={{
          position: 'absolute',
          bottom: insets.bottom + space.s4,
          left: space.s4,
          right: space.s4,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s3,
        }}
      >
        <View
          style={{
            paddingHorizontal: space.s3,
            paddingVertical: space.s2,
            borderRadius: radius.pill,
            backgroundColor: 'rgba(14,15,18,0.92)',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <LiveDot kind="coral" size={6} />
          <Text style={{ color: '#F2F3F6', fontFamily: fontFamily.mono, fontSize: 11 }}>
            agent driving · 0:43
          </Text>
        </View>
        <Pressable
          style={{
            flex: 1,
            paddingHorizontal: space.s4,
            paddingVertical: space.s3,
            borderRadius: radius.pill,
            backgroundColor: colors.brand,
            alignItems: 'center',
          }}
          onPress={() => router.back()}
        >
          <Text style={{ color: 'white', fontFamily: fontFamily.bodyMedium, fontSize: fontSize.body }}>
            ↑ Take over
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}
