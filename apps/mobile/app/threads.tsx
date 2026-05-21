/* Threads list — search bar, horizontal filter chips, grouped sections.
 *
 * Each thread row is a SwipeRow so you can pin (drag right) or archive
 * (drag left). Section labels sit in `sticky` slots so they pin to the
 * top of the visible scroll area as you pass them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Eyebrow, Mono, Screen } from '../src/components/primitives';
import { LargeTitleHeader } from '../src/components/LargeTitleHeader';
import { LiveDot } from '../src/components/LiveDot';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { SkeletonRow } from '../src/components/Skeleton';
import { SwipeRow } from '../src/components/SwipeRow';
import { TabBar, TAB_BAR_HEIGHT } from '../src/components/TabBar';
import { getThreads, type ThreadSummary } from '../src/lib/api';
import { useSession } from '../src/lib/session-store';
import { tabReTapped } from '../src/lib/events';
import { useTheme } from '../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../src/theme/tokens';

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

const FALLBACK: ThreadSummary[] = [
  { id: 'q3', title: 'Q3 launch plan + customer calls', updatedAt: Date.now(), live: true, pending: 2 },
  { id: 'redesign', title: 'Compress onboarding to 60s', updatedAt: Date.now() - 1000 * 60 * 60 * 3 },
  { id: 'compete', title: 'Cursor competitive teardown', updatedAt: Date.now() - 1000 * 60 * 60 * 8 },
  { id: 'lunch', title: 'Lunch options near 5th & Howard', updatedAt: Date.now() - 1000 * 60 * 60 * 11 },
  { id: 'taxes', title: 'Q2 estimated taxes', updatedAt: Date.now() - 1000 * 60 * 60 * 28 },
  { id: 'pricing', title: 'Pricing teardown — Linear', updatedAt: Date.now() - 1000 * 60 * 60 * 48 },
  { id: 'd1', title: 'Migrate from Postgres → D1', updatedAt: Date.now() - 1000 * 60 * 60 * 72 },
  { id: 'showhn', title: 'Draft Show HN post', updatedAt: Date.now() - 1000 * 60 * 60 * 100 },
];

type Scope = 'all' | 'live' | 'today' | 'week' | 'approvals';

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'approvals', label: 'Has approvals' },
];

export default function Threads() {
  const router = useRouter();
  const { session } = useSession();
  const { colors } = useTheme();
  const [scope, setScope] = useState<Scope>('all');
  const [query, setQuery] = useState('');
  const [threads, setThreads] = useState<ThreadSummary[]>(FALLBACK);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const scrollRef = useRef<ScrollView | null>(null);

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  useEffect(() => {
    return tabReTapped.on((key) => {
      if (key === 'threads') {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }
    });
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const data = await getThreads(session, scope);
      setThreads(data.threads);
      setOnline(true);
    } catch {
      setOnline(false);
    } finally {
      setLoaded(true);
    }
  }, [scope, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const live: ThreadSummary[] = [];
    const today: ThreadSummary[] = [];
    const week: ThreadSummary[] = [];
    const older: ThreadSummary[] = [];
    const now = Date.now();
    const filtered = query.trim()
      ? threads.filter((t) => t.title.toLowerCase().includes(query.trim().toLowerCase()))
      : threads;
    for (const t of filtered) {
      if (t.live) live.push(t);
      else if (now - t.updatedAt < 24 * 3600_000) today.push(t);
      else if (now - t.updatedAt < 7 * 24 * 3600_000) week.push(t);
      else older.push(t);
    }
    return { live, today, week, older };
  }, [threads, query]);

  const sections = useMemo(() => {
    const groups: { label: string; count: number; rows: ThreadSummary[] }[] = [];
    if (grouped.live.length) groups.push({ label: 'Live', count: grouped.live.length, rows: grouped.live });
    if (grouped.today.length) groups.push({ label: 'Today', count: grouped.today.length, rows: grouped.today });
    if (grouped.week.length) groups.push({ label: 'Earlier this week', count: grouped.week.length, rows: grouped.week });
    if (grouped.older.length) groups.push({ label: 'Older', count: grouped.older.length, rows: grouped.older });
    return groups;
  }, [grouped]);

  return (
    <Screen>
      <OfflineBanner online={online} onRetry={() => void load()} />

      <LargeTitleHeader
        title="Threads"
        subtitle={
          threads.length === 0
            ? 'No threads'
            : `${threads.filter((t) => t.live).length} live · ${threads.length} total`
        }
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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.brand}
          />
        }
      >
        {/* Search */}
        <View style={{ paddingHorizontal: space.s4 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s2,
              backgroundColor: colors.surface,
              borderColor: colors.rule,
              borderWidth: 1,
              borderRadius: radius.r3,
              paddingHorizontal: space.s3,
              height: 40,
            }}
          >
            <Ionicons name="search-outline" size={16} color={colors.soft} />
            <TextInput
              placeholder="Search threads, artifacts"
              placeholderTextColor={colors.soft}
              value={query}
              onChangeText={setQuery}
              style={{ flex: 1, fontFamily: fontFamily.body, fontSize: 14, color: colors.ink }}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={16} color={colors.soft} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Filter chips — horizontal scroll like iOS smart-filter row */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space.s4, gap: 6 }}
        >
          {SCOPES.map((s) => {
            const on = s.value === scope;
            return (
              <Pressable
                key={s.value}
                onPress={() => setScope(s.value)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                  borderRadius: radius.pill,
                  backgroundColor: on ? colors.ink : colors.surface,
                  borderWidth: 1,
                  borderColor: on ? colors.ink : colors.rule,
                }}
              >
                <Text
                  style={{
                    fontFamily: fontFamily.bodyMedium,
                    fontSize: 12.5,
                    color: on ? colors.bg : colors.ink2,
                  }}
                >
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {!loaded && (
          <View style={{ gap: 8, paddingHorizontal: space.s4 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonRow key={`tl-${i}`} lines={2} />
            ))}
          </View>
        )}

        {loaded &&
          sections.map((s) => (
            <View key={s.label} style={{ gap: 1 }}>
              <View
                style={{
                  paddingHorizontal: space.s4,
                  paddingVertical: 6,
                  backgroundColor: colors.bg,
                }}
              >
                <Eyebrow>
                  {s.label} · {s.count}
                </Eyebrow>
              </View>
              <View
                style={{
                  marginHorizontal: space.s4,
                  borderRadius: radius.r4,
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: colors.rule,
                  backgroundColor: colors.surface,
                }}
              >
                {s.rows.map((t, i) => (
                  <SwipeRow
                    key={t.id}
                    left={t.live ? undefined : { icon: 'star-outline', label: 'Pin', tone: 'pin' }}
                    right={{ icon: 'archive-outline', label: 'Archive', tone: 'archive' }}
                    onLeft={() => {/* TODO pin */}}
                    onRight={() => {/* TODO archive */}}
                  >
                    <ThreadRow
                      thread={t}
                      onPress={() => router.push(`/threads/${t.id}`)}
                      isLast={i === s.rows.length - 1}
                    />
                  </SwipeRow>
                ))}
              </View>
            </View>
          ))}

        {threads.length === 0 && (
          <View
            style={{ paddingVertical: space.s10, alignItems: 'center', gap: space.s2, paddingHorizontal: space.s4 }}
          >
            <Eyebrow>No threads yet</Eyebrow>
            <Text style={{ textAlign: 'center', color: colors.mute, fontFamily: fontFamily.body, fontSize: 14 }}>
              Tap the orange button below to start one.
            </Text>
          </View>
        )}
      </AnimatedScrollView>

      <TabBar
        active="threads"
        onNavigate={(href) => router.push(href as never)}
        onCompose={() => router.push('/sheets/new-task' as never)}
      />
    </Screen>
  );
}

