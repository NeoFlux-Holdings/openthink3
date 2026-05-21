/* Settings detail — pushed screens from the You tab.
 *
 * One file, switches on `key` query param:
 *   approval-mode → radio list (Full auto / Smart auto / Manual)
 *   spend-cap     → input + bar + reset cadence
 *   skills        → toggle list of enabled skills + chip "open registry"
 *   memory        → preview of recent entries · open in browser
 *
 * Mobile is a remote control for these settings; consequential edits
 * happen in the web shell. The detail screens here are read-mostly with
 * the simplest set of toggles needed to be useful on the go.
 */
import { Pressable, ScrollView, Switch, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';

import { Card, Mono, Screen } from '../../src/components/primitives';
import { LargeTitleHeader } from '../../src/components/LargeTitleHeader';
import { useSession } from '../../src/lib/session-store';
import { useTheme } from '../../src/theme/ThemeContext';
import { radius, space, type as fontFamily } from '../../src/theme/tokens';
import { selection as hapticSelection } from '../../src/lib/haptics';

const AnimatedScrollView = Animated.ScrollView;

const TITLES: Record<string, string> = {
  'approval-mode': 'Approval mode',
  'spend-cap': 'Spend cap',
  skills: 'Skills',
  memory: 'Memory',
};

export default function SettingsDetail() {
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const { colors } = useTheme();
  const { session } = useSession();
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);

  const title = TITLES[key ?? ''] ?? 'Setting';

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

      <LargeTitleHeader title={title} scrollY={scrollY} />

      <AnimatedScrollView
        onScroll={scrollHandler as unknown as (e: NativeSyntheticEvent<NativeScrollEvent>) => void}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: space.s2,
          paddingBottom: space.s10,
          paddingHorizontal: space.s4,
          gap: space.s3,
        }}
      >
        {key === 'approval-mode' && <ApprovalModeView />}
        {key === 'spend-cap' && <SpendCapView />}
        {key === 'skills' && <SkillsView />}
        {key === 'memory' && <MemoryView />}

        {/* Footer — link out to web for the full picture */}
        <Pressable
          onPress={() => session && Linking.openURL(`${session.agentUrl}/#/settings`)}
          style={({ pressed }) => ({
            marginTop: space.s4,
            paddingVertical: space.s3,
            paddingHorizontal: space.s4,
            backgroundColor: pressed ? colors.surface2 : 'transparent',
            borderRadius: radius.r3,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          })}
        >
          <Ionicons name="open-outline" size={14} color={colors.brand} />
          <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 13, color: colors.brand }}>
            Open in browser
          </Text>
        </Pressable>
      </AnimatedScrollView>
    </Screen>
  );
}

/* --- Approval mode --- */

function ApprovalModeView() {
  const { colors } = useTheme();
  const [mode, setMode] = useState<'full' | 'smart' | 'manual'>('smart');
  const opts = [
    { k: 'full' as const, n: 'Full auto', d: 'Agent acts without asking — fastest, riskiest.' },
    { k: 'smart' as const, n: 'Smart auto', d: 'Asks before consequential actions (send, spend > cap, delete).' },
    { k: 'manual' as const, n: 'Manual', d: 'Every tool call asks first — safest, slowest.' },
  ];
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {opts.map((o, i) => {
        const on = o.k === mode;
        return (
          <Pressable
            key={o.k}
            onPress={() => {
              hapticSelection();
              setMode(o.k);
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s3,
              paddingHorizontal: space.s4,
              paddingVertical: space.s3,
              backgroundColor: pressed ? colors.surface2 : 'transparent',
              borderBottomColor: colors.rule,
              borderBottomWidth: i === opts.length - 1 ? 0 : 0.5,
              minHeight: 56,
            })}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                borderWidth: on ? 2 : 1.5,
                borderColor: on ? colors.brand : colors.rule2,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {on && (
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: colors.brand,
                  }}
                />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 15, color: colors.ink }}>
                {o.n}
              </Text>
              <Mono style={{ fontSize: 11.5, marginTop: 2 }}>{o.d}</Mono>
            </View>
          </Pressable>
        );
      })}
    </Card>
  );
}

/* --- Spend cap --- */

