/* You — profile + agent settings + app settings + sign-out.
 *
 * Layout matches the design handoff:
 *   - Hero profile card (gradient avatar 56px · agent URL · live dot)
 *   - This month spend with mini visualization (number + bar + 3 sub-stats)
 *   - Agent group: Approval mode · Spend cap · Skills · Memory
 *   - App group: Theme picker (opens bottom sheet) · Updates · Face ID
 *   - Sign out (coral text)
 */
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { Card, Chip, Eyebrow, Mono, Screen } from '../src/components/primitives';
import { LargeTitleHeader } from '../src/components/LargeTitleHeader';
import { LiveDot } from '../src/components/LiveDot';
import { TabBar, TAB_BAR_HEIGHT } from '../src/components/TabBar';
import { useSession } from '../src/lib/session-store';
import { tabReTapped } from '../src/lib/events';
import { useTheme } from '../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../src/theme/tokens';
import { selection as hapticSelection } from '../src/lib/haptics';

const AnimatedScrollView = Animated.ScrollView;

export default function You() {
  const router = useRouter();
  const { session, signOut } = useSession();
  const { theme, colors } = useTheme();
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  useEffect(() => {
    return tabReTapped.on((key) => {
      if (key === 'you') {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }
    });
  }, []);

  const agentHost = (session?.agentUrl ?? '').replace(/^https?:\/\//, '');

  return (
    <Screen>
      <LargeTitleHeader
        title="You"
        subtitle="Personal workspace"
        scrollY={scrollY}
      />

      <AnimatedScrollView
        ref={scrollRef as never}
        onScroll={scrollHandler as unknown as (e: NativeSyntheticEvent<NativeScrollEvent>) => void}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: space.s2,
          paddingBottom: TAB_BAR_HEIGHT + space.s5,
          gap: space.s3,
        }}
      >
        {/* Profile card */}
        <View style={{ paddingHorizontal: space.s4 }}>
          <Card style={{ padding: space.s4, flexDirection: 'row', alignItems: 'center', gap: space.s3 }}>
            <LinearGradient
              colors={[colors.brand, colors.coral]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#FFFFFF', fontFamily: fontFamily.display, fontSize: 22 }}>
                {(session?.agentName ?? 'a').slice(0, 1).toUpperCase()}
              </Text>
            </LinearGradient>
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                style={{
                  fontFamily: fontFamily.display500,
                  fontSize: fontSize.h3,
                  color: colors.ink,
                  letterSpacing: -0.2,
                }}
              >
                {session?.agentName ?? 'agent'}
              </Text>
              <Mono numberOfLines={1}>{agentHost || 'agent.openthink.run'}</Mono>
            </View>
            <LiveDot kind="green" size={8} />
          </Card>
        </View>

        {/* Spend visualization */}
        <View style={{ gap: space.s2 }}>
          <SectionTitle>This month</SectionTitle>
          <View style={{ paddingHorizontal: space.s4 }}>
            <Card style={{ padding: space.s4, gap: space.s3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                  <Text
                    style={{
                      fontFamily: fontFamily.display500,
                      fontSize: 28,
                      letterSpacing: -0.6,
                      color: colors.ink,
                    }}
                  >
                    $4.82
                  </Text>
                  <Text style={{ fontFamily: fontFamily.body, fontSize: 13, color: colors.mute }}>spent</Text>
                </View>
                <Mono style={{ fontSize: 12 }}>of $20.00</Mono>
              </View>
              <View style={{ height: 8, backgroundColor: colors.bg2, borderRadius: radius.pill, overflow: 'hidden' }}>
                <LinearGradient
                  colors={[colors.brand, colors.coral]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{ width: '24%', height: '100%' }}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 14 }}>
                <SubStat label="Models" value="$2.40" />
                <SubStat label="Browser" value="$1.20" />
                <SubStat label="Storage" value="$0.80" />
              </View>
            </Card>
          </View>
        </View>

        {/* Agent group */}
        <View style={{ gap: space.s2 }}>
          <SectionTitle>Agent</SectionTitle>
          <View style={{ paddingHorizontal: space.s4 }}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <Row
                tone="brand"
                icon="shield-checkmark-outline"
                label="Approval mode"
                value="Smart auto"
                onPress={() => router.push('/settings/approval-mode' as never)}
              />
              <Row
                tone="coral"
                icon="cash-outline"
                label="Spend cap"
                value="$20/month · hard limit"
                onPress={() => router.push('/settings/spend-cap' as never)}
              />
              <Row
                tone="blue"
                icon="flash-outline"
                label="Skills"
                value="14 enabled · 41 in registry"
                onPress={() => router.push('/settings/skills' as never)}
              />
              <Row
                tone="green"
                icon="bulb-outline"
                label="Memory"
                value="218 facts · 7 pending"
                onPress={() => router.push('/settings/memory' as never)}
                isLast
              />
            </Card>
          </View>
        </View>

        {/* App group */}
        <View style={{ gap: space.s2 }}>
          <SectionTitle>App</SectionTitle>
          <View style={{ paddingHorizontal: space.s4 }}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <Row
                icon={theme === 'dark' ? 'moon-outline' : 'sunny-outline'}
                label="Theme"
                value={theme === 'dark' ? 'Dark' : 'Light'}
                onPress={() => {
                  hapticSelection();
                  router.push('/sheets/theme' as never);
                }}
              />
              <Row
                tone="amber"
                icon="refresh-outline"
                label="Updates"
                value="3 available · 2 safe"
                pill={{ kind: 'coral', text: '3' }}
                onPress={() => router.push('/updates' as never)}
              />
              <Row
                icon="finger-print-outline"
                label="Face ID for approvals"
                switchOn
                isLast
              />
            </Card>
          </View>
        </View>

        <Pressable
          onPress={() => void signOut()}
          style={{ paddingVertical: space.s4, alignSelf: 'center' }}
        >
          <Mono style={{ color: colors.coral }}>Sign out of {session?.agentName ?? 'agent'}</Mono>
        </Pressable>
      </AnimatedScrollView>

      <TabBar
        active="you"
        onNavigate={(href) => router.push(href as never)}
        onCompose={() => router.push('/sheets/new-task' as never)}
      />
    </Screen>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ paddingHorizontal: space.s4, paddingTop: space.s1 }}>
      <Eyebrow>{children}</Eyebrow>
    </View>
  );
}

