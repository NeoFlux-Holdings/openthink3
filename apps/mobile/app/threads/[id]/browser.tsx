/* Full-bleed browser session — the agent is driving a real browser tab.
 * Top chrome shows back/url/close. Bottom overlay shows the "Take over"
 * button and an animated agent-cursor on top of a Calendly mock.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, Dot, Mono, Screen } from '../../../src/components/primitives';
import { useTheme } from '../../../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../../../src/theme/tokens';

const CURSOR_PATH = [
  { x: 60, y: 100, label: 'reading page' },
  { x: 220, y: 160, label: 'click 11:00am slot' },
  { x: 220, y: 220, label: 'confirm selection' },
  { x: 220, y: 280, label: 'submit booking' },
];

export default function BrowserSession() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const x = useRef(new Animated.Value(CURSOR_PATH[0]!.x)).current;
  const y = useRef(new Animated.Value(CURSOR_PATH[0]!.y)).current;
  const labelIdx = useRef(0);
  const cursorLabel = useRef(CURSOR_PATH[0]!.label);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      labelIdx.current = (labelIdx.current + 1) % CURSOR_PATH.length;
      const target = CURSOR_PATH[labelIdx.current]!;
      cursorLabel.current = target.label;
      Animated.parallel([
        Animated.timing(x, { toValue: target.x, duration: 700, useNativeDriver: false, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
        Animated.timing(y, { toValue: target.y, duration: 700, useNativeDriver: false, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
      ]).start();
      setTimeout(tick, 2200);
    };
    const t = setTimeout(tick, 2200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [x, y]);

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
            <Dot kind="coral" size={6} />
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

        <Animated.View
          style={{
            position: 'absolute',
            left: x,
            top: y,
            pointerEvents: 'none',
          }}
        >
          <View style={{ width: 14, height: 18, alignItems: 'flex-start', justifyContent: 'flex-start' }}>
            <View
              style={{
                width: 0,
                height: 0,
                borderLeftWidth: 6,
                borderRightWidth: 6,
                borderBottomWidth: 12,
                borderStyle: 'solid',
                backgroundColor: 'transparent',
                borderLeftColor: 'transparent',
                borderRightColor: 'transparent',
                borderBottomColor: 'white',
                transform: [{ rotate: '45deg' }],
              }}
            />
          </View>
          <View
            style={{
              position: 'absolute',
              top: 18,
              left: 12,
              backgroundColor: colors.ink,
              paddingHorizontal: 7,
              paddingVertical: 3,
              borderRadius: 4,
            }}
          >
            <Text style={{ color: colors.bg, fontFamily: fontFamily.mono, fontSize: 10.5 }}>
              {cursorLabel.current}
            </Text>
          </View>
        </Animated.View>
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
          <Dot kind="coral" size={6} />
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