function SpendCapView() {
  const { colors } = useTheme();
  const [cap, setCap] = useState(20);
  return (
    <View style={{ gap: space.s3 }}>
      <Card style={{ padding: space.s4, gap: space.s3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            <Text
              style={{
                fontFamily: fontFamily.display500,
                fontSize: 36,
                letterSpacing: -0.8,
                color: colors.ink,
              }}
            >
              ${cap}
            </Text>
            <Mono style={{ fontSize: 13 }}>/ month</Mono>
          </View>
          <Mono>spent so far: $4.82</Mono>
        </View>
        <View style={{ height: 8, backgroundColor: colors.bg2, borderRadius: radius.pill, overflow: 'hidden' }}>
          <View style={{ width: '24%', height: '100%', backgroundColor: colors.brand }} />
        </View>
        <Mono>Resets on the 1st · hard limit (agent pauses when reached)</Mono>
      </Card>

      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {[5, 10, 20, 50, 100].map((v) => {
          const on = v === cap;
          return (
            <Pressable
              key={v}
              onPress={() => {
                hapticSelection();
                setCap(v);
              }}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: radius.pill,
                backgroundColor: on ? colors.ink : colors.surface,
                borderWidth: 1,
                borderColor: on ? colors.ink : colors.rule,
              }}
            >
              <Text
                style={{
                  fontFamily: fontFamily.bodyMedium,
                  fontSize: 13,
                  color: on ? colors.bg : colors.ink2,
                }}
              >
                ${v}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* --- Skills --- */

function SkillsView() {
  const { colors } = useTheme();
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    'send-email': true,
    'browser': true,
    'calendar': true,
    'crm-query': true,
    'doc-edit': true,
    'invoice-ocr': false,
  });
  const SKILLS = [
    { k: 'send-email', n: 'Send email', d: 'gmail, hello@', tone: 'coral' },
    { k: 'browser', n: 'Web browser', d: 'navigate, click, fill, screenshot', tone: 'brand' },
    { k: 'calendar', n: 'Calendar', d: 'read + draft invites', tone: 'blue' },
    { k: 'crm-query', n: 'CRM query', d: 'attio, hubspot', tone: 'green' },
    { k: 'doc-edit', n: 'Document edit', d: 'notion, google docs', tone: 'amber' },
    { k: 'invoice-ocr', n: 'Invoice OCR', d: 'community · 4★', tone: 'blue' },
  ] as const;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {SKILLS.map((s, i) => {
        const on = enabled[s.k] ?? false;
        const toneMap = {
          brand: { bg: colors.brandSoft, fg: colors.brandInk },
          coral: { bg: colors.coralSoft, fg: colors.coralInk },
          green: { bg: colors.greenSoft, fg: colors.greenInk },
          amber: { bg: colors.amberSoft, fg: colors.amberInk },
          blue: { bg: colors.blueSoft, fg: colors.blueInk },
        } as const;
        const t = toneMap[s.tone];
        return (
          <View
            key={s.k}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s3,
              paddingHorizontal: space.s4,
              paddingVertical: space.s3,
              borderBottomColor: colors.rule,
              borderBottomWidth: i === SKILLS.length - 1 ? 0 : 0.5,
              minHeight: 56,
            }}
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
              <Ionicons name="flash-outline" size={14} color={t.fg} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 14, color: colors.ink }}>
                {s.n}
              </Text>
              <Mono style={{ fontSize: 11.5, marginTop: 1 }}>{s.d}</Mono>
            </View>
            <Switch
              value={on}
              onValueChange={(next) => {
                hapticSelection();
                setEnabled((prev) => ({ ...prev, [s.k]: next }));
              }}
              trackColor={{ false: colors.rule2, true: colors.brand }}
              thumbColor="#FFFFFF"
            />
          </View>
        );
      })}
    </Card>
  );
}

/* --- Memory --- */

function MemoryView() {
  const { colors } = useTheme();
  const ENTRIES = [
    { t: 'Prefers async over sync for status updates', src: 'thread:onboarding-redesign', age: '3d' },
    { t: 'Calls live customer calls "deep dives", not "interviews"', src: 'thread:q3', age: '5h' },
    { t: 'Lives in CA · prefers Pacific time slots', src: 'thread:lunch', age: '2w' },
    { t: 'Uses Geist over Inter — strong opinion', src: 'thread:redesign', age: '3d' },
  ];
  return (
    <View style={{ gap: space.s3 }}>
      <Card style={{ padding: space.s4, gap: space.s2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Text
            style={{
              fontFamily: fontFamily.display500,
              fontSize: 24,
              letterSpacing: -0.4,
              color: colors.ink,
            }}
          >
            218 facts
          </Text>
          <Mono>7 pending review</Mono>
        </View>
      </Card>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {ENTRIES.map((e, i) => (
          <View
            key={i}
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: space.s3,
              paddingHorizontal: space.s4,
              paddingVertical: space.s3,
              borderBottomColor: colors.rule,
              borderBottomWidth: i === ENTRIES.length - 1 ? 0 : 0.5,
            }}
          >
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                backgroundColor: colors.greenSoft,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 2,
              }}
            >
              <Ionicons name="bulb-outline" size={13} color={colors.greenInk} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fontFamily.body, fontSize: 13.5, color: colors.ink, lineHeight: 19 }}>
                {e.t}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                <Mono style={{ fontSize: 11 }}>{e.src}</Mono>
                <Mono style={{ fontSize: 11, color: colors.soft }}>· {e.age}</Mono>
              </View>
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}
