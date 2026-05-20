/* Today — landing screen for the mobile app.
 *
 * Greeting · live activity card · approvals stack · spend bar · recent threads.
 * The five elements stack vertically with the bottom tab bar pinned below.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Avatar, Body, Card, Chip, Dot, Eyebrow, H1, Mono, Screen } from '../src/components/primitives';
import { LiveDot } from '../src/components/LiveDot';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { SkeletonRow } from '../src/components/Skeleton';
import { TabBar, TAB_BAR_HEIGHT } from '../src/components/TabBar';
import { getToday, type Approval, type TodayState } from '../src/lib/api';
import { useSession } from '../src/lib/session-store';
import { tabReTapped } from '../src/lib/events';
import { registerForPush } from '../src/lib/notifications';
import { useTheme } from '../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../src/theme/tokens';

const FALLBACK: TodayState = {
  greeting: 'Good morning',
  agentName: 'agent',
  liveTask: {
    threadId: 'q3',
    title: 'Q3 launch + book 3 customer calls',
    statusLine: 'browsing calendly.com/derek-m · selecting slot',
    spent: 0.04,
    elapsed: '2:31',
    toolsUsed: 5,
  },
  approvals: [
    {
      id: 'a1',
      threadId: 'q3',
      kind: 'send',
      title: 'Send email to Sarah Cohen',
      body: 'Confirming Thursday 2pm. Looking forward to talking through the launch plan.',
      meta: 'sarah@tilt.com · ~$0.001 to send',
      costUsd: 0.001,
      createdAt: Date.now() - 1000 * 60 * 4,
    },
    {
      id: 'a2',
      threadId: 'taxes',
      kind: 'spend',
      title: 'Spend cap warning',
      body: '$1.71 of $5.00 daily cap used. The agent will ask before exceeding.',
      meta: 'today',
      createdAt: Date.now() - 1000 * 60 * 60,
    },
  ],
  spend: { today: 1.71, cap: 5.0 },
  recentThreads: [
    { id: 'q3', title: 'Q3 launch + customer calls', updatedAt: Date.now(), live: true },
    { id: 'redesign', title: 'Compress onboarding to 60s', updatedAt: Date.now() - 1000 * 60 * 60 * 3 },
    { id: 'compete', title: 'Cursor competitive teardown', updatedAt: Date.now() - 1000 * 60 * 60 * 27 },
  ],
};

export default function Today() {
  const router = useRouter();
  const { session, signOut } = useSession();
  const { colors } = useTheme();
  const [state, setState] = useState<TodayState>(FALLBACK);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const scrollRef = useRef<ScrollView | null>(null);

  // Scroll-to-top when the user re-taps the Today tab. Standard iOS pattern;
  // we mirror it on Android too. Event emits from TabBar.tsx.
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
      // First-launch backend not yet wired — fall back to the design fixture
      // so the screen still has something to render. Surface the offline
      // banner so the user knows we're showing cached data.
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
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: space.s5, paddingTop: space.s8, paddingBottom: TAB_BAR_HEIGHT + space.s5, gap: space.s5 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Mono>{state.greeting}</Mono>
            <H1>Today</H1>
          </View>
          <Pressable
            onPress={() => router.push('/you')}
            accessibilityLabel="Your account"
          >
            <Avatar name={state.agentName} size={36} />
          </Pressable>
        </View>

        {!loaded ? (
          <SkeletonRow lines={4} />
        ) : state.liveTask ? (
          <LiveTaskCard task={state.liveTask} onOpen={() => router.push(`/threads/${state.liveTask!.threadId}`)} />
        ) : null}

        {state.approvals.length > 0 && (
          <View style={{ gap: space.s2 }}>
            <Eyebrow>{state.approvals.length} approval{state.approvals.length === 1 ? '' : 's'}</Eyebrow>
            {state.approvals.map((a) => (
              <ApprovalRow key={a.id} approval={a} onPress={() => router.push({ pathname: '/sheets/approval', params: { id: a.id } })} />
            ))}
          </View>
        )}

        <SpendCard today={state.spend.today} cap={state.spend.cap} />

        <View style={{ gap: space.s2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Eyebrow>Recent threads</Eyebrow>
            <Pressable onPress={() => router.push('/threads')}>
              <Text style={{ fontFamily: fontFamily.mono, color: colors.mute, fontSize: 11.5 }}>see all →</Text>
            </Pressable>
          </View>
          {!loaded
            ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={`s-${i}`} lines={2} />)
            : state.recentThreads.slice(0, 5).map((t) => (
            <Pressable
              key={t.id}
              onPress={() => router.push(`/threads/${t.id}`)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.s3,
                paddingVertical: space.s3,
                paddingHorizontal: space.s4,
                borderRadius: radius.r3,
                backgroundColor: colors.surface,
                borderColor: colors.rule,
                borderWidth: 1,
              }}
            >
              {t.live ? <LiveDot kind="coral" size={7} /> : <Dot kind="idle" size={7} />}
              <Text style={{ flex: 1, fontFamily: fontFamily.bodyMedium, fontSize: fontSize.body, color: colors.ink }} numberOfLines={1}>
                {t.title}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.soft} />
            </Pressable>
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

        <Pressable
          onPress={() => void signOut()}
          style={{ alignSelf: 'center', paddingVertical: space.s3 }}
        >
          <Mono>Sign out</Mono>
        </Pressable>
      </ScrollView>

      <TabBar active="today" onNavigate={(href) => router.push(href as any)} onCompose={() => router.push('/sheets/new-task' as any)} />
    </Screen>
  );
}

function LiveTaskCard({ task, onOpen }: { task: NonNullable<TodayState['liveTask']>; onOpen: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onOpen}>
      <Card style={{ padding: space.s5, gap: space.s3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2 }}>
          <LiveDot kind="coral" size={8} />
          <Text style={{ fontFamily: fontFamily.bodyMedium, color: colors.coralInk, fontSize: 12 }}>Live</Text>
          <Text style={{ marginLeft: 'auto', fontFamily: fontFamily.mono, color: colors.mute, fontSize: 11 }}>
            {task.elapsed}
          </Text>
        </View>
        <Text style={{ fontFamily: fontFamily.display500, fontSize: fontSize.h3, color: colors.ink, letterSpacing: -0.2 }}>
          {task.title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2, backgroundColor: colors.surface2, paddingHorizontal: space.s3, paddingVertical: space.s2, borderRadius: radius.pill, borderColor: colors.rule, borderWidth: 1 }}>
          <View style={{ width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: colors.brand, borderTopColor: 'transparent' }} />
          <Text style={{ flex: 1, fontFamily: fontFamily.mono, fontSize: 12, color: colors.mute }} numberOfLines={1}>
            {task.statusLine}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: space.s3 }}>
          <Stat label="Spent" value={`$${task.spent.toFixed(2)}`} />
          <Stat label="Elapsed" value={task.elapsed} />
          <Stat label="Tools" value={`${task.toolsUsed}`} />
        </View>
      </Card>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, gap: 2, backgroundColor: colors.bg2, paddingVertical: space.s2, paddingHorizontal: space.s3, borderRadius: radius.r2 }}>
      <Mono style={{ fontSize: 10, letterSpacing: 0.8 }}>{label.toUpperCase()}</Mono>
      <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 14, color: colors.ink }}>{value}</Text>
    </View>
  );
}

function ApprovalRow({ approval, onPress }: { approval: Approval; onPress: () => void }) {
  const { colors } = useTheme();
  const kind = approval.kind === 'send' || approval.kind === 'tool' ? 'coral' : 'amber';
  return (
    <Pressable onPress={onPress}>
      <Card
        style={{
          padding: space.s4,
          gap: space.s2,
          backgroundColor: kind === 'coral' ? colors.coralSoft : colors.amberSoft,
          borderColor: 'transparent',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2 }}>
          <Ionicons name={kind === 'coral' ? 'mail-outline' : 'alert-circle-outline'} size={18} color={kind === 'coral' ? colors.coralInk : colors.amberInk} />
          <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: fontSize.body, color: kind === 'coral' ? colors.coralInk : colors.amberInk }}>
            {approval.title}
          </Text>
        </View>
        {approval.body && (
          <Body style={{ color: kind === 'coral' ? colors.coralInk : colors.amberInk }} numberOfLines={2}>
            {approval.body}
          </Body>
        )}
        {approval.meta && (
          <Mono style={{ color: kind === 'coral' ? colors.coralInk : colors.amberInk, opacity: 0.7 }}>{approval.meta}</Mono>
        )}
        <View style={{ flexDirection: 'row', gap: space.s2, marginTop: space.s1 }}>
          <Chip kind="default" small>
            Skip
          </Chip>
          <Chip kind={kind === 'coral' ? 'coral' : 'amber'} small>
            Review →
          </Chip>
        </View>
      </Card>
    </Pressable>
  );
}

function SpendCard({ today, cap }: { today: number; cap: number }) {
  const { colors } = useTheme();
  const pct = Math.min(1, today / cap);
  return (
    <Card style={{ padding: space.s4, gap: space.s2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Eyebrow>Today&apos;s spend</Eyebrow>
        <Text style={{ fontFamily: fontFamily.mono, fontSize: 11.5, color: colors.mute }}>cap ${cap.toFixed(2)}</Text>
      </View>
      <View style={{ height: 8, backgroundColor: colors.surface2, borderRadius: radius.pill, overflow: 'hidden' }}>
        <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: pct > 0.85 ? colors.coral : colors.brand }} />
      </View>
      <Text style={{ fontFamily: fontFamily.mono, fontSize: 12, color: colors.ink2 }}>
        ${today.toFixed(2)} of ${cap.toFixed(2)}
      </Text>
    </Card>
  );
}
