/* Today — landing screen for the mobile app.
 *
 * Lays out vertically:
 *   LargeTitleHeader (collapses on scroll)
 *   Live activity card (big — embeds a MiniBrowserThumb preview)
 *   Approvals (inline cards with Skip / Review actions)
 *   Today's spend bar
 *   Recent threads (SwipeRow rows: Pin left, Archive right)
 *
 * Re-tapping the Today tab scrolls back to the top — same convention as
 * iOS apps. The scrolled-Y is held in a Reanimated shared value so the
 * LargeTitleHeader collapses on the UI thread (no React churn).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Avatar, Body, Card, Eyebrow, Mono, Screen } from '../src/components/primitives';
import { LargeTitleHeader } from '../src/components/LargeTitleHeader';
import { LiveDot } from '../src/components/LiveDot';
import { MiniBrowserThumb } from '../src/components/MiniBrowserThumb';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { SkeletonRow } from '../src/components/Skeleton';
import { SwipeRow } from '../src/components/SwipeRow';
import { TabBar, TAB_BAR_HEIGHT } from '../src/components/TabBar';
import { getToday, type Approval, type TodayState } from '../src/lib/api';
import { useSession } from '../src/lib/session-store';
import { tabReTapped } from '../src/lib/events';
import { registerForPush } from '../src/lib/notifications';
import { useTheme } from '../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../src/theme/tokens';

const AnimatedScrollView = Animated.ScrollView;

const FALLBACK: TodayState = {
  greeting: 'Tuesday, May 20',
  agentName: 'agent',
  liveTask: {
    threadId: 'q3',
    title: 'Q3 launch + book 3 customer calls',
    statusLine: 'browsing calendly.com/derek-m',
    spent: 0.04,
    elapsed: '2:14',
    toolsUsed: 5,
  },
  approvals: [
    {
      id: 'a1',
      threadId: 'q3',
      kind: 'send',
      title: 'Send email to Sarah Cohen',
      body: '"Hi Sarah — we’re shipping Q3 in 3 weeks. Could I grab 20 min Thursday…"',
      meta: 'tilt.com · launch outreach draft',
      costUsd: 0.001,
      createdAt: Date.now() - 1000 * 60 * 4,
    },
    {
      id: 'a2',
      threadId: 'q3',
      kind: 'spend',
      title: 'Spend cap warning',
      body: 'Approve raising today’s browser budget from $1 → $5 to finish booking Priya.',
      meta: 'browser session · ~$0.40 next step',
      createdAt: Date.now() - 1000 * 60 * 60,
    },
  ],
  spend: { today: 2.18, cap: 20.0 },
  recentThreads: [
    { id: 'q3', title: 'Q3 launch plan', updatedAt: Date.now(), live: true },
    { id: 'redesign', title: 'Compress onboarding to 60s', updatedAt: Date.now() - 1000 * 60 * 60 * 3 },
    { id: 'compete', title: 'Cursor competitive teardown', updatedAt: Date.now() - 1000 * 60 * 60 * 27 },
  ],
};

export default function Today() {
  const router = useRouter();
  const { session } = useSession();
  const { colors } = useTheme();
  const [state, setState] = useState<TodayState>(FALLBACK);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const scrollRef = useRef<ScrollView | null>(null);

  // Shared scroll-Y for the LargeTitleHeader animation.
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  useEffect(() => {
    return tabReTapped.on((key) => {
      if (key === 'today') {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }
    });
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const data = await getToday(session);
      setState(data);
      setOnline(true);
    } catch {
      setOnline(false);
    } finally {
      setLoaded(true);
    }
  }, [session]);

  useEffect(() => {
    void load();
    if (session) void registerForPush(session);
  }, [load, session]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <Screen>
      <OfflineBanner online={online} onRetry={() => void load()} />

      <LargeTitleHeader
        title="Today"
        subtitle={state.greeting}
        scrollY={scrollY}
        rightAccessory={
          <Pressable onPress={() => router.push('/you')} accessibilityLabel="Your account">
            <Avatar name={state.agentName} size={32} />
          </Pressable>
        }
      />

      <AnimatedScrollView
        ref={scrollRef as never}
        onScroll={scrollHandler as unknown as (e: NativeSyntheticEvent<NativeScrollEvent>) => void}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingHorizontal: 0,
          paddingTop: space.s2,
          paddingBottom: TAB_BAR_HEIGHT + space.s5,
          gap: space.s4,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
      >
        {!loaded ? (
          <View style={{ paddingHorizontal: space.s4 }}>
            <SkeletonRow lines={4} />
          </View>
        ) : state.liveTask ? (
          <LiveTaskCard
            task={state.liveTask}
            onOpen={() => router.push(`/threads/${state.liveTask!.threadId}`)}
            onOpenBrowser={() => router.push(`/browser/${state.liveTask!.threadId}` as never)}
          />
        ) : null}

        {state.approvals.length > 0 && (
          <View style={{ gap: space.s2 }}>
            <SectionTitle right="See all" onRight={() => router.push('/approvals' as never)}>
              Needs your approval · {state.approvals.length}
            </SectionTitle>
            {state.approvals.map((a) => (
              <ApprovalRow
                key={a.id}
                approval={a}
                onPress={() => router.push({ pathname: '/sheets/approval', params: { id: a.id } })}
              />
            ))}
          </View>
        )}

        <View style={{ gap: space.s2 }}>
          <SectionTitle>Today&apos;s spend</SectionTitle>
          <SpendCard today={state.spend.today} cap={state.spend.cap} />
        </View>

        <View style={{ gap: space.s2 }}>
          <SectionTitle right="All threads" onRight={() => router.push('/threads')}>
            Recent
          </SectionTitle>
          {!loaded
            ? Array.from({ length: 3 }).map((_, i) => (
                <View key={`s-${i}`} style={{ paddingHorizontal: space.s4 }}>
                  <SkeletonRow lines={2} />
                </View>
              ))
            : state.recentThreads.slice(0, 5).map((t) => (
                <SwipeRow
                  key={t.id}
                  right={{ icon: 'archive-outline', label: 'Archive', tone: 'archive' }}
                  onRight={() => {/* TODO: optimistically archive */}}
                >
                  <Pressable
                    onPress={() => router.push(`/threads/${t.id}`)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.s3,
                      paddingVertical: space.s3,
                      paddingHorizontal: space.s4,
                      backgroundColor: pressed ? colors.surface2 : colors.surface,
                      borderColor: colors.rule,
                      borderTopWidth: 0.5,
                      borderBottomWidth: 0.5,
                    })}
                  >
                    <View
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        backgroundColor: t.live ? colors.coralSoft : colors.brandSoft,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons
                        name="git-branch-outline"
                        size={14}
                        color={t.live ? colors.coralInk : colors.brandInk}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {t.live && <LiveDot kind="coral" size={6} />}
                        <Text
                          style={{
                            flex: 1,
                            fontFamily: fontFamily.bodyMedium,
                            fontSize: fontSize.body,
                            color: colors.ink,
                          }}
                          numberOfLines={1}
                        >
                          {t.title}
                        </Text>
                      </View>
                      <Mono style={{ fontSize: 11.5 }}>
                        {t.live ? 'browsing calendly · 2m ago' : formatRelative(t.updatedAt)}
                      </Mono>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.soft} />
                  </Pressable>
                </SwipeRow>
              ))}
        </View>

        {loaded && state.recentThreads.length === 0 && (
          <View style={{ alignItems: 'center', paddingVertical: space.s7, gap: space.s2 }}>
            <Ionicons name="leaf-outline" size={28} color={colors.soft} />
            <Body style={{ color: colors.mute, textAlign: 'center' }}>
              No threads yet — tap the orange button to start one.
            </Body>
          </View>
        )}
      </AnimatedScrollView>

      <TabBar
        active="today"
        onNavigate={(href) => router.push(href as never)}
        onCompose={() => router.push('/sheets/new-task' as never)}
      />
    </Screen>
  );
}