function ThreadRow({
  thread,
  onPress,
  isLast,
}: {
  thread: ThreadSummary;
  onPress: () => void;
  isLast: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s3,
        paddingVertical: space.s3,
        paddingHorizontal: space.s4,
        backgroundColor: pressed ? colors.surface2 : colors.surface,
        borderBottomWidth: isLast ? 0 : 0.5,
        borderBottomColor: colors.rule,
      })}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 7,
          backgroundColor: thread.live ? colors.coralSoft : colors.brandSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons
          name="git-branch-outline"
          size={14}
          color={thread.live ? colors.coralInk : colors.brandInk}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {thread.live && <LiveDot kind="coral" size={6} />}
          <Text
            style={{
              flex: 1,
              fontFamily: fontFamily.bodyMedium,
              fontSize: fontSize.body,
              color: colors.ink,
            }}
            numberOfLines={1}
          >
            {thread.title}
          </Text>
        </View>
        <Mono style={{ fontSize: 11.5 }} numberOfLines={1}>
          {thread.live ? 'browsing calendly · 2 approvals waiting' : `agent · ${formatRelative(thread.updatedAt)}`}
        </Mono>
      </View>
      {thread.pending != null && thread.pending > 0 && (
        <View
          style={{
            paddingHorizontal: 7,
            paddingVertical: 2,
            borderRadius: radius.pill,
            backgroundColor: colors.coralSoft,
          }}
        >
          <Text style={{ color: colors.coralInk, fontFamily: fontFamily.bodyMedium, fontSize: 10 }}>
            {thread.pending}
          </Text>
        </View>
      )}
      <Text style={{ fontFamily: fontFamily.mono, fontSize: 11, color: colors.soft }}>
        {thread.live ? 'now' : formatShortRelative(thread.updatedAt)}
      </Text>
    </Pressable>
  );
}

function formatRelative(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 24 * 3600_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function formatShortRelative(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 24 * 3600_000) return `${Math.round(diff / 3_600_000)}h`;
  return `${Math.round(diff / 86_400_000)}d`;
}
