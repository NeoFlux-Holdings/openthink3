/* Threads list — search + filter chips + grouped lists. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Body, Dot, Eyebrow, H1, Mono, PillPicker, Screen, SectionLabel } from '../src/components/primitives';
import { LiveDot } from '../src/components/LiveDot';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { SkeletonRow } from '../src/components/Skeleton';
import { TabBar, TAB_BAR_HEIGHT } from '../src/components/TabBar';
import { getThreads, type ThreadSummary } from '../src/lib/api';
import { useSession } from '../src/lib/session-store';
import { tabReTapped } from '../src/lib/events';
import { useTheme } from '../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../src/theme/tokens';

const FALLBACK: ThreadSummary[] = [
  { id: 'q3', title: 'Q3 launch + customer calls', updatedAt: Date.now(), live: true },
  { id: 'redesign', title: 'Compress onboarding to 60s', updatedAt: Date.now() - 1000 * 60 * 60 * 3 },
  { id: 'compete', title: 'Cursor competitive teardown', updatedAt: Date.now() - 1000 * 60 * 60 * 27 },
  { id: 'lunch', title: 'Lunch options for Thursday', updatedAt: Date.now() - 1000 * 60 * 60 * 48 },
  { id: 'taxes', title: 'Q2 estimated taxes', updatedAt: Date.now() - 1000 * 60 * 60 * 72 },
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

  // Scroll-to-top when the Threads tab is re-tapped.
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

  // Build the flat children list + indexes of section headers so we can
  // pass `stickyHeaderIndices` to ScrollView. iOS pins these headers as the
  // user scrolls past them.
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
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: space.s5, paddingTop: space.s8, paddingBottom: TAB_BAR_HEIGHT + space.s5, gap: space.s4 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => {
          setRefreshing(true);
          await load();
          setRefreshing(false);
        }} tintColor={colors.brand} />}
      >
        <H1>Threads</H1>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.s2,
            backgroundColor: colors.surface,
            borderColor: colors.rule2,
            borderWidth: 1,
            borderRadius: radius.r3,
            paddingHorizontal: space.s3,
            height: 44,
          }}
        >
          <Ionicons name="search-outline" size={18} color={colors.soft} />
          <TextInput
            placeholder="Search threads…"
            placeholderTextColor={colors.soft}
            value={query}
            onChangeText={setQuery}
            style={{ flex: 1, fontFamily: fontFamily.body, fontSize: fontSize.body, color: colors.ink }}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.soft} />
            </Pressable>
          )}
        </View>

        <PillPicker options={SCOPES} value={scope} onChange={setScope} />

        {!loaded && (
          <View style={{ gap: 8 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonRow key={`tl-${i}`} lines={2} />
            ))}
          </View>
        )}

        {loaded && sections.map((s) => (
          <View key={s.label}>
            <View style={{ backgroundColor: colors.bg, paddingVertical: 4 }}>
              <SectionLabel count={s.count}>{s.label}</SectionLabel>
            </View>
            {s.rows.map((t) => (
              <Row key={t.id} thread={t} onPress={() => router.push(`/threads/${t.id}`)} />
            ))}
          </View>
        ))}

        {threads.length === 0 && (
          <View style={{ paddingVertical: space.s10, alignItems: 'center', gap: space.s3 }}>
            <Eyebrow>No threads yet</Eyebrow>
            <Body style={{ textAlign: 'center', color: colors.mute }}>
              Tap the orange button below to start one.
            </Body>
          </View>
        )}
      </ScrollView>
      <TabBar active="threads" onNavigate={(href) => router.push(href as any)} onCompose={() => router.push('/sheets/new-task' as any)} />
    </Screen>
  );
}

function Row({ thread, onPress }: { thread: ThreadSummary; onPress: () => void }) {
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
        marginBottom: 6,
        backgroundColor: pressed ? colors.surface2 : colors.surface,
        borderColor: colors.rule,
        borderWidth: 1,
        borderRadius: radius.r3,
      })}
    >
      {thread.live ? <LiveDot kind="coral" size={7} /> : <Dot kind="idle" size={7} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: fontSize.body, color: colors.ink }} numberOfLines={1}>
          {thread.title}
        </Text>
        <Mono style={{ fontSize: 10.5 }}>{formatRelative(thread.updatedAt)}</Mono>
      </View>
      {thread.pending != null && thread.pending > 0 && (
        <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: colors.coralSoft }}>
          <Text style={{ color: colors.coralInk, fontFamily: fontFamily.bodyMedium, fontSize: 10 }}>{thread.pending}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={16} color={colors.soft} />
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