/* ---------- Subcomponents ---------- */

function SectionTitle({
  children,
  right,
  onRight,
}: {
  children: React.ReactNode;
  right?: string;
  onRight?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        paddingHorizontal: space.s4,
        paddingTop: space.s1,
      }}
    >
      <Eyebrow>{children}</Eyebrow>
      {right && (
        <Pressable onPress={onRight}>
          <Text
            style={{
              fontFamily: fontFamily.bodyMedium,
              fontSize: 12.5,
              color: colors.brand,
            }}
          >
            {right}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function LiveTaskCard({
  task,
  onOpen,
  onOpenBrowser,
}: {
  task: NonNullable<TodayState['liveTask']>;
  onOpen: () => void;
  onOpenBrowser: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onOpen} style={{ paddingHorizontal: space.s4 }}>
      <Card style={{ padding: 0, overflow: 'hidden', borderRadius: radius.r5 }}>
        {/* soft brand wash behind */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.brandSoft,
            opacity: 0.55,
          }}
        />

        <View style={{ paddingHorizontal: space.s4, paddingTop: space.s4, paddingBottom: space.s2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2 }}>
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  backgroundColor: colors.brand,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="flash" size={14} color="#FFF" />
              </View>
              <Text style={{ fontFamily: fontFamily.body, fontSize: 13, color: colors.mute }}>
                <Text style={{ fontFamily: fontFamily.bodyMedium, color: colors.ink }}>flannel-arroyo</Text> is working
              </Text>
            </View>
            <LiveDot kind="coral" size={8} />
          </View>
          <Text
            style={{
              marginTop: space.s2,
              fontFamily: fontFamily.display500,
              fontSize: fontSize.h3,
              letterSpacing: -0.2,
              color: colors.ink,
              lineHeight: fontSize.h3 * 1.3,
            }}
          >
            {task.title}
          </Text>
          <View
            style={{
              marginTop: space.s2,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s2,
            }}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                borderWidth: 1.5,
                borderColor: colors.ruleStrong,
                borderTopColor: colors.brand,
              }}
            />
            <Text
              style={{ flex: 1, fontFamily: fontFamily.body, fontSize: 13, color: colors.mute }}
              numberOfLines={1}
            >
              {task.statusLine}
            </Text>
          </View>
        </View>

        <Pressable onPress={onOpenBrowser} style={{ paddingHorizontal: space.s4, paddingBottom: space.s3 }}>
          <View
            style={{
              height: 110,
              borderRadius: radius.r3,
              overflow: 'hidden',
              borderColor: colors.rule,
              borderWidth: 1,
              backgroundColor: colors.bg2,
            }}
          >
            <MiniBrowserThumb />
          </View>
        </Pressable>

        <View
          style={{
            flexDirection: 'row',
            borderTopWidth: 1,
            borderTopColor: colors.rule,
            backgroundColor: colors.surface,
          }}
        >
          <Stat label="spent" value={`$${task.spent.toFixed(2)}`} />
          <View style={{ width: 1, backgroundColor: colors.rule }} />
          <Stat label="elapsed" value={task.elapsed} />
          <View style={{ width: 1, backgroundColor: colors.rule }} />
          <Stat label="tools" value={`${task.toolsUsed}`} />
        </View>
      </Card>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 10 }}>
      <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 15, color: colors.ink }}>
        {value}
      </Text>
      <Mono style={{ fontSize: 10.5, marginTop: 2 }}>{label}</Mono>
    </View>
  );
}

