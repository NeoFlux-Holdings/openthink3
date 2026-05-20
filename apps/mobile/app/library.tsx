/* Library — 2-column grid of artifact tiles. Tap → opens in your browser
 * (the web shell renders artifacts much better than we can on a phone).
 */
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Body, Chip, Eyebrow, H1, Mono, PillPicker, Screen } from '../src/components/primitives';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { Skeleton } from '../src/components/Skeleton';
import { TabBar, TAB_BAR_HEIGHT } from '../src/components/TabBar';
import { getLibrary } from '../src/lib/api';
import { useSession } from '../src/lib/session-store';
import { useTheme } from '../src/theme/ThemeContext';
import { fontSize, radius, space, type as fontFamily } from '../src/theme/tokens';

type Filter = 'all' | 'doc' | 'code' | 'table' | 'image' | 'chart' | 'webpage';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'doc', label: 'Doc' },
  { value: 'code', label: 'Code' },
  { value: 'table', label: 'Table' },
  { value: 'image', label: 'Image' },
  { value: 'chart', label: 'Chart' },
  { value: 'webpage', label: 'Webpage' },
];

interface Item {
  id: string;
  title: string;
  type: string;
  size: string;
  age: string;
}

const FALLBACK: Item[] = [
  { id: '1', title: 'launch.md', type: 'doc', size: '4.2KB', age: '12m' },
  { id: '2', title: 'candidates', type: 'table', size: '1.4KB', age: '14m' },
  { id: '3', title: 'book-meeting.skill.ts', type: 'code', size: '2.1KB', age: '3h' },
  { id: '4', title: 'wallpaper.png', type: 'image', size: '482KB', age: '11m' },
  { id: '5', title: 'pricing-v2', type: 'webpage', size: '6.8KB', age: '2d' },
  { id: '6', title: 'cost-7d', type: 'chart', size: '0.8KB', age: '4h' },
];

export default function Library() {
  const router = useRouter();
  const { session } = useSession();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<Item[]>(FALLBACK);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const data = await getLibrary(session);
      setItems(data.items);
      setOnline(true);
    } catch {
      setOnline(false);
    } finally {
      setLoaded(true);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = filter === 'all' ? items : items.filter((i) => i.type === filter);

  return (
    <Screen>
      <OfflineBanner online={online} onRetry={() => void load()} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.s5,
          paddingTop: space.s8,
          paddingBottom: TAB_BAR_HEIGHT + space.s5,
          gap: space.s4,
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
        <H1>Library</H1>
        <PillPicker options={FILTERS} value={filter} onChange={setFilter} />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 }}>
          {!loaded
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={`lt-${i}`} width="48%" height={170} borderRadius={radius.r4} />
              ))
            : filtered.map((item) => (
                <Tile key={item.id} item={item} onPress={() => session && Linking.openURL(`${session.agentUrl}/#/library?artifact=${item.id}`)} />
              ))}
        </View>

        {filtered.length === 0 && (
          <View style={{ paddingVertical: space.s10, alignItems: 'center', gap: space.s2 }}>
            <Eyebrow>Empty</Eyebrow>
            <Body style={{ color: colors.mute }}>Nothing matches that filter yet.</Body>
          </View>
        )}
      </ScrollView>
      <TabBar active="library" onNavigate={(href) => router.push(href as any)} onCompose={() => router.push('/sheets/new-task' as any)} />
    </Screen>
  );
}

function Tile({ item, onPress }: { item: Item; onPress: () => void }) {
  const { colors } = useTheme();
  const tint =
    item.type === 'browser' ? colors.coralSoft :
    item.type === 'image' ? colors.brandSoft :
    item.type === 'code' ? '#0E0F12' :
    colors.surface2;
  const icon =
    item.type === 'doc' ? 'document-text-outline' :
    item.type === 'code' ? 'code-slash-outline' :
    item.type === 'table' ? 'grid-outline' :
    item.type === 'image' ? 'image-outline' :
    item.type === 'webpage' ? 'globe-outline' :
    item.type === 'chart' ? 'stats-chart-outline' :
    'cube-outline';
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: '48%',
        backgroundColor: colors.surface,
        borderColor: colors.rule,
        borderWidth: 1,
        borderRadius: radius.r4,
        overflow: 'hidden',
      }}
    >
      <View style={{ aspectRatio: 4 / 3, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={36} color={item.type === 'code' ? '#fff' : colors.mute} />
        <View
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            paddingHorizontal: 7,
            paddingVertical: 2,
            borderRadius: 4,
            backgroundColor: 'rgba(14,15,18,0.78)',
          }}
        >
          <Text style={{ color: '#fff', fontFamily: fontFamily.monoMedium, fontSize: 9.5, letterSpacing: 0.5 }}>
            {item.type.toUpperCase()}
          </Text>
        </View>
      </View>
      <View style={{ padding: 10, gap: 4 }}>
        <Text style={{ fontFamily: fontFamily.bodyMedium, fontSize: 13, color: colors.ink }} numberOfLines={1}>
          {item.title}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Mono style={{ fontSize: 10.5 }}>{item.size}</Mono>
          <Mono style={{ fontSize: 10.5, color: colors.soft }}>{item.age}</Mono>
        </View>
      </View>
    </Pressable>
  );
}