function SubStat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Mono style={{ fontSize: 11.5 }}>{label}</Mono>
      <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 12, color: colors.ink }}>
        {value}
      </Text>
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  onPress,
  pill,
  tone,
  switchOn,
  isLast,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  pill?: { kind: 'coral' | 'green' | 'amber'; text: string };
  tone?: 'brand' | 'coral' | 'green' | 'amber' | 'blue';
  switchOn?: boolean;
  isLast?: boolean;
}) {
  const { colors } = useTheme();
  const toneMap = {
    brand: { bg: colors.brandSoft, fg: colors.brandInk },
    coral: { bg: colors.coralSoft, fg: colors.coralInk },
    green: { bg: colors.greenSoft, fg: colors.greenInk },
    amber: { bg: colors.amberSoft, fg: colors.amberInk },
    blue: { bg: colors.blueSoft, fg: colors.blueInk },
  } as const;
  const t = tone ? toneMap[tone] : { bg: colors.bg2, fg: colors.mute };
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s3,
        paddingHorizontal: space.s4,
        paddingVertical: space.s3,
        backgroundColor: pressed && onPress ? colors.surface2 : 'transparent',
        borderBottomColor: colors.rule,
        borderBottomWidth: isLast ? 0 : 0.5,
        minHeight: 56,
      })}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 7,
          backgroundColor: t.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={14} color={t.fg} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: fontFamily.bodyMedium,
            fontSize: 14.5,
            color: colors.ink,
            letterSpacing: -0.05,
          }}
        >
          {label}
        </Text>
        {value && <Mono style={{ fontSize: 11.5, marginTop: 1 }}>{value}</Mono>}
      </View>
      {pill && (
        <Chip kind={pill.kind} small>
          {pill.text}
        </Chip>
      )}
      {switchOn !== undefined && (
        <View
          style={{
            width: 36,
            height: 22,
            borderRadius: 11,
            backgroundColor: switchOn ? colors.brand : colors.ruleStrong,
            padding: 2,
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: '#FFFFFF',
              alignSelf: switchOn ? 'flex-end' : 'flex-start',
            }}
          />
        </View>
      )}
      {onPress && switchOn === undefined && !pill && (
        <Ionicons name="chevron-forward" size={16} color={colors.soft} />
      )}
    </Pressable>
  );
}
