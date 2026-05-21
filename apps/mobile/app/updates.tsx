/* Updates — friendly "Sync" screen for non-technical users.
 *
 * Hero card with refresh icon + count + Apply-safe CTA, then a list of
 * available updates. Safe rows get a green Apply chip; updates that
 * touch schemas / require migrations get an amber Review chip.
 */
import { Pressable, ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Mono, Screen } from '../src/components/primitives';
import { LargeTitleHeader } from '../src/components/LargeTitleHeader';
import { useTheme } from '../src/theme/ThemeContext';
import { radius, space, type as fontFamily } from '../src/theme/tokens';

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

const UPDATES = [
  {
    id: '1',
    title: 'Faster browser session startup',
    desc: 'Cuts cold-start ~2s → 400ms',
    safe: true,
  },
  {
    id: '2',
    title: 'Per-tool spend caps',
    desc: 'Cap spend separately per tool',
    safe: true,
  },
  {
    id: '3',
    title: 'Schema · trajectories',
    desc: 'Adds parent_step_id · 1-time migration',
    safe: false,
  },
];

export default function Updates() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  return (
    <Screen>
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingHorizontal: space.s2,
          paddingBottom: space.s1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s2,
          backgroundColor: colors.bg,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4 }}
        >
          <Ionicons name="chevron-back" size={22} color={colors.brand} />
          <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 15, color: colors.brand }}>
            You
          </Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <View style={{ width: 38 }} />
      </View>

      <LargeTitleHeader title="Updates" subtitle="Auto-checked daily" scrollY={scrollY} />

      <AnimatedScrollView
        onScroll={scrollHandler as unknown as (e: NativeSyntheticEvent<NativeScrollEvent>) => void}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: space.s2,
          paddingBottom: space.s10,
          gap: space.s4,
        }}
      >
        {/* Hero card */}
        <View style={{ paddingHorizontal: space.s4 }}>
          <Card style={{ padding: space.s5, gap: space.s3, alignItems: 'center' }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: radius.r3,
                backgroundColor: colors.brandSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="refresh-outline" size={22} color={colors.brand} />
            </View>
            <Text
              style={{
                fontFamily: fontFamily.display500,
                fontSize: 20,
                color: colors.ink,
                letterSpacing: -0.3,
              }}
            >
              3 updates available
            </Text>
            <Mono>2 safe · 1 needs review</Mono>
            <Pressable
              style={({ pressed }) => ({
                marginTop: space.s2,
                width: '100%',
                backgroundColor: pressed ? colors.brand2 : colors.brand,
                paddingVertical: 13,
                borderRadius: radius.r3,
                alignItems: 'center',
              })}
              onPress={() => {/* TODO apply safe */}}
            >
              <Text
                style={{
                  color: '#FFFFFF',
                  fontFamily: fontFamily.bodyMedium,
                  fontSize: 14.5,
                  letterSpacing: -0.1,
                }}
              >
                Apply 2 safe updates
              </Text>
            </Pressable>
          </Card>
        </View>

        {/* Available list */}
        <View style={{ gap: space.s2 }}>
          <View style={{ paddingHorizontal: space.s4 }}>
            <Text
              style={{
                fontFamily: fontFamily.monoMedium,
                fontSize: 11,
                letterSpacing: 1.1,
                textTransform: 'uppercase',
                color: colors.mute,
              }}
            >
              Available
            </Text>
          </View>
          <View style={{ paddingHorizontal: space.s4 }}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {UPDATES.map((u, i) => (
                <View
                  key={u.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.s3,
                    paddingHorizontal: space.s4,
                    paddingVertical: space.s3,
                    borderBottomColor: colors.rule,
                    borderBottomWidth: i === UPDATES.length - 1 ? 0 : 0.5,
                  }}
                >
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 7,
                      backgroundColor: u.safe ? colors.greenSoft : colors.amberSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons
                      name={u.safe ? 'checkmark' : 'information-circle-outline'}
                      size={14}
                      color={u.safe ? colors.greenInk : colors.amberInk}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontFamily: fontFamily.bodyMedium,
                        fontSize: 14,
                        color: colors.ink,
                      }}
                    >
                      {u.title}
                    </Text>
                    <Mono style={{ fontSize: 11.5, marginTop: 1 }}>{u.desc}</Mono>
                  </View>
                  <Pressable
                    style={({ pressed }) => ({
                      paddingHorizontal: 11,
                      paddingVertical: 6,
                      borderRadius: radius.pill,
                      backgroundColor: u.safe ? colors.greenSoft : colors.amberSoft,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Text
                      style={{
                        fontFamily: fontFamily.bodyMedium,
                        fontSize: 12,
                        color: u.safe ? colors.greenInk : colors.amberInk,
                      }}
                    >
                      {u.safe ? 'Apply' : 'Review'}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </Card>
          </View>
        </View>
      </AnimatedScrollView>
    </Screen>
  );
}