function ApprovalRow({ approval, onPress }: { approval: Approval; onPress: () => void }) {
  const { colors } = useTheme();
  const isCoral = approval.kind === 'send' || approval.kind === 'tool';
  const tint = isCoral ? colors.coralSoft : colors.amberSoft;
  const accent = isCoral ? colors.coral : colors.amber;
  const ink = isCoral ? colors.coralInk : colors.amberInk;
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: space.s4 }}>
      <View
        style={{
          backgroundColor: isCoral ? tint : colors.surface,
          borderColor: isCoral ? 'transparent' : colors.brandSoft2,
          borderWidth: 1.5,
          borderRadius: radius.r4,
          overflow: 'hidden',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2, padding: space.s3, paddingBottom: 8 }}>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 9,
              backgroundColor: accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name={isCoral ? 'mail-outline' : 'cash-outline'}
              size={14}
              color="#FFF"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: fontSize.body, color: ink }}>
              {approval.title}
            </Text>
            {approval.meta && <Mono style={{ marginTop: 1, color: ink, opacity: 0.65 }}>{approval.meta}</Mono>}
          </View>
        </View>
        {approval.body && (
          <Text
            style={{
              paddingHorizontal: space.s3,
              paddingBottom: space.s3,
              fontFamily: fontFamily.body,
              fontSize: 13,
              lineHeight: 19,
              color: ink,
            }}
            numberOfLines={2}
          >
            {approval.body}
          </Text>
        )}
        <View
          style={{
            flexDirection: 'row',
            borderTopWidth: 1,
            borderTopColor: 'rgba(0,0,0,0.05)',
          }}
        >
          <Pressable
            onPress={() => {/* skip handled in sheet */}}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 12,
              alignItems: 'center',
              backgroundColor: pressed ? 'rgba(0,0,0,0.04)' : 'transparent',
            })}
          >
            <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 14, color: colors.mute }}>
              Skip
            </Text>
          </Pressable>
          <View style={{ width: 1, backgroundColor: 'rgba(0,0,0,0.05)' }} />
          <Pressable
            onPress={onPress}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 12,
              alignItems: 'center',
              backgroundColor: pressed ? 'rgba(0,0,0,0.04)' : 'transparent',
            })}
          >
            <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 14, color: accent }}>
              Review →
            </Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

function SpendCard({ today, cap }: { today: number; cap: number }) {
  const { colors } = useTheme();
  const pct = Math.max(0.02, Math.min(1, today / cap));
  return (
    <View style={{ paddingHorizontal: space.s4 }}>
      <Card style={{ padding: space.s4, gap: space.s2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 13, color: colors.ink2 }}>
            Across 3 threads
          </Text>
          <Text style={{ fontFamily: fontFamily.mono, fontSize: 13, color: colors.mute }}>
            <Text style={{ fontFamily: fontFamily.monoMedium, color: colors.ink }}>${today.toFixed(2)}</Text> / ${cap.toFixed(2)}
          </Text>
        </View>
        <View style={{ height: 6, backgroundColor: colors.bg2, borderRadius: radius.pill, overflow: 'hidden' }}>
          <View
            style={{
              width: `${pct * 100}%`,
              height: '100%',
              backgroundColor: pct > 0.85 ? colors.coral : colors.brand,
            }}
          />
        </View>
      </Card>
    </View>
  );
}

function formatRelative(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 24 * 3600_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}
